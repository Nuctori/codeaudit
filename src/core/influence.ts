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
  // pred[k] = 直接 caller 分量集（与效应传播的 succ 反向）
  const pred: Array<Set<number>> = sccs.map(() => new Set<number>());
  sccs.forEach((s, k) => {
    for (const i of s)
      for (const t of edges.get(i)!)
        if (comp.get(t)! !== k) pred[comp.get(t)!]!.add(k);
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

  // 自上而下：caller 先（分量下标大 → 小）
  const S: Array<Set<number>> = sccs.map(() => new Set<number>());
  const inflByComp = new Map<number, number>();
  for (let k = sccs.length - 1; k >= 0; k--) {
    const set = new Set<number>();
    if (sourceOf.has(k)) set.add(k);
    for (const p of pred[k]!) for (const s of S[p]!) set.add(s);
    S[k] = set;
    // 本分量的每个未知源都影响本分量（SCC 内共享），且影响 S 传播到的下游
    if (sourceOf.has(k)) {
      inflByComp.set(k, (inflByComp.get(k) ?? 0) + sccs[k]!.length);
    }
    for (const s of set) {
      if (s !== k) inflByComp.set(s, (inflByComp.get(s) ?? 0) + sccs[k]!.length);
    }
  }

  const influence = new Map<string, number>();
  for (const [k, keys] of sourceOf) {
    const n = inflByComp.get(k) ?? 0;
    for (const key of keys) influence.set(key, n);
  }
  return influence;
}
