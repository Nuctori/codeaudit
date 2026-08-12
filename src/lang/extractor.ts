import { createHash } from "node:crypto";
import type Parser from "web-tree-sitter";
import type { SyntaxNode } from "./pack";
import type { LangPack, RawCall, RawChunk, RawFileFacts } from "./pack";
import { UNRESOLVED_TARGET } from "./pack";

/**
 * 通用提取器：一次 AST 遍历，由语言包的数据表驱动。
 *
 * 公理1（边的守恒）：遍历为每个调用点找到最近的 chunk 归属；
 * 不归属任何具名 chunk 的调用进文件级伪 chunk "<module>"。
 */
export class Extractor {
  private readonly parser: Parser;

  constructor(
    ParserCtor: typeof Parser,
    private readonly pack: LangPack,
    language: Parser.Language,
  ) {
    this.parser = new ParserCtor();
    this.parser.setLanguage(language);
  }

  extract(source: string, file: string, precomputedHash?: string): RawFileFacts {
    const tree = this.parser.parse(source);
    const root = tree.rootNode;
    const chunks: RawChunk[] = [];
    // 伪 chunk 收容模块级调用（公理1）；行数计数循环（split 生成 10M 元素数组 ~300MB 瞬态）
    let lineCount = 1;
    for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) lineCount++;
    const moduleChunk = fresh("<module>", 1, lineCount, "", null, "module");
    const stack: MutableChunk[] = [moduleChunk];

    const visit = (node: SyntaxNode): void => {
      // CJS 导出函数 chunk（迭代15 解构 require 盲区）：exports.handler = function(){} /
      // module.exports.handler = fn → 建命名 chunk（名 = 成员名），from-import 语义
      // （imported="handler"）可解析；否则导出函数只有 <module> 伪 chunk，解构 require 回调全落 ?
      const cjsName = this.cjsExportName(node);
      const isChunk = this.pack.chunkNodes.includes(node.type) || cjsName !== null;
      let pushed = false;
      if (isChunk) {
        const name = cjsName ?? this.chunkName(node);
        if (name !== null) {
          const mc = fresh(
            name,
            node.startPosition.row + 1,
            node.endPosition.row + 1,
            normalizeCode(node),
            this.ownerClass(node),
            this.pack.classNodes.includes(node.type) ? "class" : "function",
          );
          mc.nesting = this.maxNesting(node);
          mc.assigned = this.assignedNames(node);
          mc.declared = this.declaredNames(node);
          mc.params = this.paramNames(node);
          chunks.push(mc as RawChunk);
          stack.push(mc);
          pushed = true;
        }
      }
      if (this.pack.callNodes.includes(node.type)) {
        stack[stack.length - 1]!.calls.push(this.callOf(node));
      }
      // 状态写检测（用户需求 2026-08-11）：self.x = / this.x = / global、nonlocal 声明 /
      // 任意外部对象属性写（user.status = "banned"，obj 非局部新建）→ state 效应。
      // 位置化（迭代8 视角2）：返回位置列表（"self.x" / "user.status" / "counter"）供读方传播匹配。
      // CJS 导出赋值（cjsExportName 命中）是模块级导出定义非 chunk 体状态写——跳过（迭代15 视角 2 探针发现）
      const writes = cjsName === null ? this.stateWritePos(node, stack[stack.length - 1]!) : [];
      for (const w of writes) {
        const t = stack[stack.length - 1]!;
        if (!t.stateWrites.includes(w)) t.stateWrites.push(w);
      }
      // 读侧提取（迭代8 视角2）：attribute/member 值读取 → stateReads（赋值左值/调用目标排除）
      const reads = this.stateReadPos(node, stack[stack.length - 1]!);
      for (const r of reads) {
        const t = stack[stack.length - 1]!;
        if (!t.stateReads.includes(r)) t.stateReads.push(r);
      }
      // 异常抛出提取（盲区1）：raise/throw → chunk.thrownTypes（异常类型字面可静态提取；裸 raise/throw → "*"）
      const thrown = this.thrownTypeOf(node);
      if (thrown !== null) {
        const t = stack[stack.length - 1]!;
        if (!t.thrownTypes.includes(thrown)) t.thrownTypes.push(thrown);
      }
      // 异常捕获提取（迭代7 视角3 ④）：catch 子句类型——TS catch {} 吞一切（"*"）；Python except X 精确类型
      const caught = this.catchTypeOf(node);
      if (caught !== null) {
        const t = stack[stack.length - 1]!;
        if (!t.catches.includes(caught)) t.catches.push(caught);
      }
      for (const child of node.children) visit(child);
      if (pushed) stack.pop();
    };
    visit(root);
    // 模块级遮蔽守卫：module chunk 的 assigned = 文件级绑定（函数内重绑由各 chunk 自己的 assigned 管；
    // 模块级重绑影响所有消费者——如 from db import conn 后被 conn = other 重绑）
    moduleChunk.assigned = this.assignedNames(root);

