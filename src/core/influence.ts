import { type Chunk, UNKNOWN_TARGET } from "./types";
import { tarjan } from "./tarjan";

/**
 * 影响面分析（--unknowns 标注优先级的数学形式）。
 *
 * 定义：S(w) = 可到达 w 的未知源（含 `?` 的 chunk）集；源 u 的影响面
 * I(u) = {w : u ∈ S(w)}（u 反向可达闭包内的 chunk 集，按 chunk 计数）。
 * 标注 u 释放所有满足 S(w) ⊆ R 的 w 的 UNKNOWN——u 的影响面越大，
 * 一次标注解除的 UNKNOWN 越多（这正是"被 300 个 caller 引用 vs 3 个"的
 * 精确形式：|I(u)| 是反向可达闭包，不是 1 跳扇入）。
 *
 * 计算：Tarjan 凝聚 DAG 上自上而下单趟（caller 分量下标大于 callee，
 * 逆拓扑序处理 k 从大到小），S 集用分量编号的并集传播。
 */
export function influenceAnalysis(chunks: readonly Chunk[]): Map<string, number> {
  const byKey = new Map(chunks.map((c) => [c.key, c]));
  const edges = new Map<string, Set<string>>();
  for (const c of chunks) {
    const s = new Set<string>();
    for (const t of c.calls) if (t !== UNKNOWN_TARGET && byKey.has(t)) s.add(t);
    edges.set(c.key, s);
  }

  // 逆拓扑：callee 分量下标更小（tarjan 契约）
  const sccs = tarjan(byKey.keys(), edges);
  const comp = new Map<string, number>();
  sccs.forEach((s, k) => s.forEach((i) => comp.set(i, k)));
  // succ[k] = 直接 callee 分量集（与效应传播同向）
  const succ: Array<Set<number>> = sccs.map(() => new Set<number>());
  sccs.forEach((s, k) => {
    for (const i of s)
      for (const t of edges.get(i)!)
        if (comp.get(t)! !== k) succ[k]!.add(comp.get(t)!);
  });

  const sourceOf = new Map<number, string[]>(); // 分量 → 含 `?` 的 chunk key 列表
  for (const c of chunks) {
    if (c.calls.has(UNKNOWN_TARGET)) {
      const k = comp.get(c.key)!;
      const arr = sourceOf.get(k) ?? [];
      arr.push(c.key);
      sourceOf.set(k, arr);
    }
  }

  // 沿 succ（callee）方向传播：Down[k] = k 及其调用链下游（callee 子孙）中的未知源集。
  // 语义：未知从源沿调用边 callee→caller 传导，故 chunk k 的 UNKNOWN 依赖其下游源 u；
  // 标注 u 释放的 chunk = {k : u ∈ Down[k]}（k 是 u 的祖先/调用方）。
  // 与效应传播同序（callee 分量下标小、先处理），逆拓扑单趟即收敛。
  const Down: Array<Set<number>> = sccs.map(() => new Set<number>());
  const inflByComp = new Map<number, number>();
  for (let k = 0; k < sccs.length; k++) {
    const set = new Set<number>();
    if (sourceOf.has(k)) set.add(k);
    for (const s2 of succ[k]!) for (const s of Down[s2]!) set.add(s);
    Down[k] = set;
    // k ∈ I(u)：u 的下游之一，标注 u 会释放 k（SCC 内共享）
    for (const s of set) inflByComp.set(s, (inflByComp.get(s) ?? 0) + sccs[k]!.length);
  }

  const influence = new Map<string, number>();
  for (const [k, keys] of sourceOf) {
    const n = inflByComp.get(k) ?? 0;
    for (const key of keys) influence.set(key, n);
  }
  return influence;
}
