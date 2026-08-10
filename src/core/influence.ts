import { type Chunk, UNKNOWN_TARGET } from "./types";
import { tarjan } from "./tarjan";

/**
 * 影响面分析（--unknowns 标注优先级的数学形式）。
 *
 * 定义：S(w) = 可到达 w 的未知源（含 `?` 的 chunk）集；源 u 的影响面
 * I(u) = {w : u ∈ S(w)}（u 反向可达闭包内的 chunk 集，按 chunk 计数）。
 * 标注 u 释放所有满足 S(w) ⊆ R 的 w 的 UNKNOWN——u 的影响面越大，
 * 一次标注解除的 UNKNOWN 越多。
 *
 * 计算：Tarjan 凝聚 DAG 上沿 callee 方向单趟传播 Down[k]（k 的调用链
 * 下游中的未知源集；未知沿调用边 callee→caller 传导，k 的 UNKNOWN
 * 依赖其下游源）。与效应传播同序（callee 分量下标小、先处理）。
 */
export interface AnnotationBudget {
  /** 源 chunk key → 影响面（标注解除的 chunk 数）。 */
  readonly influence: Map<string, number>;
  /** chunk key → 依赖的源 chunk 数 |S(w)|（0/缺省 = 无未知依赖）。 */
  readonly deps: Map<string, number>;
  /** 源 chunk key → 它解除的 chunk key 列表（I(u) 桶，标注曲线用）。 */
  readonly released: Map<string, string[]>;
}

export function annotationBudget(chunks: readonly Chunk[]): AnnotationBudget {
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

  // 沿 succ（callee）方向传播 Down[k] = k 及其调用链下游中的未知源分量集。
  const Down: Array<Set<number>> = sccs.map(() => new Set<number>());
  const inflByComp = new Map<number, number>();
  const reachByComp = new Map<number, string[]>(); // 源分量 → 受影响的 chunk keys
  for (let k = 0; k < sccs.length; k++) {
    const set = new Set<number>();
    if (sourceOf.has(k)) set.add(k);
    for (const s2 of succ[k]!) for (const s of Down[s2]!) set.add(s);
    Down[k] = set;
    for (const s of set) {
      inflByComp.set(s, (inflByComp.get(s) ?? 0) + sccs[k]!.length);
      const arr = reachByComp.get(s) ?? [];
      for (const key of sccs[k]!) arr.push(key);
      reachByComp.set(s, arr);
    }
  }

  // deps[w] = 影响 w 的源 chunk 总数（|S(w)| 按源 chunk 计；标注需把每个源都标掉）
  const srcCount = new Map<number, number>();
  for (const [k, keys] of sourceOf) srcCount.set(k, keys.length);
  const deps = new Map<string, number>();
  for (const c of chunks) {
    let n = 0;
    for (const s of Down[comp.get(c.key)!]!) n += srcCount.get(s) ?? 0;
    if (n > 0) deps.set(c.key, n);
  }

  // released[u] = 标注源 u 解除的 chunk keys（分量内多个源共享同一桶）
  const released = new Map<string, string[]>();
  for (const [s, keys] of sourceOf) {
    const affected = reachByComp.get(s) ?? [];
    for (const u of keys) released.set(u, affected);
  }

  const influence = new Map<string, number>();
  for (const [k, keys] of sourceOf) {
    const n = inflByComp.get(k) ?? 0;
    for (const key of keys) influence.set(key, n);
  }
  return { influence, deps, released };
}

/** 影响面视图（--unknowns 排序用）：源 chunk key → 影响面。 */
export function influenceAnalysis(chunks: readonly Chunk[]): Map<string, number> {
  return annotationBudget(chunks).influence;
}

/**
 * 标注曲线：按给定顺序（源 key 列表）逐条标注，返回每个前缀后的剩余 UNKNOWN chunk 数。
 * 精确（非估计）：chunk w 在 S(w) ⊆ 已标注集时被释放；曲线[0] = 初始剩余，
 * 曲线[k] = 标注前 k 条后的剩余。标注顺序应取影响面贪心序（budget.influence 降序）。
 * target 限定计数对象（传当前 UNKNOWN chunk 集；缺省 = 全部有未知依赖的 chunk）。
 */
export function annotationCurve(
  budget: AnnotationBudget,
  order: readonly string[],
  target?: ReadonlySet<string>,
): number[] {
  const need = new Map(budget.deps);
  const counted = target ?? new Set(need.keys());
  let remaining = 0;
  for (const k of counted) if ((need.get(k) ?? 0) > 0) remaining++;
  const curve: number[] = [remaining];
  const annotated = new Set<string>();
  for (const u of order) {
    if (!annotated.has(u)) {
      annotated.add(u);
      for (const w of budget.released.get(u) ?? []) {
        if (!counted.has(w)) continue; // 目标之外的 chunk（IMPURE 带未知依赖）不计数
        const n = (need.get(w) ?? 0) - 1;
        need.set(w, n);
        if (n === 0) remaining--;
      }
    }
    curve.push(remaining);
  }
  return curve;
}
