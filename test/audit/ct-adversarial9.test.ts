import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "../../src/core/analyze";
import { scanProject } from "../../src/index";
import { Purity, UNKNOWN_TARGET, type Chunk } from "../../src/core/types";
import { stateCouplingOf } from "../../src/core/state";
import { riskOfChange } from "../../src/core/risk";

/**
 * 轮9 范畴律对抗审计（证明系统完备性推进·深化——在轮8 之上）：
 * - law:edge-case      ⊤ 降级面显式化（任务1）：⊤ 写者/根限定 ⊤ 读造成的可观测 false coupling
 *                      锚定为「已知近似」（state.ts:12-16/39-46 声明），判定边界 = 不进 purity/effects/chain；
 *                      R_state 消费边界（risk.ts:217-232）。
 * - law:fixpoint       A6-inner 证书补强（任务2）：证明步骤1 的有限格高度界 |V|·|Σ∪{?}| 与
 *                      「每步至少新增一个格元素」机制——7 种效应原子满格攀登对拍。
 * - law:edge-case      A6 S2/S4 通道穷举（任务3）：构造器解析失败 / 继承解析失败（super/base miss）/
 *                      模块导入失败（resolveMod miss）/ 泛型-重载失败——每条「要么边要么 unknown，无静默 ∅」。
 * - law:functoriality  轮8 作用域化自身边界（任务4）：C# partial 跨文件 ctor 必须可见（S1）；
 *                      Python 模块私有类跨模块引用回退并集；TS 调用方文件同名类局部优先。
 */

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-ct9-"));
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
	verdicts: { chunk: { name: string; file: string }; purity: number }[];
}): Map<string, (typeof r.verdicts)[number]> {
	return new Map(r.verdicts.map((v) => [v.chunk.name, v]));
}

function mkChunk(
	key: string,
	direct: string[] = [],
	calls: string[] = [],
	extra: Partial<Chunk> = {},
): Chunk {
	return {
		id: key,
		key,
		name: key,
		file: "f.ts",
		line: 1,
		endLine: 2,
		nesting: 0,
		direct: new Set(direct),
		calls: new Set(calls),
		unknownSites: 0,
		unknownCalls: [],
		thrownTypes: [],
		catches: [],
		stateWrites: [],
		stateReads: [],
		...extra,
	};
}

// ---------------------------------------------------------------------------
// 任务1：stateDeps ⊤ 降级面显式化（false coupling 锚定为已知近似）
// ---------------------------------------------------------------------------
describe("law:edge-case（⊤ 降级面——已知近似锚定，非静默）", () => {
	it("⊤ 写者匹配一切读者 → 全项目状态读者耦合（state.ts:46 声明；判定边界：不进 purity/effects）", () => {
		const writer = mkChunk("w", [], [], { stateWrites: ["⊤"] });
		const reader = mkChunk("r", [], [], { stateReads: ["user.status"] });
		const report = analyze([writer, reader]);
		const r = report.verdicts.find((v) => v.chunk.key === "r")!;
		// 已知近似（state.ts:12-13「全局 ⊤ 匹配一切」）：⊤ 写者 → 读者依赖集含 ⊤
		expect(r.stateDeps).toContain("⊤");
		// 耦合图可观测 false coupling：写者 w 与读者 r 显示耦合（两 chunk 调用边零交集）
		const entries = stateCouplingOf(report.verdicts);
		const w = entries.find((e) => e.key === "w")!;
		expect(w.readerKeys).toContain("r");
		// 判定边界（公理3）：⊤ 只进耦合元数据与 R_state，不进 purity/effects/chain
		expect(r.purity).toBe(Purity.PURE);
		expect(r.effects.size).toBe(0);
	});

	it("根限定 ⊤ 读（d.⊤）耦合同根写者（state.ts:43-45 声明；非根写者不耦合）", () => {
		const writer = mkChunk("w", [], [], { stateWrites: ["d.x"] });
		const foreign = mkChunk("fo", [], [], { stateWrites: ["other.y"] });
		const reader = mkChunk("r", [], [], { stateReads: ["d.⊤"] });
		const report = analyze([writer, foreign, reader]);
		const r = report.verdicts.find((v) => v.chunk.key === "r")!;
		expect(r.stateDeps).toContain("d.x"); // 同根耦合（已知近似）
		expect(r.stateDeps).not.toContain("other.y"); // 根限定：异根不耦合
		expect(r.purity).toBe(Purity.PURE); // 判定边界
	});

	it("R_state 消费边界：⊤ 写者改动 → 全部状态读者 broken（risk.ts:217-232 影响面——似然因子非判定）", () => {
		// w 写 ⊤（changed）；r1/r2 读状态（任意位置）——⊤ 写者使两个读者全部 broken
		const w = mkChunk("w", [], [], {
			file: "w.ts",
			stateWrites: ["⊤"],
		});
		const r1 = mkChunk("r1", [], [], {
			file: "r1.ts",
			stateReads: ["user.status"],
		});
		const r2 = mkChunk("r2", [], [], {
			file: "r2.ts",
			stateReads: ["cfg.timeout"],
		});
		const report = analyze([w, r1, r2]);
		const risk = riskOfChange(report.verdicts, new Set(["w.ts"]));
		// ⊤ 写者命中一切写位置 → 两个读者都 broken → state = 2/2 = 1
		expect(risk.factors.state).toBe(1);
		// 判定边界：r1/r2 自身 purity 不受 ⊤ 影响（读不是副作用，公理3）
		for (const v of report.verdicts) expect(v.purity).toBe(Purity.PURE);
	});
});

