import { type Verdict, Purity } from "./types";
import { annotationBudget, annotationCurve } from "./influence";
import { forwardClosure } from "./risk";

/**
 * 证明完整度（用户核心目标：把审计工具变成可验证代码库基础设施的会计层）。
 * 裁决（数学家评审 2026-08-11）：Θ/MPS 是现有标注闭环（annotationBudget/Curve）的**派生报告层**，
 * 非新数学——Θ = 1 − 剩余 UNKNOWN/总数（挂曲线精确值）；MPS = 曲线逆（"预算序"非"最小"，
 * 贪心 = (1−1/e) 近似：次模集合覆盖，启发序非边际最优，axioms.md 四·七 明示）。
 * 新增维度：Fwd 加权（forwardClosure 对候选源 BFS——未知 chunk 的传播枢纽权重）。
 */
export interface ProofCompleteness {
  /** 证明完整度 [0,1]：1 − Σg·w / Σw（w = |Fwd(c)| 加权或 1）。 */
  readonly theta: number;
  /** 剩余 UNKNOWN 加权缺口 [0,1]（1 − theta）。 */
  readonly gap: number;
  /** 标注预算序（influence 降序、key 升序确定性 tiebreak）——非"最小"集，贪心近似。 */
  readonly order: readonly string[];
  /** 预算曲线：order 每个前缀后的剩余 UNKNOWN 加权数。 */
  readonly curve: readonly number[];
  /** 达到目标 Θ 所需标注数（curve 首次 ≤ 阈值的位置；null = 不可达）。 */
  readonly budgetToTarget: number | null;
  /** 传播枢纽权重：最大 |Fwd(c)|（未知 chunk 的最宽扇出）。 */
  readonly maxFwd: number;
}

/**
 * 证明完整度计算（纯函数，单次扫描数据）。
 * @param weighted 用 |Fwd(c)| 加权缺口（未知枢纽权重）；false = 简单 UNKNOWN 计数（= annotationCurve 换名）。
 */
export function proofCompleteness(
  verdicts: readonly Verdict[],
  opts?: { weighted?: boolean; targetTheta?: number },
): ProofCompleteness {
  const chunks = verdicts.map((v) => v.chunk);
  const budget = annotationBudget(chunks);
  const unknownKeys = new Set(verdicts.filter((v) => v.purity === Purity.UNKNOWN).map((v) => v.chunk.key));
  const total = unknownKeys.size;

  // 加权：Fwd(c) 对候选源（自身含 ? 的 chunk——UNKNOWN 依赖其源）逐源 BFS
  const fwdWeight = new Map<string, number>();
  let maxFwd = 0;
  if (opts?.weighted && total > 0) {
    const sourceKeys = new Set(verdicts.filter((v) => v.chunk.calls.has("?")).map((v) => v.chunk.key));
    const fwd = forwardClosure(verdicts, sourceKeys);
    for (const [k, d] of fwd) {
      fwdWeight.set(k, d + 1); // 深度+1 作权重（自身 1）
      if (d + 1 > maxFwd) maxFwd = d + 1;
    }
  }

  const weightOf = (k: string): number => (opts?.weighted ? (fwdWeight.get(k) ?? 1) : 1);
  const totalWeight = opts?.weighted
    ? [...unknownKeys].reduce((s, k) => s + weightOf(k), 0)
    : total;

  // 预算序：UNKNOWN 密集影响面（released∩unknownKeys）降序、总影响面平手、key 升序兜底（确定性）
  const order = [...unknownKeys].sort((a, b) => {
    const ra = (budget.released.get(a) ?? []).filter((x) => unknownKeys.has(x)).length;
    const rb = (budget.released.get(b) ?? []).filter((x) => unknownKeys.has(x)).length;
    if (ra !== rb) return rb - ra;
    const ia = budget.influence.get(a) ?? 0;
    const ib = budget.influence.get(b) ?? 0;
    if (ia !== ib) return ib - ia;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  // 曲线：标注前缀后的剩余加权 UNKNOWN（复用 annotationCurve 的释放机制，但按权重计数）
  const remaining = new Map<string, number>();
  for (const k of unknownKeys) remaining.set(k, weightOf(k));
  const curve: number[] = [totalWeight];
  const annotated = new Set<string>();
  let rem = totalWeight;
  for (const u of order) {
    if (annotated.has(u)) continue;
    annotated.add(u);
    for (const w of budget.released.get(u) ?? []) {
      const cur = remaining.get(w);
      if (cur !== undefined && !annotated.has(w)) {
        remaining.set(w, 0);
        rem -= cur;
      }
    }
    curve.push(rem);
  }
  // 曲线末点：全部标注后
  while (curve.length <= order.length) curve.push(curve[curve.length - 1]!);

  const theta = totalWeight > 0 ? 1 - (curve[curve.length - 1]! / totalWeight) : 1;
  // 全标后剩余（被 IMPURE 带 ? 源占住的 UNKNOWN 不计入 order）——gap 用曲线终点
  const finalRemaining = curve[curve.length - 1]!;
  const target = opts?.targetTheta;
  let budgetToTarget: number | null = null;
  if (target !== undefined && target > theta) budgetToTarget = null; // 目标高于可达
  else if (target !== undefined) {
    const limit = totalWeight * (1 - target);
    for (let k = 0; k < curve.length; k++) {
      if (curve[k]! <= limit) { budgetToTarget = k; break; }
    }
  }

  return {
    theta,
    gap: 1 - theta,
    order,
    curve,
    budgetToTarget,
    maxFwd,
  };
}
