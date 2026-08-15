import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "../../src/core/analyze";
import { scanProject } from "../../src/index";
import { Purity, UNKNOWN_TARGET, type Chunk } from "../../src/core/types";

/**
 * 轮8 范畴律对抗审计（证明系统完备性推进）：
 * - law:fixpoint（A6-inner 机检证书）：效应传播 = 有限格单调函数 F 的最小不动点——
 *   手动 Kleene 迭代对拍 analyze 单趟逆拓扑输出；单调不变量；≤|V|·|Σ∪{?}| 收敛；不动点方程；
 *   迭代两次 == 迭代一次（幂等吸收）。
 * - law:functoriality（迭代56 闭合 + 轮9 修正）：同名类解析语言门控——构造器路径（C# new Svc()：
 *   轮9 起 C# 恒并集 = partial 语义必需，见本文件 f1-ctor 注释与 ct-adversarial9 law:functoriality）、
 *   静态成员路径（Svc.helper）、self 路径（ct-adversarial2 已锚）——Python/TS/JS 文件作用域，C# 命名空间作用域。
 * - law:annotation-boundary（任务3 收口）：(file,id) 锚定优先于裸 id 内容寻址，跨文件不泄漏。
 */

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-ct8-"));
});
afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

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

/**
 * 手动 Kleene 迭代：F(X)(v) = direct(v) ∪ ⋃_{(v,u)∈E} X(u) ∪ {? | v 含未知调用}，
 * 从 ∅ 出发迭代至不动点。返回收敛集合、步数、单调性是否保持（每步 F^k ⊆ F^{k+1}）。
 */
function kleeneFixpoint(chunks: readonly Chunk[]): {
	sets: Map<string, Set<string>>;
	steps: number;
	converged: boolean;
	monotone: boolean;
} {
	const byKey = new Map<string, Chunk>();
	for (const c of chunks) byKey.set(c.key, c);
	let cur = new Map<string, Set<string>>();
	for (const c of chunks) cur.set(c.key, new Set(c.direct));
	const maxIter = chunks.length * 8 + 4; // 有限格高度上界 |V|·(|Σ|+1)
	let monotone = true;
	let steps = 0;
	let converged = false;
	for (; steps < maxIter; steps++) {
		const next = new Map<string, Set<string>>();
		for (const c of chunks) {
			const s = new Set(c.direct);
			for (const t of c.calls) {
				if (t === UNKNOWN_TARGET) s.add(UNKNOWN_TARGET);
				else if (byKey.has(t)) {
					for (const e of cur.get(t)!) s.add(e);
				} else s.add(UNKNOWN_TARGET); // 悬垂边：S4 按未知处理
			}
			next.set(c.key, s);
		}
		let stable = true;
		for (const c of chunks) {
			const a = cur.get(c.key)!;
			const b = next.get(c.key)!;
			for (const e of a) {
				if (!b.has(e)) {
					monotone = false;
					stable = false;
					break;
				}
			}
			if (a.size !== b.size) stable = false;
			if (!monotone) break;
		}
		cur = next;
		if (stable) {
			converged = true;
			steps++; // 收敛步 = 最后一次迭代
			break;
		}
	}
	return { sets: cur, steps, converged, monotone };
}

/** 判定格映射（与 analyze 同构）：IMPURE if real>0；UNKNOWN if ?∈set；否则 PURE。 */
function purityOf(s: ReadonlySet<string>): Purity {
	const real = [...s].filter((x) => x !== UNKNOWN_TARGET);
	if (real.length > 0) return Purity.IMPURE;
	return s.has(UNKNOWN_TARGET) ? Purity.UNKNOWN : Purity.PURE;
}

