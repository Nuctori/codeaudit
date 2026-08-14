import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "../../src/core/analyze";
import { tarjan } from "../../src/core/tarjan";
import { graphMetrics } from "../../src/core/topology";
import { proofCompleteness } from "../../src/core/proof";
import {
	annotationBudget,
	annotationCurve,
	changedImpact,
	compareReports,
} from "../../src/core/influence";
import { riskOfChange } from "../../src/core/risk";
import { moduleSummary } from "../../src/core/module";
import { stateCouplingOf } from "../../src/core/state";
import { moduleGraph } from "../../src/core/depgraph";
import { duplicateGroups, testCoverage, deadChunks } from "../../src/core/gov";
import { scanProject } from "../../src/index";
import {
	Purity,
	UNKNOWN_TARGET,
	type Chunk,
	type Verdict,
} from "../../src/core/types";

/**
 * 范畴律对抗性审计（函数式范畴论视角）：
 * 工具 = 源码范畴 → 效应代数 的函子。逐律验证：
 * - law:functoriality   analysis(f∘g) == analysis(f) ∘ analysis(g)（不相交并图组合性）
 * - law:associativity   效应并集结合律/置换不变（不动点方程、annotationCurve 终值）
 * - law:idempotence     tarjan/影响传播/recheck 重算幂等（两遍 == 一遍）
 * - law:determinism     同一输入两次分析逐字节一致（含 chainPath/stateDeps/排序）
 * - law:poset-monotonicity 纯度格单调（效应/边增长 → 判定不反向跳变）
 * - law:edge-case       空/单点/孤立/全纯/全不纯/悬垂/幽灵目标有明确定义的像
 */

