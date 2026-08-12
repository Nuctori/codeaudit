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
	/**
	 * 属性读取形态（非调用：obj.Prop 读值）——迭代40 B5：C# 属性访问器假纯洞。
	 * 成员 miss 时按静态语言语义判纯（字段/自动属性/不存在成员读取无用户代码）。
	 */
	readonly prop?: boolean;
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
	/** 参数名（迭代40 P0-3：ptype 分支遮蔽守卫的豁免维度——参数声明非重绑）。 */
	readonly params: readonly string[];
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
	/** 迭代39 B7：virtual 族方法（类名 → 方法名列表）。C# virtual/override/abstract（无 sealed）；
	 *  base_list ≥2 命名子节点（基类 + 接口）→ 该类全部方法隐含 virtual 族（保守，B13 残余为单接口形态）。 */
	readonly virtualMembers?: Readonly<Record<string, readonly string[]>>;
	/** 类字段名（迭代40 M6：无 getter 声明的字段读取纯——JS 语义；TS/JS 提取，C# 不需要
	 *  （propMissIsPure 静态论证已覆盖）。跨文件祖先查询在 link 侧。 */
	readonly memberNames?: Readonly<Record<string, readonly string[]>>;
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
	// 勿因"表多"合并。语言差异 = 各表数据（通用机制 + 语言数据），引擎零语言常量（P0 达成；
	// 迭代40 P0-3 独立审计 25 项硬编码全数据化复核通过——剩余节点名均为 tree-sitter 跨语言
	// 公共名 identifier/property_identifier/type_identifier/predefined_type 或核心语义值）。
	/** 作为 chunk 的节点类型。 */
	readonly chunkNodes: readonly string[];
	/** 类节点类型（用于方法归属）。 */
	readonly classNodes: readonly string[];
	/** 调用节点类型。 */
	readonly callNodes: readonly string[];
	/**
	 * 属性读取形态节点（非调用：obj.Prop 读值）——迭代40 B5。读取形态 = 非调用目标链、
	 * 非赋值左值、非 ++/-- 目标（这些形态已有各自通道，见 propertyReadSkipMorphs）。
	 * 成员 miss 时的语义见 RawCall.prop + propMissIsPure。
	 */
	readonly propertyReadNodes?: readonly string[];
	/**
	 * 属性读取形态排除：parent 形态（调用目标链/赋值左值/++/-- 目标——已有各自通道）。
	 * 与 propertyReadNodes 同语言对齐（TS 未来接入时填 call_expression 等自己的形态名）。
	 */
	readonly propertyReadSkipMorphs?: readonly string[];
	/**
	 * 属性读取形态排除：parent 声明/类型位（无运行时读取——声明、类型参数、特性、标签等）。
	 * C# 填 40+ 节点（cast/is/as/泛型/声明…）；新语言接入时填自己的类型位节点。
	 */
	readonly propertyReadSkipParents?: readonly string[];
	/**
	 * 属性读取形态排除：parent 的 name/type 槽位（声明名位无运行时读取，value 位保留）。
	 * 值 = 命名字段数组；"__child0" = children[0]（无命名字段的语言形态，C# variable_declarator）。
	 */
	readonly propertyReadNameSlots?: Readonly<Record<string, readonly string[]>>;
	/**
	 * 属性读取成员 miss 语义：true = 静态语言（字段/自动属性/不存在成员读取不执行用户代码 → 纯）。
	 * 动态语言（TS/JS/Python）不设 → miss 落 ? 诚实——防"属性读取=纯"语义泄漏到动态语言。
	 */
	readonly propMissIsPure?: boolean;
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
	/** 迭代39 B7：类方法默认多态（Python/JS 一切方法原型分派 → true 即现状宽守卫；
	 *  C# false → 仅 virtual/override/abstract 族降 ?，非 virtual 静态分派精确（L4）。 */
	readonly polymorphicMethods?: boolean;
	/** 迭代39：模块说明符前缀别名（JS/TS "node:" ≡ 无前缀——运行时同模块）。引擎零语言常量完整态。 */
	readonly stripModulePrefixes?: readonly string[];
	/** 迭代39 P2-1：AST 形状投影表（π 数据侧）——extractor 的节点类型判定统一走此表。
	 *  只含「哪类节点是哪种 IR 事件」的语言数据；字段结构/拍平逻辑留在 extractor（跨语言同构）。
	 *  未声明 = 空集（该语言无此形态）。新语言接入 = 纯数据，零 extractor 改动。 */
	readonly astShapes?: Readonly<{
		/** 外部状态写语句节点（global/nonlocal 声明）。 */
		writeStmts: readonly string[];
		/** 赋值形态写节点（assignment/augmented_assignment/...）。 */
		writeAssigns: readonly string[];
		/** 增量写节点（update_expression / ++ -- 一元）。 */
		writeUpdates: readonly string[];
		/** 一元增减节点（postfix/prefix_unary_expression）。 */
		writeUnary: readonly string[];
		/** 成员访问节点（attribute/member_expression/member_access...）。 */
		memberNodes: readonly string[];
		/** 成员访问内部包装（member_binding_expression，C# ?. 链）。 */
		memberWrapNodes: readonly string[];
		/** 调用形态节点（call/call_expression/invocation...）。 */
		callShapes: readonly string[];
		/** 构造调用节点（object_creation_expression/new_expression）。 */
		ctorCallNodes: readonly string[];
		/** 参数节点（parameter/typed_parameter...）。 */
		paramNodes: readonly string[];
		/** 抛出/捕获节点。 */
		throwNodes: readonly string[];
		catchNodes: readonly string[];
		/** 类基类容器节点（base_list/class_heritage）。 */
		heritageNodes: readonly string[];
		/** this 形态节点（this/this_expression）。 */
		thisNodes: readonly string[];
		/** 类方法声明节点（method_declaration/method_definition）。 */
		methodNodes: readonly string[];
		/** 解包表达式节点（parenthesized/as/satisfies/non_null——字面量接收者剥壳）。 */
		unwrapNodes: readonly string[];
		/** 语句解包包装（export_statement/expression_statement——模块绑定/赋值提取）。 */
		stmtWrapNodes: readonly string[];
		/** 构造绑定赋值节点（**不含** augmented——x += C() 是增量非构造，独立审计必修 3）。 */
		bindAssigns: readonly string[];
		/** 声明节点（variable_declarator/variable_declaration/lexical_declaration）。 */
		declNodes: readonly string[];
		/** 初始化器父节点（initializer_expression——对象初始化器非外部写）。 */
		initializerParentNodes: readonly string[];
		/** 默认导出容器（export_statement）。 */
		exportStmtNodes: readonly string[];
	}>;
	/** 迭代38 B：参数共享容器的方法变异（list.append / List.Add / dict.clear…）→ state 效应
	 *  （与参数下标写 d[0]=1 → stateWrites 同语义统一，iter36 §b-7）。
	 *  只收真实高频变异方法；局部绑定（lb）不接（局部对象变异不可见）；TS/JS 不可达不加（死表）。 */
	readonly builtinMutators?: Readonly<Record<string, ReadonlySet<string>>>;

	// ---- 迭代40 P0-3：形状/语义数据化（独立审计 25 项 hack 收敛）----
	/** 构造器 chunk 名（构造体效应并入 class chunk 的合并键；Python __init__ / TS constructor；
	 *  C# ctor 名 = 类名走 isCtor 分支，不填）。H01。 */
	readonly ctorChunkNames?: readonly string[];
	/** 类型化 catch 的声明节点（C# catch_declaration——含 type 子节点；TS/JS catch 无 → 不填）。B01。 */
	readonly catchDeclNodes?: readonly string[];
	/** CJS 导出对象名（exports / module.exports——exports.x = fn 建命名 chunk）。仅 JS 填；B02。 */
	readonly cjsExportObjNames?: readonly string[];
	/** require 函数名（require 导入声明不是遮蔽、RHS 不产构造绑定）。仅 JS 填；H12。 */
	readonly requireFnNames?: readonly string[];
	/** 接口存在启发式阈值（base_list 命名子节点 ≥ N 视为含接口 → 全方法隐含 virtual 族）。
	 *  C# = 2（基类+接口）；其他语言不设 → 不触发。B03。 */
	readonly interfaceHeuristicMinBases?: number;
	/** 构造节点 → 类型名字段（C# object_creation_expression → "type"；TS new_expression →
	 *  "constructor"）。提取侧构造名剥壳统一走 ctorTypeName。H02。 */
	readonly ctorTypeFields?: Readonly<Record<string, string>>;
	/** 产 ctor 标记的节点（走 link resolveCtorCall 专用通道）。C# object_creation_expression
	 *  （类名不裸名可见 → 需专用通道）；TS new_expression 走裸名 + ctor-merge（填空）。H02。 */
	readonly ctorMarkNodes?: readonly string[];
	/** virtual 族修饰符 token（C# virtual/override/abstract；其他语言不填 → 无 virtual 族）。
	 *  H03。 */
	readonly virtualModifiers?: readonly string[];
	/** sealed 修饰符 token（C# sealed——不可再覆写 → 静态分派精确）。H03。 */
	readonly sealedModifiers?: readonly string[];

	// ---- 迭代40 P0-3 批3：extractor 剩余语言形状数据化（H04-H19）----
	/** 类成员方法体节点（inClassMemberBody 命中集——C# method/constructor_declaration）。H04。 */
	readonly classMemberBodyNodes?: readonly string[];
	/** 类成员方法体边界（inClassMemberBody 停止集——local_function/lambda/嵌套类）。H04。 */
	readonly classMemberBodyStopNodes?: readonly string[];
	/** foreach 节点 + `in` token 文本（C# for_each_statement → "in"）。H07。 */
	readonly foreachNodes?: readonly string[];
	readonly foreachInToken?: string;
	/** throw 节点 → 实参提取字段（TS throw_statement → "argument"；Python raise 无字段 →
	 *  "__namedChildren"）。H09。 */
	readonly throwArgFields?: Readonly<Record<string, string>>;
	/** 类节点 → 基类容器字段（Python class_definition → "superclasses"；C#/TS 无字段 →
	 *  heritageNodes 子节点查找）。H10。 */
	readonly heritageFields?: Readonly<Record<string, string>>;
	/** 参数名槽位（propertyReadNameSlots 同机制：命名字段 / "__child0" / "__firstIdentifier"）。
	 *  Python typed_parameter 无 name 字段 → "__firstIdentifier"。H11。 */
	readonly paramNameSlots?: Readonly<Record<string, readonly string[]>>;
	/** 类型名剥壳节点（ctorTypeName 递归集——generic_name/qualified_name/type）。H13。 */
	readonly typeNameNodes?: readonly string[];
	/** 需 bytes 前缀检查的字面量类型（Python "str"——b"" 前缀判别）。H14。 */
	readonly bytesPrefixTypes?: readonly string[];
	/** 声明名 pattern 节点（tuple_pattern/array_pattern/as_pattern_target——声明名抑制）。H15。 */
	readonly patternNameNodes?: readonly string[];
	/** 函数字面量节点（chunkName 的 /function/ 正则替代——箭头/函数表达式）。H16。 */
	readonly fnLiteralNodes?: readonly string[];
	/** lambda 节点 + 命名父节点（Python lambda 提 chunk 的赋值父判定）。H16。 */
	readonly lambdaNodes?: readonly string[];
	readonly lambdaAssignNodes?: readonly string[];
	/** 导出语句 token（export_statement 内 "default"/"export"）。H17。 */
	readonly exportStmtTokens?: readonly string[];
	/** 参数列表节点类型（assignedNames 的 walk 匹配——Python "parameters" / TS "formal_parameters" /
	 *  C# "parameter_list"）。H18。 */
	readonly paramListNodeTypes?: readonly string[];
	/** 参数列表字段名（paramNames/paramTypesOf 的 childForFieldName——跨语言通用 "parameters"）。H18。 */
	readonly paramListField?: string;
	/** 嵌套函数边界节点（localBindingsOf 跳过集——嵌套 chunk 的绑定归它们自己）。H19。 */
	readonly nestedFnBoundaryNodes?: readonly string[];
	/** heritage 内部包装节点（TS class_heritage 内包 extends_clause）。P0-3 漏网。 */
	readonly heritageWrapNodes?: readonly string[];
	/** 实参包装节点（C# argument——解包一层取命名子节点）。P0-3 漏网。 */
	readonly argWrapNodes?: readonly string[];
	/** 关键字实参节点（Python keyword_argument——取 value 字段）。P0-3 漏网。 */
	readonly keywordArgNodes?: readonly string[];
	/** 多类型捕获节点（Python except (A,B) 的 tuple——保守吞一切）。P0-3 漏网。 */
	readonly catchMultiTypeNodes?: readonly string[];
	/** 接口声明节点（C# interface_declaration——方法无条件 virtual）。P0-3 漏网。 */
	readonly interfaceNodes?: readonly string[];
	/** 赋值 value 包装节点（C# equals_value_clause——解包取 value 字段）。P0-3 漏网。 */
	readonly valueWrapNodes?: readonly string[];
	/** 增减操作符 token（C# "++"/"--"——writeUnary 只认增减非逻辑非）。P0-3 漏网。 */
	readonly incDecTokens?: readonly string[];
	/** 类字段声明节点（TS/JS public_field_definition——memberNames 提取：无 getter 声明的字段
	 *  读取纯，JS 语义）。M6。 */
	readonly memberNameNodes?: readonly string[];
	/** 类型注解包装节点（Python "type" / TS "type_annotation"——解包取命名子节点）。M6。 */
	readonly typeWrapNodes?: readonly string[];
	/** 参数类型字段名（C#/Python "type"；TS "type_annotation"）。M6。 */
	readonly paramTypeField?: string;
	/** self/this 属性读取成员 miss 恒纯（TS/JS：this.attr 非 getter 读取无副作用——JS 语义
	 *  读 undefined；getter 已建 chunk 命中。Python 不填——__getattr__ 动态）。M6。 */
	readonly selfPropReadIsPure?: boolean;
	/** 对象字面量类型节点（TS "object_type"——`{name?: string}` 参数：属性读取无 getter 恒纯，
	 *  提取为 "__objectLiteral" 标记，link ptype 分支消费）。M6。 */
	readonly objectLiteralTypeNodes?: readonly string[];

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
