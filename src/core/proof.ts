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
	const unknownKeys = new Set(
		verdicts.filter((v) => v.purity === Purity.UNKNOWN).map((v) => v.chunk.key),
	);
	const total = unknownKeys.size;

	// 加权：每个 UNKNOWN chunk 单独的正向闭包大小 |Fwd(c)|（下游影响面权重——
	// 传播枢纽未知 chunk 权重更高；联合源集 BFS 深度是错误语义，迭代2 修正）
	const fwdWeight = new Map<string, number>();
	let maxFwd = 0;
	if (opts?.weighted && total > 0) {
		for (const k of unknownKeys) {
			const w = forwardClosure(verdicts, new Set([k])).size;
			fwdWeight.set(k, w);
			if (w > maxFwd) maxFwd = w;
		}
	}

	const weightOf = (k: string): number =>
		opts?.weighted ? (fwdWeight.get(k) ?? 1) : 1;
	const totalWeight = opts?.weighted
		? [...unknownKeys].reduce((s, k) => s + weightOf(k), 0)
		: total;
	const order = [...unknownKeys].sort((a, b) => {
		const ra = (budget.released.get(a) ?? []).filter((x) =>
			unknownKeys.has(x),
		).length;
		const rb = (budget.released.get(b) ?? []).filter((x) =>
			unknownKeys.has(x),
		).length;
		if (ra !== rb) return rb - ra;
		const ia = budget.influence.get(a) ?? 0;
		const ib = budget.influence.get(b) ?? 0;
		if (ia !== ib) return ib - ia;
		return a < b ? -1 : a > b ? 1 : 0;
	});

	// 曲线：标注前缀后的剩余加权 UNKNOWN——复用 annotationCurve 的释放语义（deps 倒计时，
	// w 的全部未知源标完才释放；源自含于 released(u)，标注自身即计一个源——迭代2 BLOCKER-1 修复）
	const need = new Map<string, number>();
	for (const k of unknownKeys) need.set(k, budget.deps.get(k) ?? 0);
	let rem = 0;
	for (const k of unknownKeys) rem += weightOf(k);
	const curve: number[] = [rem];
	const annotated = new Set<string>();
	for (const u of order) {
		if (annotated.has(u)) continue;
		annotated.add(u);
		for (const w of budget.released.get(u) ?? []) {
			const n = need.get(w);
			if (n === undefined) continue;
			const nn = n - 1;
			need.set(w, nn);
			if (nn === 0) rem -= weightOf(w);
		}
		curve.push(rem);
	}
	// 曲线末点：全部标注后
	while (curve.length <= order.length) curve.push(curve[curve.length - 1]!);

	const theta =
		totalWeight > 0 ? 1 - curve[curve.length - 1]! / totalWeight : 1;
	// 全标后剩余（被 IMPURE 带 ? 源占住的 UNKNOWN 不计入 order）——gap 用曲线终点
	const finalRemaining = curve[curve.length - 1]!;
	const target = opts?.targetTheta;
	let budgetToTarget: number | null = null;
	if (target !== undefined) {
		// 可达性：target 高于可达 θ（含浮点边界——BLOCKER-2 修复）→ null；否则取曲线首次 ≤ 阈值的位置
		const finalRem = curve[curve.length - 1]!;
		const reachable = target <= theta + 1e-9;
		if (!reachable) budgetToTarget = null;
		else {
			const limit = totalWeight * (1 - target);
			for (let k = 0; k < curve.length; k++) {
				if (curve[k]! <= limit + 1e-9) {
					budgetToTarget = k;
					break;
				}
			}
			if (budgetToTarget === null && finalRem <= limit + 1e-9)
				budgetToTarget = order.length;
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
