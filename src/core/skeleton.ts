import type { Verdict } from "./types";
import { UNKNOWN_TARGET } from "./types";
import { tarjan } from "./tarjan";

/**
 * 迭代46 A：依赖骨架（dependencySkeleton）——凝聚 DAG 的传递约简。
 *
 * 数学（Aho-Garey-Ullman 1972）：DAG 的传递约简存在且唯一——删除可由路径推导的边，
 * 保可达性（最小依赖集）。骨架是**报告层**变换（揭示「模块真正直接依赖谁」），
 * 不进入判定通道：原始 verdicts 不可变，骨架边是纯派生集合。
 *
 * 规模：chunk 级朴素 O(V·E) 在 28K 图（8.6e8）不可行——本实现限定**分量级**
 * （SCC 凝聚后，83+ 分量近树毫秒级），恰是模块/文件决策的读者粒度。
 *
 * 实现：对凝聚 DAG 的每个源分量做 DFS，记录「深度 1 直接后继」；当某直接后继
 * 可通过另一路径（经其他直接后继）到达时，该边为传递冗余，从骨架删除。
 * 输出：[{ from, to }]（分量 key 对）——调用方映射回代表性 chunk key 或文件。
 */
export interface SkeletonEdge {
	readonly from: string; // 源分量代表 chunk key
	readonly to: string; // 目标分量代表 chunk key
}

/** 分量 → 代表性 chunk key（该分量内第一个 chunk）。 */
export function componentReps(verdicts: readonly Verdict[]): Map<number, string> {
	const edgeSet = new Map<string, ReadonlySet<string>>();
	const byKey = new Map(verdicts.map((v) => [v.chunk.key, v]));
	for (const v of verdicts) {
		edgeSet.set(
			v.chunk.key,
			new Set(
				[...v.chunk.calls].filter(
					(t) => t !== UNKNOWN_TARGET && t !== v.chunk.key && byKey.has(t),
				),
			),
		);
	}
	const comps = tarjan(
		verdicts.map((v) => v.chunk.key),
		edgeSet,
	);
	const reps = new Map<number, string>();
	comps.forEach((comp, c) => reps.set(c, comp[0]!));
	return reps;
}

/** 凝聚 DAG：分量 → 直接后继分量集（跨分量边，自环排除）。 */
function condensedDag(
	verdicts: readonly Verdict[],
): { compOf: Map<string, number>; succComp: number[][]; comps: string[][] } {
	const byKey = new Map(verdicts.map((v) => [v.chunk.key, v]));
	const edgeSet = new Map<string, ReadonlySet<string>>();
	for (const v of verdicts) {
		edgeSet.set(
			v.chunk.key,
			new Set(
				[...v.chunk.calls].filter(
					(t) => t !== UNKNOWN_TARGET && t !== v.chunk.key && byKey.has(t),
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
	const succComp: number[][] = comps.map(() => []);
	for (const v of verdicts) {
		const c = compOf.get(v.chunk.key)!;
		for (const t of v.chunk.calls) {
			if (t === UNKNOWN_TARGET || t === v.chunk.key) continue;
			const tc = compOf.get(t);
			if (tc !== undefined && tc !== c && !succComp[c]!.includes(tc))
				succComp[c]!.push(tc);
		}
	}
	return { compOf, succComp, comps };
}

/**
 * 凝聚 DAG 传递约简（迭代46 A）。返回骨架边（分量代表 key 对）。
 * 对每个源分量 c：直接后继 D = succComp[c]。边 c→d ∈ D 冗余 ⟺ d 可从另一直接
 * 后继 d' ≠ d 到达（d' →* d）。近树图 D 小（≤ 数），DFS 每源 O(Σ|reach|) 总毫秒级。
 */
export function dependencySkeleton(
	verdicts: readonly Verdict[],
): SkeletonEdge[] {
	const { compOf, succComp, comps } = condensedDag(verdicts);
	void compOf;
	const reps = componentReps(verdicts);
	const out: SkeletonEdge[] = [];

	// 可达性预计算（记忆化，DAG 后继下标更小 → 逆序已算）：reach[c] = c 的后代分量集
	const reach: Set<number>[] = comps.map(() => new Set());
	for (let c = 0; c < comps.length; c++) {
		for (const s of succComp[c]!) {
			reach[c]!.add(s);
			for (const r of reach[s]!) reach[c]!.add(r);
		}
	}

	for (let c = 0; c < comps.length; c++) {
		const from = reps.get(c)!;
		for (const d of succComp[c]!) {
			// 边 c→d 冗余 ⟺ ∃ 其他直接后继 d'：d ∈ reach[d']（d'→* d）
			let redundant = false;
			for (const d2 of succComp[c]!) {
				if (d2 === d) continue;
				if (reach[d2]!.has(d)) {
					redundant = true;
					break;
				}
			}
			if (!redundant) out.push({ from, to: reps.get(d)! });
		}
	}
	return out;
}

/**
 * 迭代46 桥：凝聚 DAG **无向化**上的桥边（删边即模块隔离）+ 割点分量。
 * 无向桥 = 唯一连通通道——「Framework ↔ SDK 只通过这一条边连接」的直接揭示。
 * 复用 tarjan 迭代设施：无向 DFS + low 判据（low[v] > tin[u] ⟺ 桥）。
 * 返回桥边（{from,to} 分量代表 key）与割点分量代表 key 列表。
 */
export interface BridgeResult {
	readonly bridges: SkeletonEdge[];
	readonly articulationPoints: string[];
}

export function bridgesOf(verdicts: readonly Verdict[]): BridgeResult {
	const { compOf, succComp, comps } = condensedDag(verdicts);
	void compOf;
	const reps = componentReps(verdicts);
	const n = comps.length;

	// 无向邻接（分量图，去重）
	const adj: number[][] = comps.map(() => []);
	for (let c = 0; c < n; c++)
		for (const s of succComp[c]!)
			if (!adj[c]!.includes(s)) {
				adj[c]!.push(s);
				adj[s]!.push(c);
			}

	const tin = new Array(n).fill(-1);
	const low = new Array(n).fill(-1);
	const bridges: SkeletonEdge[] = [];
	const articulation = new Set<number>();
	let timer = 0;

	const dfs = (u: number, parent: number): void => {
		tin[u] = low[u] = timer++;
		let children = 0;
		for (const w of adj[u]!) {
			if (w === parent) continue;
			if (tin[w] === -1) {
				children++;
				dfs(w, u);
				low[u] = Math.min(low[u]!, low[w]!);
				if (low[w]! > tin[u]!) {
					bridges.push({ from: reps.get(u)!, to: reps.get(w)! });
				}
				if (parent !== -1 && low[w]! >= tin[u]!) articulation.add(u);
			} else {
				low[u] = Math.min(low[u]!, tin[w]!);
			}
		}
		if (parent === -1 && children > 1) articulation.add(u);
	};

	for (let c = 0; c < n; c++) if (tin[c] === -1) dfs(c, -1);

	return {
		bridges,
		articulationPoints: [...articulation].map((c) => reps.get(c)!),
	};
}
