import { createHash } from "node:crypto";
import type Parser from "web-tree-sitter";
import type { SyntaxNode } from "./pack";
import type {
	LangPack,
	RawCall,
	RawChunk,
	RawFileFacts,
	FileEventInfo,
} from "./pack";
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

	extract(
		source: string,
		file: string,
		precomputedHash?: string,
	): RawFileFacts {
		const tree = this.parser.parse(source);
		const root = tree.rootNode;
		const chunks: RawChunk[] = [];
		// 伪 chunk 收容模块级调用（公理1）；行数计数循环（split 生成 10M 元素数组 ~300MB 瞬态）
		let lineCount = 1;
		for (let i = 0; i < source.length; i++)
			if (source.charCodeAt(i) === 10) lineCount++;
		const moduleChunk = fresh("<module>", 1, lineCount, "", null, "module");
		const stack: MutableChunk[] = [moduleChunk];

		const visit = (node: SyntaxNode): void => {
			// 迭代43 r2：static 初始化器子树跳过（静态字段 value + 静态构造器体）——
			// 归 static-init 合成 chunk（staticInitOf 独立收集），class chunk 不含类型加载调用
			//（否则双计 + 过近似不消除）。声明名/修饰符对 class chunk 无消费（C# 裸名读走 propMissIsPure）。
			const smods = this.pack.staticModifiers ?? EMPTY_SHAPES;
			if (
				smods.length > 0 &&
				(node.type === "field_declaration" ||
					node.type === "constructor_declaration") &&
				node.children.some((c) => smods.includes(c.text))
			)
				return;
			// 迭代44-r2：编译期操作符（typeof/default/nameof）——实参是类型/编译期常量，
			// 不提取调用点（typeof(T) 的 T 被误当裸名调用，InitDeity T·bare 89 实证）。
			// 跳过整个子树（实参无运行时求值；类型实参位置已由 propertyReadSkipParents 排除）。
			const ctop = this.pack.compileTimeOps ?? EMPTY_SHAPES;
			if (ctop.length > 0 && node.type === "invocation_expression") {
				const fn = node.childForFieldName("function") ?? node.children[0];
				if (fn && fn.type === "identifier" && ctop.includes(fn.text)) return;
			}
			// CJS 导出函数 chunk（迭代15 解构 require 盲区）：exports.handler = function(){} /
			// module.exports.handler = fn → 建命名 chunk（名 = 成员名），from-import 语义
			// （imported="handler"）可解析；否则导出函数只有 <module> 伪 chunk，解构 require 回调全落 ?
			const cjsName = this.cjsExportName(node);
			const isChunk =
				this.pack.chunkNodes.includes(node.type) || cjsName !== null;
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
					mc.paramTypes = this.paramTypesOf(node); // 迭代35 A1：参数显式类型绑定
					mc.localBindings = this.localBindingsOf(node, mc.params); // 迭代37 P1-2：局部单赋值构造绑定
					chunks.push(mc as RawChunk);
					stack.push(mc);
					pushed = true;
				}
			}
			if (this.pack.callNodes.includes(node.type)) {
				stack[stack.length - 1]!.calls.push(this.callOf(node));
			}
			// 迭代40 B5：属性读取形态（obj.Prop 读值，非调用/非写）→ prop 调用点。
			// 静态语言（C#）成员 miss 语义见 RawCall.prop——字段/自动属性/不存在成员读取无用户代码。
			// 参数名裸读（var x = a; 的 a）→ 读取参数引用无副作用 → 直接跳过（assigned 含参数，
			// 裸名分支会被遮蔽守卫误挡成 ?——参数读取纯是静态事实，不需要解析）。
			if (
				this.pack.propertyReadNodes?.includes(node.type) &&
				this.isPropertyRead(node) &&
				!(
					node.type === "identifier" &&
					stack[stack.length - 1]!.params.includes(node.text)
				)
			) {
				stack[stack.length - 1]!.calls.push(this.propertyReadOf(node));
			}
			// 状态写检测（用户需求 2026-08-11）：self.x = / this.x = / global、nonlocal 声明 /
			// 任意外部对象属性写（user.status = "banned"，obj 非局部新建）→ state 效应。
			// 位置化（迭代8 视角2）：返回位置列表（"self.x" / "user.status" / "counter"）供读方传播匹配。
			// CJS 导出赋值（cjsExportName 命中）是模块级导出定义非 chunk 体状态写——跳过（迭代15 视角 2 探针发现）
			const writes =
				cjsName === null
					? this.stateWritePos(node, stack[stack.length - 1]!)
					: [];
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
		// 迭代43 r2：static 初始化器单元（合成 chunk）——追加到 chunks（link 侧按 name 识别建映射）
		const staticInit = this.staticInitOf(root);
		if (staticInit) chunks.push(...staticInit);
		const ce = this.classExtendsOf(root); // 迭代38 A：继承边（单次遍历，避免双走）
		const mn = this.memberNamesOf(root); // 迭代40 M6：类字段名（TS/JS 无 getter 字段判纯）
		return {
			file,
			lang: this.pack.name,
			contentHash:
				precomputedHash ??
				createHash("sha256").update(source, "utf8").digest("hex"),
			chunks,
			imports: this.pack.extractImports(root),
			defaultExport: findDefaultExport(root, this.pack),
			moduleBindings: this.moduleBindingsOf(root),
			classExtends: ce.map,
			hasDynamicExtends: ce.dynamic || undefined,
			virtualMembers: this.virtualMembersOf(root) || undefined,
			events: this.eventsOf(root) || undefined, // 迭代43 B：类事件表（事件触发通道）
			memberNames: mn || undefined,
			parseError: root.hasError,
		};
	}

	/** 模块级单赋值绑定（模块级值绑定溯源，A）：名称 → 构造类名；last-write-wins；定义遮蔽赋值。
	 *  迭代39 P2-1：包装/声明/赋值节点走投影表。 */
	private moduleBindingsOf(root: SyntaxNode): Record<string, string> {
		const bindings: Record<string, string> = {};
		const stmtWraps = shapesOf(this.pack, "stmtWrapNodes");
		const decls = shapesOf(this.pack, "declNodes");
		const assigns = shapesOf(this.pack, "bindAssigns"); // 不含 augmented（x += C() 非构造绑定）
		const ctorCalls = shapesOf(this.pack, "ctorCallNodes");
		const callShapes = shapesOf(this.pack, "callShapes");
		for (const stmt0 of root.children) {
			// 解包包装节点：TS export const x = ...（export_statement→variable_declarator）、
			// Python 表达式语句（expression_statement→assignment）。
			// 迭代40 P0-3：export 容器/声明节点判定走 pack 表（exportStmtNodes/declNodes）
			let stmt: SyntaxNode = stmt0;
			if (
				stmtWraps.includes(stmt.type) &&
				shapesOf(this.pack, "exportStmtNodes").includes(stmt.type)
			) {
				const decl = stmt.children.find((c) => decls.includes(c.type));
				if (decl)
					stmt = decl.children.find((c) => decls.includes(c.type)) ?? stmt;
			} else if (stmtWraps.includes(stmt.type)) {
				const inner = stmt.children[0];
				if (inner && assigns.includes(inner.type)) stmt = inner;
			}
			// 赋值/声明：x = C() / const x = new C() / const x = C()
			if (assigns.includes(stmt.type) || decls.includes(stmt.type)) {
				const left =
					stmt.childForFieldName("left") ?? stmt.childForFieldName("name");
				const value =
					stmt.childForFieldName("right") ?? stmt.childForFieldName("value");
				if (
					left &&
					(left.type === "identifier" || left.type === "property_identifier") &&
					value
				) {
					let cls: string | null = null;
					if (callShapes.includes(value.type)) {
						const fn = value.childForFieldName("function") ?? value.children[0];
						if (
							fn &&
							(fn.type === "identifier" || fn.type === "property_identifier") &&
							// 迭代40 P0-3 H12：require 名走 pack 数据（仅 JS 族）
							!(this.pack.requireFnNames ?? EMPTY_SHAPES).includes(fn.text)
						)
							cls = fn.text;
					} else if (
						ctorCalls.includes(value.type) &&
						this.pack.trustedCtor !== false
					) {
						// 迭代38 规则7：JS/TS 构造器可 return 任意对象 → new X() 不产 trusted 绑定（假纯洞 B2）
						// 迭代40 P0-3 H02：类型名字段走 pack 数据
						const typeField = this.pack.ctorTypeFields?.[value.type];
						const ctor =
							typeField !== undefined
								? value.childForFieldName(typeField)
								: (value.childForFieldName("constructor") ?? value.children[1]);
						if (ctor) cls = ctorTypeName(ctor, this.pack);
					}
					if (cls !== null) bindings[left.text] = cls;
					else delete bindings[left.text]; // 非类赋值/重绑 → 清除（不可证）
				}
			} else if (this.pack.chunkNodes.includes(stmt.type)) {
				const nameNode = stmt.childForFieldName("name");
				if (nameNode) delete bindings[nameNode.text]; // 定义遮蔽赋值绑定
			}
		}
		return bindings;
	}

	/** 迭代37 P1-2：函数内局部单赋值构造绑定（C6——最小语言类型层第一个传递函数）。
	 *  数学 G4 守卫：恰一次赋值 ∧ RHS 是构造调用形态（C# object_creation_expression /
	 *  TS new_expression / Python|TS 类调用 x = C()）∧ 非参数 ∧ 非嵌套函数体。
	 *  多赋值/非构造赋值 → 不绑（保守：类型多变/不可证）。函数名 RHS（x = make()）→ 绑函数名，
	 *  消费端 globalClasses 只含 kind=class → 函数名不命中 → ? 诚实（kind=class 校验在消费侧）。
	 *  嵌套 chunk（方法/局部函数/lambda/类）的赋值归它们自己，本函数跳过（防跨作用域错绑假纯）。 */
	private localBindingsOf(
		node: SyntaxNode,
		params: readonly string[],
	): Record<string, string> | undefined {
		const counts: Record<string, { count: number; cls: string }> = {};
		// 嵌套函数状节点（不处理其内部赋值）：chunkNodes + pack 边界集（迭代40 P0-3 H19）
		const nested = new Set([
			...this.pack.chunkNodes,
			...(this.pack.nestedFnBoundaryNodes ?? EMPTY_SHAPES),
		]);
		const visit = (n: SyntaxNode): void => {
			if (n !== node && nested.has(n.type)) return; // 嵌套 chunk 的绑定归它们
			// 迭代39 P2-1：声明/赋值节点走投影表（bindAssigns 不含 augmented——增量非构造绑定）
			if (
				shapesOf(this.pack, "declNodes").includes(n.type) ||
				shapesOf(this.pack, "bindAssigns").includes(n.type)
			) {
				const left =
					n.childForFieldName("left") ??
					n.childForFieldName("name") ??
					n.children[0] ??
					null;
				let value =
					n.childForFieldName("right") ??
					n.childForFieldName("value") ??
					n.children[n.children.length - 1] ??
					null;
				// 迭代40 P0-3：value 包装节点解包走 pack 数据（C# variable_declarator 的
				// value 字段是 equals_value_clause 包装——"=" 表达式）
				if (
					value !== null &&
					(this.pack.valueWrapNodes ?? EMPTY_SHAPES).includes(value.type)
				) {
					value =
						value.childForFieldName("value") ??
						value.children[value.children.length - 1] ??
						null;
				}
				if (
					left !== null &&
					value !== null &&
					(left.type === "identifier" || left.type === "property_identifier") &&
					!params.includes(left.text)
				) {
					// 参数重绑不绑（def f(x): x = C()——调用方注入类型）
					const name = left.text;
					const cls = this.ctorClsOf(value);
					const b = counts[name] ?? { count: 0, cls: "" };
					b.count++;
					if (cls !== null) b.cls = cls;
					counts[name] = b;
				}
			}
			for (const c of n.children) visit(c);
		};
		visit(node);
		const out: Record<string, string> = {};
		for (const [name, b] of Object.entries(counts)) {
			if (b.count === 1 && b.cls !== "") out[name] = b.cls;
		}
		return Object.keys(out).length > 0 ? out : undefined;
	}

	/** 构造调用形态 RHS → 类型名（C# new X() / TS new X() / Python|TS 类调用 X()）；非构造 → null。 */
	private ctorClsOf(value: SyntaxNode): string | null {
		const ctorCalls = shapesOf(this.pack, "ctorCallNodes");
		const callShapes = shapesOf(this.pack, "callShapes");
		// 迭代40 P0-3 H02：构造节点 → 类型名字段走 pack 数据（C# type / TS constructor），
		// 统一 ctorTypeName 剥壳（identifier/generic_name/qualified_name 通用）
		const typeField = this.pack.ctorTypeFields?.[value.type];
		if (ctorCalls.includes(value.type) && typeField !== undefined) {
			// 迭代38 规则7：JS/TS 构造器可 return 任意对象 → 不产 trusted 绑定（假纯洞 B2）
			if (this.pack.trustedCtor === false) return null;
			const ctor =
				value.childForFieldName(typeField) ?? value.children[1] ?? null;
			if (ctor) return ctorTypeName(ctor, this.pack);
			return null;
		}
		if (callShapes.includes(value.type)) {
			// Python/TS 类调用：x = C()（函数名 RHS 也绑——消费端 kind=class 校验兜底 ?）。
			// 迭代40 P0-3 H12：require 名走 pack 数据（仅 JS 族）
			const fn = value.childForFieldName("function") ?? value.children[0];
			if (
				fn &&
				(fn.type === "identifier" || fn.type === "property_identifier") &&
				!(this.pack.requireFnNames ?? EMPTY_SHAPES).includes(fn.text)
			) {
				return fn.text;
			}
		}
		return null;
	}

	/** 迭代38 A：类继承边提取（类名 → 静态基类名列表；动态 heritage → hasDynamicExtends）。
	 *  Python class_definition superclasses 字段 / C# class_declaration base_list 字段 /
	 *  TS class_declaration class_heritage 子节点。只收静态 identifier / 泛型末段（ctorTypeName 剥壳）；
	 *  非静态形态（member_expression、调用、属性访问等）→ 该类不记边且 hasDynamicExtends = true。
	 *  C# 接口名照记（基类与接口同为 base_list identifier——保守并集，仅污染祖先集不假纯，文档化）。 */
	private classExtendsOf(root: SyntaxNode): {
		map: Record<string, readonly string[]>;
		dynamic: boolean;
	} {
		const map: Record<string, string[]> = {};
		let dynamic = false;
		const visit = (n: SyntaxNode): void => {
			if (this.pack.classNodes.includes(n.type)) {
				const name = n.childForFieldName("name");
				const bases: string[] = [];
				if (name) {
					const pushBase = (c: SyntaxNode): void => {
						// 迭代44-r3 痛点2 根因修复：非继承形态排除——枚举底层类型（enum X : int 的
						// predefined_type）与预处理指令（#if DISABLE_SRDEBUGGER 内类声明——if_directive
						// 混入 base_list 子节点）此前落 dynamic=true → 语言级降级 → 全库多态解析 unknown。
						// ERROR（parseError 文件）同样跳过（文件已降级，不额外污染语言级）。
						if (
							c.type === "predefined_type" ||
							c.type === "if_directive" ||
							c.type === "else_directive" ||
							c.type === "elif_directive" ||
							c.type === "endif_directive" ||
							c.type === "define_directive" ||
							c.type === "undef_directive" ||
							c.type === "ERROR"
						)
							return;
						if (
							c.type === "identifier" ||
							c.type === "type_identifier" ||
							c.type === "property_identifier"
						) {
							bases.push(c.text);
						} else if (
							(this.pack.heritageWrapNodes ?? EMPTY_SHAPES).includes(c.type)
						) {
							// 迭代39：TS class_heritage 内包一层 extends_clause（extends 表达式）；
							// 迭代40 P0-3：包装节点走 pack 数据
							for (const k of c.children) if (k.isNamed) pushBase(k);
						} else if (
							(this.pack.typeNameNodes ?? EMPTY_SHAPES).includes(c.type) &&
							c.type === "generic_name"
						) {
							const t = ctorTypeName(c, this.pack); // List<int> → List（末段）
							if (t !== null) bases.push(t);
							else dynamic = true;
						} else if (
							(this.pack.typeNameNodes ?? EMPTY_SHAPES).includes(c.type) &&
							c.type === "qualified_name"
						) {
							// 迭代44-r3 痛点2 根因：C# 命名空间限定基类（class X : Sirenix.OdinInspector.Editor.OdinEditor）
							// 此前落 dynamic=true → 语言级降级 → 全库全部多态解析 unknown（Init·bare 52 条实证）。
							// qualified_name 是静态可解析（剥壳末段——与 generic_name 同款）。
							const t = ctorTypeName(c, this.pack);
							if (t !== null) bases.push(t);
							else dynamic = true;
						} else {
							dynamic = true; // 动态 heritage：member_expression / 调用 / subscript 等
						}
					};
					// 迭代40 P0-3 H10：基类容器字段走 pack 数据（Python class_definition →
					// "superclasses" 字段；C#/TS 无字段 → heritageNodes 子节点查找）
					const heritageField = this.pack.heritageFields?.[n.type];
					if (heritageField !== undefined) {
						const sup = n.childForFieldName(heritageField);
						// isNamed 过滤：argument_list 含逗号等匿名子节点（否则误标 dynamic）
						if (sup) for (const c of sup.children) if (c.isNamed) pushBase(c);
					} else {
						// C# base_list / TS class_heritage 是子节点（探针实证）——heritageNodes 表查找
						const bl =
							n.children.find((c) =>
								shapesOf(this.pack, "heritageNodes").includes(c.type),
							) ?? null;
						if (bl) for (const c of bl.children) if (c.isNamed) pushBase(c);
					}
					if (bases.length > 0) map[name.text] = bases;
				}
			}
			for (const c of n.children) visit(c);
		};
		visit(root);
		return { map, dynamic };
	}

	/** 迭代39 B7：virtual 族方法提取（C# method_declaration 修饰符 virtual/override/abstract，无 sealed）。
	 *  sealed override 不可再覆写 → 静态分派精确，排除。base_list ≥2 命名子节点（基类 + 接口）→
	 *  该类全部方法隐含 virtual 族（接口实现隐式 virtual，保守并集；单接口形态 = B13 残余）。
	 *  Python/JS 走 pack.polymorphicMethods（一切方法多态），不需本表。 */
	private virtualMembersOf(
		root: SyntaxNode,
	): Record<string, readonly string[]> | null {
		const out: Record<string, string[]> = {};
		const visit = (n: SyntaxNode): void => {
			if (this.pack.classNodes.includes(n.type)) {
				const name = n.childForFieldName("name");
				if (name) {
					// base_list 命名子节点数（C#：首 = 基类，其余 = 接口；TS class_heritage 单类）
					// 迭代39 P2-1：heritage 容器走投影表
					const bl =
						n.childForFieldName("base_list") ??
						n.children.find((c) =>
							shapesOf(this.pack, "heritageNodes").includes(c.type),
						) ??
						null;
					const namedBases = bl
						? bl.children.filter((c) => c.isNamed).length
						: 0;
					const allVirtual =
						namedBases >= (this.pack.interfaceHeuristicMinBases ?? Infinity); // 迭代40 P0-3 B03：接口启发阈值走 pack 数据
					// 迭代39 审计必修 2：**接口声明本身** = 全部方法无条件 virtual（C# 接口分派恒动态——
					// 接口作静态类型的接收者会精确解析到无方法体的接口 chunk → 假纯，独立审计反例）。
					// 迭代40 P0-3：接口节点判定走 pack 数据（C# interface_declaration；其他语言不填）
					const isInterface = (
						this.pack.interfaceNodes ?? EMPTY_SHAPES
					).includes(n.type);
					// 方法在 declaration_list 内（非直接子节点）——递归，嵌套类/结构体边界即停（归它们自己）
					const walk = (node: SyntaxNode): void => {
						if (node !== n && this.pack.classNodes.includes(node.type)) return;
						if (shapesOf(this.pack, "methodNodes").includes(node.type)) {
							const mn = node.childForFieldName("name");
							if (mn) {
								const mods = node.children.map((x) => x.text); // 修饰符 token 可能命名/匿名——全子节点文本匹配
								// 迭代40 P0-3 H03：修饰符语义走 pack 数据（C# virtual/override/abstract/sealed；
								// 其他语言不填 → 无 virtual 族——与 polymorphicMethods 语义正交）
								const vmods = this.pack.virtualModifiers ?? EMPTY_SHAPES;
								const smods = this.pack.sealedModifiers ?? EMPTY_SHAPES;
								const sealed = mods.some((m) => smods.includes(m));
								const virtual = mods.some((m) => vmods.includes(m));
								if (!sealed && (allVirtual || virtual || isInterface)) {
									(out[name.text] ??= []).push(mn.text);
								}
							}
							return;
						}
						for (const c of node.children) walk(c);
					};
					for (const c of n.children) walk(c);
				}
			}
			for (const c of n.children) visit(c);
		};
		visit(root);
		return Object.keys(out).length > 0 ? out : null;
	}

	/** 迭代40 M6：类字段名提取（TS/JS public_field_definition——无 getter 声明的字段读取纯）。
	 *  类名 → 字段名列表；与 virtualMembersOf 同构（classNodes 遍历 + 嵌套类边界即停）。 */
	private memberNamesOf(
		root: SyntaxNode,
	): Record<string, readonly string[]> | null {
		const memberNodes = this.pack.memberNameNodes ?? EMPTY_SHAPES;
		if (memberNodes.length === 0) return null;
		const out: Record<string, string[]> = {};
		const visit = (n: SyntaxNode): void => {
			if (this.pack.classNodes.includes(n.type)) {
				const name = n.childForFieldName("name");
				if (name) {
					const walk = (node: SyntaxNode): void => {
						if (node !== n && this.pack.classNodes.includes(node.type)) return;
						if (memberNodes.includes(node.type)) {
							const nm = node.children.find(
								(c) =>
									c.type === "property_identifier" || c.type === "identifier",
							);
							if (nm) (out[name.text] ??= []).push(nm.text);
							return;
						}
						for (const c of node.children) walk(c);
					};
					for (const c of n.children) walk(c);
				}
			}
			for (const c of n.children) visit(c);
		};
		visit(root);
		return Object.keys(out).length > 0 ? out : null;
	}

	/** 迭代43 B：类事件表提取（C# event_field_declaration + `evt += h` 订阅点）。
	 *  类名 → 事件名 → { private, handlers, incomplete }。
	 *  形态规则（数学评审 §2 + 工程评审陷阱）：
	 *  - 订阅点 = augmented_assignment_expression（运算符 ∈ pack.eventSubscribeOps），left 裸名 identifier
	 *    → 事件；RHS 裸名 identifier → handler（跨方法关联）；RHS 其他形态（lambda/调用/方法组引用）
	 *    → 集合不完整（触发端 ?）；
	 *  - left 为 member_access（X.evt += h 跨实例订阅，property 名 ∈ 本类事件）→ 集合不完整（接收者
	 *    类型不可证 → 订阅不可归属 → 触发端 ? 传导）；
	 *  - partial 类（修饰符）→ 订阅可跨文件 → 集合不完整（数学修正 3）。 */
	private eventsOf(
		root: SyntaxNode,
	): Record<string, Readonly<Record<string, FileEventInfo>>> | null {
		const eventNodes = this.pack.eventFieldNodes ?? EMPTY_SHAPES;
		const ops = this.pack.eventSubscribeOps ?? EMPTY_SHAPES;
		if (eventNodes.length === 0 || ops.length === 0) return null;
		const out: Record<string, Record<string, FileEventInfo>> = {};
		const visit = (n: SyntaxNode): void => {
			if (this.pack.classNodes.includes(n.type)) {
				const name = n.childForFieldName("name");
				if (name) {
					const cls: Record<string, FileEventInfo> = {};
					const isPartial = n.children.some((c) => c.text === "partial");
					const walk = (node: SyntaxNode): void => {
						if (node !== n && this.pack.classNodes.includes(node.type)) return;
						if (eventNodes.includes(node.type)) {
							// C# 形态（探针实证）：event_field_declaration → variable_declaration →
							// variable_declarator(identifier name, equals_value_clause?)——name 字段不在
							// event_field_declaration 直接子节点（嵌套两层）。
							const vdecl = node.children.find(
								(c) => c.type === "variable_declaration",
							);
							const vd = vdecl?.children.find(
								(c) => c.type === "variable_declarator",
							);
							const en = vd?.childForFieldName("name") ?? vd?.children[0];
							if (en) {
								const mods = node.children.map((x) => x.text);
								const info: FileEventInfo = {
									private: mods.includes("private"),
									handlers: [],
									incomplete: isPartial,
								};
								// 初始化器订阅（数学 §2a）：`= HandleInit` 在构造序早期注册 → 属 sub_static。
								// RHS identifier → handler；RHS 调用形态（Factory()）真实执行于字段初始化——
								// 保留调用边（callOf 通道），不并入订阅边语义（数学修正 2）。
								// C# 形态（探针实证）：初始化器在 equals_value_clause 子节点（无 value 命名字段）
								const rhs = vd?.children.find(
									(c) => c.type === "equals_value_clause",
								)?.namedChildren[0];
								if (rhs && rhs.type === "identifier")
									info.handlers.push(rhs.text);
								cls[en.text] = info;
							}
							return;
						}
						if (
							node.type === "assignment_expression" &&
							node.children.some(
								(c) => c.type === "assignment_operator" && ops.includes(c.text),
							)
						) {
							// 订阅点（探针实证）：C# 事件 += 是 assignment_expression（含 assignment_operator
							// 匿名子节点），非 augmented_assignment。left/right 字段兜底 children 索引。
							const left = node.childForFieldName("left") ?? node.children[0];
							const right =
								node.childForFieldName("right") ?? node.namedChildren[1];
							if (left && right) {
								if (left.type === "identifier") {
									const ev = cls[left.text];
									if (ev) {
										if (right.type === "identifier")
											ev.handlers.push(right.text);
										else ev.incomplete = true; // lambda/方法组/调用 → 集合不完整
									}
								} else if (left.type === "member_access_expression") {
									const prop = left.childForFieldName("property");
									const ev = prop && cls[prop.text];
									if (ev) ev.incomplete = true; // 跨实例订阅 → 触发端 ?
								}
							}
						}
						for (const c of node.children) walk(c);
					};
					for (const c of n.children) walk(c);
					if (Object.keys(cls).length > 0) out[name.text] = cls;
				}
			}
			for (const c of n.children) visit(c);
		};
		visit(root);
		return Object.keys(out).length > 0 ? out : null;
	}

	/** 迭代43 r2：static 初始化器单元提取（C# static 字段初始化器 value + 静态构造器体 → 合成 chunk
	 *  "<static-init>"，ownerClass=类名——类型加载效应独立判定单元）。主 visit 已跳过这些子树
	 *  （class chunk 不含类型加载调用），此处独立收集（callNodes → callOf；属性读取 → propertyReadOf，
	 *  与主 visit 同通道）。normText = 静态成员文本拼接（内容寻址稳定：类内方法变化不漂移 static-init id）。 */
	private staticInitOf(root: SyntaxNode): RawChunk[] | null {
		const smods = this.pack.staticModifiers ?? EMPTY_SHAPES;
		if (smods.length === 0) return null;
		const out: MutableChunk[] = [];
		const isStatic = (n: SyntaxNode): boolean =>
			n.children.some((c) => smods.includes(c.text));
		const collect = (node: SyntaxNode, chunk: MutableChunk): void => {
			const walkC = (n: SyntaxNode): void => {
				if (this.pack.callNodes.includes(n.type)) {
					chunk.calls.push(this.callOf(n));
				} else if (
					this.pack.propertyReadNodes?.includes(n.type) &&
					this.isPropertyRead(n)
				) {
					chunk.calls.push(this.propertyReadOf(n));
				}
				for (const c of n.children) walkC(c);
			};
			walkC(node);
		};
		const visit = (n: SyntaxNode): void => {
			if (this.pack.classNodes.includes(n.type)) {
				const name = n.childForFieldName("name");
				if (name) {
					const sic = fresh(
						"<static-init>",
						n.startPosition.row + 1,
						n.endPosition.row + 1,
						"",
						name.text,
						"function",
					);
					const parts: string[] = [];
					const walk = (node: SyntaxNode): void => {
						if (node !== n && this.pack.classNodes.includes(node.type)) return;
						if (
							(node.type === "field_declaration" ||
								node.type === "constructor_declaration") &&
							isStatic(node)
						) {
							let target: SyntaxNode | null = null;
							if (node.type === "field_declaration") {
								// C# 形态（探针实证）：field_declaration → variable_declaration → variable_declarator
								// → equals_value_clause（初始化器在 equals_value_clause 子节点，无 value 命名字段）
								const vdecl = node.children.find(
									(c) => c.type === "variable_declaration",
								);
								const vd = vdecl?.children.find(
									(c) => c.type === "variable_declarator",
								);
								const evc = vd?.children.find(
									(c) => c.type === "equals_value_clause",
								);
								target = evc ?? null;
							} else {
								target =
									node.childForFieldName("body") ??
									node.children[node.children.length - 1] ??
									null;
							}
							if (target) {
								collect(target, sic);
								// 审计 blocker：normText 必须去注释（公理4 内容身份稳定）——
								// node.text 含注释 → id 随注释漂移；normalizeCode 与 class chunk 同款
								parts.push(normalizeCode(node));
							}
							return;
						}
						for (const c of node.children) walk(c);
					};
					for (const c of n.children) walk(c);
					if (parts.length > 0) {
						sic.normText = parts.join(" ");
						out.push(sic);
					}
				}
			}
			for (const c of n.children) visit(c);
		};
		visit(root);
		return out.length > 0 ? out : null;
	}

	/** 状态写位置提取（迭代8 视角2）：self.x= / this.x= / global、nonlocal 声明 → 位置列表（空 = 非写）。
	 *  迭代39 P2-1：节点类型判定走 pack 投影表。 */
	private stateWritePos(node: SyntaxNode, chunk: MutableChunk): string[] {
		if (shapesOf(this.pack, "writeStmts").includes(node.type)) {
			// Python：global counter, x → 声明名列表
			return node.children
				.filter((c) => c.type === "identifier")
				.map((c) => c.text);
		}
		if (shapesOf(this.pack, "writeAssigns").includes(node.type)) {
			// 迭代25：C# 对象初始化器（new C { A = v }）——新鲜对象属性初始化，非外部状态写。
			// TS/JS 对象字面量是 pair 节点、从不触发写分支；Python dict 同理——本跳过是对齐语义。
			if (
				shapesOf(this.pack, "initializerParentNodes").includes(
					node.parent?.type ?? "",
				)
			)
				return [];
			const left = node.childForFieldName("left") ?? node.children[0];
			const pos = this.externalWritePos(left, chunk);
			return pos !== null ? [pos] : [];
		}
		if (shapesOf(this.pack, "writeUpdates").includes(node.type)) {
			// TS：this.x++ / this.x--
			const arg = node.childForFieldName("argument") ?? node.children[0];
			const pos = this.externalWritePos(arg, chunk);
			return pos !== null ? [pos] : [];
		}
		if (shapesOf(this.pack, "writeUnary").includes(node.type)) {
			// 迭代25：C# i++ / this.x++ / ++i。操作数是唯一 named 子节点（++/-- 是匿名 token）；
			// 不用 children[0]（prefix 的 children[0] 是 `++`）——web-tree-sitter 引用比较恒真（iter24 教训）。
			// 注意：!x / -x / ~x 同为 prefix_unary_expression 但语义是**读**（逻辑非/取负）——
			// 只认增减操作符（迭代40 P0-3：token 走 pack 数据，C# "++"/"--"）
			const isIncDec = node.children.some((c) =>
				(this.pack.incDecTokens ?? EMPTY_SHAPES).includes(c.text),
			);
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
		// 迭代39 P2-1：节点类型判定走 pack 投影表
		const S = shapesOf(this.pack, "memberNodes");
		const SW = shapesOf(this.pack, "memberWrapNodes");
		const SC = shapesOf(this.pack, "callShapes");
		const SCT = shapesOf(this.pack, "ctorCallNodes");
		if (node.type === "identifier") {
			// 裸标识符读（模块级 let / 闭包外层变量）：∉ 参数 且 ∉ 局部赋值 → 外部状态读（终裁 Step1）。
			// 迭代24：成员访问结构（obj.attr / obj?.attr）的子标识符由成员节点统一承担——跳过，避免
			// C#/Python 成员名（identifier 类型）被当裸变量读（Foo.instance.x 的 instance/成员名全误读）。
			const p = node.parent;
			if (p && (S.includes(p.type) || SW.includes(p.type))) return [];
			// 迭代26-27：统一声明名抑制——声明名不是裸变量读（parent 的 name 字段指向自身、
			// 或声明结构中的名字位置）。.id 判等（iter24 教训：`===` 恒假）。
			const p2 = p;
			// ① name 字段（def foo / function foo / C# method/catch_declaration name，迭代26）
			if (p2 && p2.childForFieldName("name")?.id === node.id) return [];
			// ② 声明名位（迭代40 P0-3：declNodes 表）——children[0] 即声明名位置（裸 identifier 或 pattern）。
			//    简单名（var q=1）已被 assigned 覆盖（迭代25c），本规则对其冗余无害；真收益 = pattern 名。
			if (
				p2 &&
				shapesOf(this.pack, "declNodes").includes(p2.type) &&
				p2.children[0]?.id === node.id
			)
				return [];
			// ③ pattern 名（迭代40 P0-3 H15）：声明名位置 pattern 的直接 identifier 子节点
			const pp = p2?.parent;
			if (
				pp &&
				shapesOf(this.pack, "declNodes").includes(pp.type) &&
				pp.children[0]?.id === p2?.id &&
				(this.pack.patternNameNodes ?? EMPTY_SHAPES).includes(p2?.type ?? "")
			)
				return [];
			// ④ foreach 变量（迭代40 P0-3 H07）：foreach 节点的裸 identifier 直接子节点，
			//    且位于 `in` token 之前（其后同名 identifier 是集合——真读，不得抑制）
			if (p2 && (this.pack.foreachNodes ?? EMPTY_SHAPES).includes(p2.type)) {
				const kids = p2.children;
				const inIdx = kids.findIndex(
					(c) => c.type === this.pack.foreachInToken,
				);
				if (inIdx >= 0 && kids.some((c, i) => c.id === node.id && i < inIdx))
					return [];
			}
			// ⑤ 异常变量：catch 节点 / except as pattern 的唯一 identifier
			if (
				p2 &&
				(shapesOf(this.pack, "catchNodes").includes(p2.type) ||
					(this.pack.patternNameNodes ?? EMPTY_SHAPES).includes(p2.type))
			)
				return [];
			if (
				!chunk.params.includes(node.text) &&
				!chunk.assigned.includes(node.text)
			)
				return [node.text];
			return [];
		}
		if (!S.includes(node.type)) return [];
		const parent = node.parent;
		const isAssignmentParent = (t: string): boolean =>
			shapesOf(this.pack, "writeAssigns").includes(t) ||
			shapesOf(this.pack, "writeUpdates").includes(t);
		const isCallLike = (t: string): boolean =>
			SC.includes(t) || SCT.includes(t);
		if (parent && isAssignmentParent(parent.type)) {
			// 赋值左值跳过（写侧已处理；augmented/update 的右值读由右侧表达式节点捕获）
			const left =
				parent.childForFieldName("left") ?? parent.children[0] ?? null;
			if (left != null && left.id === node.id) return [];
		}
		if (parent && isCallLike(parent.type)) {
			// 调用目标排除（user.save() 不是字段值读取；instance.Method() 同理）
			const fn =
				parent.childForFieldName("function") ??
				parent.childForFieldName("constructor") ??
				parent.children[0] ??
				null;
			if (fn != null && fn.id === node.id) return [];
		}
		// 边缘：a.b?.c() 内层成员——member_access_expression(a.b) 的 parent 是 conditional_access_expression
		// （非调用），但该 conditional 是 invocation 的 function 链一部分 → 排除内层成员
		if (
			parent &&
			S.includes(parent.type) &&
			parent.type === "conditional_access_expression"
		) {
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
			const mbe = node.children.find((c) => SW.includes(c.type));
			attrNode = mbe ? (mbe.namedChildren[0] ?? null) : null;
		} else {
			obj =
				node.childForFieldName("object") ??
				node.childForFieldName("expression") ??
				node.children[0] ??
				null;
			attrNode =
				node.childForFieldName("attribute") ??
				node.childForFieldName("property") ??
				node.childForFieldName("name") ??
				node.children[node.children.length - 1] ??
				null;
		}
		if (!obj || !attrNode) return [];
		if (this.pack.selfNames.includes(obj.text))
			// 迭代40 P0-3 H05：自引用名走 pack.selfNames 表（原硬编码 self/cls/this）
			return [`self.${attrNode.text}`];
		if (obj.type === "identifier") {
			if (chunk.params.includes(obj.text) || !chunk.assigned.includes(obj.text))
				return [`${obj.text}.${attrNode.text}`];
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
			n =
				n.childForFieldName("value") ??
				n.childForFieldName("object") ??
				n.childForFieldName("function") ??
				n.children[0] ??
				null;
		}
		return null;
	}

	/** 异常捕获类型提取（迭代7 ④ + 迭代40 P0-3 B01）：catch 类型化形态走 pack 数据
	 *  （C# catch_declaration 含 type → 精确类型；TS/JS catch 无 → "*" 吞一切；
	 *  Python except_clause 类型是直接子节点）。非捕获节点 → null。 */
	private catchTypeOf(node: SyntaxNode): string | null {
		const catches = shapesOf(this.pack, "catchNodes");
		if (catches.includes(node.type)) {
			// 类型化 catch（C# catch (IOException e) → catch_declaration 含 type）——
			// 通用形态判定：catchDeclNodes 命中 → 提取类型；无 → 落原分支
			const decls = this.pack.catchDeclNodes ?? EMPTY_SHAPES;
			const decl = node.children.find((c) => decls.includes(c.type));
			if (decl) {
				const typ = decl.childForFieldName("type") ?? null;
				if (typ) return ctorTypeName(typ, this.pack) ?? "*";
				return "*"; // catch (e) 无类型（罕见）→ 吞一切
			}
			// Python：except ValueError: / except (A, B): / except: / except Exception as e:
			// 类型节点 = identifier（公共）或成员访问（memberNodes 表）
			const typ = node.children.find(
				(c) =>
					c.type === "identifier" ||
					shapesOf(this.pack, "memberNodes").includes(c.type) ||
					(this.pack.catchMultiTypeNodes ?? EMPTY_SHAPES).includes(c.type),
			);
			if (!typ) return "*"; // 裸 except:
			// 迭代40 P0-3 漏网：多类型捕获节点走 pack 数据（Python except (A,B) 的 tuple——保守吞一切）
			if ((this.pack.catchMultiTypeNodes ?? EMPTY_SHAPES).includes(typ.type))
				return "*";
			return typ.text; // 精确类型（仅字面匹配；项目自定义类型未提取继承边 → 保守不减其子类）
		}
		return null;
	}

	/** chunk 自身参数名（不进入嵌套函数——只取本 chunk 的参数列表直接子节点）。
	 *  迭代40 P0-3 H18：参数列表节点走 pack 数据（parameters/formal_parameters）。 */
	private paramNames(root: SyntaxNode): string[] {
		const out: string[] = [];
		const params = root.childForFieldName(
			this.pack.paramListField ?? "parameters",
		);
		if (!params) return out;
		const push = (n: SyntaxNode): void => {
			if (shapesOf(this.pack, "paramNodes").includes(n.type)) {
				const named = n.childForFieldName("name");
				if (
					named &&
					(named.type === "identifier" || named.type === "property_identifier")
				) {
					out.push(named.text);
					return;
				}
			}
			// 迭代40 P0-3 H11：参数名槽位走 pack 数据（Python typed_parameter 无 name 字段 →
			// "__firstIdentifier"；其余语言 name/pattern 字段）
			const slots = this.pack.paramNameSlots?.[n.type];
			if (slots) {
				for (const slot of slots) {
					if (slot === "__child0") {
						const c0 = n.children[0] ?? null;
						if (
							c0 &&
							(c0.type === "identifier" || c0.type === "property_identifier")
						) {
							out.push(c0.text);
							return;
						}
					} else if (slot === "__firstIdentifier") {
						const id = n.children.find(
							(c) =>
								c.type === "identifier" || c.type === "property_identifier",
						);
						if (id) {
							out.push(id.text);
							return;
						}
					} else {
						const named = n.childForFieldName(slot);
						if (
							named &&
							(named.type === "identifier" ||
								named.type === "property_identifier")
						) {
							out.push(named.text);
							return;
						}
					}
				}
			}
			const named =
				n.childForFieldName("name") ?? n.childForFieldName("pattern") ?? null;
			if (
				named &&
				(named.type === "identifier" || named.type === "property_identifier")
			) {
				out.push(named.text);
			} else if (n.type === "identifier" || n.type === "property_identifier") {
				out.push(n.text);
			}
		};
		for (const c of params.children) push(c);
		return out;
	}

	/** 迭代35 A1 + 迭代40 P0-3 H11/H18：参数显式类型提取（方法参数 Dictionary<string,int> d → d: "Dictionary"）。
	 *  迭代36 独立审计修正：收集**全部显式参数类型**（剥壳后）——string/int 等表条目全纯方向安全；
	 *  项目类撞表键由 link A1 分支守卫排除（不在此过滤）。参数列表节点/名字槽位走 pack 数据。 */
	private paramTypesOf(root: SyntaxNode): Record<string, string> {
		const out: Record<string, string> = {};
		const params = root.childForFieldName(
			this.pack.paramListField ?? "parameters",
		);
		if (!params) return out;
		for (const c of params.children) {
			if (!shapesOf(this.pack, "paramNodes").includes(c.type)) continue;
			// 迭代38：typed_parameter 无 name 字段——name = 首个 identifier 子节点（探针实证）；
			// 迭代40 P0-3 H11：槽位机制统一（__firstIdentifier）
			const slots = this.pack.paramNameSlots?.[c.type];
			let name: SyntaxNode | null = c.childForFieldName("name") ?? null;
			if (!name && slots) {
				for (const slot of slots) {
					if (slot === "__firstIdentifier") {
						name =
							c.children.find(
								(x) =>
									x.type === "identifier" || x.type === "property_identifier",
							) ?? null;
						break;
					}
				}
			}
			// 迭代40 M6：类型注解解包（typeWrapNodes：TS type_annotation / Python type）
			let ty = c.childForFieldName(this.pack.paramTypeField ?? "type");
			while (
				ty !== null &&
				(this.pack.typeWrapNodes ?? EMPTY_SHAPES).includes(ty.type)
			) {
				ty = ty.children.find((x) => x.isNamed) ?? null;
			}
			if (
				!name ||
				!ty ||
				(name.type !== "identifier" && name.type !== "property_identifier")
			)
				continue;
			const t = ctorTypeName(ty, this.pack); // 复用构造类型名剥壳（generic_name/qualified_name/predefined_type）
			if (t !== null) out[name.text] = t;
			else if (
				(this.pack.objectLiteralTypeNodes ?? EMPTY_SHAPES).includes(ty.type)
			) {
				// 对象字面量类型（TS `{name?: string}`）：属性是数据字段无 getter → 读取恒纯
				out[name.text] = "__objectLiteral";
			}
		}
		return out;
	}

	/** 本 chunk 内声明名（variable_declarator 的 let/const/var 定义，含解构绑定；Python 赋值非声明不收集）——裸标识符写外部性判定。 */
	private declaredNames(root: SyntaxNode): string[] {
		const out: string[] = [];
		const collectPattern = (n: SyntaxNode): void => {
			if (
				n.type === "shorthand_property_identifier_pattern" ||
				n.type === "identifier" ||
				n.type === "property_identifier"
			) {
				out.push(n.text);
			} else {
				for (const c of n.children) collectPattern(c);
			}
		};
		const walk = (n: SyntaxNode): void => {
			if (n.type === "variable_declarator") {
				const left = n.childForFieldName("name") ?? n.children[0];
				if (!left) return;
				if (left.type === "identifier" || left.type === "property_identifier")
					out.push(left.text);
				else collectPattern(left); // const {a} = obj / const [x] = arr（计算理论 Note：解构绑定是局部声明）
			}
			for (const c of n.children) walk(c);
		};
		walk(root);
		return out;
	}

	/** 异常抛出类型提取（盲区1 + 迭代40 P0-3 H09）：raise/throw 类型文本；裸 → "*"。
	 *  实参提取字段走 pack 数据（throwArgFields：TS throw_statement → "argument"；
	 *  Python raise 无字段 → 子节点查找）。非抛出节点 → null。 */
	private thrownTypeOf(node: SyntaxNode): string | null {
		if (!shapesOf(this.pack, "throwNodes").includes(node.type)) return null;
		const argField = this.pack.throwArgFields?.[node.type];
		if (argField === undefined) {
			// Python：raise / raise ValueError / raise ValueError("x")——子节点查找
			const exc = node.children.find(
				(c) =>
					c.type === "call" ||
					c.type === "identifier" ||
					c.type === "attribute",
			);
			if (!exc) return "*";
			if (exc.type === "call") {
				const fn = exc.childForFieldName("function") ?? exc.children[0];
				if (!fn) return "*";
				const flat = flattenCallTarget(fn, this.pack);
				return flat !== null ? flat.split(".").pop()! : "*";
			}
			const flat = flattenCallTarget(exc, this.pack);
			return flat !== null ? flat.split(".").pop()! : "*";
		}
		// TS/JS：throw new Error() / throw err / throw "x"
		const arg =
			node.childForFieldName(argField) ??
			node.children.find((c) => c.type !== "throw");
		if (!arg) return "*";
		if (arg.type === "new_expression") {
			// 迭代40 P0-3 H02：类型名字段走 pack 数据
			const typeField = this.pack.ctorTypeFields?.[arg.type];
			const ctor =
				typeField !== undefined
					? (arg.childForFieldName(typeField) ?? arg.children[1])
					: null;
			if (ctor) return ctor.type === "identifier" ? ctor.text : "*";
			return "*";
		}
		if (arg.type === "identifier") return arg.text;
		return "*";
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
	private externalWritePos(
		left: SyntaxNode | null | undefined,
		chunk: MutableChunk,
	): string | null {
		if (!left) return null;
		if (left.type === "identifier" || left.type === "property_identifier") {
			// 裸标识符写：TS/JS 模块级 let/闭包外层变量（let count; inc(){count++} / count = count - 1）→ 外部；
			// Python 函数内赋值 = 局部定义（global/nonlocal 由 global_statement 分支处理）→ 非外部。
			// module chunk 特判：模块级赋值（handler = ...）是定义非外部写。
			// 参数重绑（function f(x){ x = 5 }）纯局部（JS 语义）→ 非外部（迭代15 F2 修复）。
			// 终裁 Step1 {closure} 折叠进 state；S1 假纯洞修复（迭代12 Jeff P0）
			if (chunk.kind === "module") return null;
			if (this.pack.assignmentScopesLocals) return null; // Python：赋值即局部定义（迭代37 P0-2 数据化）
			if (chunk.declared.includes(left.text)) return null; // 局部声明（let y = 0; y = 5）
			if (chunk.params.includes(left.text)) return null; // 参数重绑（F2）
			// 迭代25：C# 类成员方法内裸字段写（score = v）→ self.score（类内状态，非全局裸名）。
			// 边界：最近函数状祖先是 method/constructor_declaration 才成立——C# 无全局变量，
			// 方法内可裸写的名字只有 局部(declared)/参数(params)/字段属性/静态字段，后两者即 self 语义；
			// local_function_statement 排除：捕获外层局部时语义等同 TS 闭包（裸外部写，与 TS 一致）。
			if (this.pack.bareNameMeansThisInMethod && this.inClassMemberBody(left))
				return `self.${left.text}`;
			return left.text; // TS/JS 裸标识符写 = 外部
		}
		const readTarget = (
			obj: SyntaxNode | null | undefined,
			attr: string | null | undefined,
		): string | null => {
			if (!obj || !attr) return null;
			if (this.pack.selfNames.includes(obj.text))
				// 迭代40 P0-3 H05：自引用名走 pack.selfNames 表
				return `self.${attr}`;
			if (
				obj.type === "identifier" &&
				(chunk.params.includes(obj.text) || !chunk.assigned.includes(obj.text))
			) {
				return `${obj.text}.${attr}`;
			}
			return null;
		};
		// 迭代40 P0-3 H06：attribute/member_expression/member_access_expression 三段同构消重——
		// 统一走 memberNodes 表（conditional_access 排除——原代码对 ?. 写不检测，保持等价）
		if (
			shapesOf(this.pack, "memberNodes").includes(left.type) &&
			left.type !== "conditional_access_expression"
		) {
			const obj =
				left.childForFieldName("object") ??
				left.childForFieldName("expression") ??
				left.children[0] ??
				null;
			const attr =
				left.childForFieldName("attribute") ??
				left.childForFieldName("property") ??
				left.childForFieldName("name") ??
				left.children[left.children.length - 1] ??
				null;
			const rt = readTarget(obj, attr?.text);
			if (rt !== null) return rt;
			// ②b（迭代26）：d[k].x = v（obj 是 subscript）→ 镜像读侧 subscriptRoot → "d.⊤"。
			// 仅复杂 obj（subscript/call 链）启用——identifier 局部/外部已由 readTarget 正确判定，
			// subscriptRoot 对裸 identifier 会误报局部（o.x=1 的 o 在 assigned → 不得产生写）。
			const root =
				obj !== null &&
				obj.type !== "identifier" &&
				obj.type !== "property_identifier"
					? this.subscriptRoot(obj)
					: null;
			return root !== null ? `${root}.⊤` : null;
		}
		// 迭代26：下标/元素访问左值写（arr[i]=v / this.arr[0]=x / items[0]++）——此前全无写 = 假纯缺陷。
		// 容器位置语义（审计裁决）：arr[i]=v → "arr"（容器本身，精确/前缀双命中）；非 "arr.⊤"
		// （"arr.⊤" 写只匹配 "d.⊤" 读者，漏主模式——state.ts:41-59 实证）。
		if (
			left.type === "subscript" ||
			left.type === "subscript_expression" ||
			left.type === "element_access_expression"
		) {
			const obj =
				left.childForFieldName("object") ??
				left.childForFieldName("expression") ??
				left.children[0] ??
				null;
			if (!obj) return null;
			if (obj.type === "identifier" || obj.type === "property_identifier") {
				if (chunk.kind === "module") return null; // 模块级数组初始化（定义非外部写）
				if (chunk.params.includes(obj.text)) return obj.text; // 参数容器变异（arr[0]=1）影响调用方 → 外部
				// C# 类成员方法内裸字段容器（items[0]=v）→ self.items（类内状态，与裸字段写 self.attr 对偶）；
				// 方法内局部数组（declared 含）→ 非外部
				if (
					this.pack.bareNameMeansThisInMethod &&
					this.inClassMemberBody(obj)
				) {
					return chunk.declared.includes(obj.text) ? null : `self.${obj.text}`;
				}
				// 与 readTarget 同判：局部容器（assigned 含且非参数，如 for 变量 item["x"]=v）→ 非外部
				if (
					chunk.declared.includes(obj.text) ||
					chunk.assigned.includes(obj.text)
				)
					return null;
				return obj.text;
			}
			if (
				obj.type === "member_expression" ||
				obj.type === "member_access_expression" ||
				obj.type === "attribute"
			) {
				// this.arr[0]=x / user.arr[0]=x → 递归成员写语义（self.arr / user.arr）
				return this.externalWritePos(obj, chunk);
			}
			return null;
		}
		return null;
	}

	/** 类成员方法体判定（迭代40 P0-3 H04）：命中/停止节点集走 pack 数据
	 *  （C# method/constructor_declaration 命中；local_function/lambda/嵌套类停止）。
	 *  class_declaration 本体（kind="class"）→ false（字段声明级写由 declared 短路，不需 self）。 */
	private inClassMemberBody(node: SyntaxNode | null | undefined): boolean {
		const hits = this.pack.classMemberBodyNodes ?? EMPTY_SHAPES;
		const stops = this.pack.classMemberBodyStopNodes ?? EMPTY_SHAPES;
		let p = node?.parent;
		while (p !== null && p !== undefined) {
			if (hits.includes(p.type)) return true;
			if (stops.includes(p.type)) return false;
			p = p.parent;
		}
		return false;
	}

	/** 状态写检测：self.x = / this.x = / global、nonlocal 声明 → state 效应。 */

	/** CJS 导出函数 chunk（迭代15 解构 require 盲区）：exports.handler = function(){} /
	 *  module.exports.handler = fn → 成员名（非函数字面量 RHS 不建——identifier 导出走既有
	 *  function_declaration chunk）。module.exports = fn（默认导出）左值是 exports 自身 → null。 */
	private cjsExportName(node: SyntaxNode): string | null {
		// 迭代39 P2-1：赋值/成员节点走投影表
		if (!shapesOf(this.pack, "writeAssigns").includes(node.type)) return null;
		const left = node.childForFieldName("left") ?? node.children[0] ?? null;
		if (!left || !shapesOf(this.pack, "memberNodes").includes(left.type))
			return null;
		const obj = left.childForFieldName("object") ?? left.children[0] ?? null;
		const attr =
			left.childForFieldName("property") ??
			left.children[left.children.length - 1] ??
			null;
		if (!obj || !attr || attr.type !== "property_identifier") return null;
		// 迭代40 P0-3 B02：CJS 导出对象名走 pack 数据（仅 JS 族声明——C#/Python 不再误触发）
		const isExports = (this.pack.cjsExportObjNames ?? EMPTY_SHAPES).includes(
			obj.text,
		);
		if (!isExports) return null;
		const value =
			node.childForFieldName("right") ??
			node.children[node.children.length - 1] ??
			null;
		if (value === null) return null;
		// 迭代40 P0-3 H16：函数字面量判定走 pack 数据（替代 /function/ 正则）
		if (!(this.pack.fnLiteralNodes ?? EMPTY_SHAPES).includes(value.type))
			return null;
		return attr.text;
	}

	/** chunk 展示名：优先 name 字段；变量声明的箭头函数取变量名；赋值 RHS 的 Python lambda 取变量名。
	 *  迭代40 P0-3 H16：lambda/函数字面量节点判定走 pack 数据（Python lambda + assignment；
	 *  fnLiteralNodes 替代 /function/ 正则）。 */
	private chunkName(node: SyntaxNode): string | null {
		if ((this.pack.lambdaNodes ?? EMPTY_SHAPES).includes(node.type)) {
			// handler = lambda: ... → 提为命名 chunk（体调用归它，模块级赋值不再假 IMPURE）；
			// 实参/其他位置 lambda（map(lambda…)）→ 不提 chunk，体调用归外层（map 执行时确实调用）
			let p = node.parent;
			while (p !== null && p.type === "parenthesized_expression") p = p.parent;
			if (
				p !== null &&
				(this.pack.lambdaAssignNodes ?? EMPTY_SHAPES).includes(p.type)
			) {
				const left = p.childForFieldName("left") ?? p.children[0] ?? null;
				if (left !== null && left.type === "identifier") return left.text;
			}
			return null;
		}
		if (node.type === "variable_declarator") {
			// 仅当值是函数字面量时才是 chunk：const f = () => {...}
			const value = node.childForFieldName("value");
			if (
				value === null ||
				!(this.pack.fnLiteralNodes ?? EMPTY_SHAPES).includes(value.type)
			)
				return null;
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
		const body =
			root.type === "variable_declarator"
				? (root.childForFieldName("value") ?? root.children[0])
				: root;
		if (body) for (const c of body.children) walk(c, 0);
		return max;
	}

	/** 调用点提取：点连文本 + 首段对象 + 末段名。不可拍平（super().m()、factory()()、d[k]()）产哨兵走未知；字面量接收者（"x".strip、[].push）产 receiver 事实。 */
	private callOf(node: SyntaxNode): RawCall {
		const argFns = this.argFnsOf(node);
		// 迭代33 C1 + 迭代40 P0-3 H02：构造调用建模——ctor 标记节点（C# object_creation_expression
		// 产 ctor 标记走 link 专用分支；TS new_expression 走裸名 + ctor-merge——类名裸名可见）
		const markCtor =
			shapesOf(this.pack, "ctorCallNodes").includes(node.type) &&
			(this.pack.ctorMarkNodes ?? EMPTY_SHAPES).includes(node.type);
		if (markCtor) {
			const typeNode =
				node.childForFieldName(this.pack.ctorTypeFields?.[node.type] ?? "") ??
				null;
			if (typeNode) {
				const name = ctorTypeName(typeNode, this.pack);
				if (name !== null) {
					return {
						target: `new ${name}`,
						obj: null,
						attr: UNRESOLVED_TARGET,
						receiver: null,
						argFns,
						ctor: name,
					};
				}
			}
			return {
				target: UNRESOLVED_TARGET,
				obj: null,
				attr: UNRESOLVED_TARGET,
				receiver: null,
				argFns,
			};
		}
		const fn =
			shapesOf(this.pack, "ctorCallNodes").includes(node.type) &&
			(this.pack.ctorTypeFields?.[node.type] ?? undefined) !== undefined
				? (node.childForFieldName(
						this.pack.ctorTypeFields?.[node.type] ?? "",
					) ?? node.children[0])
				: (node.childForFieldName("function") ?? node.children[0]);
		if (!fn)
			return {
				target: UNRESOLVED_TARGET,
				obj: null,
				attr: UNRESOLVED_TARGET,
				receiver: null,
				argFns,
			};
		const flat = flattenCallTarget(fn, this.pack);
		if (flat === null) {
			// 接收者事实：字面量 / 链式（"x".strip().upper() 的 upper 接收者是 strip 的返回类型）/ 构造器
			// 迭代39 P2-1：成员节点走投影表
			if (shapesOf(this.pack, "memberNodes").includes(fn.type)) {
				const obj = fn.childForFieldName("object") ?? fn.children[0];
				// Python attribute 无命名字段（children: [obj, ., name]）；TS member_expression 有 property 字段
				const attr =
					fn.childForFieldName("attribute") ??
					fn.childForFieldName("property") ??
					fn.children[fn.children.length - 1];
				if (
					obj &&
					attr &&
					(attr.type === "identifier" || attr.type === "property_identifier")
				) {
					const r = this.receiverTypeOf(obj);
					if (r !== null)
						return {
							target: UNRESOLVED_TARGET,
							obj: null,
							attr: attr.text,
							receiver: r,
							argFns,
						};
				}
			}
			return {
				target: UNRESOLVED_TARGET,
				obj: null,
				attr: UNRESOLVED_TARGET,
				receiver: null,
				argFns,
			};
		}
		const dot = flat.indexOf(".");
		if (dot === -1)
			return { target: flat, obj: null, attr: flat, receiver: null, argFns };
		return {
			target: flat,
			obj: flat.slice(0, dot),
			attr: flat.slice(dot + 1),
			receiver: null,
			argFns,
		};
	}

	/**
	 * 属性读取形态判定（迭代40 B5）：obj.Prop / 裸名 identifier 读值。
	 * 纯表驱动（P2-1 纪律）：全部节点形态/槽位判定走 pack 数据表（propertyReadSkipMorphs /
	 * propertyReadSkipParents / propertyReadNameSlots），引擎零语言常量。
	 */
	private isPropertyRead(node: SyntaxNode): boolean {
		const p = node.parent;
		if (p === null) return false;
		// 形态排除：调用目标链 / 赋值左值 / ++/-- 目标（已有各自通道）
		if (this.pack.propertyReadSkipMorphs?.includes(p.type)) return false;
		// 声明/类型位排除（C# 声明、类型参数、特性、标签、cast/is/as 等——无运行时读取）
		if (this.pack.propertyReadSkipParents?.includes(p.type)) return false;
		// 声明名位排除（name/type 槽位——无运行时读取；value 位保留）。
		// 位置比较（web-tree-sitter 每次访问产新包装对象，=== 引用比较失效）
		const slots = this.pack.propertyReadNameSlots?.[p.type];
		if (slots) {
			const samePos = (a: SyntaxNode | null): boolean =>
				a !== null &&
				a.startIndex === node.startIndex &&
				a.endIndex === node.endIndex;
			for (const slot of slots) {
				if (slot === "__child0") {
					// 无命名字段的形态（C# variable_declarator——name 恒为 children[0]，语法固定）
					if (samePos(p.children[0] ?? null)) return false;
				} else if (samePos(p.childForFieldName(slot))) {
					return false;
				}
			}
		}
		return true;
	}

	/** 属性读取调用点（obj.Prop 读值）：拍平 + prop 标记。不可拍平（d[k].x 等）→ ? 诚实。 */
	private propertyReadOf(node: SyntaxNode): RawCall {
		const flat = flattenCallTarget(node, this.pack);
		if (flat === null)
			return {
				target: UNRESOLVED_TARGET,
				obj: null,
				attr: UNRESOLVED_TARGET,
				receiver: null,
				argFns: [],
				prop: true,
			};
		const dot = flat.indexOf(".");
		if (dot === -1)
			return {
				target: flat,
				obj: null,
				attr: flat,
				receiver: null,
				argFns: [],
				prop: true,
			};
		return {
			target: flat,
			obj: flat.slice(0, dot),
			attr: flat.slice(dot + 1),
			receiver: null,
			argFns: [],
			prop: true,
		};
	}

	/**
	 * 接收者类型：字面量 → 内建类型（literalReceivers）；链式（obj 是调用）→ 被调方法的
	 * 返回类型（builtinMethodReturns，语言事实）；构造器（new C()）→ "class:C"；表外 → null。
	 */
	private receiverTypeOf(obj: SyntaxNode): string | null {
		const lit = literalReceiverType(obj, this.pack);
		if (lit !== null) return lit;
		// 迭代39 P2-1 + 迭代40 P0-3 H02：构造器接收者节点走投影表 + 类型名字段数据
		if (shapesOf(this.pack, "ctorCallNodes").includes(obj.type)) {
			const typeField = this.pack.ctorTypeFields?.[obj.type];
			const ctor =
				typeField !== undefined
					? (obj.childForFieldName(typeField) ?? obj.children[1])
					: null;
			const name = ctor ? ctorTypeName(ctor, this.pack) : null;
			if (name !== null) return `class:${name}`;
			return null;
		}
		// 迭代39 P2-1：调用接收者节点走投影表
		if (shapesOf(this.pack, "callShapes").includes(obj.type)) {
			// 迭代31 S1：C# 调用节点是 invocation_expression（此前缺失 → C# 链第二环起全断，
			// 21,488 bare <unresolved> 站点大块来源）。fn 字段与 attribute/member 提取与 TS/Python 同构。
			const fn = obj.childForFieldName("function") ?? obj.children[0];
			if (fn && shapesOf(this.pack, "memberNodes").includes(fn.type)) {
				const innerObj = fn.childForFieldName("object") ?? fn.children[0];
				const innerAttr =
					fn.childForFieldName("attribute") ??
					fn.childForFieldName("property") ??
					fn.children[fn.children.length - 1];
				if (
					innerObj &&
					innerAttr &&
					(innerAttr.type === "identifier" ||
						innerAttr.type === "property_identifier")
				) {
					const recv = this.receiverTypeOf(innerObj);
					if (recv !== null && !recv.startsWith("class:"))
						return (
							this.pack.builtinMethodReturns[recv]?.[innerAttr.text] ?? null
						);
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
		if (!args)
			args = node.children.find((c) => c.type === "argument_list") ?? null;
		if (!args) return [];
		const out: string[] = [];
		const pushArg = (n: SyntaxNode): void => {
			if (n.type === "identifier" || n.type === "property_identifier") {
				out.push(n.text);
			} else if (shapesOf(this.pack, "memberNodes").includes(n.type)) {
				const flat = flattenCallTarget(n, this.pack);
				if (flat !== null) out.push(flat);
			}
		};
		for (const c of args.children) {
			// 迭代40 P0-3 漏网：关键字实参节点走 pack 数据（Python keyword_argument → value 字段）
			if ((this.pack.keywordArgNodes ?? EMPTY_SHAPES).includes(c.type)) {
				const v = c.childForFieldName("value");
				if (v) pushArg(v);
			} else if (c.isNamed) {
				// 迭代40 P0-3 漏网：实参包装节点走 pack 数据（C# argument → 解包一层取命名子节点）
				pushArg(
					(this.pack.argWrapNodes ?? EMPTY_SHAPES).includes(c.type)
						? (c.children.find((x) => x.isNamed) ?? c)
						: c,
				);
			}
		}
		return out;
	}

	/** 函数内绑定名（赋值目标 + 参数名——参数同样遮蔽外层 import；遮蔽守卫用）。流不敏感保守收集。
	 *  迭代40 P0-3 H11/H18：参数名槽位/参数列表节点走 pack 数据。 */
	private assignedNames(root: SyntaxNode): string[] {
		const out: string[] = [];
		const pushParam = (n: SyntaxNode): void => {
			// 迭代40 P0-3 H11：槽位机制（Python typed_parameter → __firstIdentifier）
			const slots = this.pack.paramNameSlots?.[n.type];
			if (slots) {
				for (const slot of slots) {
					if (slot === "__firstIdentifier") {
						const id = n.children.find(
							(c) =>
								c.type === "identifier" || c.type === "property_identifier",
						);
						if (id) {
							out.push(id.text);
							return;
						}
					}
				}
			}
			const named =
				n.childForFieldName("name") ?? n.childForFieldName("pattern");
			if (
				named &&
				(named.type === "identifier" || named.type === "property_identifier")
			) {
				out.push(named.text);
			} else if (n.type === "identifier" || n.type === "property_identifier") {
				out.push(n.text);
			}
		};
		const walk = (n: SyntaxNode): void => {
			if (this.pack.assignmentTargets.includes(n.type)) {
				// require 导入声明（const x = require(...)）不是遮蔽——importMap 已登记该绑定。
				// 迭代40 P0-3 H12：require 名走 pack 数据（仅 JS 族）
				let isRequireDecl = false;
				if (n.type === "variable_declarator") {
					const val = n.childForFieldName("value");
					const fn = val
						? (val.childForFieldName("function") ?? val.children[0])
						: null;
					isRequireDecl =
						!!fn &&
						fn.type === "identifier" &&
						(this.pack.requireFnNames ?? EMPTY_SHAPES).includes(fn.text);
				}
				if (!isRequireDecl) {
					// 迭代25：C# variable_declarator 无 name 字段（名字是裸 identifier 子节点）→ children[0] fallback；
					// TS/JS variable_declarator 有 name 字段、assignment_expression 有 left 字段 → fallback 不触发。
					const left =
						n.childForFieldName("left") ??
						n.childForFieldName("name") ??
						n.children[0] ??
						null;
					if (
						left &&
						(left.type === "identifier" || left.type === "property_identifier")
					) {
						out.push(left.text);
					}
				}
			} else if (
				(this.pack.paramListNodeTypes ?? EMPTY_SHAPES).includes(n.type)
			) {
				for (const c of n.children) pushParam(c); // 参数名遮蔽外层绑定
			} else if ((this.pack.foreachNodes ?? EMPTY_SHAPES).includes(n.type)) {
				// 迭代44：foreach 变量（in token 前的裸 identifier——C# for_each_statement）→ assigned。
				// 候选 1 短路依赖 assigned——foreach 变量此前不在收集 → 变量读落 ?（InitDeity i·bare 实证）。
				const kids = n.children;
				const inIdx = kids.findIndex(
					(c) => c!.type === this.pack.foreachInToken,
				);
				for (let i = 0; i < kids.length && (inIdx < 0 || i < inIdx); i++) {
					const c = kids[i]!;
					if (c.type === "identifier" || c.type === "property_identifier") {
						out.push(c.text);
						break;
					}
				}
			} else if (shapesOf(this.pack, "catchNodes").includes(n.type)) {
				// 迭代44：catch 变量（catch_declaration 的唯一 identifier——C# 类型化 catch）→ assigned
				//（e·bare 实证同族；stateReadPos ⑤ 规则已抑制读侧，此处补 assigned 让候选 1 短路覆盖）
				for (const c of n.children) {
					if (c.type === "identifier" || c.type === "property_identifier") {
						out.push(c.text);
						break;
					}
				}
			}
			for (const c of n.children) walk(c);
		};
		for (const c of root.children) walk(c);
		return out;
	}
}

/** 迭代39 P2-1：投影表访问——未声明集 = 空（该语言无此形态）。 */
const EMPTY_SHAPES: readonly string[] = [];
function shapesOf(
	pack: LangPack,
	key: keyof NonNullable<LangPack["astShapes"]>,
): readonly string[] {
	return pack.astShapes?.[key] ?? EMPTY_SHAPES;
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
	/** 迭代35 A1：参数显式类型（参数名 → 类型名，Dictionary<string,int> d → d:"Dictionary"）——变量 receiver 查 builtinTypeEffects。 */
	paramTypes: Record<string, string>;
	/** 迭代37 P1-2：局部单赋值构造绑定（var xs = new List<int>() → xs:"List"）。 */
	localBindings?: Record<string, string>;
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
	return {
		name,
		line,
		endLine,
		nesting: 0,
		normText,
		kind,
		calls: [],
		assigned: [],
		params: [],
		paramTypes: {},
		stateWrites: [],
		stateReads: [],
		declared: [],
		thrownTypes: [],
		catches: [],
		ownerClass,
	};
}

/** 字面量接收者判定：解包括号/断言后查 literalReceivers 表；bytes 前缀（b"..."）按文本区分。
 *  迭代39 P2-1：解包节点走投影表。 */
function literalReceiverType(node: SyntaxNode, pack: LangPack): string | null {
	let n = node;
	while (shapesOf(pack, "unwrapNodes").includes(n.type)) {
		const inner =
			n.childForFieldName("expression") ??
			n.childForFieldName("value") ??
			n.children.find((c) => c.type !== "(" && c.type !== ")");
		if (!inner) return null;
		n = inner;
	}
	const t = pack.literalReceivers[n.type];
	if (t === undefined) return null;
	// 迭代40 P0-3 H14：bytes 前缀检查只对声明的类型做（Python "str"——b"" 前缀才是 bytes）
	if (
		(pack.bytesPrefixTypes ?? EMPTY_SHAPES).includes(t) &&
		/^[bB]['"]/.test(n.text)
	)
		return "bytes";
	return t;
}

/** 把 member/attribute 链拍平成点连文本；动态部分（下标、调用结果）返回 null。
 *  迭代39 P2-1：成员/this 节点判定走 pack 投影表；identifier/property_identifier/type_identifier/
 *  predefined_type 是 tree-sitter 跨语言公共节点名（非语言常量）。 */
function flattenCallTarget(node: SyntaxNode, pack: LangPack): string | null {
	const members = shapesOf(pack, "memberNodes");
	const thisNodes = shapesOf(pack, "thisNodes");
	const memberWraps = shapesOf(pack, "memberWrapNodes");
	if (
		node.type === "identifier" ||
		node.type === "property_identifier" ||
		thisNodes.includes(node.type) ||
		node.type === "type_identifier" ||
		node.type === "predefined_type"
	) {
		return node.text;
	}
	// 迭代44 候选3（双评审）：两漏网形态可拍平——generic_name（`Foo<int>(1)` 调用目标，
	// 剥壳先例 ctorTypeName L1836）与 alias_qualified_name（`global::System.X`——剥 global
	// 前缀递归内层，与 propertyReadSkipParents 的 alias_qualified_name 排除同源实证）。
	// 残余不可拍平形态（factory()()/d[k]()）维持 <unresolved>（设计诚实）。
	if (node.type === "generic_name") {
		const id =
			node.childForFieldName("name") ??
			node.children.find((c) => c.type === "identifier");
		if (id) return id.text;
		return null;
	}
	if (node.type === "alias_qualified_name") {
		const inner = node.children[1] ?? null; // children[0] = identifier[global]
		if (inner) return flattenCallTarget(inner, pack);
		return null;
	}
	if (
		members.includes(node.type) &&
		node.type !== "conditional_access_expression"
	) {
		const obj = node.childForFieldName("object") ?? node.children[0];
		const attr =
			node.childForFieldName("attribute") ??
			node.childForFieldName("property") ??
			node.childForFieldName("name");
		if (!obj || !attr) return null;
		const objText = flattenCallTarget(obj, pack);
		if (objText === null) return null;
		// C# 泛型成员（迭代19）：Resources.Load<GameObject> → 剥 type_argument_list 取方法名
		if (attr.type === "generic_name") {
			const id =
				attr.childForFieldName("name") ??
				attr.children.find((c) => c.type === "identifier");
			if (
				id &&
				(id.type === "identifier" || id.type === "property_identifier")
			) {
				return objText + "." + id.text;
			}
			return null;
		}
		if (attr.type === "identifier" || attr.type === "property_identifier") {
			return objText + "." + attr.text;
		}
		return null;
	}
	if (
		members.includes(node.type) &&
		node.type === "conditional_access_expression"
	) {
		// C# null 条件访问（迭代20）：obj?.Method → obj 部分 flatten + member_binding 标识符
		const expr = node.children[0];
		const binding = node.children.find((c) => memberWraps.includes(c.type));
		if (expr === undefined || binding === undefined) return null;
		const objText = flattenCallTarget(expr, pack);
		if (objText === null) return null;
		const id = binding.children.find(
			(c) => c.type === "identifier" || c.type === "property_identifier",
		);
		if (id) return objText + "." + id.text;
		return null;
	}
	return null;
}

/** 构造类型名提取（迭代33 C1 + 迭代40 P0-3 H13）：identifier → 文本；剥壳节点集走 pack 数据
 *  （generic_name → 剥 type_argument_list 取名；qualified_name → 取末段；Python type 注解包装）。
 *  其余 → null（诚实）。 */
function ctorTypeName(node: SyntaxNode, pack?: LangPack): string | null {
	if (
		node.type === "identifier" ||
		node.type === "type_identifier" ||
		node.type === "predefined_type"
	)
		return node.text;
	const typeNameNodes = pack?.typeNameNodes ?? EMPTY_SHAPES;
	const typeWrapNodes = pack?.typeWrapNodes ?? EMPTY_SHAPES;
	if (typeWrapNodes.includes(node.type)) {
		// 注解包装（Python "type" / TS "type_annotation"——typed_parameter 的 type 字段是
		// 包装节点，内含真实类型）
		const inner = node.children.find((c) => c.isNamed);
		return inner ? ctorTypeName(inner, pack) : null;
	}
	if (typeNameNodes.includes(node.type) && node.type === "generic_name") {
		// generic_name: [identifier|name, type_argument_list]——取 name 子节点或首子节点
		const name = node.childForFieldName("name") ?? node.children[0];
		if (name && (name.type === "identifier" || name.type === "type_identifier"))
			return name.text;
		return null;
	}
	if (typeNameNodes.includes(node.type) && node.type === "qualified_name") {
		// 迭代34 独立审计 Low-Med：末段节点递归剥壳——System.Collections.Generic.Dictionary<K,V> 的末子
		// 是 generic_name（非 identifier），此前 filter 只留 identifier → 返回末段 identifier（如 "Generic"）
		// 且 ctor:Generic 进 miss 记账（迭代36 独立审计：旧行为描述修正——非"空 → null"）。
		// "取末段"必须是节点级递归（generic_name/qualified_name/identifier/predefined_type 均可）。
		const last = node.children[node.children.length - 1];
		if (last) return ctorTypeName(last, pack);
		return null;
	}
	return null;
}

/** 默认导出登记：export default function foo / export default class Bar。
 *  迭代39 P2-1：导出容器节点走投影表。 */
function findDefaultExport(root: SyntaxNode, pack: LangPack): string | null {
	let found: string | null = null;
	const visit = (n: SyntaxNode): void => {
		if (found !== null) return;
		if (shapesOf(pack, "exportStmtNodes").includes(n.type)) {
			// 迭代40 P0-3 H17：导出 token 文本走 pack 数据（TS/JS "default"/"export"）
			const tokens = pack.exportStmtTokens ?? EMPTY_SHAPES;
			const hasDefault = n.children.some((c) => tokens.includes(c.text));
			if (hasDefault) {
				for (const c of n.children) {
					if (pack.chunkNodes.includes(c.type)) {
						const nameNode = c.childForFieldName("name");
						if (nameNode) found = nameNode.text;
					} else if (c.type === "identifier" && !tokens.includes(c.text)) {
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