// ---------------------------------------------------------------------------
// law:fixpoint —— A6-inner 机检证书（最小不动点对拍）
// ---------------------------------------------------------------------------
describe("law:fixpoint（A6-inner 机检证书）", () => {
	it("有限格单调函数 F 的最小不动点 == analyze 单趟逆拓扑输出（含 SCC/未知/悬垂边）", () => {
		// 构造：线性链 + 循环 SCC + 未知站点 + 悬垂边（S4 全部通道）
		const chunks = [
			mkChunk("src", ["io"], ["chain1"]),
			mkChunk("chain1", [], ["chain2"]),
			mkChunk("chain2", [], ["sccA"]),
			mkChunk("sccA", [], ["sccB", "unknown1"]),
			mkChunk("sccB", [], ["sccA"]), // 环：SCC 分量
			mkChunk("unknown1", [], [UNKNOWN_TARGET]), // 未知站点
			mkChunk("pure1", []),
			mkChunk("dangling", [], ["ghost"]), // 悬垂边 → S4 按未知
			mkChunk("staleReader", [], ["dangling"]),
		];
		const k1 = kleeneFixpoint(chunks);
		expect(k1.converged).toBe(true);
		expect(k1.monotone).toBe(true); // 单调不变量：F^k ⊆ F^{k+1} 全程保持
		expect(k1.steps).toBeLessThan(chunks.length * 8 + 4); // 有限格收敛界内

		// 幂等吸收：迭代两次 == 迭代一次（不动点吸收）
		const k2 = kleeneFixpoint(chunks);
		for (const c of chunks) {
			expect([...k2.sets.get(c.key)!].sort()).toEqual(
				[...k1.sets.get(c.key)!].sort(),
			);
		}
		expect(k2.steps).toBeLessThanOrEqual(k1.steps);

		// 不动点方程：X(v) == direct(v) ∪ ⋃ X(callee)（含 ? 通道）——逐点验证
		const byKey = new Map(chunks.map((c) => [c.key, c]));
		for (const c of chunks) {
			const lhs = new Set(k1.sets.get(c.key)!);
			const rhs = new Set(c.direct);
			for (const t of c.calls) {
				if (t === UNKNOWN_TARGET) rhs.add(UNKNOWN_TARGET);
				else if (byKey.has(t)) {
					for (const e of k1.sets.get(t)!) rhs.add(e);
				} else rhs.add(UNKNOWN_TARGET);
			}
			expect([...lhs].sort()).toEqual([...rhs].sort());
		}

		// 机检证书核心：analyze 输出 == Kleene 最小不动点（逐 chunk：effects/purity）
		const report = analyze(chunks);
		expect(report.invariantViolations).toBe(0);
		for (const v of report.verdicts) {
			const mu = k1.sets.get(v.chunk.key)!;
			expect([...v.effects].sort()).toEqual(
				[...mu].filter((x) => x !== UNKNOWN_TARGET).sort(),
			);
			expect(v.purity).toBe(purityOf(mu));
		}
		// SCC 分量内同判定（公理2：分量级量）
		const sccA = report.verdicts.find((v) => v.chunk.key === "sccA")!;
		const sccB = report.verdicts.find((v) => v.chunk.key === "sccB")!;
		expect(sccA.purity).toBe(sccB.purity);
		expect(sccA.chain).toBe(sccB.chain);
	});

	it("无效应宇宙（全纯）与单点图的不动点是恒等像（初始对象边界）", () => {
		const chunks = [mkChunk("a"), mkChunk("b", [], ["a"])];
		const k = kleeneFixpoint(chunks);
		for (const c of chunks) expect(k.sets.get(c.key)!.size).toBe(0);
		const report = analyze(chunks);
		for (const v of report.verdicts) expect(v.purity).toBe(Purity.PURE);
		expect(report.invariantViolations).toBe(0);
	});

	it("格单调性在效应增长下保持（F 单调 ⟹ 判定格 Λ 不反向跳变）", () => {
		// 同一图上的效果链（每步只增效应，形成子格链）：
		//   c0 基线全纯 → c1 u 加 ?（UNKNOWN） → c2 w 加 io（IMPURE，? 保留）
		// 判定只能 PURE→UNKNOWN→IMPURE 方向移动；反向跳变 = F 非单调。
		const chunksOf = (step: number) => {
			const c = (key: string, direct: string[] = [], calls: string[] = []) =>
				mkChunk(key, direct, calls);
			const u = step >= 1 ? c("u", [], ["v", UNKNOWN_TARGET]) : c("u", [], ["v"]);
			const w = step >= 2 ? c("w", ["io"]) : c("w");
			return [u, c("v", [], ["w"]), w];
		};
		const seq = [0, 1, 2].map((step) =>
			analyze(chunksOf(step)).verdicts.find((v) => v.chunk.key === "u")!.purity,
		);
		for (let i = 1; i < seq.length; i++) expect(seq[i]!).toBeGreaterThanOrEqual(seq[i - 1]!);
		expect(seq[0]).toBe(Purity.PURE);
		expect(seq[1]).toBe(Purity.UNKNOWN);
		expect(seq[2]).toBe(Purity.IMPURE);
	});
});

