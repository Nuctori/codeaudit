import type Parser from "web-tree-sitter";
import type { Effect } from "../core/types";

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
	/** 构造调用类型名（new X(...)；非构造为 undefined）。迭代33 C1：构造器建模。 */
	readonly ctor?: string;
}

/** 原始 import 记录。 */
export interface RawImport {
	/** 本地绑定名（as 之后的名字）。 */
	readonly local: string;
	/** 模块说明符，原样保留（如 "./db"、"os"、".utils"）。 */
	readonly module: string;
	/** 从模块导入的名字；命名空间/整模块导入为 null。 */
	readonly imported: string | null;
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
	/** 状态写（self.x = / this.x = / global、nonlocal 声明）→ state 效应（用户需求 2026-08-11）。 */
	readonly stateWrites: readonly string[];
	/** 读侧状态位置（self.x / user.status / ⊤）。 */
	readonly stateReads: readonly string[];
	/** 直接抛出的异常类型（raise ValueError / throw new Error() → "ValueError"/"Error"；裸 raise/throw → "*"）。 */
	readonly thrownTypes: readonly string[];
	/** 捕获的异常类型（catch {} / except X → "*"/类型名）。 */
	readonly catches: readonly string[];
	/** 所在类名（方法归属），顶层为 null。 */
	readonly ownerClass: string | null;
	/** 迭代35 A1：参数显式类型（参数名 → 类型名，Dictionary<string,int> d → d:"Dictionary"）——变量 receiver 查 builtinTypeEffects。 */
	readonly paramTypes?: Readonly<Record<string, string>>;
	/** 迭代37 P1-2：函数内局部单赋值构造绑定（var xs = new List<int>() → xs:"List"）——消费端 G4 守卫
	 *  （单赋值 ∧ ¬assigned ∧ ¬param；RHS 构造调用形态；多赋值/非构造不绑）。 */
	readonly localBindings?: Readonly<Record<string, string>>;
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
	/** 模块级单赋值绑定：名称 → 构造类名（conn = DB() / export const db = new Pool()）。last-write-wins。 */
	readonly moduleBindings: Record<string, string>;
	readonly parseError: boolean;
	/** 迭代38 A：类继承边（类名 → 静态基类名列表）。只收静态可解析基类（identifier / 泛型末段）；
	 *  动态 heritage → 该类不记边且 hasDynamicExtends = true（规则3：多态分派整体降 ?）。 */
	readonly classExtends?: Readonly<Record<string, readonly string[]>>;
	/** 迭代38 A：文件内存在动态 extends（class B extends getBase()）→ 该语言多态分派整体 ?（健全版规则3）。 */
	readonly hasDynamicExtends?: boolean;
}

export interface LangPack {
	readonly name: string;
	readonly extensions: readonly string[];
	/** tree-sitter-wasms 包内的 wasm 文件名。 */
	readonly wasm: string;

