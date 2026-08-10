import { type Chunk, Purity, type Verdict, UNKNOWN_TARGET } from "./types";
import { tarjan } from "./tarjan";
import { stateDepsOf } from "./state";

interface ModeResult {
  readonly effects: ReadonlySet<string>;
  readonly chain: number;
  readonly purity: Purity;
  /** 到效应源的最短路径（chunk key 数组，源在前；PURE 为空；audit 模式）。 */
  readonly chainPath: string[];
  /** 本 chunk 或其调用链可能抛出的异常类型（保守传播，含自身直接抛的）。 */
  readonly throwsTypes: readonly string[];
}

/**
 * 唯一的分析函数。
 * 公理2：先在凝聚 DAG 上传播；公理3：audit 模式下未知调用记为 "?" 效应。
 */
function runOnce(
  chunks: readonly Chunk[],
  audit: boolean,
): { res: Map<string, ModeResult>; inDeg: Map<string, number>; cycleCount: number; staleEdges: number } {
  const byKey = new Map<string, Chunk>();
  for (const c of chunks) byKey.set(c.key, c);

  const edges = new Map<string, Set<string>>();
  const hasUnknown = new Set<string>();
  let staleEdges = 0;
  for (const c of chunks) {
    const s = new Set<string>();
    for (const t of c.calls) {
      if (t === UNKNOWN_TARGET) hasUnknown.add(c.key);
      else if (byKey.has(t)) s.add(t);
      else { staleEdges++; hasUnknown.add(c.key); } // 悬垂目标（图中不存在）：按未知处理（S4 诚实），仍计数
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
  const prevComp: number[] = new Array(sccs.length).fill(-1); // 链上"上一跳"分量（-1 = 纯/无路径；自身 = 效应源）
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
      if (eff[k2]!.size > 0 && 1 + chain[k2]! < best) {
        best = 1 + chain[k2]!;
        prevComp[k] = k2; // 链路径记录：本分量的最近效应源经 k2
      }
    }
    eff[k] = e;
    chain[k] = best;
    if (e.size > 0 && prevComp[k] === -1) prevComp[k] = k; // 自身是效应源
  }

  // 异常传播（盲区1，保守：未捕获异常沿调用链向上）。方向安全减法（迭代7 ④）：
  // 本 chunk 的 catch（"*" 吞一切 / 精确类型）吞掉对应 throws——只减明确覆盖，内建层级/项目类型不减（多报不漏报）
  const throwsComp: Array<Set<string>> = [];
  for (let k = 0; k < sccs.length; k++) {
    const t = new Set<string>();
    for (const i of sccs[k]!) for (const x of byKey.get(i)!.thrownTypes) t.add(x);
    for (const k2 of succ[k]!) for (const x of throwsComp[k2]!) t.add(x);
    throwsComp[k] = t;
  }
  const coveredBy = (t: string, catches: readonly string[]): boolean =>
    catches.includes("*") || catches.includes(t);

  // chain 路径重构（audit 模式；用户需求可解释性 2026-08-11）：
  // 分量级路径 [源分量, ..., 本分量]（SCC 内同 chain 无跳），映射为 chunk key（分量取首个 chunk）
  const compKey = new Map<number, string>();
  sccs.forEach((s, k) => { for (const i of s) { compKey.set(k, i); break; } });
  const pathOf = (compIdx: number, chunkKey: string): string[] => {
    const keys: string[] = [];
    let cur = compIdx;
    const guard = new Set<number>();
    while (cur >= 0 && !guard.has(cur)) {
      const p = prevComp[cur];
      if (p === undefined || p === -1) break; // 纯/无路径
      guard.add(cur);
      // 本 chunk 所在分量末跳用真实 chunk key（SCC 内代表语义修正，迭代7 Med2）——
      // 分量中间跳用代表 key（分量内无跳）；长度不变（|path|-1 == chain 保持）
      keys.unshift(keys.length === 0 ? chunkKey : compKey.get(cur)!);
      if (p === cur) break; // 源分量
      cur = p;
    }
    return keys; // [源 chunk key, ..., 本 chunk key]
  };

  const res = new Map<string, ModeResult>();
  for (const c of chunks) {
    const k = comp.get(c.key)!;
    const real = new Set([...eff[k]!].filter((x) => x !== UNKNOWN_TARGET));
    const purity: Purity =
      real.size > 0
        ? Purity.IMPURE
        : eff[k]!.has(UNKNOWN_TARGET)
          ? Purity.UNKNOWN
          : Purity.PURE;
    res.set(c.key, {
      effects: real, chain: chain[k]!, purity,
      chainPath: purity === Purity.PURE ? [] : pathOf(k, c.key),
      // F2（迭代8）：本 chunk 自身抛过异常（含 catch 体内重抛）→ catch 不可信为"吞掉"，全部保留
      // （重抛使 callee 异常照样逃逸）；无自身 throw → 减 catch 覆盖（吞掉）
      throwsTypes: (c.thrownTypes.length > 0
        ? [...throwsComp[comp.get(c.key)!]!]
        : [...throwsComp[comp.get(c.key)!]!].filter((t) => !coveredBy(t, c.catches))
      ).sort(),
    });
  }
  const cycleCount = sccs.filter((s) => s.length > 1).length;
  return { res, inDeg, cycleCount, staleEdges };
}