// ---------------------------------------------------------------------------
// law:functoriality —— 迭代56 同名类作用域化闭合（构造器/静态/self 三路径）
// ---------------------------------------------------------------------------
describe("law:functoriality（同名类作用域化：ctor/static 路径）", () => {
	it("C# 构造器路径：new Svc() 跨文件同名类 = 命名空间作用域（轮9 修正——文件作用域化不适用于 C#："
		+ "partial 类跨文件 ctor 必需并集，轮8 作用域化在 partial 下回退永不触发 → S1 假纯实证；"
		+ "本 fixture 为非法 C#（同 namespace 非 partial 同名类 = 编译错误），并集过近似是 S2 方向安全选择）", async () => {
		const root = join(dir, "f1-ctor");
		mkdirSync(root, { recursive: true });
		writeFileSync(
			join(root, "a.cs"),
			[
				"class Svc {",
				"    Svc() { }",
				"    public int Make() { var s = new Svc(); return s.H(); }",
				"    public int H() { return 1; }",
				"}",
			].join("\n"),
		);
		const aloneA = await scanProject(root);
		// 并图：b.cs 同名类带 io 构造器——C# 命名空间作用域（globalClasses 并集，classEntriesFor
		// fileScoped=false）：b.cs 构造器 io 必须传播（S1 永不假纯；并集 = S2 过近似方向安全）
		writeFileSync(
			join(root, "b.cs"),
			[
				"class Svc {",
				"    Svc() { System.Console.WriteLine(\"x\"); }",
				"    public int H() { return 2; }",
				"}",
			].join("\n"),
		);
		const joint = await scanProject(root);
		const make = joint.verdicts.find(
			(v) => v.chunk.file === "a.cs" && v.chunk.name === "Svc.Make",
		)!;
		const makeAlone = aloneA.verdicts.find(
			(v) => v.chunk.name === "Svc.Make",
		)!;
		expect(makeAlone.purity).toBe(Purity.PURE); // 单项目：本文件 ctor 空 → 纯
		// 并集语义下 a.cs 判定可因同命名空间同名类成员变化（S2 过近似），S1 永不假纯：
		// b.cs 构造器 io 必须使 new Svc() 判 IMPURE（轮8 文件作用域化曾判 PURE = S1 违反）
		expect(make.purity).toBe(Purity.IMPURE);
		// b.cs 自身判定不受 a.cs 影响
		const ctorB = joint.verdicts.find(
			(v) => v.chunk.file === "b.cs" && v.chunk.name === "Svc.Svc",
		)!;
		expect(ctorB.purity).toBe(Purity.IMPURE);
	});

	it("Python 静态成员路径：Svc.helper(None) 在并图下只解析本文件类成员（resolveObjDispatch 作用域）", async () => {
		const root = join(dir, "f2-static");
		mkdirSync(root, { recursive: true });
		writeFileSync(
			join(root, "a.py"),
			[
				"class Svc:",
				"    def helper(self):",
				"        return 1",
				"def via_static():",
				"    return Svc.helper(None)",
				"def via_self():",
				"    s = Svc()",
				"    return s.helper()",
			].join("\n"),
		);
		const aloneA = await scanProject(root);
		writeFileSync(
			join(root, "b.py"),
			[
				"class Svc:",
				"    def helper(self):",
				"        print('x')",
			].join("\n"),
		);
		const joint = await scanProject(root);
		for (const name of ["via_static", "via_self"]) {
			const v = joint.verdicts.find(
				(c) => c.chunk.file === "a.py" && c.chunk.name === name,
			)!;
			const alone = aloneA.verdicts.find(
				(c) => c.chunk.name === name,
			)!;
			expect(v.purity).toBe(alone.purity); // 函子律
			expect(v.purity).toBe(Purity.PURE); // 旧并集语义下 helper 并集会引 b.py print → IMPURE
		}
		// b.py 的 helper 自身仍 IMPURE（作用域化不吞异文件判定）
		const helperB = joint.verdicts.find(
			(c) => c.chunk.file === "b.py" && c.chunk.name === "Svc.helper",
		)!;
		expect(helperB.purity).toBe(Purity.IMPURE);
	});
});