    chunks.unshift(moduleChunk as RawChunk);
    return {
      file,
      lang: this.pack.name,
      contentHash: precomputedHash ?? createHash("sha256").update(source, "utf8").digest("hex"),
      chunks,
      imports: this.pack.extractImports(root),
      defaultExport: findDefaultExport(root, this.pack),
      moduleBindings: this.moduleBindingsOf(root),
      parseError: root.hasError,
    };
  }

  /** 模块级单赋值绑定（模块级值绑定溯源，A）：名称 → 构造类名；last-write-wins；定义遮蔽赋值。 */
  private moduleBindingsOf(root: SyntaxNode): Record<string, string> {
    const bindings: Record<string, string> = {};
    for (const stmt0 of root.children) {
      // 解包包装节点：TS export const x = ...（export_statement→variable_declarator）、
      // Python 表达式语句（expression_statement→assignment）
      let stmt: SyntaxNode = stmt0;
      if (stmt.type === "export_statement") {
        const decl = stmt.children.find((c) => c.type === "variable_declaration" || c.type === "lexical_declaration");
        if (decl) stmt = decl.children.find((c) => c.type === "variable_declarator") ?? stmt;
      } else if (stmt.type === "expression_statement") {
        const inner = stmt.children[0];
        if (inner && (inner.type === "assignment" || inner.type === "assignment_expression")) stmt = inner;
      }
      // 赋值/声明：x = C() / const x = new C() / const x = C()
      if (stmt.type === "assignment" || stmt.type === "variable_declarator" || stmt.type === "assignment_expression") {
        const left = stmt.childForFieldName("left") ?? stmt.childForFieldName("name");
        const value = stmt.childForFieldName("right") ?? stmt.childForFieldName("value");
        if (left && (left.type === "identifier" || left.type === "property_identifier") && value) {
          let cls: string | null = null;
          if (value.type === "call" || value.type === "call_expression") {
            const fn = value.childForFieldName("function") ?? value.children[0];
            if (fn && (fn.type === "identifier" || fn.type === "property_identifier") && fn.text !== "require") cls = fn.text;
          } else if (value.type === "new_expression") {
            const ctor = value.childForFieldName("constructor") ?? value.children[1];
            if (ctor && (ctor.type === "identifier" || ctor.type === "property_identifier")) cls = ctor.text;
          }
          if (cls !== null) bindings[left.text] = cls;
          else delete bindings[left.text]; // 非类赋值/重绑 → 清除（不可证）
        }
      } else if (stmt.type === "function_definition" || stmt.type === "class_definition" ||
                 stmt.type === "function_declaration" || stmt.type === "class_declaration") {
        const nameNode = stmt.childForFieldName("name");
        if (nameNode) delete bindings[nameNode.text]; // 定义遮蔽赋值绑定
      }
    }
    return bindings;
  }

  /** 状态写位置提取（迭代8 视角2）：self.x= / this.x= / global、nonlocal 声明 → 位置列表（空 = 非写）。 */
  private stateWritePos(node: SyntaxNode, chunk: MutableChunk): string[] {
    if (node.type === "global_statement" || node.type === "nonlocal_statement") {
      // Python：global counter, x → 声明名列表
      return node.children.filter((c) => c.type === "identifier").map((c) => c.text);
    }
    if (node.type === "assignment" || node.type === "augmented_assignment" ||
        node.type === "assignment_expression" || node.type === "augmented_assignment_expression") {
      // TS/JS：x = y → assignment_expression；x += y → augmented_assignment_expression（迭代8 F1）
      // 迭代25：C# 对象初始化器（new C { A = v }）——新鲜对象属性初始化，非外部状态写。
      // TS/JS 对象字面量是 pair 节点、从不触发写分支；Python dict 同理——本跳过是对齐语义。
      if (node.parent?.type === "initializer_expression") return [];
      const left = node.childForFieldName("left") ?? node.children[0];
      const pos = this.externalWritePos(left, chunk);
      return pos !== null ? [pos] : [];
    }
    if (node.type === "update_expression") {
      // TS：this.x++ / this.x--
      const arg = node.childForFieldName("argument") ?? node.children[0];
      const pos = this.externalWritePos(arg, chunk);
      return pos !== null ? [pos] : [];
    }
    if (node.type === "postfix_unary_expression" || node.type === "prefix_unary_expression") {
      // 迭代25：C# i++ / this.x++ / ++i。操作数是唯一 named 子节点（++/-- 是匿名 token）；
      // 不用 children[0]（prefix 的 children[0] 是 `++`）——web-tree-sitter 引用比较恒真（iter24 教训）。
      // 注意：!x / -x / ~x 同为 prefix_unary_expression 但语义是**读**（逻辑非/取负）——只认 ++/-- 操作符。
      const isIncDec = node.children.some((c) => c.text === "++" || c.text === "--");
      if (!isIncDec) return [];
      const arg = node.children.find((c) => c.isNamed) ?? null;
      const pos = this.externalWritePos(arg, chunk);
      return pos !== null ? [pos] : [];
    }
    return [];
  }

  /** 读侧状态位置（迭代8 视角2）：attribute/member 值读取 → "self.x"/"user.status"/"⊤"；空 = 非读。
   *  迭代24 修复（审计 docs/iter24/audit.md）：
   *  - 节点同一性 `===` → `.id`（web-tree-sitter 每次属性访问返回新节点对象，`===` 恒假——
   *    「调用目标排除」「赋值左值跳过」自迭代8 起是死代码，对所有语言生效）；
   *  - 成员访问结构的子标识符不再独立裸读（对象名/成员名由成员节点单点承担）；
   *  - 节点过滤补 C#（member_access_expression/conditional_access_expression）；
   *  - 调用 parent 列表补 C#（invocation_expression/object_creation_expression）；
   *  - 边缘：a.b?.c() 内层成员（parent 是 conditional_access_expression 的调用链）；
   *  - obj/attr 提取按类型分支（C# 字段是 expression/name；?. 的 name 在 member_binding_expression 内）。 */
  private stateReadPos(node: SyntaxNode, chunk: MutableChunk): string[] {
    if (node.type === "identifier") {
      // 裸标识符读（模块级 let / 闭包外层变量）：∉ 参数 且 ∉ 局部赋值 → 外部状态读（终裁 Step1）。
      // 迭代24：成员访问结构（obj.attr / obj?.attr）的子标识符由成员节点统一承担——跳过，避免
      // C#/Python 成员名（identifier 类型）被当裸变量读（Foo.instance.x 的 instance/成员名全误读）。
      const p = node.parent;
      if (p && (p.type === "attribute" || p.type === "member_expression" ||
          p.type === "member_access_expression" || p.type === "conditional_access_expression" ||
          p.type === "member_binding_expression")) return [];
      // 迭代26-27：统一声明名抑制——声明名不是裸变量读（parent 的 name 字段指向自身、
      // 或声明结构中的名字位置）。.id 判等（iter24 教训：`===` 恒假）。
      const p2 = p;
      // ① name 字段（def foo / function foo / C# method/catch_declaration name，迭代26）
      if (p2 && p2.childForFieldName("name")?.id === node.id) return [];
      // ② C# variable_declarator 无 name 字段——children[0] 即声明名位置（裸 identifier 或 pattern）。
      //    简单名（var q=1）已被 assigned 覆盖（迭代25c），本规则对其冗余无害；真收益 = pattern 名。
      if (p2 && p2.type === "variable_declarator" && p2.children[0]?.id === node.id) return [];
      // ③ pattern 名：C# tuple_pattern / TS array_pattern 的直接 identifier 子节点（pattern 在声明名位置）
      const pp = p2?.parent;
      if (pp && pp.type === "variable_declarator" && pp.children[0]?.id === p2?.id &&
          (p2?.type === "tuple_pattern" || p2?.type === "array_pattern")) return [];
      // ④ C# foreach 变量：for_each_statement 的裸 identifier 直接子节点，且位于 `in` token 之前
      //    （其后同名 identifier 是集合 arr——真读，不得抑制）。
      if (p2 && p2.type === "for_each_statement") {
        const kids = p2.children;
        const inIdx = kids.findIndex((c) => c.type === "in");
        if (inIdx >= 0 && kids.some((c, i) => c.id === node.id && i < inIdx)) return [];
      }
      // ⑤ 异常变量：TS/JS catch_clause 唯一 identifier 直接子节点；Python except as_pattern_target 的唯一 identifier
      if (p2 && (p2.type === "catch_clause" || p2.type === "as_pattern_target")) return [];
      if (!chunk.params.includes(node.text) && !chunk.assigned.includes(node.text)) return [node.text];
      return [];
    }
    if (node.type !== "attribute" && node.type !== "member_expression" &&
        node.type !== "member_access_expression" && node.type !== "conditional_access_expression") return [];
    const parent = node.parent;
    const isAssignmentParent = (t: string): boolean =>
      t === "assignment" || t === "augmented_assignment" ||
      t === "assignment_expression" || t === "augmented_assignment_expression" ||
      t === "update_expression";
    const isCallLike = (t: string): boolean =>
      t === "call" || t === "call_expression" || t === "new_expression" ||
      t === "invocation_expression" || t === "object_creation_expression";
    if (parent && isAssignmentParent(parent.type)) {
      // 赋值左值跳过（写侧已处理；augmented/update 的右值读由右侧表达式节点捕获）
      const left = parent.childForFieldName("left") ?? parent.children[0] ?? null;
      if (left != null && left.id === node.id) return [];
    }
    if (parent && isCallLike(parent.type)) {
      // 调用目标排除（user.save() 不是字段值读取；instance.Method() 同理）
      const fn = parent.childForFieldName("function") ?? parent.childForFieldName("constructor") ?? parent.children[0] ?? null;
      if (fn != null && fn.id === node.id) return [];
    }
    // 边缘：a.b?.c() 内层成员——member_access_expression(a.b) 的 parent 是 conditional_access_expression
    // （非调用），但该 conditional 是 invocation 的 function 链一部分 → 排除内层成员
    if (parent && parent.type === "conditional_access_expression") {
      const gp = parent.parent;
      if (gp && isCallLike(gp.type)) {
        const fn = gp.childForFieldName("function") ?? gp.children[0] ?? null;
        if (fn != null && fn.id === parent.id) return [];
      }
    }
    // obj/attr 按类型分支（C# 字段名：member_access_expression 是 expression/name；
    // conditional_access_expression 无字段，name 在 member_binding_expression 首个子节点）
    let obj: SyntaxNode | null = null;
    let attrNode: SyntaxNode | null = null;
    if (node.type === "conditional_access_expression") {
      obj = node.children[0] ?? null;
      const mbe = node.children.find((c) => c.type === "member_binding_expression");
      attrNode = mbe ? (mbe.namedChildren[0] ?? null) : null;
    } else {
      obj = node.childForFieldName("object") ?? node.childForFieldName("expression") ?? node.children[0] ?? null;
      attrNode = node.childForFieldName("attribute") ?? node.childForFieldName("property") ??
        node.childForFieldName("name") ?? node.children[node.children.length - 1] ?? null;
    }
    if (!obj || !attrNode) return [];
    if (obj.text === "self" || obj.text === "cls" || obj.text === "this") return [`self.${attrNode.text}`];
    if (obj.type === "identifier") {
      if (chunk.params.includes(obj.text) || !chunk.assigned.includes(obj.text)) return [`${obj.text}.${attrNode.text}`];
      return []; // 局部对象读（非外部）
    }
    // 下标/调用结果接收者：根限定 ⊤（d[k] 读 → "d.⊤"）或全局 ⊤
    const root = this.subscriptRoot(obj);
    return root !== null ? [`${root}.⊤`] : ["⊤"];
  }

  /** 下标/调用表达式根标识符（d[k] → d；f(x)[k] → 回溯到根标识符或 null）。 */
  private subscriptRoot(node: SyntaxNode): string | null {
    let n: SyntaxNode | null = node;
    for (let i = 0; i < 8 && n !== null; i++) {
      if (n.type === "identifier") return n.text;
      n = n.childForFieldName("value") ?? n.childForFieldName("object") ?? n.childForFieldName("function") ?? n.children[0] ?? null;
    }
    return null;
  }

  /** 异常捕获类型提取（迭代7 ④）：catch_clause（TS catch {} / catch(e) → "*" 吞一切）；
   *  Python except_clause（except ValueError → "ValueError"；裸 except: → "*"）。非捕获节点 → null。 */
  private catchTypeOf(node: SyntaxNode): string | null {
    if (node.type === "catch_clause") return "*"; // TS/JS catch 无条件吞一切（无类型化 catch）
    if (node.type === "except_clause") {
      // Python：except ValueError: / except (A, B): / except: / except Exception as e:
      const typ = node.children.find((c) => c.type === "identifier" || c.type === "attribute" || c.type === "tuple");
      if (!typ) return "*"; // 裸 except:
      if (typ.type === "tuple") return "*"; // except (A, B): 多类型——保守吞一切（过近似安全）
      return typ.text; // 精确类型（仅字面匹配；项目自定义类型未提取继承边 → 保守不减其子类）
    }
    return null;
  }

  /** chunk 自身参数名（不进入嵌套函数——只取本 chunk 的 parameters 字段直接子节点）。 */
  private paramNames(root: SyntaxNode): string[] {
    const out: string[] = [];
    const params = root.childForFieldName("parameters");
    if (!params) return out;
    const push = (n: SyntaxNode): void => {
      const named = n.childForFieldName("name") ?? n.childForFieldName("pattern");
      if (named && (named.type === "identifier" || named.type === "property_identifier")) {
        out.push(named.text);
      } else if (n.type === "identifier" || n.type === "property_identifier") {
        out.push(n.text);
      }
    };
    for (const c of params.children) push(c);
    return out;
  }

  /** 本 chunk 内声明名（variable_declarator 的 let/const/var 定义，含解构绑定；Python 赋值非声明不收集）——裸标识符写外部性判定。 */
  private declaredNames(root: SyntaxNode): string[] {
    const out: string[] = [];
    const collectPattern = (n: SyntaxNode): void => {
      if (n.type === "shorthand_property_identifier_pattern" || n.type === "identifier" || n.type === "property_identifier") {
        out.push(n.text);
      } else {
        for (const c of n.children) collectPattern(c);
      }
    };
    const walk = (n: SyntaxNode): void => {
      if (n.type === "variable_declarator") {
        const left = n.childForFieldName("name") ?? n.children[0];
        if (!left) return;
        if (left.type === "identifier" || left.type === "property_identifier") out.push(left.text);
        else collectPattern(left); // const {a} = obj / const [x] = arr（计算理论 Note：解构绑定是局部声明）
      }
      for (const c of n.children) walk(c);
    };
    walk(root);
    return out;
  }

  /** 异常抛出类型提取（盲区1）：raise X / throw new Y() → 类型文本；裸 raise/throw → "*"；非抛出节点 → null。 */
  private thrownTypeOf(node: SyntaxNode): string | null {
    if (node.type === "raise_statement") {
      // Python：raise / raise ValueError / raise ValueError("x")
      const exc = node.children.find((c) => c.type === "call" || c.type === "identifier" || c.type === "attribute");
      if (!exc) return "*";
      if (exc.type === "call") {
        const fn = exc.childForFieldName("function") ?? exc.children[0];
        if (!fn) return "*";
        const flat = flattenCallTarget(fn);
        return flat !== null ? flat.split(".").pop()! : "*";
      }
      const flat = flattenCallTarget(exc);
      return flat !== null ? flat.split(".").pop()! : "*";
    }
    if (node.type === "throw_statement") {
      // TS/JS：throw new Error() / throw err / throw "x"
      const arg = node.childForFieldName("argument") ?? node.children.find((c) => c.type !== "throw");
      if (!arg) return "*";
      if (arg.type === "new_expression") {
        const ctor = arg.childForFieldName("constructor") ?? arg.children[1];
        if (ctor) return ctor.type === "identifier" ? ctor.text : "*";
        return "*";
      }
      if (arg.type === "identifier") return arg.text;
      return "*";
    }
    return null;
  }

  /**
   * 外部状态写判定：赋值目标是 self./cls./this. 属性，或任意对象属性且对象名**不在本 chunk 的
   * 局部赋值**（assigned）中——参数（params 含）/模块级对象属性写（user.status = "banned"）算外部
   * 状态写；局部新建对象初始化（const o = {}; o.x = 1）不算（obj 在 assigned 且非参数）。
   */
  /**
   * 外部状态写位置：赋值目标是 self./cls./this. 属性，或任意对象属性且对象名**不在本 chunk 的
   * 局部赋值**（assigned）中——参数（params 含）/模块级对象属性写（user.status = "banned"）算外部
   * 状态写；局部新建对象初始化（const o = {}; o.x = 1）不算（obj 在 assigned 且非参数）。
   * 返回位置字符串（"self.x" / "user.status"）；非外部写 → null。
   */
  private externalWritePos(left: SyntaxNode | null | undefined, chunk: MutableChunk): string | null {
    if (!left) return null;
    if (left.type === "identifier" || left.type === "property_identifier") {
      // 裸标识符写：TS/JS 模块级 let/闭包外层变量（let count; inc(){count++} / count = count - 1）→ 外部；
      // Python 函数内赋值 = 局部定义（global/nonlocal 由 global_statement 分支处理）→ 非外部。
      // module chunk 特判：模块级赋值（handler = ...）是定义非外部写。
      // 参数重绑（function f(x){ x = 5 }）纯局部（JS 语义）→ 非外部（迭代15 F2 修复）。
      // 终裁 Step1 {closure} 折叠进 state；S1 假纯洞修复（迭代12 Jeff P0）
      if (chunk.kind === "module") return null;
      if (this.pack.name === "python") return null;
      if (chunk.declared.includes(left.text)) return null; // 局部声明（let y = 0; y = 5）
      if (chunk.params.includes(left.text)) return null; // 参数重绑（F2）
      // 迭代25：C# 类成员方法内裸字段写（score = v）→ self.score（类内状态，非全局裸名）。
      // 边界：最近函数状祖先是 method/constructor_declaration 才成立——C# 无全局变量，
      // 方法内可裸写的名字只有 局部(declared)/参数(params)/字段属性/静态字段，后两者即 self 语义；
      // local_function_statement 排除：捕获外层局部时语义等同 TS 闭包（裸外部写，与 TS 一致）。
      if (this.pack.name === "csharp" && this.inClassMemberBody(left)) return `self.${left.text}`;
      return left.text; // TS/JS 裸标识符写 = 外部
    }
    const readTarget = (obj: SyntaxNode | null | undefined, attr: string | null | undefined): string | null => {
      if (!obj || !attr) return null;
      if (obj.text === "self" || obj.text === "cls" || obj.text === "this") return `self.${attr}`;
      if (obj.type === "identifier" &&
          (chunk.params.includes(obj.text) || !chunk.assigned.includes(obj.text))) {
        return `${obj.text}.${attr}`;
      }
      return null;
    };
    if (left.type === "attribute") {
      const obj = left.childForFieldName("object") ?? left.children[0] ?? null;
      const attr = left.childForFieldName("attribute") ?? left.children[left.children.length - 1] ?? null;
      const rt = readTarget(obj, attr?.text);
      if (rt !== null) return rt;
      // ②b（迭代26）：d[k].x = v（obj 是 subscript）→ 镜像读侧 subscriptRoot → "d.⊤"。
      // 仅复杂 obj（subscript/call 链）启用——identifier 局部/外部已由 readTarget 正确判定，
      // subscriptRoot 对裸 identifier 会误报局部（o.x=1 的 o 在 assigned → 不得产生写）。
      const root = obj !== null && obj.type !== "identifier" && obj.type !== "property_identifier"
        ? this.subscriptRoot(obj) : null;
      return root !== null ? `${root}.⊤` : null;
    }
    if (left.type === "member_expression") {
      const obj = left.childForFieldName("object") ?? left.children[0] ?? null;
      const attr = left.childForFieldName("property") ?? left.children[left.children.length - 1] ?? null;
      const rt = readTarget(obj, attr?.text);
      if (rt !== null) return rt;
      const root = obj !== null && obj.type !== "identifier" && obj.type !== "property_identifier"
        ? this.subscriptRoot(obj) : null;
      return root !== null ? `${root}.⊤` : null;
    }
    // 迭代24 写侧对偶（审计 ⑦）：C# this.x = v / instance.Field = v 的 left 是 member_access_expression
    // （字段 expression/name）——此前只认 attribute/member_expression，C# 字段写完全不可见
    if (left.type === "member_access_expression") {
      const obj = left.childForFieldName("expression") ?? left.children[0] ?? null;
      const attr = left.childForFieldName("name") ?? left.children[left.children.length - 1] ?? null;
      const rt = readTarget(obj, attr?.text);
      if (rt !== null) return rt;
      const root = obj !== null && obj.type !== "identifier" && obj.type !== "property_identifier"
        ? this.subscriptRoot(obj) : null;
      return root !== null ? `${root}.⊤` : null;
    }
    // 迭代26：下标/元素访问左值写（arr[i]=v / this.arr[0]=x / items[0]++）——此前全无写 = 假纯缺陷。
    // 容器位置语义（审计裁决）：arr[i]=v → "arr"（容器本身，精确/前缀双命中）；非 "arr.⊤"
    // （"arr.⊤" 写只匹配 "d.⊤" 读者，漏主模式——state.ts:41-59 实证）。
    if (left.type === "subscript" || left.type === "subscript_expression" || left.type === "element_access_expression") {
      const obj = left.childForFieldName("object") ?? left.childForFieldName("expression") ?? left.children[0] ?? null;
      if (!obj) return null;
      if (obj.type === "identifier" || obj.type === "property_identifier") {
        if (chunk.kind === "module") return null; // 模块级数组初始化（定义非外部写）
        if (chunk.params.includes(obj.text)) return obj.text; // 参数容器变异（arr[0]=1）影响调用方 → 外部
        // C# 类成员方法内裸字段容器（items[0]=v）→ self.items（类内状态，与裸字段写 self.attr 对偶）；
        // 方法内局部数组（declared 含）→ 非外部
        if (this.pack.name === "csharp" && this.inClassMemberBody(obj)) {
          return chunk.declared.includes(obj.text) ? null : `self.${obj.text}`;
        }
        // 与 readTarget 同判：局部容器（assigned 含且非参数，如 for 变量 item["x"]=v）→ 非外部
        if (chunk.declared.includes(obj.text) || chunk.assigned.includes(obj.text)) return null;
        return obj.text;
      }
      if (obj.type === "member_expression" || obj.type === "member_access_expression" || obj.type === "attribute") {
        // this.arr[0]=x / user.arr[0]=x → 递归成员写语义（self.arr / user.arr）
        return this.externalWritePos(obj, chunk);
      }
      return null;
    }
    return null;
  }

  /** C# 类成员方法体判定：最近函数状祖先 ∈ {method_declaration, constructor_declaration}。
   *  class_declaration 本体（kind="class"）→ false（字段声明级写由 declared 短路，不需 self）。
   *  local_function_statement/lambda/anonymous 排除：捕获外层局部时语义等同 TS 闭包（裸外部写）。 */
  private inClassMemberBody(node: SyntaxNode | null | undefined): boolean {
    let p = node?.parent;
    while (p !== null && p !== undefined) {
      if (p.type === "method_declaration" || p.type === "constructor_declaration") return true;
      if (p.type === "local_function_statement" || p.type === "lambda_expression" ||
          p.type === "anonymous_method_expression" || p.type === "class_declaration" ||
          p.type === "struct_declaration" || p.type === "interface_declaration") return false;
      p = p.parent;
    }
    return false;
  }

  /** 状态写检测：self.x = / this.x = / global、nonlocal 声明 → state 效应。 */

  /** CJS 导出函数 chunk（迭代15 解构 require 盲区）：exports.handler = function(){} /
   *  module.exports.handler = fn → 成员名（非函数字面量 RHS 不建——identifier 导出走既有
   *  function_declaration chunk）。module.exports = fn（默认导出）左值是 exports 自身 → null。 */
  private cjsExportName(node: SyntaxNode): string | null {
    if (node.type !== "assignment_expression") return null;
    const left = node.childForFieldName("left") ?? node.children[0] ?? null;
    if (!left || left.type !== "member_expression") return null;
    const obj = left.childForFieldName("object") ?? left.children[0] ?? null;
    const attr = left.childForFieldName("property") ?? left.children[left.children.length - 1] ?? null;
    if (!obj || !attr || attr.type !== "property_identifier") return null;
    const isExports = obj.text === "exports" || obj.text === "module.exports";
    if (!isExports) return null;
    const value = node.childForFieldName("right") ?? node.children[node.children.length - 1] ?? null;
    if (value === null || !/function/.test(value.type)) return null;
    return attr.text;
  }

  /** chunk 展示名：优先 name 字段；变量声明的箭头函数取变量名；赋值 RHS 的 Python lambda 取变量名。 */
  private chunkName(node: SyntaxNode): string | null {
    if (node.type === "lambda") {
      // handler = lambda: ... → 提为命名 chunk（体调用归它，模块级赋值不再假 IMPURE）；
      // 实参/其他位置 lambda（map(lambda…)）→ 不提 chunk，体调用归外层（map 执行时确实调用）
      let p = node.parent;
      while (p !== null && p.type === "parenthesized_expression") p = p.parent;
      if (p !== null && p.type === "assignment") {
        const left = p.childForFieldName("left") ?? p.children[0] ?? null;
        if (left !== null && left.type === "identifier") return left.text;
      }
      return null;
    }
    if (node.type === "variable_declarator") {
      // 仅当值是函数字面量时才是 chunk：const f = () => {...}
      const value = node.childForFieldName("value");
      if (value === null || !/function/.test(value.type)) return null;
      const nameNode = node.childForFieldName("name") ?? node.children[0];
      return nameNode ? nameNode.text : null;
    }
    const nameNode = node.childForFieldName("name");
    return nameNode ? nameNode.text : null;
  }

  /** 方法归属：最近的类祖先（self/this 调用需要类上下文）。 */
  private ownerClass(node: SyntaxNode): string | null {
    let p = node.parent;
    while (p !== null) {
      if (this.pack.classNodes.includes(p.type)) {
        const n = p.childForFieldName("name");
        return n ? n.text : null;
      }
      p = p.parent;
    }
    return null;
  }

  /** 最大嵌套深度：chunk 自身不计，其后代中 nesting 节点每层 +1。 */
  private maxNesting(root: SyntaxNode): number {
    let max = 0;
    const walk = (n: SyntaxNode, depth: number): void => {
      const d = this.pack.nestingNodes.includes(n.type) ? depth + 1 : depth;
      if (d > max) max = d;
      for (const c of n.children) walk(c, d);
    };
    // variable_declarator chunk（const f = () => …）：箭头函数值是"chunk 自身"（与 function_declaration
    // 同地位）→ 不计层；否则箭头函数比同语义 function 声明多计 1 层（nesting 差一，迭代3 已知限制）
    const body = root.type === "variable_declarator"
      ? (root.childForFieldName("value") ?? root.children[0])
      : root;
    if (body) for (const c of body.children) walk(c, 0);
    return max;
  }

  /** 调用点提取：点连文本 + 首段对象 + 末段名。不可拍平（super().m()、factory()()、d[k]()）产哨兵走未知；字面量接收者（"x".strip、[].push）产 receiver 事实。 */
  private callOf(node: SyntaxNode): RawCall {
    const argFns = this.argFnsOf(node);
    const fn = node.type === "new_expression"
      ? (node.childForFieldName("constructor") ?? node.children[0])
      : (node.childForFieldName("function") ?? node.children[0]);
    if (!fn) return { target: UNRESOLVED_TARGET, obj: null, attr: UNRESOLVED_TARGET, receiver: null, argFns };
    const flat = flattenCallTarget(fn);
    if (flat === null) {
      // 接收者事实：字面量 / 链式（"x".strip().upper() 的 upper 接收者是 strip 的返回类型）/ 构造器
      if (fn.type === "attribute" || fn.type === "member_expression" || fn.type === "member_access_expression") {
        const obj = fn.childForFieldName("object") ?? fn.children[0];
        // Python attribute 无命名字段（children: [obj, ., name]）；TS member_expression 有 property 字段
        const attr = fn.childForFieldName("attribute") ?? fn.childForFieldName("property") ?? fn.children[fn.children.length - 1];
        if (obj && attr && (attr.type === "identifier" || attr.type === "property_identifier")) {
          const r = this.receiverTypeOf(obj);
          if (r !== null) return { target: UNRESOLVED_TARGET, obj: null, attr: attr.text, receiver: r, argFns };
        }
      }
      return { target: UNRESOLVED_TARGET, obj: null, attr: UNRESOLVED_TARGET, receiver: null, argFns };
    }
    const dot = flat.indexOf(".");
    if (dot === -1) return { target: flat, obj: null, attr: flat, receiver: null, argFns };
    return { target: flat, obj: flat.slice(0, dot), attr: flat.slice(dot + 1), receiver: null, argFns };
  }

  /**
   * 接收者类型：字面量 → 内建类型（literalReceivers）；链式（obj 是调用）→ 被调方法的
   * 返回类型（builtinMethodReturns，语言事实）；构造器（new C()）→ "class:C"；表外 → null。
   */
  private receiverTypeOf(obj: SyntaxNode): string | null {
    const lit = literalReceiverType(obj, this.pack);
    if (lit !== null) return lit;
    if (obj.type === "new_expression") {
      const ctor = obj.childForFieldName("constructor") ?? obj.children[1];
      if (ctor && (ctor.type === "identifier" || ctor.type === "property_identifier")) return `class:${ctor.text}`;
      return null;
    }
    if (obj.type === "call" || obj.type === "call_expression" || obj.type === "invocation_expression") {
      // 迭代31 S1：C# 调用节点是 invocation_expression（此前缺失 → C# 链第二环起全断，
      // 21,488 bare <unresolved> 站点大块来源）。fn 字段与 attribute/member 提取与 TS/Python 同构。
      const fn = obj.childForFieldName("function") ?? obj.children[0];
      if (fn && (fn.type === "attribute" || fn.type === "member_expression" || fn.type === "member_access_expression")) {
        const innerObj = fn.childForFieldName("object") ?? fn.children[0];
        const innerAttr = fn.childForFieldName("attribute") ?? fn.childForFieldName("property") ?? fn.children[fn.children.length - 1];
        if (innerObj && innerAttr && (innerAttr.type === "identifier" || innerAttr.type === "property_identifier")) {
          const recv = this.receiverTypeOf(innerObj);
          if (recv !== null && !recv.startsWith("class:")) return this.pack.builtinMethodReturns[recv]?.[innerAttr.text] ?? null;
        }
      }
    }
    return null;
  }

  /** 命名函数实参（HOF 回调边原料）：arguments 子节点中直接是标识符或可拍平成员表达式（this.log）的，及 Python 关键字实参（key=fn）的值。 */
  private argFnsOf(node: SyntaxNode): string[] {
    // C# invocation_expression 的参数是 argument_list 直接子节点（无 arguments 命名字段）——
    // 迭代30 T3 暴露：Enumerable.ForEach(xs, Save) 的 Save 实参此前全漏（回调边丢失 = 假纯源）。
    let args = node.childForFieldName("arguments");
    if (!args) args = node.children.find((c) => c.type === "argument_list") ?? null;
    if (!args) return [];
    const out: string[] = [];
    const pushArg = (n: SyntaxNode): void => {
      if (n.type === "identifier" || n.type === "property_identifier") {
        out.push(n.text);
      } else if (n.type === "attribute" || n.type === "member_expression" || n.type === "member_access_expression") {
        const flat = flattenCallTarget(n);
        if (flat !== null) out.push(flat);
      }
    };
    for (const c of args.children) {
      if (c.type === "keyword_argument") {
        const v = c.childForFieldName("value");
        if (v) pushArg(v);
      } else if (c.isNamed) {
        // C# 参数是 argument 包装节点（argument → identifier）——解包一层（迭代30 T3 实证）。
        pushArg(c.type === "argument" ? (c.children.find((x) => x.isNamed) ?? c) : c);
      }
    }
    return out;
  }

  /** 函数内绑定名（赋值目标 + 参数名——参数同样遮蔽外层 import；遮蔽守卫用）。流不敏感保守收集。 */
  private assignedNames(root: SyntaxNode): string[] {
    const out: string[] = [];
    const pushParam = (n: SyntaxNode): void => {
      const named = n.childForFieldName("name") ?? n.childForFieldName("pattern");
      if (named && (named.type === "identifier" || named.type === "property_identifier")) {
        out.push(named.text);
      } else if (n.type === "identifier" || n.type === "property_identifier") {
        out.push(n.text);
      }
    };
    const walk = (n: SyntaxNode): void => {
      if (this.pack.assignmentTargets.includes(n.type)) {
        // require 导入声明（const x = require(...)）不是遮蔽——importMap 已登记该绑定
        let isRequireDecl = false;
        if (n.type === "variable_declarator") {
          const val = n.childForFieldName("value");
          const fn = val ? val.childForFieldName("function") ?? val.children[0] : null;
          isRequireDecl = !!fn && fn.type === "identifier" && fn.text === "require";
        }
        if (!isRequireDecl) {
          // 迭代25：C# variable_declarator 无 name 字段（名字是裸 identifier 子节点）→ children[0] fallback；
          // TS/JS variable_declarator 有 name 字段、assignment_expression 有 left 字段 → fallback 不触发。
          const left = n.childForFieldName("left") ?? n.childForFieldName("name") ?? n.children[0] ?? null;
          if (left && (left.type === "identifier" || left.type === "property_identifier")) {
            out.push(left.text);
          }
        }
      } else if (n.type === "parameters") {
        for (const c of n.children) pushParam(c); // 参数名遮蔽外层绑定
      }
      for (const c of n.children) walk(c);
    };
    for (const c of root.children) walk(c);
    return out;
  }
}