// ---- 工具 ----

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-ct-"));
});
afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** 确定性 PRNG（mulberry32）——与 property.test.ts 同款，保证可复现。 */
function rng(seed: number): () => number {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function randGraph(
	rand: () => number,
	n: number,
	edgeProb: number,
): Map<string, Set<string>> {
	const edges = new Map<string, Set<string>>();
	for (let i = 0; i < n; i++) {
		const s = new Set<string>();
		for (let j = 0; j < n; j++) {
			if (i !== j && rand() < edgeProb) s.add("n" + j);
		}
		edges.set("n" + i, s);
	}
	return edges;
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

/** 全字段归一化（Set → 排序数组）——逐字节可比。 */
function normVerdict(v: Verdict): Record<string, unknown> {
	return {
		key: v.chunk.key,
		id: v.chunk.id,
		name: v.chunk.name,
		file: v.chunk.file,
		line: v.chunk.line,
		endLine: v.chunk.endLine,
		nesting: v.chunk.nesting,
		kind: v.chunk.kind ?? null,
		complexity: v.chunk.complexity ?? null,
		direct: [...v.chunk.direct].sort(),
		calls: [...v.chunk.calls].sort(),
		unknownSites: v.chunk.unknownSites ?? 0,
		parseError: v.chunk.parseError ?? false,
		thrownTypes: v.chunk.thrownTypes,
		catches: v.chunk.catches,
		stateWrites: v.chunk.stateWrites,
		stateReads: v.chunk.stateReads,
		purity: v.purity,
		effects: [...v.effects].sort(),
		chain: v.chain,
		chainDev: v.chainDev,
		chainCertain: v.chainCertain,
		chainPath: v.chainPath,
		throwsTypes: v.throwsTypes,
		stateDeps: v.stateDeps,
		provenance: v.provenance,
	};
}

const sig = (vs: readonly Verdict[]): string =>
	JSON.stringify(vs.map(normVerdict));

const normMapSig = (vs: readonly Verdict[]): string =>
	JSON.stringify(
		[...new Map(vs.map((v) => [v.chunk.key, normVerdict(v)])).entries()].sort(
			(a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
		),
	);

// ---------------------------------------------------------------------------
// law:functoriality —— 组合性：不相交子图并集不改变局部判定
// ---------------------------------------------------------------------------
describe("law:functoriality", () => {
	it("不相交子图并集不改变各 chunk 判定（compositionality：analysis(f∘g) == analysis(f) ∘ analysis(g)）", () => {
		const s1 = [
			mkChunk("a1", [], ["b1"]),
			mkChunk("b1", ["io"], [], { stateWrites: ["s1.pos"] }),
		];
		const s2 = [
			mkChunk("a2", [], ["b2", "c2"]),
			mkChunk("b2", ["fs"]),
			mkChunk("c2", ["io"], [], { stateWrites: ["s2.pos"] }),
		];
		// 不相交性检查：无跨子图调用键；无同名状态位置
		const jointKeys = new Set([...s1, ...s2].map((c) => c.key));
		for (const c of [...s1, ...s2])
			for (const t of c.calls)
				if (t !== UNKNOWN_TARGET)
					expect(jointKeys.has(t)).toBe(true); // 无悬垂/无跨图引用
		const joint = analyze([...s1, ...s2]).verdicts;
		const separate = analyze(s1).verdicts.concat(analyze(s2).verdicts);
		expect(normMapSig(joint)).toBe(normMapSig(separate));
	});

	it("效应链深度在子图并集下保持（chain 函子组合性）", () => {
		const s1 = [
			mkChunk("x1", [], ["y1"]),
			mkChunk("y1", [], ["z1"]),
			mkChunk("z1", ["db"]),
		];
		const s2 = [mkChunk("p2", ["random"])];
		const joint = new Map(
			analyze([...s1, ...s2]).verdicts.map((v) => [v.chunk.key, v]),
		);
		const sep = new Map(
			analyze(s1)
				.verdicts.concat(analyze(s2).verdicts)
				.map((v) => [v.chunk.key, v]),
		);
		for (const k of joint.keys()) {
			expect(joint.get(k)!.chain).toBe(sep.get(k)!.chain);
			expect(joint.get(k)!.chainPath).toEqual(sep.get(k)!.chainPath);
			expect(joint.get(k)!.purity).toBe(sep.get(k)!.purity);
			expect(joint.get(k)!.chainCertain).toBe(sep.get(k)!.chainCertain);
		}
	});

	it.fails("⊤ 全局读者使 stateDeps 跨不相交子图过耦合（文档化偏差：state.ts:39-46 全局 ⊤ 匹配一切写者；"
		+ "根因 = stateReads 无作用域信息，修复需提取器语义变更，暂不修）", () => {
		// 图1：reader 读全局状态；图2：writer 写 user.status——两图调用边零交集
		const reader = mkChunk("reader", [], [], { stateReads: ["⊤"] });
		const writer = mkChunk("writer", ["state"], [], {
			stateWrites: ["user.status"],
		});
		const joint = analyze([reader, writer]).verdicts.find(
			(v) => v.chunk.key === "reader",
		)!;
		const alone = analyze([reader]).verdicts.find(
			(v) => v.chunk.key === "reader",
		)!;
		// 函子律要求：不相交并集下 reader 的像不变
		expect(joint.stateDeps).toEqual(alone.stateDeps);
	});
});

// ---------------------------------------------------------------------------
// law:associativity —— 效应并集结合律/置换不变
// ---------------------------------------------------------------------------
describe("law:associativity", () => {
	it("效应代数结合律经分析函子保持：effects(c) == direct(c) ∪ ⋃ effects(callee)（不动点方程，16 随机图）", () => {
		const EFFS = ["io", "state", "fs", "net", "db", "random"];
		for (let seed = 300; seed < 316; seed++) {
			const rand = rng(seed);
			const n = 12;
			const keys = Array.from({ length: n }, (_, i) => "n" + i);
			const edges = randGraph(rand, n, 0.2);
			const chunks = keys.map((k) => {
				const d =
					rand() < 0.15
						? [EFFS[Math.floor(rand() * EFFS.length)]!]
						: [];
				return mkChunk(k, d, [...edges.get(k)!]);
			});
			const { verdicts, invariantViolations } = analyze(chunks);
			// 工具自检不变量也必须是 0（边单调性 + 链三角）
			expect(invariantViolations, `seed=${seed}`).toBe(0);
			const by = new Map(verdicts.map((v) => [v.chunk.key, v]));
			for (const v of verdicts) {
				const union = new Set(v.chunk.direct);
				for (const t of v.chunk.calls) {
					if (t === UNKNOWN_TARGET) continue;
					const callee = by.get(t);
					if (callee) for (const e of callee.effects) union.add(e);
				}
				expect(
					[...union].sort(),
					`seed=${seed} chunk=${v.chunk.key}`,
				).toEqual([...v.effects].sort());
			}
		}
	});

	it("annotationCurve 终值对标注顺序置换不变（并/交代数交换结合律）", () => {
		const chunks = [
			mkChunk("u1", [], [UNKNOWN_TARGET]),
			mkChunk("u2", [], [UNKNOWN_TARGET]),
			mkChunk("w", [], ["u1", "u2", UNKNOWN_TARGET]),
		];
		const budget = annotationBudget(chunks);
		const orders = [
			["u1", "u2", "w"],
			["w", "u2", "u1"],
			["u2", "w", "u1"],
			["u1", "w", "u2"],
		];
		const finals = orders.map((o) => {
			const c = annotationCurve(budget, o);
			return c[c.length - 1]!;
		});
		expect(finals.every((f) => f === finals[0])).toBe(true);
		expect(finals[0]).toBe(0); // 全部标完 → 剩余 0
	});

	it("moduleSummary 聚合可分性：模块计数之和 = 全项目；模块效应并集 = 项目效应并集", () => {
		const chunks = [
			mkChunk("x1", [], ["y1"], { file: "src/a/mod1.ts" }),
			mkChunk("y1", ["io"], [], { file: "src/a/mod2.ts" }),
			mkChunk("z1", ["state"], [], { file: "src/b/mod3.ts" }),
		];
		const { verdicts } = analyze(chunks);
		const mods = moduleSummary(verdicts, 2);
		expect(mods.reduce((s, m) => s + m.chunks, 0)).toBe(verdicts.length);
		const allEffects = new Set<string>();
		for (const m of mods) for (const e of m.effects) allEffects.add(e);
		const projEffects = new Set<string>();
		for (const v of verdicts) for (const e of v.effects) projEffects.add(e);
		expect([...allEffects].sort()).toEqual([...projEffects].sort());
	});
});

// ---------------------------------------------------------------------------
// law:idempotence —— 重算幂等（两遍 == 一遍）
// ---------------------------------------------------------------------------
describe("law:idempotence", () => {
	it("analyze 重跑逐字段一致（同一输入两次分析 == 一次）", () => {
		const chunks = [
			mkChunk("a", [], ["b", "c"]),
			mkChunk("b", ["io"]),
			mkChunk("c", [], ["b"]),
			mkChunk("d", [], [UNKNOWN_TARGET]),
			mkChunk("e", ["state"], [], { stateWrites: ["p.q"], stateReads: ["p.q"] }),
		];
		const r1 = analyze(chunks);
		const r2 = analyze(chunks);
		expect(sig(r1.verdicts)).toBe(sig(r2.verdicts));
		expect(r1.cycleCount).toBe(r2.cycleCount);
		expect(r1.staleEdges).toBe(r2.staleEdges);
		expect(r1.invariantViolations).toBe(r2.invariantViolations);
	});

	it("graphMetrics / proofCompleteness / annotationBudget / stateCouplingOf 重跑深等", () => {
		const chunks = [
			mkChunk("a", [], ["b"]),
			mkChunk("b", [], [UNKNOWN_TARGET]),
			mkChunk("c", ["io"], [], { stateWrites: ["x"], stateReads: ["x"] }),
		];
		const { verdicts } = analyze(chunks);
		expect(JSON.stringify(graphMetrics(verdicts))).toBe(
			JSON.stringify(graphMetrics(verdicts)),
		);
		const p1 = proofCompleteness(verdicts);
		const p2 = proofCompleteness(verdicts);
		expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
		const ab1 = annotationBudget(chunks);
		const ab2 = annotationBudget(chunks);
		expect(JSON.stringify([...ab1.influence.entries()])).toBe(
			JSON.stringify([...ab2.influence.entries()]),
		);
		expect(JSON.stringify(stateCouplingOf(verdicts))).toBe(
			JSON.stringify(stateCouplingOf(verdicts)),
		);
	});

	it("annotationCurve 重复标注序幂等：curve(o·o) 尾段 == curve(o) 终值（标注集去重）", () => {
		const chunks = [
			mkChunk("u1", [], [UNKNOWN_TARGET]),
			mkChunk("u2", [], [UNKNOWN_TARGET]),
			mkChunk("w", [], ["u1", "u2", UNKNOWN_TARGET]),
		];
		const budget = annotationBudget(chunks);
		const order = ["u1", "u2"];
		const c1 = annotationCurve(budget, order);
		const c2 = annotationCurve(budget, [...order, ...order]);
		// 前段与单次完全一致；重复段全是终值
		expect(c2.slice(0, c1.length)).toEqual(c1);
		expect(c2.slice(c1.length - 1)).toEqual(
			new Array(c2.length - c1.length + 1).fill(c1[c1.length - 1]),
		);
	});

	it("缓存热扫与冷扫判定逐字段一致（recheck 重算幂等）", async () => {
		const root = join(dir, "cache-idem");
		mkdirSync(root, { recursive: true });
		writeFileSync(
			join(root, "a.py"),
			[
				"class Store:",
				"    v = 0",
				"    def write(self, x):",
				"        self.v = x",
				"        return x",
				"    def read(self):",
				"        return self.v",
				"def top(x):",
				"    s = Store()",
				"    s.write(x)",
				"    return s.read()",
			].join("\n"),
		);
		writeFileSync(
			join(root, "b.ts"),
			[
				"export function helper(x: number) { return x + 1; }",
				"export function entry(x: number) { console.log(x); return helper(x); }",
			].join("\n"),
		);
		const cacheDir = join(root, ".codeaudit");
		const cold = await scanProject(root, { useCache: true, cacheDir });
		const warm = await scanProject(root, { useCache: true, cacheDir });
		expect(warm.stats.cachedFiles).toBe(cold.stats.files);
		expect(sig(warm.verdicts)).toBe(sig(cold.verdicts));
	});
});

// ---------------------------------------------------------------------------
// law:determinism —— 同一输入两次分析逐字节一致
// ---------------------------------------------------------------------------
describe("law:determinism", () => {
	it("analyze 输入乱序逐字段一致（含 chainPath 平手 tiebreak / 环内代表键）", () => {
		const chunks = [
			mkChunk("top", [], ["mid1", "mid2"]),
			mkChunk("mid1", [], ["io1"]),
			mkChunk("mid2", [], ["io2"]),
			mkChunk("io1", ["io"]),
			mkChunk("io2", ["io"]),
			mkChunk("cycA", [], ["cycB"]),
			mkChunk("cycB", [], ["cycA", "io1"]),
		];
		const base = normMapSig(analyze(chunks).verdicts);
		const shuffles = [
			[...chunks].reverse(),
			[chunks[4]!, chunks[0]!, chunks[2]!, chunks[6]!, chunks[1]!, chunks[5]!, chunks[3]!],
			[chunks[6]!, chunks[5]!, chunks[4]!, chunks[3]!, chunks[2]!, chunks[1]!, chunks[0]!],
		];
		for (const sh of shuffles) {
			expect(normMapSig(analyze(sh).verdicts)).toBe(base);
		}
	});

	it("同一项目两次扫描全字段字节一致（含状态耦合元数据/链路径/证明台账）", async () => {
		const root = join(dir, "det-proj");
		mkdirSync(root, { recursive: true });
		writeFileSync(
			join(root, "a.py"),
			[
				"class Store:",
				"    v = 0",
				"    def write(self, x):",
				"        self.v = x",
				"        return x",
				"    def read(self):",
				"        return self.v",
				"def pure(x):",
				"    return x * 2",
				"def top(x):",
				"    s = Store()",
				"    s.write(x)",
				"    return s.read() + pure(x)",
			].join("\n"),
		);
		writeFileSync(
			join(root, "b.ts"),
			[
				"export function helper(x: number) { return x + 1; }",
				"export function entry(x: number) { console.log(x); return helper(x); }",
			].join("\n"),
		);
		const r1 = await scanProject(root);
		const r2 = await scanProject(root);
		expect(sig(r1.verdicts)).toBe(sig(r2.verdicts));
		const { scannedAt: _s1, ...stats1 } = r1.stats as Record<string, unknown>;
		const { scannedAt: _s2, ...stats2 } = r2.stats as Record<string, unknown>;
		expect(JSON.stringify(stats1)).toBe(JSON.stringify(stats2));
	});
});

// ---------------------------------------------------------------------------
// law:poset-monotonicity —— 纯度格单调（效应/边增长不反向跳变）
// ---------------------------------------------------------------------------
describe("law:poset-monotonicity", () => {
	it("效应集增长 → 全图 purity/effects 单调不减（含 UNKNOWN→IMPURE 方向）", () => {
		const base = [
			mkChunk("a", [], ["b"]),
			mkChunk("b", [], ["c"]),
			mkChunk("c", ["io"]),
			mkChunk("u", [], [UNKNOWN_TARGET]),
			mkChunk("v", [], ["u"]),
			mkChunk("iso", []),
		];
		const grown = base.map((c) =>
			c.key === "c"
				? { ...c, direct: new Set([...c.direct, "fs", "db"]) }
				: c.key === "u"
					? { ...c, direct: new Set([...c.direct, "state"]) }
					: c,
		);
		const r1 = new Map(
			analyze(base).verdicts.map((v) => [v.chunk.key, v]),
		);
		const r2 = new Map(
			analyze(grown).verdicts.map((v) => [v.chunk.key, v]),
		);
		for (const k of r1.keys()) {
			const a = r1.get(k)!;
			const b = r2.get(k)!;
			expect(b.purity, `purity 单调 key=${k}`).toBeGreaterThanOrEqual(
				a.purity,
			);
			for (const e of a.effects)
				expect(b.effects.has(e), `effects 单调 key=${k} eff=${e}`).toBe(
					true,
				);
		}
		// 语义锚点：c 的调用者 a 从 IMPURE 保持 IMPURE；u 的调用者 v 从 UNKNOWN 升至 IMPURE
		expect(r2.get("a")!.purity).toBe(Purity.IMPURE);
		expect(r2.get("v")!.purity).toBe(Purity.IMPURE);
		expect(r2.get("v")!.purity).toBeGreaterThanOrEqual(
			r1.get("v")!.purity,
		);
	});

	it("调用边增长（含新增成环）→ purity/effects 单调不减", () => {
		const base = [mkChunk("x", [], ["y"]), mkChunk("y", ["io"]), mkChunk("z", [])];
		const plusEdge = [
			mkChunk("x", [], ["y", "z"]),
			mkChunk("y", ["io"]),
			mkChunk("z", []),
		];
		const plusCycle = [
			mkChunk("x", [], ["y"]),
			mkChunk("y", ["io"], ["x"]),
			mkChunk("z", [], ["y"]),
		];
		const snap = (cs: Chunk[]) =>
			new Map(analyze(cs).verdicts.map((v) => [v.chunk.key, v]));
		const a = snap(base);
		const b = snap(plusEdge);
		const c = snap(plusCycle);
		for (const k of a.keys()) {
			expect(b.get(k)!.purity).toBeGreaterThanOrEqual(a.get(k)!.purity);
			expect(c.get(k)!.purity).toBeGreaterThanOrEqual(b.get(k)!.purity);
			for (const e of a.get(k)!.effects)
				expect(b.get(k)!.effects.has(e)).toBe(true);
			for (const e of b.get(k)!.effects)
				expect(c.get(k)!.effects.has(e)).toBe(true);
		}
		// 新增成环后：x/y 同 SCC，效应并集——仍不反向
		expect(c.get("y")!.effects.has("io")).toBe(true);
		expect(c.get("x")!.effects.has("io")).toBe(true);
	});

	it("riskOfChange 随 Δ 增长单调（L×C 六因子不反向）", () => {
		const chunks = [
			mkChunk("a", [], ["b"], { file: "A.py" }),
			mkChunk("b", ["io"], [], { file: "B.py" }),
			mkChunk("c", [], [], { file: "C.py" }),
		];
		const { verdicts } = analyze(chunks);
		const r1 = riskOfChange(verdicts, new Set(["B.py"]));
		const r2 = riskOfChange(verdicts, new Set(["A.py", "B.py"]));
		const r3 = riskOfChange(verdicts, new Set(["A.py", "B.py", "C.py"]));
		expect(r1.risk).toBeGreaterThanOrEqual(0);
		expect(r2.risk).toBeGreaterThanOrEqual(r1.risk);
		expect(r3.risk).toBeGreaterThanOrEqual(r2.risk);
	});

	it("stateDeps 随新写者加入单调（只增不减）", () => {
		const snap = (cs: Chunk[]) =>
			new Map(analyze(cs).verdicts.map((v) => [v.chunk.key, v]));
		const r1 = snap([
			mkChunk("R", [], [], { stateReads: ["user.status", "user.name"] }),
			mkChunk("W1", ["state"], [], { stateWrites: ["user.status"] }),
		]);
		const r2 = snap([
			mkChunk("R", [], [], { stateReads: ["user.status", "user.name"] }),
			mkChunk("W1", ["state"], [], { stateWrites: ["user.status"] }),
			mkChunk("W2", ["state"], [], { stateWrites: ["user.name"] }),
		]);
		const d1 = r1.get("R")!.stateDeps;
		const d2 = r2.get("R")!.stateDeps;
		for (const d of d1) expect(d2.includes(d)).toBe(true);
		expect(d2.length).toBeGreaterThanOrEqual(d1.length);
	});
});

// ---------------------------------------------------------------------------
// law:edge-case —— 极端对象（终/始对象）必须有明确定义的像
// ---------------------------------------------------------------------------
describe("law:edge-case", () => {
	it("空图全家桶不崩溃且像有定义", () => {
		expect(analyze([])).toEqual({
			verdicts: [],
			cycleCount: 0,
			staleEdges: 0,
			invariantViolations: 0,
		});
		const g = graphMetrics([]);
		expect(g.nodes).toBe(0);
		expect(g.knownEdges).toBe(0);
		expect(g.density).toBe(0);
		expect(g.dagDepth).toBe(0);
		expect(riskOfChange([], new Set())).toMatchObject({
			risk: 0,
			grade: "low",
		});
		// 空 Δ 匹配空项目 → 有效；改动文件无 chunk 匹配 → invalid 哨兵（文档化）
		expect(riskOfChange([], new Set(["missing.py"]))).toMatchObject({
			risk: -1,
			grade: "invalid",
		});
		const p = proofCompleteness([]);
		expect(p.theta).toBe(1);
		expect(p.order).toEqual([]);
		expect(p.curve).toEqual([0]);
		expect(moduleSummary([])).toEqual([]);
		expect(stateCouplingOf([])).toEqual([]);
		expect(moduleGraph([])).toEqual({ nodes: [], edges: [], sccs: [] });
		expect(testCoverage([])).toMatchObject({
			production: 0,
			coverage: 0,
			uncovered: [],
		});
		expect(deadChunks([])).toEqual([]);
		expect(duplicateGroups([])).toEqual([]);
		expect(
			changedImpact([], new Set()).summary,
		).toMatchObject({
			changedFiles: 0,
			unmatchedFiles: 0,
			changedChunks: 0,
			affectedChunks: 0,
			maxDepth: 0,
		});
		expect(compareReports([], [])).toEqual([]);
		expect(annotationBudget([])).toEqual({
			influence: new Map(),
			deps: new Map(),
			released: new Map(),
		});
	});

	it("孤立节点：无出入边 → PURE / chain ∞ / chainCertain true", () => {
		const { verdicts } = analyze([
			mkChunk("iso", [], [], { stateReads: ["never.written"] }),
		]);
		const v = verdicts[0]!;
		expect(v.purity).toBe(Purity.PURE);
		expect(v.chain).toBe(Infinity);
		expect(v.chainCertain).toBe(true);
		expect(v.stateDeps).toEqual([]); // 无写者 → 无依赖
	});

	it("全纯端：单点无效应图 → 全 PURE；全不纯端：全直接效应 → 全 IMPURE chain=0", () => {
		const pure = analyze([
			mkChunk("p1"),
			mkChunk("p2", [], ["p1"]),
			mkChunk("p3", [], ["p2"]),
		]).verdicts;
		expect(pure.every((v) => v.purity === Purity.PURE)).toBe(true);
		expect(pure.every((v) => v.chain === Infinity)).toBe(true);

		const impure = analyze([
			mkChunk("i1", ["io"]),
			mkChunk("i2", ["state"]),
			mkChunk("i3", ["fs", "net"]),
		]).verdicts;
		expect(impure.every((v) => v.purity === Purity.IMPURE)).toBe(true);
		expect(impure.every((v) => v.chain === 0)).toBe(true);
	});

	it("悬垂调用目标 → UNKNOWN 且 staleEdges 计数（诚实不猜）", () => {
		const { verdicts, staleEdges } = analyze([
			mkChunk("a", [], ["ghost"]),
			mkChunk("b", [], ["a"]),
		]);
		expect(staleEdges).toBe(1);
		const a = verdicts.find((v) => v.chunk.key === "a")!;
		expect(a.purity).toBe(Purity.UNKNOWN);
		expect(a.chain).toBe(0); // audit 悲观：未知是链源
		expect(a.chainCertain).toBe(false);
		const b = verdicts.find((v) => v.chunk.key === "b")!;
		expect(b.purity).toBe(Purity.UNKNOWN);
	});

	it("tarjan 输出是输入节点的划分（边目标不在节点集 → 幽灵节点不入分量）", () => {
		const sccs = tarjan(["a"], new Map([["a", new Set(["ghost"])]]));
		expect(sccs.flat().sort()).toEqual(["a"]);
		// 混合：部分目标合法、部分幽灵——幽灵被忽略，合法边照常凝聚
		const mixed = tarjan(
			["a", "b"],
			new Map([
				["a", new Set(["b", "phantom"])],
				["b", new Set(["a"])],
			]),
		);
		expect(mixed.flat().sort()).toEqual(["a", "b"]);
		expect(mixed.length).toBe(1); // a↔b 仍是一个 SCC
	});

	it("空节点集 tarjan → 空划分", () => {
		expect(tarjan([], new Map())).toEqual([]);
	});
});