	// ---- 数据侧 ----
	// 效应表族（impureBuiltins/Globals/Modules/frameworkIo/frameworkPure/builtinTypeEffects/
	// pureCtor/hofCallsArgs/hofAlwaysArgs）的**通道分派语义是语义非风格**（迭代37 数学 G3' 护栏）：
	// 每张表对应引擎 F 的一个查表通道（裸名/对象/模块/ns 前缀/类型成员/构造/回调），匹配模式不同
	// （精确/段前缀/最长点分回退）且优先级不可重排（receiver 先于裸名防字面量劫持；impure 先于 pure；
	// hof 与 hofAlways 是不同语义原子——坍缩即假纯通道）。统一为单表属过度抽象（迭代37 裁决不做），
	// 勿因"表多"合并。语言差异 = 各表数据（通用机制 + 语言数据），引擎零语言常量（P0 达成）。
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
	/** 不纯内置函数：函数名 -> 效应类（fetch: "net"、print: "io"）。 */
	readonly impureBuiltins: Readonly<Record<string, Effect>>;
	/** 已知纯内置函数（直接丢弃，不计未知）。 */
	readonly pureBuiltins: ReadonlySet<string>;
	/** 不纯模块：模块名 -> 效应类（fs: "fs"）或成员列表（元素可带 ":类" 后缀或 ":p" 纯标记）。 */
	readonly impureModules: Readonly<Record<string, Effect | readonly string[]>>;
	/** 已知纯模块（导入名解析到这些模块时丢弃调用）。 */
	readonly pureModules: ReadonlySet<string>;
	/** 不纯全局对象（console/process…）：对象名 -> 效应类或成员列表（同 impureModules 元素语义）。 */
	readonly impureGlobals: Readonly<Record<string, Effect | readonly string[]>>;
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
	readonly builtinTypeEffects: Readonly<
		Record<string, Readonly<Record<string, "pure" | "hof">>>
	>;
	/** 内建方法返回类型（链式接收者解析用）：类型 → 方法 → 返回类型；表外 → ?（链断）。语言事实义务。 */
	readonly builtinMethodReturns: Readonly<
		Record<string, Readonly<Record<string, string>>>
	>;
	/** 框架命名空间（如 egg 的 ctx）：对象名 → 成员前缀列表，命中视为 io 边界（ctx.model.* / ctx.service.*）。 */
	readonly frameworkIo: Readonly<Record<string, readonly string[]>>;
	/** 框架纯命名空间（frameworkIo 镜像，迭代32 成员级）：对象名 → 类型首段 → "pure"|"hof"，
	 *  或异质类型的嵌套成员表 Record<member, "pure"|"hof">；段前缀匹配命中视为纯
	 *  （hof = 回调义务保留）；未列键落 ?（严格白名单，漏条方向恒 ? 非假纯）。 */
	readonly frameworkPure?: Readonly<
		Record<
			string,
			Readonly<
				Record<
					string,
					"pure" | "hof" | Readonly<Record<string, "pure" | "hof">>
				>
			>
		>
	>;
	/** 纯构造类型（迭代33 C1：new X() 构造器建模——X ∈ 清单 → 纯分配无副作用；未列框架类型 → ? 诚实）。
	 *  与 impureGlobals 互补：impureGlobals 类型键优先（构造即效应，FileStream:fs 等）。 */
	readonly pureCtor?: ReadonlySet<string>;
	/** 属性链前缀白名单（迭代37 P0-1，原 C# gameObject 硬编码数据化）：任意变量的 `.head.member` 链
	 *  （item.gameObject.SetActive 的 attr="gameObject.SetActive"），head = attr 首段 ∈ 键且
	 *  member ∈ 清单 → io 边界。语义要求：引擎在 assigned 守卫**之前**查此表（主体是变量 receiver）。
	 *  白名单 miss → 落回后续分支 → UNKNOWN 保持（方向安全）。 */
	readonly frameworkAttrPrefix?: Readonly<Record<string, readonly string[]>>;
	/** 赋值即局部定义（Python：函数内裸名赋值 = 局部声明，非外部状态写）。迭代37 P0-2。 */
	readonly assignmentScopesLocals: boolean;
	/** 类方法内裸字段写 = this 字段（C#：self.x；TS 同形写是外层写 x）。迭代37 P0-2。 */
	readonly bareNameMeansThisInMethod: boolean;
	/** 隐式 this（C#：类内裸名方法调用 = this 方法；TS/Python 需显式 this/self）。迭代19。 */
	readonly implicitThis: boolean;
	/** 迭代38 A 规则7：构造器结果可信（new C() 必返回 C 实例或抛）——C#/Python true；
	 *  JS/TS false（构造器可 return 任意对象）→ 不产 trusted localBinding，class: 接收者落 ?。 */
	readonly trustedCtor?: boolean;
	/** 迭代38 B：参数共享容器的方法变异（list.append / List.Add / dict.clear…）→ state 效应
	 *  （与参数下标写 d[0]=1 → stateWrites 同语义统一，iter36 §b-7）。
	 *  只收真实高频变异方法；局部绑定（lb）不接（局部对象变异不可见）；TS/JS 不可达不加（死表）。 */
	readonly builtinMutators?: Readonly<Record<string, ReadonlySet<string>>>;

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
		/** 可选：projectFiles 的末段路径索引（M2：绝对导入按末段查，免逐文件全扫）。 */
		byLast?: ReadonlyMap<string, string[]>,
	): string | null;
}