interface MutableChunk {
  name: string;
  line: number;
  endLine: number;
  nesting: number;
  normText: string;
  kind: "class" | "function" | "module";
  calls: RawCall[];
  assigned: string[];
  /** 函数参数名（与 assigned 分离：参数是外部传入对象，对其属性写 = 外部状态写；局部赋值不算）。 */
  params: string[];
  /** 状态写位置（self.x / user.status / global 名）；非空 → state 效应。 */
  stateWrites: string[];
  /** 读侧状态位置（self.x / user.status / ⊤）——stateDeps 传播原料。 */
  stateReads: string[];
  /** 本 chunk 内声明名（let/const/var/def 定义，非纯赋值）——裸标识符写的外部性判定（终裁 Step1）。 */
  declared: string[];
  /** 直接抛出的异常类型（raise ValueError / throw new Error()）。 */
  thrownTypes: string[];
  /** 捕获的异常类型（catch {} / except X → "*"/类型名；方向安全减法用）。 */
  catches: string[];
  ownerClass: string | null;
}

/**
 * 令牌级规范化（公理4 单射）：跳过 comment 节点；叶子令牌文本原样保留
 * （字符串内容、运算符、私有字段名都精确），令牌间以单空格连接。
 * 结果：注释/缩进/CRLF 改动不敏感；真实改动（含字符串内 //、#、整除）敏感。
 */
