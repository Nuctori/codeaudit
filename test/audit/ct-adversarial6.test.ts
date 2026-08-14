import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { initParser, loadLanguage } from "../../src/loader";
import { csharpPack, extractCSharpImports } from "../../src/lang/packs/csharp";
import { typescriptPack } from "../../src/lang/packs/typescript";
import { javascriptPack } from "../../src/lang/packs/javascript";
import { pythonPack } from "../../src/lang/packs/python";
import { Purity } from "../../src/core/types";

/**
 * 第六轮范畴律对抗性审计：axioms.md 公理层机检（A6 健全性 / A7 效应格 / 引理 L-C1′·L-C2 / 义务 O-C5·O-C6）。
 *
 * - law:poset-monotonicity  A6 S1 假纯洞三连：HOF 实参遮蔽错边（addArgEdges 无遮蔽守卫——
 *                           const f = evil; [1].map(f) 且顶层有纯 f → PURE 实证）；ctor 遮蔽回落
 *                           pureCtor（var Uri = 5; new Uri(x) → PURE 实证，Roslyn 证类型上下文
 *                           不受局部遮蔽影响——有效 C# 假纯）；using 别名 new 走 pureCtor
 *                           （using Uri = MyUri; new Uri() → PURE 实证）
 * - law:minimality         死机制：using 别名提取（grammar 形状 name_equals——原 "=" 直查永不命中）；
 *                           O-C5 parse 驱动对拍：primary_constructor_base_type（C# 12 record 主构造
 *                           基类）∉ 接受集 → 语言级降级；O-C6 同节点入 propertyReadSkipParents
 * - law:edge-case          L-C2 豁免面：全限定 System.X.Y → ?；同名枚举 + 遮蔽守卫（项目类优先 /
 *                           moduleAssigned 作用域修复——方法局部不再污染同文件其他方法）
 * - law:edge-case          L-C1′ 四条件必要性：obj≠null / prop=false 不短路；正向控制（四条件齐 → PURE）
 * - law:edge-case          A7：? ∉ Σ（effects 永不含 "?"）；Σ 原子性机检（表值 ⊆ Σ、无死原子、无恒伴对）
 */

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-ct6-"));
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

