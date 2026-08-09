import { Chunk, Purity, Verdict, UNKNOWN_TARGET } from "./types";
import { tarjan } from "./tarjan";

interface ModeResult {
  readonly effects: ReadonlySet<string>;
  readonly chain: number;
  readonly purity: Purity;
}

/**
 * 唯一的分析函数。
 * 公理2：先在凝聚 DAG 上传播；公理3：audit 模式下未知调用记为 "?" 效应。
 */
function runOnce(
  chunks: readonly Chunk[],
  audit: boolean,
): { res: Map<string, ModeResult>; inDeg: Map<string, number>; cycleCount: number } {
  const byKey = new Map<string, Chunk>();
  for (const c of chunks) byKey.set(c.key, c);

  const edges = new Map<string, Set<string>>();
  const hasUnknown = new Set<string>();
  for (const c of chunks) {
    const s = new Set<string>();
    for (const t of c.calls) {
      if (t === UNKNOWN_TARGET) hasUnknown.add(c.key);
      else if (byKey.has(t)) s.add(t);
    }
    edges.set(c.key, s);
  }

  const inDeg = new Map<string, number>();
  for (const k of byKey.keys()) inDeg.set(k, 0);
  for (const s of edges.values())
    for (const t of s) inDeg.set(t, (inDeg.get(t) ?? 0) + 1);

  // 凝聚：sccs 逆拓扑序（后继分量下标更小）
  const sccs = tarjan(byKey.keys(), edges);
  const comp = new Map<string, number>();
  sccs.forEach((s, k) => s.forEach((i) => comp.set(i, k)));
  const succ: Array<Set<number>> = sccs.map(() => new Set<number>());
  sccs.forEach((s, k) => {
    for (const i of s)
      for (const t of edges.get(i)!)
        if (comp.get(t)! !== k) succ[k]!.add(comp.get(t)!);
  });

  const eff: Array<Set<string>> = [];
  const chain: number[] = [];
  for (let k = 0; k < sccs.length; k++) {
    const e = new Set<string>();
    for (const i of sccs[k]!) {
      for (const d of byKey.get(i)!.direct) e.add(d);
    }
    // 公理3：audit 模式未知倒向不纯，"?" 同样构成效应源
    if (audit && sccs[k]!.some((i) => hasUnknown.has(i))) e.add(UNKNOWN_TARGET);
    let best = e.size > 0 ? 0 : Infinity;
    for (const k2 of succ[k]!) {
      for (const d of eff[k2]!) e.add(d);
      if (eff[k2]!.size > 0 && 1 + chain[k2]! < best) best = 1 + chain[k2]!;
    }
    eff[k] = e;
    chain[k] = best;
  }

  const res = new Map<string, ModeResult>();
  for (const c of chunks) {
    const k = comp.get(c.key)!;
    const real = new Set([...eff[k]!].filter((x) => x !== UNKNOWN_TARGET));
    const purity: Purity =
      real.size > 0
        ? Purity.IMPURE
        : eff[k]!.has(UNKNOWN_TARGET) || hasUnknown.has(c.key)
          ? Purity.UNKNOWN
          : Purity.PURE;
    res.set(c.key, { effects: real, chain: chain[k]!, purity });
  }
  const cycleCount = sccs.filter((s) => s.length > 1).length;
  return { res, inDeg, cycleCount };
}

export interface AnalyzeOutput {
  readonly verdicts: Verdict[];
  readonly cycleCount: number;
}

/**
 * 双模式运行，产出链长确定性与纯度判定。
 * chain 取 audit（悲观）值；chainCertain = 两遍结果一致。
 */
export function analyze(chunks: readonly Chunk[]): AnalyzeOutput {
  const audit = runOnce(chunks, true);
  const dev = runOnce(chunks, false);

  const verdicts: Verdict[] = chunks.map((c) => {
    const a = audit.res.get(c.key)!;
    const d = dev.res.get(c.key)!;
    return {
      chunk: c,
      purity: a.purity,
      effects: a.effects,
      chain: a.chain,
      chainCertain: a.chain === d.chain,
      inDegree: audit.inDeg.get(c.key) ?? 0,
      outDegree: c.calls.size - (c.calls.has(UNKNOWN_TARGET) ? 1 : 0),
    };
  });

  // 公理5：字典序。IMPURE 在前；藏得深（chain 大）在前；再按嵌套、key。
  verdicts.sort((x, y) => {
    if (x.purity !== y.purity) return y.purity - x.purity;
    const cx = x.chain === Infinity ? -1 : x.chain;
    const cy = y.chain === Infinity ? -1 : y.chain;
    if (cx !== cy) return cy - cx;
    if (x.chunk.nesting !== y.chunk.nesting) return y.chunk.nesting - x.chunk.nesting;
    return x.chunk.key < y.chunk.key ? -1 : x.chunk.key > y.chunk.key ? 1 : 0;
  });

  return { verdicts, cycleCount: audit.cycleCount };
}
