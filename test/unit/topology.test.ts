import { describe, expect, it } from "vitest";
import { graphMetrics } from "../../src/core/topology";
import { scanProject } from "../../src/index";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Verdict } from "../../src/core/types";

/** fixture：构造 Verdict（risk.test.ts v() 同款最小形状）。 */
function v(
	key: string,
	opts: {
		calls?: string[];
		chain?: number;
		chainCertain?: boolean;
		purity?: number;
		unknownSites?: number;
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
});
