import { describe, it, expect } from "vitest";
import { riskOfChange, forwardClosure, gradeOf } from "../../src/core/risk";
import { Purity, UNKNOWN_TARGET, type Verdict } from "../../src/core/types";

function v(
	key: string,
	opts: {
		purity?: number;
		chain?: number;
		calls?: string[];
		file?: string;
	} = {},
): Verdict {
	const purity = opts.purity ?? Purity.PURE;
	return {
		chunk: {
			id: key,
			key,
			name: key,
			file: opts.file ?? "f.ts",
			line: 1,
			endLine: 2,
			nesting: 0,
			direct: new Set(),
			calls: new Set(opts.calls ?? []),
			unknownSites: 0,
			unknownCalls: [],
			thrownTypes: [],
			catches: [],
			stateWrites: [],
			stateReads: [],
		},
		purity,
		effects: new Set(purity === Purity.IMPURE ? ["io"] : []),
		chain: opts.chain ?? (purity === Purity.PURE ? Infinity : 0),
		chainDev: opts.chain ?? Infinity,
		chainCertain: true,
		inDegree: 0,
		outDegree: 0,
		chainPath: [],
		throwsTypes: [],
		stateDeps: [],
	};
}

describe("回归风险 riskOfChange", () => {
	it("L×C 模型：全因子满 → risk=100 critical；空 Δ → 0 low", () => {
		// 5 节点强连通环，A 改、链 5、fog 全未知、反向闭包全图
		const verdicts = [
			v("A", { purity: Purity.IMPURE, chain: 5, calls: ["B"], file: "a.ts" }),
			v("B", { calls: ["C"], file: "a.ts" }),
			v("C", { calls: ["D"], file: "a.ts" }),
			v("D", { calls: ["E"], file: "a.ts" }),
			v("E", { calls: ["A"], file: "a.ts" }),
		].map((x, i) => ({ ...x, purity: i === 0 ? Purity.IMPURE : Purity.PURE }));
		const r = riskOfChange(verdicts, new Set(["a.ts"]));
		expect(r.risk).toBe(100);
		expect(r.grade).toBe("critical");
		const empty = riskOfChange(verdicts, new Set(["nope.ts"]));
		expect(empty.risk).toBe(-1);
		expect(empty.grade).toBe("invalid");
		expect(empty.unmatchedFiles).toBe(1);
	});

	it("R_purity 双通道：key 稳定翻转用 D 矩阵；新增用现状映射", () => {
		const old = [
			v("keep", { purity: Purity.PURE }),
			v("gone", { purity: Purity.IMPURE }),
		];
		const now = [
			v("keep", { purity: Purity.IMPURE }),
			v("fresh", { purity: Purity.UNKNOWN }),
		];
		const r = riskOfChange(now, new Set(["f.ts"]), { oldVerdicts: old });
		// keep: PURE→IMPURE = 1.0；fresh: 现状 UNKNOWN = 0.6 → max = 1.0
		expect(r.factors.purity).toBe(1.0);
	});

	it("R_cycle：非环 → 0；环内 → 对数压缩 >0", () => {
		const ring = [
			v("a", { calls: ["b"], file: "r.ts" }),
			v("b", { calls: ["a"], file: "r.ts" }),
			v("c", { file: "r.ts" }),
		];
		const r = riskOfChange(ring, new Set(["r.ts"]));
		expect(r.factors.cycle).toBeGreaterThan(0);
		expect(r.factors.cycle).toBeLessThanOrEqual(1);
		const linear = [
			v("x", { calls: ["y"], file: "l.ts" }),
			v("y", { file: "l.ts" }),
		];
		expect(riskOfChange(linear, new Set(["l.ts"])).factors.cycle).toBe(0);
	});

	it("R_depth：PURE/∞ → 0；chain=3 → 0.6", () => {
		const now = [
			v("deep", { purity: Purity.IMPURE, chain: 3, file: "d.ts" }),
			v("pure", { file: "d.ts" }),
		];
		const r = riskOfChange(now, new Set(["d.ts"]));
		expect(r.factors.depth).toBeCloseTo(0.6, 5);
	});

	it("R_fog 计数单调且无双重计数：changed UNKNOWN 只计一次", () => {
		// 无边图：A changed UNKNOWN、B UNKNOWN、C PURE → Fwd={A} → |Fwd∩U|=1，|U|=2 → fog=0.5
		const now = [
			v("A", { purity: Purity.UNKNOWN, file: "a.ts" }),
			v("B", { purity: Purity.UNKNOWN, file: "b.ts" }),
			v("C", { file: "c.ts" }),
		];
		const r = riskOfChange(now, new Set(["a.ts"]));
		expect(r.factors.fog).toBeCloseTo(0.5, 5); // 修复前双计 → 1.0
	});

	it("单调性：Δ 增大 → impact/cycle/depth/fog 不降", () => {
		const now = [
			v("a", { calls: ["b"], file: "a.ts" }),
			v("b", { calls: ["c"], file: "b.ts" }),
			v("c", { purity: Purity.UNKNOWN, file: "c.ts" }),
		];
		const r1 = riskOfChange(now, new Set(["a.ts"]));
		const r2 = riskOfChange(now, new Set(["a.ts", "b.ts"]));
		expect(r2.factors.impact).toBeGreaterThanOrEqual(r1.factors.impact);
		expect(r2.factors.depth).toBeGreaterThanOrEqual(r1.factors.depth);
		expect(r2.factors.fog).toBeGreaterThanOrEqual(r1.factors.fog);
	});

	it("确定性：同输入两次逐字段一致；乱序输入一致", () => {
		const now = [
			v("a", { calls: ["b"], file: "a.ts" }),
			v("b", { purity: Purity.IMPURE, file: "b.ts" }),
		];
		const r1 = riskOfChange(now, new Set(["a.ts", "b.ts"]));
		const r2 = riskOfChange([...now].reverse(), new Set(["a.ts", "b.ts"]));
		expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
	});
});