// ---------------------------------------------------------------------------
// 任务2：A6-inner 机检证书补强——有限格高度界 |V|·|Σ∪{?}| 满格攀登
// ---------------------------------------------------------------------------
describe("law:fixpoint（A6-inner 证书补强——有限格高度机制）", () => {
	it("7 种效应原子满格攀登：每步恰增一格，步数 ≤ |V|·|Σ∪{?}|，analyze == Kleene", () => {
		// Σ = {io, net, db, random, clock, state}（A7 LangPack 声明）+ ? = 7 原子
		const atoms = ["io", "net", "db", "random", "clock", "state"];
		const chunks: Chunk[] = [];
		for (let i = 0; i < atoms.length; i++) {
			const key = `v${i}`;
			const calls =
				i < atoms.length - 1 ? [`v${i + 1}`] : [UNKNOWN_TARGET];
			chunks.push(mkChunk(key, [atoms[i]], calls));
		}
		// 手动 Kleene 迭代（F(X)(v) = direct(v) ∪ ⋃ X(callee)，轮8 同定义）——保留每步集合
		let cur = new Map(chunks.map((c) => [c.key, new Set(c.direct)]));
		const growth: number[] = []; // 每步 |F^k(v0)|
		let steps = 0;
		const maxIter = chunks.length * (atoms.length + 1); // |V|·|Σ∪{?}| = 7·7
		let monotone = true;
		let converged = false;
		for (; steps < maxIter; steps++) {
			const next = new Map<string, Set<string>>();
			for (const c of chunks) {
				const s = new Set(c.direct);
				for (const t of c.calls) {
					if (t === UNKNOWN_TARGET) s.add(UNKNOWN_TARGET);
					else {
						const curT = cur.get(t);
						if (curT) for (const e of curT) s.add(e);
						else s.add(UNKNOWN_TARGET);
					}
				}
				next.set(c.key, s);
			}
			growth.push(next.get("v0")!.size);
			let stable = true;
			for (const c of chunks) {
				const a = cur.get(c.key)!;
				const b = next.get(c.key)!;
				for (const e of a)
					if (!b.has(e)) {
						monotone = false;
						stable = false;
					}
				if (a.size !== b.size) stable = false;
			}
			cur = next;
			if (stable) {
				converged = true;
				steps++;
				break;
			}
		}
		expect(converged).toBe(true);
		expect(monotone).toBe(true); // 证明步骤1：单调不变量
		// 证明步骤1 的机制声明「每步至少新增一个格元素」：v0 的效应集严格 +1 逐级增长
		// （F^1(v0) = {io,net} = 2 … F^6(v0) = 7 原子，F^7 稳定重复）
		expect(growth).toEqual([2, 3, 4, 5, 6, 7, 7]);
		// 有限格高度界：|V|·|Σ∪{?}| 步内稳定（轮8 用宽松常数 8+4，此处收紧到证明文本声明值）
		// 满格攀登恰需 |Σ∪{?}| = 7 步（6 步增长 + 1 步稳定校验；? 沿链传播参与攀格）
		expect(steps).toBe(atoms.length + 1);
		expect(steps).toBeLessThanOrEqual(chunks.length * (atoms.length + 1));
		// 证书核心：analyze 单趟逆拓扑 == Kleene 最小不动点（逐 chunk）
		const report = analyze(chunks);
		expect(report.invariantViolations).toBe(0);
		for (const v of report.verdicts) {
			const mu = cur.get(v.chunk.key)!;
			expect([...v.effects].sort()).toEqual(
				[...mu].filter((x) => x !== UNKNOWN_TARGET).sort(),
			);
			expect(v.purity).toBe(
				[...mu].filter((x) => x !== UNKNOWN_TARGET).length > 0
					? Purity.IMPURE
					: mu.has(UNKNOWN_TARGET)
						? Purity.UNKNOWN
						: Purity.PURE,
			);
		}
		// 幂等吸收：同一输入再跑一次 Kleene == 一次（不动点吸收）
		const cur2 = cur;
		const again = new Map(chunks.map((c) => [c.key, new Set(cur2.get(c.key)!)]));
		let stable2 = true;
		for (const c of chunks) {
			const s = new Set(c.direct);
			for (const t of c.calls) {
				if (t === UNKNOWN_TARGET) s.add(UNKNOWN_TARGET);
				else {
					const curT = again.get(t);
					if (curT) for (const e of curT) s.add(e);
					else s.add(UNKNOWN_TARGET);
				}
			}
			for (const e of s) if (!again.get(c.key)!.has(e)) stable2 = false;
		}
		expect(stable2).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// 任务3：A6 S2/S4 通道穷举——解析失败路径要么边要么 unknown，无静默 ∅
// ---------------------------------------------------------------------------
describe("law:edge-case（A6 S2/S4 通道穷举——构造器/继承/模块/泛型-重载失败路径）", () => {
	it("构造器解析失败：C# new MissingThing()（项目无此类、效应表无此名）→ UNKNOWN 非 PURE", async () => {
		const root = project("ct9-ctor-miss", {
			"C.cs": [
				"class C {",
				"  public void F() {",
				"    var x = new MissingThing();",
				"  }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(byName(r).get("C.F")!.purity).toBe(Purity.UNKNOWN);
	});

	it("构造器别名解析失败：C# using Alias = Ext; new Alias() → UNKNOWN（link.ts 别名通道）", async () => {
		const root = project("ct9-ctor-alias", {
			"C.cs": [
				"using Alias = SomeExternal.Thing;",
				"class C {",
				"  public void F() {",
				"    var x = new Alias();",
				"  }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(byName(r).get("C.F")!.purity).toBe(Purity.UNKNOWN);
	});

	it("继承解析失败：C# base.M()（基类项目外）→ UNKNOWN；self.M() 成员 miss → UNKNOWN", async () => {
		const root = project("ct9-base-miss", {
			"C.cs": [
				"class C : ExternalBase {",
				"  public void F() {",
				"    base.Missing();",
				"  }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(byName(r).get("C.F")!.purity).toBe(Purity.UNKNOWN);
	});

	it("继承解析失败：Python super().m() 不可拍平 → 哨兵 → UNKNOWN 非 PURE", async () => {
		const root = project("ct9-super", {
			"a.py": [
				"class A:",
				"    def g(self):",
				"        return 1",
				"class B(A):",
				"    def f(self):",
				"        return super().g()",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		// super().g() 是 extractor 不可拍平形态 → 落 unknown（S4：永不静默丢）
		expect(byName(r).get("B.f")!.purity).toBe(Purity.UNKNOWN);
	});

	it("模块导入失败：TS import {x} from './missing' → UNKNOWN（resolveMod miss 通道）", async () => {
		const root = project("ct9-mod-miss", {
			"a.ts": [
				"import { x } from './missing';",
				"export function f() { x(); }",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(byName(r).get("f")!.purity).toBe(Purity.UNKNOWN);
	});

	it("模块导入失败：Python from missing import m → UNKNOWN（resolveMod miss 通道）", async () => {
		const root = project("ct9-py-mod-miss", {
			"a.py": [
				"from missing_mod import m",
				"def f():",
				"    return m()",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(byName(r).get("f")!.purity).toBe(Purity.UNKNOWN);
	});

	it("泛型失败：TS 类型参数接收者 T.foo() → UNKNOWN（类型参数不可解析，无静默 ∅）", async () => {
		const root = project("ct9-generic", {
			"a.ts": [
				"export function f<T>(x: T): void {",
				"  x.doSomething();",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(byName(r).get("f")!.purity).toBe(Purity.UNKNOWN);
	});

	it("重载失败：C# 同限定名多定义 → 全候选并集边（无静默 ∅）——一候选 io 则调用方 IMPURE", async () => {
		const root = project("ct9-overload", {
			"C.cs": [
				"class C {",
				"  public void M(int x) { }",
				"  public void M(string s) { System.Console.WriteLine(s); }",
				"  public void F() {",
				"    C c = new C();",
				"    c.M(1);",
				"  }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const f = byName(r).get("C.F")!;
		// 重载歧义 → 并集边（迭代37 P1-3）：不静默选一，io 重载必须传播
		expect(f.purity).toBe(Purity.IMPURE);
	});
});

// ---------------------------------------------------------------------------
// 任务4：轮8 classEntriesFor 作用域化自身边界（新语义的新违反面）
// ---------------------------------------------------------------------------
describe("law:functoriality（轮8 作用域化自身边界）", () => {
	it("C# partial 类跨文件：ctor 在 b.cs、new Svc() 在 a.cs → 必须 IMPURE（S1：PURE ⟹ 效应闭包 ∅；"
		+ "作用域化不得吞跨文件 partial 成员——轮8 回退条件在 partial 下永不触发，语义失效）", async () => {
		const root = project("ct9-partial", {
			"a.cs": [
				"partial class Svc {",
				"  public void Make() { new Svc(); }",
				"}",
			].join("\n"),
			"b.cs": [
				"partial class Svc {",
				"  public Svc() { System.Console.WriteLine(\"x\"); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const make = r.verdicts.find(
			(v) => v.chunk.file === "a.cs" && v.chunk.name === "Svc.Make",
		)!;
		// 运行时 new Svc() 执行 b.cs 构造器（io）——判 PURE = S1 违反（假纯）
		expect(make.purity).toBe(Purity.IMPURE);
	});

	it("C# partial 类跨文件静态成员：a.cs 调 Svc.Helper()、实现与 io 在 b.cs → 必须 IMPURE（非 UNKNOWN 噪音）", async () => {
		const root = project("ct9-partial-static", {
			"a.cs": [
				"partial class Svc {",
				"  public static void Use() { Svc.Helper(); }",
				"}",
			].join("\n"),
			"b.cs": [
				"partial class Svc {",
				"  public static void Helper() { System.Console.WriteLine(\"x\"); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const use = r.verdicts.find(
			(v) => v.chunk.file === "a.cs" && v.chunk.name === "Svc.Use",
		)!;
		expect(use.purity).toBe(Purity.IMPURE);
	});

	it("Python 模块私有类跨模块引用：b.py 星号导入 a.py 后 Svc.helper(None) → 回退并集解析到 a.py（单候选正确）", async () => {
		const root = project("ct9-py-wildcard", {
			"a.py": [
				"class Svc:",
				"    def helper(self):",
				"        return 1",
			].join("\n"),
			"b.py": [
				"from a import *",
				"def via():",
				"    return Svc.helper(None)",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const via = r.verdicts.find((v) => v.chunk.file === "b.py")!;
		expect(via.purity).toBe(Purity.PURE); // 解析到 a.py 的纯 helper（并集回退正确解析）
		const helperKey = r.verdicts.find(
			(v) => v.chunk.file === "a.py" && v.chunk.name === "Svc.helper",
		)!.chunk.key;
		expect(via.chunk.calls.has(helperKey)).toBe(true); // 真边（非静默 ∅）
	});

	it("TS 调用方文件同名类 → 局部优先（轮8 语义保持：并图不改变本文件判定）", async () => {
		const root = project("ct9-ts-local", {
			"a.ts": [
				"class Svc {",
				"  static helper(): number { return 1; }",
				"}",
				"export function via(): number { return Svc.helper(); }",
			].join("\n"),
			"b.ts": [
				"class Svc {",
				"  static helper(): void { console.log('x'); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const via = r.verdicts.find((v) => v.chunk.file === "a.ts")!;
		expect(via.purity).toBe(Purity.PURE); // 本文件 helper 纯；b.ts 同名类不泄漏
	});
});