function normalizeCode(node: SyntaxNode): string {
  const parts: string[] = [];
  const walk = (n: SyntaxNode): void => {
    if (n.type === "comment") return;
    if (n.childCount === 0) {
      parts.push(n.text);
      return;
    }
    for (const c of n.children) walk(c);
  };
  for (const c of node.children) walk(c);
  return parts.join(" ");
}

function fresh(
  name: string,
  line: number,
  endLine: number,
  normText: string,
  ownerClass: string | null = null,
  kind: "class" | "function" | "module" = "function",
): MutableChunk {
  return { name, line, endLine, nesting: 0, normText, kind, calls: [], assigned: [], params: [], stateWrites: [], stateReads: [], declared: [], thrownTypes: [], catches: [], ownerClass };
}

/** 字面量接收者判定：解包括号/断言后查 literalReceivers 表；bytes 前缀（b"..."）按文本区分。 */
function literalReceiverType(node: SyntaxNode, pack: LangPack): string | null {
  let n = node;
  while (
    n.type === "parenthesized_expression" || n.type === "as_expression" ||
    n.type === "satisfies_expression" || n.type === "non_null_expression"
  ) {
    const inner = n.childForFieldName("expression") ?? n.childForFieldName("value")
      ?? n.children.find((c) => c.type !== "(" && c.type !== ")");
    if (!inner) return null;
    n = inner;
  }
  const t = pack.literalReceivers[n.type];
  if (t === undefined) return null;
  // tree-sitter-python 的 f-string 与 bytes 同是 string 节点：b"/B" 前缀才是 bytes
  if (t === "str" && /^[bB]['"]/.test(n.text)) return "bytes";
  return t;
}

/** 把 member/attribute 链拍平成点连文本；动态部分（下标、调用结果）返回 null。 */
function flattenCallTarget(node: SyntaxNode): string | null {
  if (
    node.type === "identifier" ||
    node.type === "property_identifier" ||
    node.type === "this" ||
    node.type === "this_expression" || // C#（迭代19）：this.gameObject 的 this 节点
    node.type === "type_identifier" ||
    node.type === "predefined_type" // C#（迭代20）：string/int/float 等 builtin 类型（string.IsNullOrWhiteSpace）
  ) {
    return node.text;
  }
  if (node.type === "attribute" || node.type === "member_expression" || node.type === "member_access_expression") {
    const obj = node.childForFieldName("object") ?? node.children[0];
    const attr =
      node.childForFieldName("attribute") ?? node.childForFieldName("property") ?? node.childForFieldName("name");
    if (!obj || !attr) return null;
    const objText = flattenCallTarget(obj);
    if (objText === null) return null;
    // C# 泛型成员（迭代19）：Resources.Load<GameObject> → 剥 type_argument_list 取方法名
    if (attr.type === "generic_name") {
      const id = attr.childForFieldName("name") ?? attr.children.find((c) => c.type === "identifier");
      if (id && (id.type === "identifier" || id.type === "property_identifier")) {
        return objText + "." + id.text;
      }
      return null;
    }
    if (attr.type === "identifier" || attr.type === "property_identifier") {
      return objText + "." + attr.text;
    }
    return null;
  }
  if (node.type === "conditional_access_expression") {
    // C# null 条件访问（迭代20）：obj?.Method → obj 部分 flatten + member_binding 标识符
    const expr = node.children[0];
    const binding = node.children.find((c) => c.type === "member_binding_expression");
    if (expr === undefined || binding === undefined) return null;
    const objText = flattenCallTarget(expr);
    if (objText === null) return null;
    const id = binding.children.find((c) => c.type === "identifier" || c.type === "property_identifier");
    if (id) return objText + "." + id.text;
    return null;
  }
  return null;
}

/** 默认导出登记：export default function foo / export default class Bar。 */
function findDefaultExport(root: SyntaxNode, pack: LangPack): string | null {
  let found: string | null = null;
  const visit = (n: SyntaxNode): void => {
    if (found !== null) return;
    if (n.type === "export_statement") {
      const hasDefault = n.children.some((c) => c.type === "default");
      if (hasDefault) {
        for (const c of n.children) {
          if (pack.chunkNodes.includes(c.type)) {
            const nameNode = c.childForFieldName("name");
            if (nameNode) found = nameNode.text;
          } else if (c.type === "identifier" && c.text !== "default" && c.text !== "export") {
            // export default foo（标识符引用：别名再导出解析依赖 defaultExport 登记）
            found = c.text;
          }
        }
      }
    }
    for (const c of n.children) visit(c);
  };
  visit(root);
  return found;
}
