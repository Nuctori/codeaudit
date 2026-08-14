import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { scanProject } from "../../src/index";
import { initParser, loadLanguage } from "../../src/loader";
import { csharpPack } from "../../src/lang/packs/csharp";
import { typescriptPack } from "../../src/lang/packs/typescript";
import { javascriptPack } from "../../src/lang/packs/javascript";
import { pythonPack } from "../../src/lang/packs/python";
import { Purity } from "../../src/core/types";

/**
 * 第七轮范畴律对抗性审计：证明系统/DSL/langpack 极小性 + A6/A7 公理机检（第三层）。
 *
 * - law:minimality     O-C5/O-C6 全表族 grammar 对拍：propertyReadSkipParents /
 *                      propertyReadSkipMorphs / propertyReadNameSlots / patternNameNodes /
 *                      typeWrapNodes / heritageWrapNodes / memberNameNodes 等全部节点名表
 *                      与 wasm grammar 节点集逐条对拍——死条目（表里有 grammar 没有）即极小性违反；
 *                      重复条目 = 死重复。对拍方法先用 parse 实证校准（node.type 来自真实解析），
 *                      再全量机检。
 * - law:edge-case      L-C1′ 条件③（attr∈assigned）与条件④（attr∉类成员）缺一不可：
 *                      ③ 缺 → 未赋值名（可能是属性）被短路判纯；④ 缺 → 写后裸读 getter io 假纯。
 * - law:poset-monotonicity  A6 S3 区间定理机检：audit 链 ≤ dev 链（chain ≤ chainDev 全 chunk 断言）；
 *                      A7 判定格 Λ 传播单调：A→B→C 链逐级加效应，purity 只升不降。
 * - law:edge-case      A6 S2/S4 诚实通道：解析失败路径必须落 unknown（不静默 ∅）。
 */

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-ct7-"));
});
afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

function project(name: string, files: Record<string, string>): string {
	const root = join(dir, name);
	for (const [f, content] of Object.entries(files)) {
		const p = join(root, f);
		mkdirSync(join(p, ".."), { recursive: true });
		writeFileSync(p, content);
	}
	return root;
}

function byName(r: {
	verdicts: { chunk: { name: string }; purity: number }[];
}): Map<string, (typeof r.verdicts)[number]> {
	return new Map(r.verdicts.map((v) => [v.chunk.name, v]));
}

/** 从 wasm grammar 提取独立节点类型名（grammar 事实源）。
 *  注意：不能用正则贪婪提取——紧凑存储下长名会吞短名（global_attribute_list 吞 attribute_list，
 *  第七轮实证误报死条目）；改为子串包含检查语义（下方 nodeInGrammar）。 */
function grammarNodeNames(wasm: string): Set<string> {
	const path = join(
		__dirname,
		"../../node_modules/tree-sitter-wasms/out",
		wasm,
	);
	if (!existsSync(path)) return new Set();
	const bytes = readFileSync(path).toString("latin1");
	const names = new Set<string>();
	const re = /[a-z][a-z0-9_]{2,}/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(bytes))) names.add(m[0]);
	return names;
}

/** 子串包含检查（修正贪婪误报）：节点名以 \0 分隔存于 wasm 数据段，包含即 grammar 有。 */
function nodeInGrammar(wasm: string, name: string): boolean {
	const path = join(
		__dirname,
		"../../node_modules/tree-sitter-wasms/out",
		wasm,
	);
	if (!existsSync(path)) return true; // 环境缺包 → 跳过语义
	const bytes = readFileSync(path).toString("latin1");
	return bytes.includes(name);
}

/** 解析实证：给定语言包与源码，返回全树节点类型集合（对拍基准——node.type 来自真实解析）。 */
async function parsedNodeTypes(
	pack: { wasm: string },
	source: string,
): Promise<Set<string>> {
	const ParserCtor = await initParser();
	const lang = await loadLanguage(pack as never);
	const parser = new ParserCtor();
	parser.setLanguage(lang);
	const tree = parser.parse(source);
	const types = new Set<string>();
	const walk = (n: { type: string; children: unknown[] }): void => {
		types.add(n.type);
		for (const c of n.children) walk(c as never);
	};
	walk(tree.rootNode as never);
	return types;
}

/** 跳过字段名/伪槽位（非节点类型）。 */
const FIELD_LIKE = new Set(["name", "type", "__child0", "__firstIdentifier"]);