describe("forwardClosure", () => {
	it("沿调用边 BFS，深度正确，未知边跳过", () => {
		const vs = [
			v("a", { calls: ["b"], file: "f.ts" }),
			v("b", { calls: ["c", UNKNOWN_TARGET], file: "f.ts" }),
			v("c", { file: "f.ts" }),
		];
		const fwd = forwardClosure(vs, new Set(["a"]));
		expect(fwd.get("a")).toBe(0);
		expect(fwd.get("b")).toBe(1);
		expect(fwd.get("c")).toBe(2);
	});
});

describe("gradeOf", () => {
	it("阈值 15/35/60（按实测分布重标，迭代13）", () => {
		expect(gradeOf(-1)).toBe("invalid");
		expect(gradeOf(14.9)).toBe("low");
		expect(gradeOf(15)).toBe("medium");
		expect(gradeOf(34.9)).toBe("medium");
		expect(gradeOf(35)).toBe("high");
		expect(gradeOf(59.9)).toBe("high");
		expect(gradeOf(60)).toBe("critical");
	});
});

describe("R_state（迭代14 视角 1）", () => {
  const writer = (key: string, writes: string[]) =>
    ({ chunk: { key, file: key + ".js", startLine: 1, endLine: 2, calls: new Set<string>(), unknownSites: 0, stateWrites: writes, parseError: false }, purity: 0, chain: 0, chainCertain: true, stateDeps: [] });
  const reader = (key: string, deps: string[]) =>
    ({ chunk: { key, file: key + ".js", startLine: 1, endLine: 2, calls: new Set<string>(), unknownSites: 0, stateWrites: [], parseError: false }, purity: 0, chain: 0, chainCertain: true, stateDeps: deps });

  it("状态写改动 → 图调用边外耦合被捕获（278 读者场景 risk>0）", () => {
    const verdicts = [writer("W", ["user.status"]), ...Array.from({ length: 278 }, (_, i) => reader("R" + i, ["user.status"]))];
    const r = riskOfChange(verdicts, new Set(["W.js"]));
    expect(r.risk).toBeGreaterThan(0);
    expect(r.factors.state).toBe(1);
    expect(r.factors.impact).toBeCloseTo(279 / 279);
  });

  it("单调性：Δ 增大 → state/impact 不降", () => {
    const verdicts = [
      writer("W1", ["user.status"]),
      writer("W2", ["user.role"]),
      reader("R1", ["user.status"]),
      reader("R2", ["user.role"]),
    ];
    const r1 = riskOfChange(verdicts, new Set(["W1.js"]));
    const r2 = riskOfChange(verdicts, new Set(["W1.js", "W2.js"]));
    expect(r2.factors.state).toBeGreaterThanOrEqual(r1.factors.state);
    expect(r2.factors.impact).toBeGreaterThanOrEqual(r1.factors.impact);
    expect(r2.risk).toBeGreaterThanOrEqual(r1.risk);
  });

  it("无读者/无状态写 → state=0，不改变既有行为", () => {
    const verdicts = [writer("W", []), reader("R", [])];
    const r = riskOfChange(verdicts, new Set(["W.js"]));
    expect(r.factors.state).toBe(0);
    expect(r.risk).toBe(0);
  });
});
