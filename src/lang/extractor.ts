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
      const isChunk = this.pack.chunkNodes.includes(node.type);
      let pushed = false;
      if (isChunk) {
        const name = this.chunkName(node);
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
          chunks.push(mc as RawChunk);
          stack.push(mc);
          pushed = true;
        }
      }
      if (this.pack.callNodes.includes(node.type)) {
        stack[stack.length - 1]!.calls.push(this.callOf(node));
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
      if (fn.type === "attribute" || fn.type === "member_expression") {
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
    if (obj.type === "call" || obj.type === "call_expression") {
      const fn = obj.childForFieldName("function") ?? obj.children[0];
      if (fn && (fn.type === "attribute" || fn.type === "member_expression")) {
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
    const args = node.childForFieldName("arguments");
    if (!args) return [];
    const out: string[] = [];
    const pushArg = (n: SyntaxNode): void => {
      if (n.type === "identifier" || n.type === "property_identifier") {
        out.push(n.text);
      } else if (n.type === "attribute" || n.type === "member_expression") {
        const flat = flattenCallTarget(n);
        if (flat !== null) out.push(flat);
      }
    };
    for (const c of args.children) {
      if (c.type === "keyword_argument") {
        const v = c.childForFieldName("value");
        if (v) pushArg(v);
      } else {
        pushArg(c);
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
          const left = n.childForFieldName("left") ?? n.childForFieldName("name");
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
  return { name, line, endLine, nesting: 0, normText, kind, calls: [], assigned: [], ownerClass };
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
    node.type === "type_identifier"
  ) {
    return node.text;
  }
  if (node.type === "attribute" || node.type === "member_expression") {
    const obj = node.childForFieldName("object") ?? node.children[0];
    const attr =
      node.childForFieldName("attribute") ?? node.childForFieldName("property");
    if (!obj || !attr) return null;
    const objText = flattenCallTarget(obj);
    if (objText === null) return null;
    if (attr.type === "identifier" || attr.type === "property_identifier") {
      return objText + "." + attr.text;
    }
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