export interface AnalyzeOutput {
  readonly verdicts: Verdict[];
  readonly cycleCount: number;
  /** 指向图中不存在目标的陈旧调用数。 */
  readonly staleEdges: number;
  /** 传播不变量违规数（0 = 边单调性 + 链三角全部成立）。 */
  readonly invariantViolations: number;
}

/**
 * 双模式运行，产出链长确定性与纯度判定。
 * chain 取 audit（悲观）值；chainCertain = 两遍结果一致。
 */
export function analyze(chunks: readonly Chunk[]): AnalyzeOutput {
  const audit = runOnce(chunks, true);
  const dev = runOnce(chunks, false);
  const stateDeps = stateDepsOf(chunks); // 读方传播（迭代8 视角2，纯元数据）

  const verdicts: Verdict[] = chunks.map((c) => {
    const a = audit.res.get(c.key)!;
    const d = dev.res.get(c.key)!;
    return {
      chunk: c,
      purity: a.purity,
      effects: a.effects,
      chain: a.chain,
      chainDev: d.chain,
      chainCertain: a.chain === d.chain,
      inDegree: audit.inDeg.get(c.key) ?? 0,
      outDegree: c.calls.size - (c.calls.has(UNKNOWN_TARGET) ? 1 : 0),
      chainPath: a.chainPath,
      throwsTypes: a.throwsTypes,
      stateDeps: stateDeps.get(c.key) ?? [],
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

  return {
    verdicts,
    cycleCount: audit.cycleCount,
    staleEdges: audit.staleEdges,
    invariantViolations: countInvariantViolations(verdicts, chunks),
  };
}

/**
 * 传播不变量机检（把公理变成可机检断言）：
 * ① 边单调性：purity(caller) ≥ purity(callee)（格序 PURE < UNKNOWN < IMPURE）——
 *    不纯 callee 必致不纯 caller，任何传播回归都会被抓住；
 * ② 链三角不等式：chain(caller) ≤ 1 + chain(callee)——最短路径性质。
 */
function countInvariantViolations(
  verdicts: readonly Verdict[],
  chunks: readonly Chunk[],
): number {
  const byKey = new Map<string, Chunk>();
  for (const c of chunks) byKey.set(c.key, c);
  const purity = new Map<string, number>();
  const chain = new Map<string, number>();
  for (const v of verdicts) {
    purity.set(v.chunk.key, v.purity);
    chain.set(v.chunk.key, v.chain);
  }
  let violations = 0;
  for (const v of verdicts) {
    const vp = purity.get(v.chunk.key)!;
    const vc = chain.get(v.chunk.key)!;
    for (const t of v.chunk.calls) {
      if (t === UNKNOWN_TARGET || !byKey.has(t)) continue;
      if (vp < purity.get(t)!) violations++;
      const tc = chain.get(t)!;
      if (vc !== Infinity && tc !== Infinity && vc > 1 + tc) violations++;
    }
  }
  return violations;
}
