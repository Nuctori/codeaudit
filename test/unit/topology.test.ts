import { describe, expect, it } from "vitest";
import { graphMetrics, reverseDepCounts } from "../../src/core/topology";
import { scanProject } from "../../src/index";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Verdict } from "../../src/core/types";

/** fixture：构造 Verdict（risk.test.ts v() 同款最小形状；迭代52 加 name 可选——同名族测试）。 */
function v(
	key: string,
	opts: {
		calls?: string[];
		chain?: number;
		chainCertain?: boolean;
		purity?: number;
		unknownSites?: number;
		name?: string;
	} = {},
): Verdict {
	return {
		chunk: {
			key,
			file: `${key}.js`,
			startLine: 1,
			endLine: 2,
			calls: new Set(opts.calls ?? []),
			unknownSites: opts.unknownSites ?? 0,
			stateWrites: [],
			parseError: false,
			...(opts.name !== undefined ? { name: opts.name } : {}),
		},
		purity: opts.purity ?? 0,
		chain: opts.chain ?? 0,
		chainCertain: opts.chainCertain ?? true,
		stateDeps: [],
	} as unknown as Verdict;
}

describe("graphMetrics（迭代14 视角 3 实施）", () => {
	it("自环 F4：selfLoopCount 单列，不进 density/cycles", () => {
		const m = graphMetrics([v("A", { calls: ["A"] })]);
		expect(m.selfLoopCount).toBe(1);
		expect(m.cyclicComponents).toBe(0);
		expect(m.density).toBe(0);
		expect(m.knownEdges).toBe(0);
	});

	it("链树 A→B→C→D：density/dagDepth/层", () => {
		const m = graphMetrics([
			v("A", { calls: ["B"] }),
			v("B", { calls: ["C"] }),
			v("C", { calls: ["D"] }),
			v("D"),
		]);
		expect(m.cyclicComponents).toBe(0);
		expect(m.density).toBeCloseTo(3 / 12);
		expect(m.dagDepth).toBe(3);
		expect(m.layerHistogram).toEqual([1, 1, 1, 1]);
	});

	it("完全图：density=1，单 SCC，dagDepth=0", () => {
		const m = graphMetrics([
			v("A", { calls: ["B", "C", "D"] }),
			v("B", { calls: ["A", "C", "D"] }),
			v("C", { calls: ["A", "B", "D"] }),
			v("D", { calls: ["A", "B", "C"] }),
		]);
		expect(m.density).toBe(1);
		expect(m.cyclicComponents).toBe(1);
		expect(m.dagDepth).toBe(0);
	});

	it("unknownEdges 多重性 + ? 排除 knownEdges", () => {
		const m = graphMetrics([
			v("A", { calls: ["B", "?"], unknownSites: 2 }),
			v("B"),
		]);
		expect(m.knownEdges).toBe(1);
		expect(m.unknownEdges).toBe(2);
	});

	it("悬垂边不计（runOnce stale 口径）", () => {
		const m = graphMetrics([v("A", { calls: ["ghost"] })]);
		expect(m.knownEdges).toBe(0);
		expect(m.cyclicComponents).toBe(0);
	});

	it("chainHistogram：∞ 单列桶，输出纯 JSON", () => {
		const m = graphMetrics([
			v("P", { purity: 3, chain: Infinity }),
			v("X", { chain: 2 }),
			v("Y", { chain: 0 }),
		]);
		expect(m.chainInf).toBe(1);
		expect(m.chainHistogram).toEqual([1, 0, 1]);
		expect(JSON.stringify(m)).not.toContain("Infinity");
	});

	it("与 stats.cycles 一致性对拍（真实 scan）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "topo-"));
		writeFileSync(
			join(dir, "a.js"),
			"module.exports = function a() { return b(); };\nmodule.exports.b = function b() { return a(); };\n",
		);
		const r = await scanProject(dir, { useCache: false });
		const m = graphMetrics(r.verdicts);
		expect(m.cyclicComponents).toBe(r.stats.cycles);
		expect(m.selfLoopCount).toBe(0);
		// evidence 与 risk.ts 同源口径（迭代15 视角 5 发现 F）
		expect(m.evidence.unknownRate).toBeGreaterThanOrEqual(0);
		expect(m.evidence.unknownRate).toBeLessThanOrEqual(1);
		expect(m.evidence.missingSiteRate).toBeGreaterThanOrEqual(0);
		expect(m.evidence.parseErrorRate).toBeGreaterThanOrEqual(0);
		rmSync(dir, { recursive: true, force: true });
	});

	it("随机 DAG 对拍：dagDepth === 朴素 DFS 最长路径", () => {
		const rng = (seed: number) => () => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		for (let t = 0; t < 100; t++) {
			const r = rng(t + 1);
			const nNodes = 3 + Math.floor(r() * 8);
			const calls = new Map<string, string[]>();
			for (let i = 0; i < nNodes; i++) {
				const key = `N${i}`;
				const out: string[] = [];
				for (let j = i + 1; j < nNodes; j++) if (r() < 0.4) out.push(`N${j}`);
				calls.set(key, out);
			}
			const verdicts = [...calls.entries()].map(([key, c]) =>
				v(key, { calls: c }),
			);
			const m = graphMetrics(verdicts);
			// 朴素 DFS 最长路径（边数）
			const memo = new Map<string, number>();
			const dfs = (k: string): number => {
				if (memo.has(k)) return memo.get(k)!;
				let best = 0;
				for (const s of calls.get(k)!) best = Math.max(best, 1 + dfs(s));
				memo.set(k, best);
				return best;
			};
			let expected = 0;
			for (const k of calls.keys()) expected = Math.max(expected, dfs(k));
			expect(m.dagDepth).toBe(expected);
			expect(m.cyclicComponents).toBe(0);
		}
	});

	it("迭代46 C：SCC 外部入口——单入口（结构化递归）=0 多入口、多入口（纠缠）=1", () => {
		// 单入口 SCC：X→A、A↔B（环）、C 不入环——外部入边只进 A
		const m1 = graphMetrics([
			v("X", { calls: ["A"] }),
			v("A", { calls: ["B"] }),
			v("B", { calls: ["A"] }),
		]);
		expect(m1.cyclicComponents).toBe(1);
		expect(m1.multiEntryScc).toBe(0);
		expect(m1.sccEntryHistogram[1]).toBe(1); // 入口 1 桶

		// 多入口 SCC：X→A、Y→B、A↔B——外部入边进 A 与 B 两个不同节点
		const m2 = graphMetrics([
			v("X", { calls: ["A"] }),
			v("Y", { calls: ["B"] }),
			v("A", { calls: ["B"] }),
			v("B", { calls: ["A"] }),
		]);
		expect(m2.cyclicComponents).toBe(1);
		expect(m2.multiEntryScc).toBe(1);
		expect(m2.sccEntryHistogram[2]).toBe(1);
	});

	it("迭代46 C：自环/链不误计，孤立递归团入口 0 桶", () => {
		const m = graphMetrics([
			v("A", { calls: ["A"] }), // 自环单点（非真 SCC>1，不计）
			v("B", { calls: ["C"] }),
			v("C", { calls: ["B"] }), // 无外部入口的递归团
		]);
		expect(m.cyclicComponents).toBe(1); // B↔C
		expect(m.multiEntryScc).toBe(0);
		expect(m.sccEntryHistogram[0]).toBe(1); // B↔C 无外部入口
	});

	it("迭代52：同名族（重载星形）内部互调 = 自环口径，不构成 SCC", () => {
		// C# 隐式 this 重载解析为并集边：Foo() 调 Foo(x)/Foo(x,y) 等——限定名相同 → 族内边。
		const m = graphMetrics([
			v("C.Foo#1", { calls: ["C.Foo#2", "C.Foo#3"], name: "C.Foo" }),
			v("C.Foo#2", { calls: ["C.Foo#1", "C.Foo#3"], name: "C.Foo" }),
			v("C.Foo#3", { calls: ["C.Foo#1", "C.Foo#2"], name: "C.Foo" }),
		]);
		expect(m.cyclicComponents).toBe(0); // 重载星形不是纠缠递归
		expect(m.selfLoopCount).toBe(6); // 6 条族内边全部自环口径
		expect(m.knownEdges).toBe(0);
		expect(m.multiEntryScc).toBe(0);
	});

	it("迭代52：同名族过滤不影响真实环（限定名不同才过滤）", () => {
		const m = graphMetrics([
			v("A.bar", { calls: ["B.baz"], name: "A.bar" }),
			v("B.baz", { calls: ["A.bar"], name: "B.baz" }),
			v("C.Foo#1", { calls: ["C.Foo#2"], name: "C.Foo" }),
			v("C.Foo#2", { calls: ["C.Foo#1", "C.Foo#3"], name: "C.Foo" }),
			v("C.Foo#3", { calls: ["C.Foo#1"], name: "C.Foo" }),
		]);
		expect(m.cyclicComponents).toBe(1); // A.bar ↔ B.baz 仍计数
		expect(m.multiEntryScc).toBe(0);
		expect(m.selfLoopCount).toBe(4); // C.Foo 族内 4 边
	});

	it("迭代52：真实多入口纠缠环不受同名族过滤影响", () => {
		const m = graphMetrics([
			v("X.hit", { calls: ["A.bar"], name: "X.hit" }),
			v("Y.hit", { calls: ["B.baz"], name: "Y.hit" }),
			v("A.bar", { calls: ["B.baz"], name: "A.bar" }),
			v("B.baz", { calls: ["A.bar"], name: "B.baz" }),
			v("C.Foo#1", { calls: ["C.Foo#2"], name: "C.Foo" }),
			v("C.Foo#2", { calls: ["C.Foo#1", "C.Foo#3"], name: "C.Foo" }),
			v("C.Foo#3", { calls: ["C.Foo#1"], name: "C.Foo" }),
		]);
		expect(m.cyclicComponents).toBe(1); // A.bar ↔ B.baz
		expect(m.cyclicComponents).toBe(1); // A.bar ↔ B.baz
		expect(m.multiEntryScc).toBe(1); // X/Y 两入口仍纠缠
		expect(m.sccEntryHistogram[2]).toBe(1);
	});

	it("迭代55：有向指标——出入度直方图 + 回边（同 SCC 内边）", () => {
		// 边：A→B, A→C, B→C, B→D, C→B, X→A（6 条）；SCC：{B,C}（B↔C）、{A}、{D}、{X}
		const m = graphMetrics([
			v("A", { calls: ["B", "C"] }),
			v("B", { calls: ["C", "D"] }),
			v("C", { calls: ["B"] }),
			v("D"),
			v("X", { calls: ["A"] }),
		]);
		expect(m.cyclicComponents).toBe(1); // B↔C
		expect(m.backEdges).toBe(2); // B→C、C→B 同分量
		expect(m.inDegreeHistogram).toEqual([1, 2, 2]); // X 入度 0；A/D 入度 1；B/C 入度 2
		expect(m.outDegreeHistogram).toEqual([1, 2, 2]); // D 出度 0；C/X 出度 1；A/B 出度 2
		// 恒等式：Σ i·h[i] = knownEdges（与边提取同口径）
		const sum = (h: readonly number[]): number =>
			h.reduce((a, c, i) => a + c * i, 0);
		expect(sum(m.inDegreeHistogram)).toBe(m.knownEdges);
		expect(sum(m.outDegreeHistogram)).toBe(m.knownEdges);
	});

	it("迭代55：DAG 链无回边，源/汇各 1", () => {
		const m = graphMetrics([
			v("A", { calls: ["B"] }),
			v("B", { calls: ["C"] }),
			v("C", { calls: ["D"] }),
			v("D"),
		]);
		expect(m.backEdges).toBe(0);
		expect(m.inDegreeHistogram[0]).toBe(1); // A 源
		expect(m.outDegreeHistogram[0]).toBe(1); // D 汇
	});

	it("迭代55-r9（reviewer Medium-1）：恶意 chain 防御——非整数/超大值不崩溃", () => {
		// chain: 2.5 曾使 new Array(3.5) 抛 RangeError；1e9 曾 V8 堆耗尽不可捕获 OOM
		// （recheck 第三方 JSON 351B 即可触发——loadReport 已挡，库 API 直调由此处兜底）
		const m = graphMetrics([
			v("A", { chain: 2.5 }), // 非整数：不计入任何桶
			v("B", { chain: 1e9 }), // 超上限：折叠到 65536 桶
			v("C", { chain: Infinity }),
			v("D", { chain: 3 }), // 正常链长
		]);
		expect(m.chainInf).toBe(1);
		expect(m.chainHistogram.length).toBe(65537); // maxFinite 封顶 65536
		expect(m.chainHistogram[65536]).toBe(1); // 超限折叠
		expect(m.chainHistogram[3]).toBe(1); // 正常链不受影响
		expect(m.chainHistogram.reduce((a, b) => a + b, 0)).toBe(2); // 非整数不计
	});

	it("迭代55：逆向依赖边（与主方向相反的路径）——环内边+自环计数，DAG 恒 0", () => {
		// A↔B 环：A→B、B→A 均同 SCC 内边（B→A 即与主方向相反的路径）；C 自环；D→E 链不计
		const verdicts = [
			v("A", { calls: ["B"] }),
			v("B", { calls: ["A"] }), // A↔B 环
			v("C", { calls: ["C"] }), // 自环
			v("D", { calls: ["E"] }),
			v("E"),
		];
		const rev = reverseDepCounts(verdicts);
		expect(rev.get("A")).toBe(1); // A→B 同 SCC
		expect(rev.get("B")).toBe(1); // B→A 同 SCC（反向路径）
		expect(rev.get("C")).toBe(1); // 自环
		expect(rev.get("D")).toBeUndefined(); // D→E 正向
		expect(rev.get("E")).toBeUndefined();
		// 全局口径一致：Σ per-chunk = backEdges + selfLoopCount
		const m = graphMetrics(verdicts);
		const sum = [...rev.values()].reduce((a, b) => a + b, 0);
		expect(sum).toBe(m.backEdges + m.selfLoopCount); // 2 + 1
	});

	describe("graphMetrics 同名族（迭代52）", () => {
		it("无 name 的旧 fixture 行为不变（无过滤）", () => {
			const m = graphMetrics([
				v("A", { calls: ["B"] }),
				v("B", { calls: ["A"] }),
			]);
			expect(m.cyclicComponents).toBe(1); // 无 name → 按 key 全量成环（旧口径）
		});
	});
});
