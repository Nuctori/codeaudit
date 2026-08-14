import type { Verdict } from "./types";
import { UNKNOWN_TARGET } from "./types";
import { tarjan } from "./tarjan";

/**
 * 拓扑健康度（迭代14 视角 3 实施；设计评审 CROSS-AUDIT.md 迭代12 拓扑 3 视角）。
 * 纯函数、verdicts 输入、不可变输出——与 riskOfChange / proofCompleteness 同构。
 * 边口径逐字复刻 analyze runOnce：? 跳过、悬垂跳过、自环计 selfLoopCount 但不计 density 分子。
 */
export interface GraphMetrics {
	readonly nodes: number; // n = verdicts.length
	/** Σ|{t ∈ calls : t≠?, t≠key, byKey.has(t)}|（自环/未知/悬垂全排除；calls 是 Set 无平行边重复）。 */
	readonly knownEdges: number;
	/** ΣunknownSites（F6；多重性口径，与 risk.ts evidence.missingSiteRate 分子同源——不构成与 knownEdges 的总量恒等，calls 的 ? 单槽 vs unknownSites 多重性）。 */
	readonly unknownEdges: number;
	/** F4：calls 含自身 key 的 chunk 数（现有 cycleCount 只计 |SCC|>1，自环是单点 SCC——盲区，单列覆盖）。 */
	/** F4：calls 含自身 key 的 chunk 数（现有 cycleCount 只计 |SCC|>1，自环是单点 SCC——盲区，单列覆盖）。 */
	readonly selfLoopCount: number;
	/** 回边数：u→v 且 u、v 同 SCC（每条同分量边都在某个环上——强连通 ⇒ v 可达 u 加上 u→v 成环）。
	 * 自环/族内边不计（selfLoopCount 单列）；DAG 上恒 0。 */
	readonly backEdges: number;
	/** 入度直方图：下标=入度 → chunk 数（自环/族内边不计；Σ i·h[i] = knownEdges 恒等式，h[0]=源节点数）。 */
	readonly inDegreeHistogram: readonly number[];
	/** 出度直方图（同口径；h[0]=汇节点数）。 */
	readonly outDegreeHistogram: readonly number[];
	/** SCC 大小>1 个数 === stats.cycles（同边口径，由构造保证）。 */
	readonly cyclicComponents: number;
	/** 迭代46 C：外部入边进入 >1 个不同节点的 SCC 数（多入口=纠缠递归，Hecht-Ullman 可规约性）。 */
	readonly multiEntryScc: number;
	/** 迭代46 C：SCC 外部入口数分布（入口数 → SCC 个数；单入口=结构化递归）。 */
	readonly sccEntryHistogram: readonly number[];
	/** 凝聚 DAG 最长路径（**边数口径**，与 chain=跳数一致；无跨分量边=0）。 */
	readonly dagDepth: number;
	/** knownEdges / (n·(n-1))，n<2 → 0（自环已从分子扣除）。 */
	readonly density: number;
	/** 层（源=0）按 chunk 计数；SCC 成员同层、孤立 chunk 层 0。 */
	readonly layerHistogram: readonly number[];
	/** 有限 chain 值 0..maxFinite 的桶计数（整数跳数）。 */
	readonly chainHistogram: readonly number[];
	/** chain === Infinity 单列桶（PURE 全落此列；输出天然纯 JSON，无 Infinity 值）。 */
	readonly chainInf: number;
	readonly evidence: {
		/** chainCertain=false 占比（与 risk.ts 同公式）。 */
		readonly unknownRate: number;
		/** chunk.parseError 占比（内容不可信 → 指标低估结构复杂度）。 */
		readonly parseErrorRate: number;
		/** ΣunknownSites / Σ(calls.size+unknownSites)。 */
		readonly missingSiteRate: number;
	};
}

