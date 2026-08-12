import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject, Purity } from "../../src/index";

/** 迭代38：继承/多态最小健全版 + mutate 语义统一（数学家 × Jeff Dean 评审后实施）。 */

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-inh-"));
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
function by(report: {
	verdicts: { chunk: { file: string; name: string } }[];
}): Map<string, { purity: number; effects: Set<string> }> {
	const m = new Map();
	for (const v of report.verdicts) m.set(`${v.chunk.file}::${v.chunk.name}`, v);
	return m;
}

describe("迭代38 继承/多态（A）", () => {
	it("C# 祖先解析：new Derived().Calc() → 基类方法真边（继承精度回收）", async () => {
		const root = project("inh-base", {
			"Base.cs": [
				"public class Base { public int Calc() { return 1; } }",
				"public class Derived : Base { }",
				"public class User { public int Run() { return new Derived().Calc(); } }",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		expect(b.get("Base.cs::User.Run")!.purity).toBe(Purity.PURE);
	});

	it("C# 基类构造器并集：new D() 连 B 的 ctor（C# 基类 ctor 必执行，不连 = 假纯）", async () => {
		const root = project("inh-ctor", {
			"B.cs": [
				'public class B { public B() { System.Console.WriteLine("io"); } }',
				"public class D : B { }",
				"public class User { public void Run() { var d = new D(); } }",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		const run = b.get("B.cs::User.Run")!;
		expect(run.effects.has("io")).toBe(true);
		expect(run.purity).toBe(Purity.IMPURE);
	});

	it("C# 多态守卫（B7）：非 virtual 静态分派精确——子类 new 隐藏不改 Base.Run 的分派 → PURE", async () => {
		const root = project("inh-poly", {
			"P.cs": [
				"public class Base {",
				"    public void Run() { this.Step(); }",
				"    public void Step() { }",
				"}",
				"public class Derived : Base {",
				'    public new void Step() { System.Console.WriteLine("io"); }',
				"}",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		// Step 非 virtual → C# 静态分派到 Base.Step（new 隐藏不参与）→ PURE（迭代39 B7 精度回收）
		expect(b.get("P.cs::Base.Run")!.purity).toBe(Purity.PURE);
	});

	it("C# 多态守卫（B7）：virtual 族 + 子类覆写 io → 降 ?（H4 假纯洞闭合）", async () => {
		const root = project("inh-vpoly", {
			"P.cs": [
				"public class Base {",
				"    public void Run() { this.Step(); }",
				"    public virtual void Step() { }",
				"}",
				"public class Derived : Base {",
				'    public override void Step() { System.Console.WriteLine("io"); }',
				"}",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		// Step virtual 且 Base 有子类 → 覆写不可证 → UNKNOWN（不 PURE）
		expect(b.get("P.cs::Base.Run")!.purity).toBe(Purity.UNKNOWN);
	});

	it("C# 无子类的类：self 调用正常解析（降级只对被子类继承的类生效）", async () => {
		const root = project("inh-nopoly", {
			"P.cs": [
				"public class Solo {",
				"    public void Run() { this.Step(); }",
				"    public void Step() { }",
				"}",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		expect(b.get("P.cs::Solo.Run")!.purity).toBe(Purity.PURE);
	});

	it("Python MRO 反例（规则1）：全祖先并集——x: X 的 x.m() 必须含 C.m 的 io", async () => {
		const root = project("py-mro", {
			"m.py": [
				"class C:",
				"    def m(self):",
				"        print('io')",
				"class A(C):",
				"    pass",
				"class B:",
				"    def m(self):",
				"        pass",
				"class X(A, B):",
				"    pass",
				"def f(x: X):",
				"    x.m()",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		const f = b.get("m.py::f")!;
		// MRO = [X, A, C, B] → 真分派 C.m（io）。最近层并集（A,B）是欠近似 → 假纯。
		// 规则1：全祖先并集 → 必须 IMPURE。
		expect(f.effects.has("io")).toBe(true);
		expect(f.purity).toBe(Purity.IMPURE);
	});

	it("动态 extends（A3 健全版）：语言内存在动态 extends → 多态分派整体 ?", async () => {
		const root = project("dyn-ext", {
			"d.ts": [
				"function getBase(): any { return Base; }",
				"class Base { m(): number { return 1; } }",
				"class B extends getBase() { m() { console.log('io'); return 1; } }",
				"export function f(a: Base) { a.m(); }",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		// B 是项目内可见子类但基类动态不可证 → 该语言多态分派整体降 ?（不 PURE）
		expect(b.get("d.ts::f")!.purity).toBe(Purity.UNKNOWN);
	});

	it("H6 内建子类守卫：项目内 class MyList(list) 覆写 append → 参数 list 表判定 ?", async () => {
		const root = project("h6", {
			"h.py": [
				"class MyList(list):",
				"    def append(self, x):",
				"        print('io')",
				"def f(d: list):",
				"    d.append(1)",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		// list 被项目类继承且 append 被覆写 → 表判纯不健全 → UNKNOWN（不 PURE）
		expect(b.get("h.py::f")!.purity).toBe(Purity.UNKNOWN);
	});
});

describe("迭代38 mutate 语义统一（B）", () => {
	it("Python 参数容器变异：d.append(x) → state（与 d[0]=1 → stateWrites 同语义）", async () => {
		const root = project("py-mutate", {
			"m.py": [
				"def f(d: list):",
				"    d.append(1)",
				"def g(d: list):",
				"    d[0] = 1",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		const f = b.get("m.py::f")!;
		const g = b.get("m.py::g")!;
		expect(f.effects.has("state")).toBe(true);
		expect(f.purity).toBe(Purity.IMPURE);
		expect(g.purity).toBe(Purity.IMPURE); // 下标写既有语义
	});

	it("B1 规则5：sort 回调义务保留——d.sort(key=write_file) → state + io 传导", async () => {
		const root = project("py-sort", {
			"s.py": [
				"def write_file(x):",
				"    print('io')",
				"def f(d: list):",
				"    d.sort(key=write_file)",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		const f = b.get("s.py::f")!;
		// mutate → state；sort 在 builtinTypeEffects 标 hof → 回调边 → io 原子保留（S2/S3）
		expect(f.effects.has("state")).toBe(true);
		expect(f.effects.has("io")).toBe(true);
		expect(f.purity).toBe(Purity.IMPURE);
	});

	it("字面量变异豁免：'x'.strip() 与 [].append 仍纯（字面量不可共享/子类化）", async () => {
		const root = project("literal", {
			"l.py": ["def f():", "    return [].append(1) or ' x '.strip()"].join(
				"\n",
			),
		});
		const b = by(await scanProject(root));
		expect(b.get("l.py::f")!.purity).toBe(Purity.PURE);
	});
});

describe("迭代39 缺口闭合", () => {
	it("P0-1/B11：字段初始化器 io → new B() IMPURE（隐式 ctor 纯的前提收紧）", async () => {
		const root = project("field-init", {
			"F.cs": [
				"public class B { int x = System.Console.ReadLine().Length; }",
				"public class User { public void Run() { var b = new B(); } }",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		const run = b.get("F.cs::User.Run")!;
		expect(run.effects.has("io")).toBe(true);
		expect(run.purity).toBe(Purity.IMPURE);
	});

	it("P0-1/B11 基类字段初始化器：new D() 连基类 class chunk（闭包覆盖）", async () => {
		const root = project("field-init-base", {
			"F.cs": [
				"public class B { int x = System.Console.ReadLine().Length; }",
				"public class D : B { }",
				"public class User { public void Run() { var d = new D(); } }",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		const run = b.get("F.cs::User.Run")!;
		expect(run.effects.has("io")).toBe(true);
		expect(run.purity).toBe(Purity.IMPURE);
	});

	it("B9：moduleBindings 接继承——export const db = new D(); db.baseMethod() → 基类方法边", async () => {
		const root = project("mb-inh", {
			"m.py": [
				"class Base:",
				"    def query(self):",
				"        print('io')",
				"class D(Base):",
				"    pass",
				"db = D()",
			].join("\n"),
			"use.py": ["from m import db", "def f():", "    db.query()"].join("\n"),
		});
		const b = by(await scanProject(root));
		// 迭代39 前：D.query 未声明 → ?；迭代39 B9：祖先闭包并集 → Base.query io 传导
		expect(b.get("use.py::f")!.purity).toBe(Purity.IMPURE);
	});

	it("B10：mutate 写位置进 stateDeps——读者通过 --state 耦合图可见参数容器变异", async () => {
		const root = project("mutate-pos", {
			"s.py": [
				"def write(d: list):",
				"    d.append(1)",
				"def read(d: list):",
				"    return d[0]",
			].join("\n"),
		});
		const r = await scanProject(root);
		const byKey = new Map(r.verdicts.map((v) => [v.chunk.name, v]));
		const writeV = byKey.get("write") as unknown as {
			chunk: { stateWrites: readonly string[] };
		};
		// mutate 位置 "d" 前缀匹配读者 "d.⊤"（下标读）→ 写入方 stateWrites 含 d
		expect(writeV!.chunk.stateWrites.includes("d")).toBe(true);
	});

	it("独立审计必修 1：显式 ctor + 字段初始化器并存 → new B() IMPURE（并集非 XOR）", async () => {
		const root = project("ctor-field-union", {
			"F.cs": [
				'public class B { static int x = System.Console.ReadLine().Length; public B() { } }',
				"public class User { public void Run() { var b = new B(); } }",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		const run = b.get("F.cs::User.Run")!;
		expect(run.effects.has("io")).toBe(true);
		expect(run.purity).toBe(Purity.IMPURE);
	});

	it("独立审计必修 2：接口作静态类型接收者 → 降 ?（接口分派恒动态，不标 virtual = 假纯）", async () => {
		const root = project("iface-receiver", {
			"I.cs": [
				"public interface IRepo { string Get(); }",
				'public class DbRepo : IRepo { public string Get() { return System.Console.ReadLine()!; } }',
				"public class User { public void Run(IRepo r) { r.Get(); } }",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		// IRepo 方法全部 virtual 族 → Run 的 r.Get 不可证 → UNKNOWN（不 PURE）
		expect(b.get("I.cs::User.Run")!.purity).toBe(Purity.UNKNOWN);
	});
});

describe("迭代38 规则7：JS 构造器不可信（B2）", () => {
	it("JS 构造器 return 任意对象：var x = new C(); x.m() → 不产 trusted 绑定 → ?（不 PURE）", async () => {
		const root = project("js-ctor", {
			"j.js": [
				"class C {",
				"  m() { return 1; }",
				"  constructor() { return { m() { console.log('io'); } }; }",
				"}",
				"export function f() { const x = new C(); x.m(); }",
			].join("\n"),
		});
		const b = by(await scanProject(root));
		expect(b.get("j.js::f")!.purity).toBe(Purity.UNKNOWN);
	});
});
