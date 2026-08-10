import type Parser from "web-tree-sitter";

export type SyntaxNode = Parser.SyntaxNode;
export type TreeSitterLanguage = Parser.Language;

/**
 * 语言包 = 数据（节点类型表、效应表）+ 行为（import 提取、模块解析）。
 *
 * 数据侧覆盖所有语言同构的部分；行为侧诚实地承认：
 * 名字解析是行为不是数据，每门语言自己实现。
 */

/** 不可拍平调用点（super().m()、factory()() 等）的哨兵 attr/target。 */
export const UNRESOLVED_TARGET = "<unresolved>";

/** 原始调用点（解析前）。target 为点连文本，如 "os.getcwd"、"this.save"、"print"。 */
export interface RawCall {
  /** 完整点连名，如 "os.getcwd"；裸名为 "print"。 */
  readonly target: string;
  /** 点连调用的首段（对象），裸名为 null。 */
  readonly obj: string | null;
  /** 末段（方法/函数名）。 */
  readonly attr: string;
  /** 字面量接收者的内建类型名（"str"/"list"...）；非字面量接收者为 null。 */
  readonly receiver: string | null;
  /** 语法函数实参（命名函数/import 绑定的标识符），供 HOF 回调边使用。 */
  readonly argFns: readonly string[];
}

/** 原始 import 记录。 */
export interface RawImport {
  /** 本地绑定名（as 之后的名字）。 */
  readonly local: string;
  /** 模块说明符，原样保留（如 "./db"、"os"、".utils"）。 */
  readonly module: string;
  /** 从模块导入的名字；命名空间/整模块导入为 null。 */
  readonly imported: string | null;
  /** 是否为再导出（export ... from / export * from）。 */
  readonly reexport: boolean;
}

/** 提取阶段的原始 chunk（尚未链接）。 */
export interface RawChunk {
  /** 文件内限定名："Svc.save" / "handle" / "<module>"。 */
  readonly name: string;
  readonly line: number;
  readonly endLine: number;
  readonly nesting: number;
  /** 令牌级规范化文本（去注释、令牌间单空格，字符串原样）——公理4 内容身份来源。 */
  readonly normText: string;
  /** chunk 形态：class（可 new 构造）| function | module。 */
  readonly kind: "class" | "function" | "module";
  readonly calls: RawCall[];
  /** 函数内赋值目标名（from-import 绑定被局部重绑时跳过解析，防假纯）。 */
  readonly assigned: string[];
  /** 所在类名（方法归属），顶层为 null。 */
  readonly ownerClass: string | null;
}

export interface RawFileFacts {
  readonly file: string;
  readonly lang: string;
  readonly contentHash: string;
  readonly chunks: RawChunk[];
  readonly imports: RawImport[];
  /** 文件默认导出的 chunk 名（无默认导出为 null）。 */
  readonly defaultExport: string | null;
  /** 模块级单赋值绑定：名称 → 构造类名（conn = DB() / export const db = new Pool()）。last-write-wins。 */
  readonly moduleBindings: Record<string, string>;
  readonly parseError: boolean;
}

export interface LangPack {
  readonly name: string;
  readonly extensions: readonly string[];
  /** tree-sitter-wasms 包内的 wasm 文件名。 */
  readonly wasm: string;

  // ---- 数据侧 ----
  /** 作为 chunk 的节点类型。 */
  readonly chunkNodes: readonly string[];
  /** 类节点类型（用于方法归属）。 */
  readonly classNodes: readonly string[];
  /** 调用节点类型。 */
  readonly callNodes: readonly string[];
  /** 计算嵌套深度时 +1 的节点类型。 */
  readonly nestingNodes: readonly string[];
  /** 自引用名（方法内对象调用的接收者）。 */
  readonly selfNames: readonly string[];
  /** 不纯内置函数（直接效应 io）。 */
  readonly impureBuiltins: ReadonlySet<string>;
  /** 已知纯内置函数（直接丢弃，不计未知）。 */
  readonly pureBuiltins: ReadonlySet<string>;
  /** 不纯模块：模块名 -> "*" 或方法名列表。 */
  readonly impureModules: Readonly<Record<string, "*" | readonly string[]>>;
  /** 已知纯模块（导入名解析到这些模块时丢弃调用）。 */
  readonly pureModules: ReadonlySet<string>;
  /** 不纯全局对象（如 console、process），无需 import。 */
  readonly impureGlobals: Readonly<Record<string, "*" | readonly string[]>>;
  /** 已知纯全局对象。 */
  readonly pureGlobals: ReadonlySet<string>;
  /** 高阶函数名：会调用其函数实参的内建/模块成员（map/filter/sorted/Array.from…），用于回调实参边。 */
  readonly hofCallsArgs: ReadonlySet<string>;
  /** 无条件调用函数实参的 HOF 子集（map/filter/forEach…）：实参未解析时记未知（防假纯）。 */
  readonly hofAlwaysArgs: ReadonlySet<string>;
  /** 赋值目标节点类型（x = ... / const x = ... 的左侧收集，遮蔽守卫用）。 */
  readonly assignmentTargets: readonly string[];
  /** AST 字面量节点类型 → 内建类型名（字面量接收者判定；表外节点 → 不判定）。 */
  readonly literalReceivers: Readonly<Record<string, string>>;
  /** 内建类型方法效应：类型 → 方法 → "pure" | "hof"。只放硬纯（无参数协议分派）方法；表外 → ?（F9）。 */
  readonly builtinTypeEffects: Readonly<Record<string, Readonly<Record<string, "pure" | "hof">>>>;
  /** 内建方法返回类型（链式接收者解析用）：类型 → 方法 → 返回类型；表外 → ?（链断）。语言事实义务。 */
  readonly builtinMethodReturns: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** 框架命名空间（如 egg 的 ctx）：对象名 → 成员前缀列表，命中视为 io 边界（ctx.model.* / ctx.service.*）。 */
  readonly frameworkIo: Readonly<Record<string, readonly string[]>>;

  // ---- 行为侧 ----
  /** 从 AST 提取 import 记录（含再导出）。 */
  extractImports(root: SyntaxNode): RawImport[];
  /**
   * 把模块说明符解析为项目内文件相对路径；
   * 返回 null 表示外部模块（标准库/第三方）。
   */
  resolveModule(
    module: string,
    fromFile: string,
    projectFiles: ReadonlySet<string>,
  ): string | null;
}