export function graphMetrics(verdicts: readonly Verdict[]): GraphMetrics {
	const n = verdicts.length;
	const byKey = new Map(verdicts.map((v) => [v.chunk.key, v]));
	const idx = new Map<string, number>();
	verdicts.forEach((v, i) => idx.set(v.chunk.key, i));

	// 迭代52：同名族（重载/同名重定义）内部调用 = 自递归口径（C# 隐式 this 解析重载为
	// 并集边——安全方向的保守选择，但重载星形委托会被并集边自连成人工 SCC）。
	// 拓扑视图把族内边视作自环（不计入 knownEdges/SCC/入口），纯度传播不受影响。
	const fam = (v: Verdict): string | null => {
		const name = v.chunk.name;
		return typeof name === "string" && name.length > 0 ? name : null;
	};
	const sameFamily = (a: Verdict, b: Verdict): boolean => {
		const na = fam(a);
		return na !== null && na === fam(b);
	};

	// 边提取（口径复刻 analyze runOnce）：?/悬垂排除；自环单计
	let knownEdges = 0;
	let unknownEdges = 0;
	let selfLoopCount = 0;
	const succ: number[][] = verdicts.map(() => []);
	const inDeg = new Array<number>(n).fill(0);
	const outDeg = new Array<number>(n).fill(0);
	for (const v of verdicts) {
		unknownEdges += v.chunk.unknownSites;
		for (const t of v.chunk.calls) {
			if (t === UNKNOWN_TARGET) continue;
			const ti = idx.get(t);
			if (ti === undefined) continue;
			if (t === v.chunk.key || sameFamily(v, verdicts[ti]!)) {
				selfLoopCount++;
				continue;
			}
			succ[idx.get(v.chunk.key)!]!.push(ti);
			outDeg[idx.get(v.chunk.key)!]!++;
			inDeg[ti]!++;
			knownEdges++;
		}
	}

	// SCC + 凝聚 DAG（tarjan 契约：跨分量边 u→v ⇒ v 分量下标更小）
	const edgeSet = new Map<string, ReadonlySet<string>>();
	for (const v of verdicts) {
		edgeSet.set(
			v.chunk.key,
			new Set(
				[...v.chunk.calls].filter(
					(t) =>
						t !== UNKNOWN_TARGET &&
						t !== v.chunk.key &&
						(() => {
							const tv = byKey.get(t);
							return tv !== undefined && !sameFamily(v, tv);
						})(),
				),
			),
		);
	}
	const comps = tarjan(
		verdicts.map((v) => v.chunk.key),
		edgeSet,
	);
	const compOf = new Map<string, number>();
	comps.forEach((comp, c) => comp.forEach((k) => compOf.set(k, c)));
	const cyclicComponents = comps.filter((c) => c.length > 1).length;

	// 回边 = 同 SCC 成员间边（有向环的显式计数；跨分量边/DAG 边不计）
	let backEdges = 0;
	for (const v of verdicts) {
		const c = compOf.get(v.chunk.key)!;
		for (const t of v.chunk.calls) {
			if (t === UNKNOWN_TARGET || t === v.chunk.key) continue;
			const tv = byKey.get(t);
			if (tv === undefined || sameFamily(v, tv)) continue;
			if (compOf.get(t) === c) backEdges++;
		}
	}
	// 分量级边集 + 深度（逆拓扑：扫 0..c-1，后继分量下标更小 → 已算）
	const succComp: number[][] = comps.map(() => []);
	for (const v of verdicts) {
		const c = compOf.get(v.chunk.key)!;
		for (const t of v.chunk.calls) {
			if (t === UNKNOWN_TARGET || t === v.chunk.key) continue;
			const tv = byKey.get(t);
			if (tv === undefined || sameFamily(v, tv)) continue;
			const tc = compOf.get(t);
			if (tc !== undefined && tc !== c && !succComp[c]!.includes(tc))
				succComp[c]!.push(tc);
		}
	}
	const depth: number[] = comps.map(() => 0);
	let dagDepth = 0;
	for (let c = 0; c < comps.length; c++) {
		if (succComp[c]!.length === 0) continue;
		let d = 0;
		for (const s of succComp[c]!) d = Math.max(d, depth[s]!);
		depth[c] = 1 + d;
		if (depth[c]! > dagDepth) dagDepth = depth[c]!;
	}

	// 层直方图（源=0；倒扫：caller 分量下标 > callee）
	const predComp: number[][] = comps.map(() => []);
	for (let c = 0; c < comps.length; c++)
		for (const s of succComp[c]!) predComp[s]!.push(c);
	const level: number[] = comps.map(() => 0);
	for (let c = comps.length - 1; c >= 0; c--) {
		if (predComp[c]!.length === 0) continue;
		let l = 0;
		for (const p of predComp[c]!) l = Math.max(l, level[p]!);
		level[c] = 1 + l;
	}
	const layerHistogram: number[] = [];
	for (const v of verdicts) {
		const l = level[compOf.get(v.chunk.key)!]!;
		layerHistogram[l] = (layerHistogram[l] ?? 0) + 1;
	}

	// chain 直方图（∞ 单列桶）
	let maxFinite = 0;
	for (const v of verdicts)
		if (v.chain !== Infinity && v.chain > maxFinite) maxFinite = v.chain;
	const chainHistogram: number[] = new Array(maxFinite + 1).fill(0);
	let chainInf = 0;
	for (const v of verdicts) {
		if (v.chain === Infinity) chainInf++;
		else chainHistogram[v.chain]!++;
	}

	const density = n > 1 ? knownEdges / (n * (n - 1)) : 0;

	// 出入度直方图（Σ i·h[i] = knownEdges 恒等式——与边提取同口径）
	const inDegreeHistogram: number[] = [];
	const outDegreeHistogram: number[] = [];
	for (let i = 0; i < n; i++) {
		inDegreeHistogram[inDeg[i]!] = (inDegreeHistogram[inDeg[i]!] ?? 0) + 1;
		outDegreeHistogram[outDeg[i]!] = (outDegreeHistogram[outDeg[i]!] ?? 0) + 1;
	}

	// 迭代46 C：SCC 外部入口数（可规约性——Hecht-Ullman：单入口=结构化递归，多入口=纠缠递归）。
	// 入口 = 来自其他分量的边进入该 SCC 的**不同目标节点**数（跨分量边终点；自环/内部边不计）。
	// 只统计真 SCC（>1，与 cyclicComponents 同口径）；孤立递归团（无外部入口）落入口 0 桶。
	const sccEntry = new Map<number, Set<string>>();
	for (const v of verdicts) {
		const c = compOf.get(v.chunk.key)!;
		for (const t of v.chunk.calls) {
			if (t === UNKNOWN_TARGET || t === v.chunk.key) continue;
			const tv = byKey.get(t);
			if (tv === undefined || sameFamily(v, tv)) continue;
			const tc = compOf.get(t);
			if (tc === undefined || tc === c) continue;
			let s = sccEntry.get(tc);
			if (!s) {
				s = new Set();
				sccEntry.set(tc, s);
			}
			s.add(t); // 被进入分量内的目标节点（跨分量边终点）
		}
	}
	let multiEntryScc = 0;
	const sccEntryHistogram: number[] = [];
	for (let c = 0; c < comps.length; c++) {
		if (comps[c]!.length <= 1) continue; // 只统计真 SCC（>1），与 cyclicComponents 同口径
		const entryCount = sccEntry.get(c)?.size ?? 0; // 无外部入口的递归团 = 0
		sccEntryHistogram[entryCount] = (sccEntryHistogram[entryCount] ?? 0) + 1;
		if (entryCount > 1) multiEntryScc++;
	}

	const uncertain = verdicts.filter((v) => !v.chainCertain).length;
	const parseErr = verdicts.filter((v) => v.chunk.parseError).length;
	let totalSites = 0;
	for (const v of verdicts)
		totalSites += v.chunk.calls.size + v.chunk.unknownSites;

	return {
		nodes: n,
		knownEdges,
		unknownEdges,
		selfLoopCount,
		backEdges,
		inDegreeHistogram,
		outDegreeHistogram,
		cyclicComponents,
		multiEntryScc,
		sccEntryHistogram,
		dagDepth,
		density,
		layerHistogram,
		chainHistogram,
		chainInf,
		evidence: {
			unknownRate: n > 0 ? uncertain / n : 0,
			parseErrorRate: n > 0 ? parseErr / n : 0,
			missingSiteRate: totalSites > 0 ? unknownEdges / totalSites : 0,
		},
	};
}