// ---------------------------------------------------------------------------
// O-C5/O-C6 全表族 grammar 对拍：死条目 = 表里有 grammar 没有（极小性违反）
// 方法：grammar token 集 ∪ parse 实证活名（超类型/别名节点不在 token 表但在真实树中，
// 如 C# assignment_expression、TS type_annotation——第七轮校准实证）
// ---------------------------------------------------------------------------
const CSHARP_CALIB = [
	"class C {",
	"  unsafe void F() {",
	"    int a = sizeof(int);",
	"    var b = nameof(F);",
	"    var c = nameof(F.M);",
	"    unchecked { a++; }",
	"    a += 1;",
	"    a ??= 2;",
	"    a -= 1;",
	"    goto L;",
	"  L:",
	"    this.GetType();",
	"    int? x = null;",
	"  }",
	"}",
].join("\n");
const TS_CALIB = [
	"function f(x: number): string { return String(x); }",
	"let a = 1; a = 2; a += 1; a ??= 3;",
	"const o = { m(): void {} }; o.m();",
	"class K { public static p = 1; }",
	"const [u, v] = [1, 2];",
].join("\n");

describe("law:minimality（O-C5/O-C6 全表族 grammar 对拍——死条目/死重复）", () => {
	it("csharp propertyReadSkipParents：每条目 ∈ grammar 节点集 ∪ parse 活名，且无重复", async () => {
		const g = grammarNodeNames(csharpPack.wasm);
		expect(g.size).toBeGreaterThan(100); // 环境缺 wasm 时跳过语义
		const live = await parsedNodeTypes(csharpPack, CSHARP_CALIB);
		const table = csharpPack.propertyReadSkipParents ?? [];
		expect(new Set(table).size).toBe(table.length); // 重复条目 = 死重复（includes 消费下无行为差异，纯死）
		const dead = table.filter(
			(n) =>
				n.includes("_") &&
				!FIELD_LIKE.has(n) &&
				!g.has(n) &&
				!nodeInGrammar(csharpPack.wasm, n) &&
				!live.has(n),
		);
		expect(dead).toEqual([]); // 表里有 grammar 没有 → 该条目永不匹配任何解析节点
	});

	it("csharp 全节点名表（skipMorphs/nameSlots/pattern/type/heritage/catch）无死条目", async () => {
		const g = grammarNodeNames(csharpPack.wasm);
		const live = await parsedNodeTypes(csharpPack, CSHARP_CALIB);
		const tables: Record<string, readonly string[]> = {
			propertyReadSkipMorphs: csharpPack.propertyReadSkipMorphs ?? [],
			patternNameNodes: csharpPack.patternNameNodes ?? [],
			typeNameNodes: csharpPack.typeNameNodes ?? [],
			heritageWrapNodes: csharpPack.heritageWrapNodes ?? [],
			heritageSkipNodes: csharpPack.heritageSkipNodes ?? [],
			catchDeclNodes: csharpPack.catchDeclNodes ?? [],
		};
		for (const [name, entries] of Object.entries(tables)) {
			const dead = entries.filter(
				(n) =>
					n.includes("_") &&
					!FIELD_LIKE.has(n) &&
					!g.has(n) &&
					!nodeInGrammar(csharpPack.wasm, n) &&
					!live.has(n),
			);
			expect(dead, `${name} 死条目`).toEqual([]);
		}
		for (const [node, slots] of Object.entries(
			csharpPack.propertyReadNameSlots ?? {},
		)) {
			expect(
				g.has(node) || live.has(node) || nodeInGrammar(csharpPack.wasm, node),
				`propertyReadNameSlots 键 ${node} 死`,
			).toBe(true);
			for (const s of slots)
				if (s.includes("_") && !FIELD_LIKE.has(s))
					expect(
						g.has(s) || live.has(s),
						`propertyReadNameSlots 值 ${s} 死`,
					).toBe(true);
		}
	});

	it("TS/JS 共享表族无死条目（每节点名 ∈ typescript ∪ javascript grammar ∪ parse 活名）", async () => {
		const g = new Set([
			...grammarNodeNames(typescriptPack.wasm),
			...grammarNodeNames(javascriptPack.wasm),
		]);
		const live = await parsedNodeTypes(typescriptPack, TS_CALIB);
		const tables: Record<string, readonly string[]> = {
			propertyReadSkipMorphs: typescriptPack.propertyReadSkipMorphs ?? [],
			propertyReadNodes: typescriptPack.propertyReadNodes ?? [],
			memberNameNodes: typescriptPack.memberNameNodes ?? [],
			objectLiteralTypeNodes: typescriptPack.objectLiteralTypeNodes ?? [],
			typeWrapNodes: typescriptPack.typeWrapNodes ?? [],
			heritageWrapNodes: typescriptPack.heritageWrapNodes ?? [],
			patternNameNodes: typescriptPack.patternNameNodes ?? [],
			nestedFnBoundaryNodes: typescriptPack.nestedFnBoundaryNodes ?? [],
		};
		for (const [name, entries] of Object.entries(tables)) {
			const dead = entries.filter(
				(n) =>
					n.includes("_") &&
					!FIELD_LIKE.has(n) &&
					!g.has(n) &&
					!nodeInGrammar(csharpPack.wasm, n) &&
					!live.has(n),
			);
			expect(dead, `${name} 死条目`).toEqual([]);
		}
	});

	it("python 节点名表无死条目", () => {
		const g = grammarNodeNames(pythonPack.wasm);
		const tables: Record<string, readonly string[]> = {
			typeWrapNodes: pythonPack.typeWrapNodes ?? [],
			patternNameNodes: pythonPack.patternNameNodes ?? [],
		};
		for (const [name, entries] of Object.entries(tables)) {
			const dead = entries.filter(
				(n) =>
					n.includes("_") &&
					!FIELD_LIKE.has(n) &&
					!g.has(n) &&
					!nodeInGrammar(pythonPack.wasm, n),
			);
			expect(dead, `${name} 死条目`).toEqual([]);
		}
	});

	it("parse 实证校准：sizeof/nameof/unchecked/增强赋值/标签/this 的真实节点名（死条目候选的活名）", async () => {
		const real = await parsedNodeTypes(
			csharpPack,
			[
				"class C {",
				"  unsafe void F() {",
				"    int a = sizeof(int);",
				"    var b = nameof(F);",
				"    var c = nameof(F.M);",
				"    unchecked { a++; }",
				"    a += 1;",
				"    a ??= 2;",
				"    a -= 1;",
				"    goto L;",
				"  L:",
				"    this.GetType();",
				"    int? x = null;",
				"    var t = (1, 2);",
				"  }",
				"}",
			].join("\n"),
		);
		// 死条目候选的 grammar 真名（若有）——断言活名存在，死名不存在
		expect(
			real.has("labeled_statement"),
			`labeled_statement absent; real=${[...real].join(",")}`,
		).toBe(true);
		expect(real.has("this_expression")).toBe(true);
		expect(
			real.has("assignment_expression"),
			"assignment_expression absent",
		).toBe(true); // += 归属（超类型名，parse 实证）
		// 死条目本身不得出现在任何真实解析树中（grammar 无此节点名，超类型机制也产不出）
		for (const dead of [
			"sizeof_expression",
			"nameof_expression",
			"unchecked_expression",
			"augmented_assignment_expression",
			"label_statement",
			"implicit_this_expression",
			"array_pattern",
			"as_pattern_target",
		]) {
			expect(real.has(dead), `${dead} 在真实解析树中出现（非死条目）`).toBe(
				false,
			);
		}
	});

	it("parse 实证校准：C# 节点名漂移盘点（真实节点在场、死名缺席——第七轮 parse 实证）", async () => {
		const real = await parsedNodeTypes(
			csharpPack,
			[
				"#if DEBUG",
				"using Ns.Sub;",
				"#region R",
				"namespace Ns {",
				"  [Attr]",
				"  struct S { public int F; }",
				"  class C {",
				"    void M(int arg) {",
				"      var o = new object();",
				"      var t = typeof(int);",
				"      var s = sizeof(int);",
				"      var l = new List<int>();",
				"    }",
				"  }",
				"}",
				"#endregion",
			].join("\n"),
		);
		// 盘点日志（grammar 漂移证据，非断言）
		process.stdout.write(
			"\n[ct7-drift] " +
				[...real]
					.filter((t) =>
						/namespace|struct|object_creation|typeof|size_of|field_decl|attribute|qualified|directive/.test(
							t,
						),
					)
					.join(" ") +
				"\n",
		);
		// 真实节点必须在场（第七轮 parse 实证：namespace_declaration/struct_declaration/
		// object_creation_expression/field_declaration/attribute_list/qualified_name/
		// if_directive/region_directive/type_argument_list 全部真实存在——早前「漂移」断言系
		// 子代理幻觉，与 wasm 子串实证矛盾，已按 parse 实证修正）
		for (const present of [
			"namespace_declaration",
			"struct_declaration",
			"object_creation_expression",
			"field_declaration",
			"attribute_list",
			"qualified_name",
			"if_directive",
			"region_directive",
			"type_argument_list",
		]) {
			expect(
				real.has(present),
				`${present} 缺席（真实节点，parse 实证在场）`,
			).toBe(true);
		}
		// 死名必须在场缺席（grammar 真名为 type_of_expression/size_of_expression）
		for (const gone of ["typeof_expression", "sizeof_expression"]) {
			expect(real.has(gone), `${gone} 仍在真实解析树中出现（死名）`).toBe(
				false,
			);
		}
		expect(
			real.has("type_of_expression"),
			"type_of_expression 缺席（typeof 真名）",
		).toBe(true);
		expect(
			real.has("size_of_expression"),
			"size_of_expression 缺席（sizeof 真名）",
		).toBe(true);
	});

	it("parse 实证校准：TS 注解/赋值节点真名（typeWrapNodes/assignment_expression 活名判定）", async () => {
		const real = await parsedNodeTypes(
			typescriptPack,
			[
				"function f(x: number): string { return String(x); }",
				"let a = 1; a = 2; a += 1; a ??= 3;",
				"const o = { m(): void {} }; o.m();",
				"class K { public static p = 1; }",
				"const [u, v] = [1, 2];",
			].join("\n"),
		);
		expect(real.has("assignment_expression")).toBe(true);
		expect(real.has("augmented_assignment_expression")).toBe(true);
		expect(real.has("type_annotation")).toBe(true);
		expect(real.has("array_pattern")).toBe(true);
		expect(real.has("public_field_definition")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// L-C1′ 四条件必要性：③ attr∈assigned / ④ attr∉类成员
// ---------------------------------------------------------------------------
describe("law:edge-case（L-C1′ 四条件缺一不可——③④ 必要性）", () => {
	it("条件③（attr∈assigned）缺：C# 方法组读未赋值名（非存储槽，含效应）→ 建边不短路 → IMPURE", async () => {
		const root = project("lc1-cond3", {
			"C.cs": [
				"class C {",
				"  public void F() {",
				'    void G() { System.Console.WriteLine("x"); }',
				"    System.Action h = G;",
				"  }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const v = byName(r).get("C.F");
		expect(v).toBeDefined();
		// G ∉ assigned（局部函数声明非存储槽）∧ ∉ 类成员 → 不得短路 → 解析到 G（io）→ IMPURE
		// （若短路在无 assigned 时误触发 → PURE 假纯，S1 违反）
		expect(v!.purity).toBe(Purity.IMPURE);
	});

	it("条件④（attr∉类成员）缺：C# 静态属性写后裸读 + io getter → IMPURE（短路=假纯）", async () => {
		const root = project("lc1-cond4", {
			"C.cs": [
				"class C {",
				"  public static int P {",
				'    get { System.Console.WriteLine("x"); return 1; }',
				"    set { }",
				"  }",
				"  public static void F() {",
				"    P = 5;",
				"    var x = P;",
				"  }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const v = byName(r).get("C.F");
		expect(v).toBeDefined();
		// P ∈ assigned（赋值左值收集）∧ P ∈ 类成员 → ④ 阻断短路 → 隐式 this 解析 → getter io 边
		expect(v!.purity).toBe(Purity.IMPURE);
	});

	it("正向控制：四条件齐（局部变量读）→ PURE（短路保留，判别力不回退）", async () => {
		const root = project("lc1-ctrl", {
			"C.cs": [
				"class C {",
				"  public int F() {",
				"    var local = 3;",
				"    return local;",
				"  }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const v = byName(r).get("C.F");
		expect(v).toBeDefined();
		expect(v!.purity).toBe(Purity.PURE);
	});
});

// ---------------------------------------------------------------------------
// A6 S3：链是悲观下界（区间定理 audit 链 ≤ dev 链）
// ---------------------------------------------------------------------------
describe("law:poset-monotonicity（A6 S3 区间定理机检——chain ≤ chainDev 全 chunk 断言）", () => {
	it("混合图（不纯源 + 未知调用 + 环）：∀v. chain ≤ chainDev；chainCertain ⟺ 相等；存在严格区间", async () => {
		const root = project("s3-interval", {
			"a.ts": [
				"declare function alien(): void;",
				"export function impure() { console.log(1); }",
				"export function callUnknown() { alien(); }",
				"export function callImpure() { impure(); }",
				"export function mid() { callImpure(); callUnknown(); }",
				"export function loopA() { loopB(); }",
				"export function loopB() { loopA(); }",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(r.verdicts.length).toBeGreaterThan(3);
		let strict = 0;
		for (const v of r.verdicts) {
			// 区间定理：audit（悲观，? 参与传播）链 ≤ dev（乐观）链
			expect(
				v.chain <= v.chainDev,
				`S3 违反: ${v.chunk.key} chain=${v.chain} chainDev=${v.chainDev}`,
			).toBe(true);
			expect(v.chainCertain).toBe(v.chain === v.chainDev);
			if (v.chain < v.chainDev) strict++;
		}
		expect(strict).toBeGreaterThan(0); // 区间非平凡：未知可达处 audit < dev
		// 不变量证书：传播不违反格序/链三角
		expect(r.stats?.invariantViolations ?? 0).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// A7：判定格 Λ={PURE<UNKNOWN<IMPURE} 传播单调（加效应只升不降）
// ---------------------------------------------------------------------------
describe("law:poset-monotonicity（A7 判定格传播单调——链式 A→B→C 逐级加效应）", () => {
	it("同一调用链三版本（纯/未知/不纯）：每 chunk purity 单调不减", async () => {
		const mk = (leaf: string, tag: string) =>
			project(`mono-${tag}`, {
				"a.ts": [
					leaf,
					"export function c() { return leaf(); }",
					"export function b() { return c(); }",
					"export function a() { return b(); }",
				].join("\n"),
			});
		// 版本1：leaf 纯
		const pure = byName(
			await scanProject(mk("export function leaf() { return 1; }", "p"), {
				useCache: false,
			}),
		);
		// 版本2：leaf 调未解析 → UNKNOWN
		const unk = byName(
			await scanProject(
				mk(
					"declare function missingFn(): void; export function leaf() { missingFn(); return 1; }",
					"u",
				),
				{ useCache: false },
			),
		);
		// 版本3：leaf 直接 io → IMPURE
		const imp = byName(
			await scanProject(
				mk("export function leaf() { console.log(1); return 1; }", "i"),
				{ useCache: false },
			),
		);
		for (const name of ["leaf", "c", "b", "a"]) {
			const p = pure.get(name)!.purity;
			const u = unk.get(name)!.purity;
			const i = imp.get(name)!.purity;
			expect(
				u,
				`${name} UNKNOWN 版本不得低于 PURE 版本`,
			).toBeGreaterThanOrEqual(p);
			expect(
				i,
				`${name} IMPURE 版本不得低于 UNKNOWN 版本`,
			).toBeGreaterThanOrEqual(u);
		}
		// 传染深度：三跳全传染（b/a 均受 leaf 影响）
		expect(imp.get("a")!.purity).toBe(Purity.IMPURE);
	});
});

// ---------------------------------------------------------------------------
// A6 S2/S4：解析失败路径不静默 ∅（unknown 通道如实参与）
// ---------------------------------------------------------------------------
describe("law:edge-case（A6 S2/S4 诚实通道——失败路径落 unknown 非静默 ∅）", () => {
	it("TS 硬失败三通道（裸名 miss/动态成员/HOF 实参未解析）→ 全部 UNKNOWN 非 PURE", async () => {
		const root = project("s4-honest", {
			"a.ts": [
				"declare function undeclared(): void;",
				"export function bare() { undeclared(); }",
				"export function dyn(o: { [k: string]: unknown }) { o.method(); }",
				"export function hof(xs: number[]) { xs.map(cb); }",
				"export function cb(x: number) { return x; }",
				"export function top() { bare(); dyn({}); hof([1]); }",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const v = byName(r);
		expect(v.get("bare")!.purity).toBe(Purity.UNKNOWN);
		expect(v.get("dyn")!.purity).toBe(Purity.UNKNOWN);
		expect(v.get("top")!.purity).toBe(Purity.UNKNOWN);
		// S4：? 参与传播——top 的 calls 含 ? 边（不变量机检 + stats 双证书）
		expect(r.stats?.invariantViolations ?? 0).toBe(0);
	});

	it("C# 解析失败（未导入命名空间裸名）→ UNKNOWN 非 PURE", async () => {
		const root = project("s4-csharp", {
			"C.cs": [
				"class C {",
				"  public void F() {",
				"    SomeExternalHelper.Run();",
				"  }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(byName(r).get("C.F")!.purity).toBe(Purity.UNKNOWN);
	});
});

// ---------------------------------------------------------------------------
// 数学层一致性（四·七）：阈值 15/35/60 与 corpus 基率注释核对（记录级）
// ---------------------------------------------------------------------------
describe("law:minimality（数学层——阈值联合体与文档声明一致）", () => {
	it("风险等级边界 15/35/60（axioms.md 四·七 #5）与实现一致", async () => {
		const { gradeOf } = await import("../../src/core/risk");
		expect(gradeOf(0)).toBe("low");
		expect(gradeOf(14.9)).toBe("low");
		expect(gradeOf(15)).toBe("medium");
		expect(gradeOf(34.9)).toBe("medium");
		expect(gradeOf(35)).toBe("high");
		expect(gradeOf(59.9)).toBe("high");
		expect(gradeOf(60)).toBe("critical");
	});
});