// ---------------------------------------------------------------------------
// law:annotation-boundary —— (file,id) 锚定优先 + 裸 id 内容寻址边界（任务3 收口）
// ---------------------------------------------------------------------------
describe("law:annotation-boundary（标注实例锚定边界）", () => {
	it("file 锚定优先于裸 id；file 锚定不泄漏到异文件同 id chunk（scan.ts:451 契约）", async () => {
		const root = join(dir, "f3-ann");
		mkdirSync(root, { recursive: true });
		// 同内容跨文件：两 f 同 id，g 均未解析 → 双 UNKNOWN
		const src = "def f(x):\n    return g(x)\n";
		writeFileSync(join(root, "a.py"), src);
		writeFileSync(join(root, "b.py"), src);
		const base = await scanProject(root);
		const fA = base.verdicts.find((v) => v.chunk.file === "a.py" && v.chunk.name === "f")!;
		const fB = base.verdicts.find((v) => v.chunk.file === "b.py" && v.chunk.name === "f")!;
		expect(fA.chunk.id).toBe(fB.chunk.id); // 内容寻址：同 id
		expect(fA.purity).toBe(Purity.UNKNOWN);
		expect(fB.purity).toBe(Purity.UNKNOWN);

		// 边界 1：file 锚定只放行 a.py（同 id⇒同判定为假——import 上下文可不同）
		const anchored = await scanProject(root, {
			annotations: new Map([[`a.py\u0000${fA.chunk.id}`, "PURE"]]),
		});
		const a1 = anchored.verdicts.find((v) => v.chunk.file === "a.py" && v.chunk.name === "f")!;
		const b1 = anchored.verdicts.find((v) => v.chunk.file === "b.py" && v.chunk.name === "f")!;
		expect(a1.purity).toBe(Purity.PURE);
		expect(b1.purity).toBe(Purity.UNKNOWN); // 不泄漏

		// 边界 2：裸 id = 内容寻址契约（公理4）——两个实例同时放行
		const bare = await scanProject(root, {
			annotations: new Map([[fA.chunk.id, "PURE"]]),
		});
		for (const file of ["a.py", "b.py"]) {
			const v = bare.verdicts.find((c) => c.chunk.file === file && c.chunk.name === "f")!;
			expect(v.purity).toBe(Purity.PURE);
		}

		// 边界 3：file 锚定与裸 id 并存 → file 锚定优先（a.py=IMPURE 锚定压过裸 PURE；b.py 走裸 id）
		const mixed = await scanProject(root, {
			annotations: new Map([
				[`a.py\u0000${fA.chunk.id}`, "IMPURE"],
				[fA.chunk.id, "PURE"],
			]),
		});
		const a3 = mixed.verdicts.find((v) => v.chunk.file === "a.py" && v.chunk.name === "f")!;
		const b3 = mixed.verdicts.find((v) => v.chunk.file === "b.py" && v.chunk.name === "f")!;
		expect(a3.purity).toBe(Purity.IMPURE); // 实例锚定覆写内容寻址
		expect(a3.effects.has("io")).toBe(true);
		expect(b3.purity).toBe(Purity.PURE); // 裸 id 对 b.py 生效
	});
});