// ---------------------------------------------------------------------------
// A6 S1：HOF 实参遮蔽守卫（addArgEdges 无遮蔽守卫 → 错边假纯）
// ---------------------------------------------------------------------------
describe("law:poset-monotonicity（A6 S1——HOF 实参遮蔽错边假纯）", () => {
	it("TS：局部箭头遮蔽顶层纯函数 + [1].map(f) → 必须 IMPURE（修复前 FALSE PURE）", async () => {
		const root = project("hof-ts", {
			"a.ts": [
				"export function f(x: number): number { return x + 1; }",
				"export function g(): void {",
				"  const f = () => { console.log('evil'); };",
				"  [1].map(f);",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const g = byName(r).get("g")!;
		// 运行时 map 调用的是局部箭头（io）；修复前按文件级符号错边到顶层纯 f → 假纯
		expect(g.purity, "局部 f 遮蔽顶层 f 时必须传播 io").toBe(Purity.IMPURE);
		expect([...g.effects]).toContain("io");
	});

	it("Python：局部 lambda 遮蔽顶层纯函数 + map(f, xs) → 必须 IMPURE（修复前 FALSE PURE）", async () => {
		const root = project("hof-py", {
			"a.py": [
				"def f(x):",
				"    return x + 1",
				"def g():",
				"    f = lambda x: __import__('sys').stdout.write('x') or 0",
				"    return list(map(f, [1]))",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const g = byName(r).get("g")!;
		expect(g.purity).toBe(Purity.IMPURE);
	});

	it("TS：局部非 chunk 绑定（const f = evilGlobal）遮蔽 import 时 → UNKNOWN 诚实（不落错边）", async () => {
		const root = project("hof-shadow", {
			"m.ts": "export function f(x: number): number { return x + 1; }\n",
			"a.ts": [
				'import { f } from "./m";',
				"declare const evil: (x: number) => void;",
				"export function g(): void {",
				"  const f = evil;",
				"  [1].map(f);",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const g = byName(r).get("g")!;
		// 修复前：bySimple/import 均按文件级符号解析到 ./m 的纯 f → 假纯
		expect(g.purity, "遮蔽名不可解析 → ?（hofAlwaysArgs 无条件记未知）").toBe(
			Purity.UNKNOWN,
		);
	});

	it("控制组：模块级 lambda + map(f, xs) 不受遮蔽守卫误伤（模块级绑定 = bySimple 真候选）", async () => {
		const root = project("hof-mod", {
			"a.py": [
				"f = lambda x: __import__('sys').stdout.write('x') or 0",
				"def g():",
				"    return list(map(f, [1]))",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const g = byName(r).get("g")!;
		expect(g.purity, "模块级 lambda 是真绑定——边保留").toBe(Purity.IMPURE);
		expect([...g.effects]).toContain("io");
	});

	it("控制组：顶层不纯 f + [1].map(f) 边保留（非遮蔽场景零行为变化）", async () => {
		const root = project("hof-top", {
			"a.ts": [
				"export function f(x: number): void { console.log('x'); }",
				"export function g(): void { [1].map(f); }",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const g = byName(r).get("g")!;
		expect(g.purity).toBe(Purity.IMPURE);
		expect([...g.effects]).toContain("io");
	});
});

// ---------------------------------------------------------------------------
// A6 S1：ctor 遮蔽回落 pureCtor / using 别名 new 假纯
// ---------------------------------------------------------------------------
describe("law:poset-monotonicity（A6 S1——ctor 解析两个假纯通道）", () => {
	it("C#：局部变量同名遮蔽 + new Uri() → UNKNOWN（修复前回落 pureCtor → 假纯；Roslyn 实证类型上下文不受局部遮蔽影响，构造真实执行）", async () => {
		const root = project("ctor-shadow", {
			"A.cs": [
				"public class Uri {",
				'    public Uri(string s) { System.Console.WriteLine("io"); }',
				"}",
				"public class T {",
				"    public void m() {",
				"        var Uri = 5;",
				"        new Uri(\"a\");",
				"    }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const m = byName(r).get("T.m")!;
		// 修复前：assigned 遮蔽 → 跳过项目类解析 → pureCtor("Uri") → PURE（假纯）
		expect(m.purity, "遮蔽时类型位置不可信 → 诚实未知").toBe(Purity.UNKNOWN);
		// 控制组：未遮蔽的项目类构造 → 构造器 io 传播
		const root2 = project("ctor-shadow2", {
			"A.cs": [
				"public class Uri2 {",
				'    public Uri2() { System.Console.WriteLine("io"); }',
				"}",
				"public class T {",
				"    public void m() { new Uri2(); }",
				"}",
				"",
			].join("\n"),
		});
		const r2 = await scanProject(root2, { useCache: false });
		const m2 = byName(r2).get("T.m")!;
		expect(m2.purity).toBe(Purity.IMPURE);
		expect([...m2.effects]).toContain("io");
	});

	it("C#：using 别名（using Uri = MyUri）+ new Uri() → UNKNOWN（修复前 pureCtor 命中别名文本 → 假纯）", async () => {
		const root = project("ctor-alias", {
			"A.cs": [
				"public class MyUri {",
				'    public MyUri() { System.Console.WriteLine("io"); }',
				"}",
				"",
			].join("\n"),
			"B.cs": [
				"using Uri = MyUri;",
				"public class T {",
				"    public void m() { new Uri(); }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const m = byName(r).get("T.m")!;
		expect(m.purity, "别名目标类型构造不可证 → 诚实未知").toBe(Purity.UNKNOWN);
	});

	it("控制组：纯构造名单未遮蔽时保持 PURE（new List<int>() 判别力不回退）", async () => {
		const root = project("ctor-pure", {
			"A.cs": [
				"using System.Collections.Generic;",
				"public class T {",
				"    public List<int> m() { var xs = new List<int>(); return xs; }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(byName(r).get("T.m")!.purity).toBe(Purity.PURE);
	});
});

// ---------------------------------------------------------------------------
// law:minimality：using 别名机制复活（grammar 形状 name_equals——原 "=" 直查死机制）
// ---------------------------------------------------------------------------
describe("law:minimality（using 别名提取死机制修复）", () => {
	it("extractCSharpImports：name_equals 形状别名注册；普通 using 不注册", async () => {
		const ParserCtor = await initParser();
		const lang = await loadLanguage(csharpPack);
		const parser = new ParserCtor();
		parser.setLanguage(lang);
		const t1 = parser.parse("using Uri = MyUri;\nusing System;\n");
		const imps = extractCSharpImports(t1.rootNode);
		expect(imps).toEqual([
			{ local: "Uri", module: "MyUri", imported: null },
		]);
		const t2 = parser.parse("using System.Collections.Generic;\n");
		expect(extractCSharpImports(t2.rootNode)).toEqual([]);
	});

	it("别名成员调用判别力保持：using File = System.IO.File → fs；using Math = System.Math → PURE", async () => {
		const root = project("alias-member", {
			"B.cs": [
				"using File = System.IO.File;",
				"public class U {",
				'    public void b() { string s = File.ReadAllText("x"); }',
				"}",
				"",
			].join("\n"),
			"C.cs": [
				"using Math = System.Math;",
				"public class V {",
				"    public double c() { return Math.Max(1.0, 2.0); }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		// 修复前（别名未注册）：File.ReadAllText 走类名表 impureGlobals.File=fs——注册后
		// module 通道未中必须回退类名通道（resolveObjDispatch 委托），判别力零回归
		expect(by.get("U.b")!.purity).toBe(Purity.IMPURE);
		expect([...by.get("U.b")!.effects]).toContain("fs");
		expect(by.get("V.c")!.purity).toBe(Purity.PURE);
	});

	it("别名指向项目类时不得命中纯名单（using Math = Ns.Math 项目类 → 类成员真边）", async () => {
		const root = project("alias-project", {
			"A.cs": [
				"namespace Ns {",
				"public class Math {",
				'    public static double Max(double a, double b) { System.Console.WriteLine("io"); return a; }',
				"}",
				"}",
				"",
			].join("\n"),
			"B.cs": [
				"using Math = Ns.Math;",
				"public class T {",
				"    public double m() { return Math.Max(1.0, 2.0); }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const m = byName(r).get("T.m")!;
		// 委托 resolveObjDispatch → globalClasses 优先：项目类真边（纯名单不越权）
		expect(m.purity, "项目类同名优先于 pureGlobals.Math").toBe(Purity.IMPURE);
		expect([...m.effects]).toContain("io");
	});
});

// ---------------------------------------------------------------------------
// law:minimality：O-C5/O-C6 机检对拍——C# 12 record 主构造基类
// ---------------------------------------------------------------------------
describe("law:minimality（O-C5 parse 驱动对拍——primary_constructor_base_type）", () => {
	it("parse 实证：record R(int x) : Base(x) 的 base_list 直接子节点 = primary_constructor_base_type", async () => {
		const ParserCtor = await initParser();
		const lang = await loadLanguage(csharpPack);
		const parser = new ParserCtor();
		parser.setLanguage(lang);
		const tree = parser.parse(
			"namespace Ns {\nrecord R(int x) : Base(x), IFoo {}\n}",
		);
		const kids: string[] = [];
		const walk = (n: { type: string; children: unknown[] }): void => {
			if (n.type === "base_list")
				for (const c of n.children as never[]) kids.push((c as { type: string }).type);
			for (const c of n.children) walk(c as never);
		};
		walk(tree.rootNode as never);
		expect(kids).toContain("primary_constructor_base_type");
		// O-C5 接受集完备性：该节点必须在剥壳表中（否则 extractor 落 dynamic=true → 语言级降级）
		expect(csharpPack.heritageCtorBaseNodes).toContain(
			"primary_constructor_base_type",
		);
		// O-C6：类型位置无运行时读取 → propertyReadSkipParents 必须排除（B5 通道不误收）
		expect(csharpPack.propertyReadSkipParents).toContain(
			"primary_constructor_base_type",
		);
	});

	it("端到端：含 record 主构造基类的项目不得触发语言级降级（多态 + 隐式 this 解析保留）", async () => {
		const root = project("oc5-record", {
			"A.cs": [
				"namespace Ns {",
				"public record R(int x) : Base { }",
				"public class Base { public virtual int F() { return 1; } }",
				"public class Derived : Base { public override int F() { return 2; } }",
				"public class T {",
				"  public int m(Derived d) { return d.F(); }",
				"  public int n() { return F(); }",
				"  public virtual int F() { return 3; }",
				"}",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		// record 基类形态不得触发语言级降级（义务 O-C5 接受集完备性：primary_constructor_base_type
		// 是 grammar 可达 base_list 子节点，iter45 wasm 对拍漏检——parse 驱动对拍补入）
		expect(by.get("T.m")!.purity, "多态虚方法分派保留（无降级）").toBe(
			Purity.PURE,
		);
		expect(by.get("T.n")!.purity, "隐式 this 解析保留（无降级）").toBe(
			Purity.PURE,
		);
		expect(r.stats.invariantViolations).toBe(0);
	});

	it("O-C6 活通道：主构造基类类型名位不产生 B5 未知噪音（修复前 module chunk 收集 Base 假读）", async () => {
		const root = project("oc6-record", {
			"A.cs": [
				"namespace Ns {",
				"public record R(int x) : Base(x) { }",
				"public class Base { }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const mod = r.verdicts.find((v) => v.chunk.name === "<module>")!;
		const attrs = mod.chunk.unknownCalls.map((c) => c.attr);
		// 修复前：primary_constructor_base_type ∉ propertyReadSkipParents → 类型名 Base 被
		// B5 identifier 通道误收为运行时读 → module unknown 噪音
		expect(attrs, "类型位置无运行时读取").not.toContain("Base");
	});
});

// ---------------------------------------------------------------------------
// law:edge-case：L-C2 豁免面边界（全限定形态 / 同名遮蔽守卫）
// ---------------------------------------------------------------------------
describe("law:edge-case（L-C2 枚举判纯豁免面）", () => {
	it("全限定形态 System.X.Y → ?（obj=System 键形状不匹配——形式强加通道）；裸名形态 → PURE", async () => {
		const root = project("lc2-full", {
			"A.cs": [
				"public class T {",
				"    public bool m() { return System.StringComparison.Ordinal == 0; }",
				"    public bool n() { return StringComparison.Ordinal == 0; }",
				"    public bool o() { return TaskStatus.Running == 0; }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		expect(by.get("T.m")!.purity, "全限定 → ? 诚实").toBe(Purity.UNKNOWN);
		expect(by.get("T.n")!.purity, "裸名枚举读 → 纯（编译期常量）").toBe(
			Purity.PURE,
		);
		expect(by.get("T.o")!.purity).toBe(Purity.PURE);
	});

	it("项目类同名枚举（静态 getter 带 io）→ IMPURE（globalClasses 优先于 pureGlobals）", async () => {
		const root = project("lc2-proj", {
			"A.cs": [
				"public class StringComparison {",
				'    public static string Ordinal { get { System.Console.WriteLine("io"); return "a"; } }',
				"}",
				"public class T {",
				"    public string m() { return StringComparison.Ordinal; }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const m = byName(r).get("T.m")!;
		expect(m.purity, "项目类遮蔽 → getter 边").toBe(Purity.IMPURE);
		expect([...m.effects]).toContain("io");
	});

	it("遮蔽守卫作用域：兄弟方法局部同名不污染本方法枚举读（moduleAssigned 修复——此前全文件收集）", async () => {
		const root = project("lc2-scope", {
			"A.cs": [
				"public class T {",
				"    public bool m() { var StringComparison = 5; return StringComparison.Ordinal == 0; }",
				"    public bool n() { return StringComparison.Ordinal == 0; }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		// 修复前：m 的局部变量经 moduleAssigned 全文件收集 → n 的枚举读被误挡 → UNKNOWN
		expect(by.get("T.m")!.purity, "m 自身遮蔽 → UNKNOWN 诚实").toBe(
			Purity.UNKNOWN,
		);
		expect(by.get("T.n")!.purity, "n 无遮蔽 → 枚举读纯").toBe(Purity.PURE);
	});

	it("模块级重绑仍构成遮蔽（from db import conn 后被 conn = other 同族：顶层赋值守卫保留）", async () => {
		const root = project("lc2-mod", {
			"a.js": [
				"StringComparison = 5;",
				"export function n() { return StringComparison.Ordinal === 0; }",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		// JS 无 pureGlobals.StringComparison——本用例验证模块级遮蔽守卫对纯名单的拦截通道：
		// 顶层重绑后读 → 不得落纯名单（UNKNOWN 诚实）
		expect(byName(r).get("n")!.purity).toBe(Purity.UNKNOWN);
	});
});

// ---------------------------------------------------------------------------
// law:edge-case：L-C1′ 四条件必要性（短路豁免面边界）
// ---------------------------------------------------------------------------
describe("law:edge-case（L-C1′ 绑定槽读短路——四条件缺一不可）", () => {
	it("条件① obj===null：C# 对象成员读（var o = new object(); o.secret）不短路 → UNKNOWN 诚实", async () => {
		const root = project("lc1-obj", {
			"A.cs": [
				"public class T {",
				"    public object m() { var o = new object(); return o.secret; }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(byName(r).get("T.m")!.purity, "obj≠null 时成员读可能 getter → 不判纯").toBe(
			Purity.UNKNOWN,
		);
	});

	it("条件② prop=true：TS 调用形态 f()（f 为局部赋值）不短路 → UNKNOWN 诚实", async () => {
		const root = project("lc1-call", {
			"a.ts": [
				"export function g(): void {",
				"  const f = () => { console.log('x'); };",
				"  f();",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(byName(r).get("g")!.purity, "调用形态可能执行用户代码 → 不判纯").toBe(
			Purity.UNKNOWN,
		);
	});

	it("正向控制：四条件齐（obj=null ∧ prop ∧ attr∈assigned ∧ attr∉类成员）→ 绑定槽读 PURE", async () => {
		const root = project("lc1-ok", {
			"a.ts": [
				"export function f(): number { let r; r = 5; return r; }",
				"export function g(): number { const q = 1; return q; }",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		expect(by.get("f")!.purity).toBe(Purity.PURE);
		expect(by.get("g")!.purity).toBe(Purity.PURE);
	});
});

// ---------------------------------------------------------------------------
// law:edge-case：A7 效应格——? ∉ Σ 与 Σ 原子性机检
// ---------------------------------------------------------------------------
describe("law:edge-case（A7——? 不属 Σ；Σ 原子性）", () => {
	it("混合图：任何 verdict.effects 不含 '?'；效应 ⊆ Σ；UNKNOWN 判定不携带伪效应", async () => {
		const root = project("sigma", {
			"a.js": [
				"export function pureFn() { return 1; }",
				"export function unkFn() { return missingGlobal(); }",
				"export function impFn() { console.log('x'); }",
				"export function mix() { return unkFn(); }",
				"export function imp2() { return impFn() + unkFn(); }",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const sigma = new Set(["io", "net", "fs", "db", "random", "clock", "state"]);
		const by = byName(r);
		for (const v of r.verdicts) {
			for (const e of v.effects) {
				expect(e, `${v.chunk.name} 效应 "${e}" 必须 ∈ Σ（? 是知识标记非效应）`).not.toBe("?");
				expect(sigma.has(e), `${v.chunk.name} 效应 "${e}" 必须是声明原子`).toBe(true);
			}
		}
		expect(by.get("unkFn")!.purity).toBe(Purity.UNKNOWN);
		expect([...by.get("unkFn")!.effects]).toEqual([]); // ? 不进 effects
		expect(by.get("mix")!.purity).toBe(Purity.UNKNOWN);
		expect(by.get("imp2")!.purity).toBe(Purity.IMPURE);
		expect([...by.get("imp2")!.effects]).toEqual(["io"]);
		expect(r.stats.invariantViolations).toBe(0); // A6-inner 机检证书（axioms.md：>0 即被证伪）
	});

	it("Σ 原子性机检：全语言包表值 ⊆ Σ；无死原子（每原子至少一包声明）；无恒伴对（可合并=极小性违反）", () => {
		const sigma = new Set(["io", "net", "fs", "db", "random", "clock", "state"]);
		const atomsOf = (
			pack: typeof csharpPack,
		): { atoms: Set<string>; entries: Set<string>[] } => {
			const atoms = new Set<string>();
			const entries: Set<string>[] = [];
			const collect = (
				rec: Record<string, string | readonly string[]> | undefined,
			): void => {
				if (!rec) return;
				for (const v of Object.values(rec)) {
					const s = new Set<string>();
					if (typeof v === "string") s.add(v);
					else
						for (const e of v) {
							const ci = e.lastIndexOf(":");
							if (ci === -1) s.add("io"); // 裸成员名 → io（link 语义）
							else {
								const cls = e.slice(ci + 1);
								if (cls !== "p") s.add(cls);
							}
						}
					if (s.size > 0) {
						for (const a of s) atoms.add(a);
						entries.push(s);
					}
				}
			};
			collect(pack.impureBuiltins);
			collect(pack.impureGlobals);
			collect(pack.impureModules);
			return { atoms, entries };
		};
		const packs = [csharpPack, typescriptPack, javascriptPack, pythonPack];
		const allAtoms = new Set<string>();
		const allEntries: Set<string>[] = [];
		for (const p of packs) {
			const { atoms, entries } = atomsOf(p as never);
			for (const a of atoms) {
				expect(sigma.has(a), `${p.name} 表声明了非 Σ 效应 "${a}"（表值域违反）`).toBe(
					true,
				);
				allAtoms.add(a);
			}
			allEntries.push(...entries);
		}
		// 无死原子：Σ 每元素至少一个语言包声明
		for (const a of sigma)
			expect(allAtoms.has(a), `Σ 原子 "${a}" 无任何语言包声明（死原子）`).toBe(true);
		// 无恒伴对：∀a，不存在 b≠a 使「含 a 的每个条目都含 b」（可合并 = 极小性违反）
		for (const a of sigma) {
			const containing = allEntries.filter((s) => s.has(a));
			if (containing.length === 0) continue;
			const companions = new Set<string>();
			for (const s of containing) for (const x of s) if (x !== a) companions.add(x);
			for (const b of companions) {
				const both = containing.every((s) => s.has(b));
				expect(both, `原子 ${a} 与 ${b} 恒伴生（每个含 ${a} 的条目都含 ${b}）——可合并，极小性违反`).toBe(false);
			}
		}
	});
});
