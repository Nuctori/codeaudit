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

  extract(source: string, file: string): RawFileFacts {
    const tree = this.parser.parse(source);
    const root = tree.rootNode;
    const chunks: RawChunk[] = [];
    // 伪 chunk 收容模块级调用（公理1）
    const moduleChunk = fresh("<module>", 1, source.split("\n").length, "", "");
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
            node.text,
            normalizeCode(node),
            this.ownerClass(node),
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

    chunks.unshift(moduleChunk as RawChunk);
    return {
      file,
      lang: this.pack.name,
      contentHash: createHash("sha256").update(source, "utf8").digest("hex"),
      chunks,
      imports: this.pack.extractImports(root),
      defaultExport: findDefaultExport(root, this.pack),
      parseError: root.hasError,
    };
  }

  /** chunk 展示名：优先 name 字段；变量声明的箭头函数取变量名。 */
  private chunkName(node: SyntaxNode): string | null {
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
    for (const c of root.children) walk(c, 0);
    return max;
  }

  /** 调用点提取：点连文本 + 首段对象 + 末段名。不可拍平（super().m()、factory()()、d[k]()）产哨兵走未知。 */
  private callOf(node: SyntaxNode): RawCall {
    const argFns = this.argFnsOf(node);
    const fn = node.childForFieldName("function") ?? node.children[0];
    if (!fn) return { target: UNRESOLVED_TARGET, obj: null, attr: UNRESOLVED_TARGET, argFns };
    const flat = flattenCallTarget(fn);
    if (flat === null) return { target: UNRESOLVED_TARGET, obj: null, attr: UNRESOLVED_TARGET, argFns };
    const dot = flat.indexOf(".");
    if (dot === -1) return { target: flat, obj: null, attr: flat, argFns };
    return { target: flat, obj: flat.slice(0, dot), attr: flat.slice(dot + 1), argFns };
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

  /** 函数内赋值目标名（遮蔽守卫：from-import 绑定被局部重绑时不再解析）。流不敏感保守收集。 */
  private assignedNames(root: SyntaxNode): string[] {
    const out: string[] = [];
    const walk = (n: SyntaxNode): void => {
      if (this.pack.assignmentTargets.includes(n.type)) {
        const left = n.childForFieldName("left") ?? n.childForFieldName("name");
        if (left && (left.type === "identifier" || left.type === "property_identifier")) {
          out.push(left.text);
        }
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
  sourceText: string;
  normText: string;
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
  sourceText: string,
  normText: string,
  ownerClass: string | null = null,
): MutableChunk {
  return { name, line, endLine, nesting: 0, sourceText, normText, calls: [], assigned: [], ownerClass };
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
          }
        }
      }
    }
    for (const c of n.children) visit(c);
  };
  visit(root);
  return found;
}
