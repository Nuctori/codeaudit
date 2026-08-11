import { type Chunk, UNKNOWN_TARGET, Purity, type Verdict } from "./types";
import { tarjan } from "./tarjan";

/** 正向可达闭包（回归风险 R_fog / 证明完整度 Fwd 加权用）：从 seeds 沿调用边 BFS，返回 key → 深度。 */
export function forwardClosure(
	verdicts: readonly { chunk: Chunk }[],
	seeds: ReadonlySet<string>,
): Map<string, number> {
	const byKey = new Map(verdicts.map((v) => [v.chunk.key, v.chunk]));
	const out = new Map<string, number>();
	const queue: string[] = [];
	for (const s of seeds) {
		if (!out.has(s)) {
			out.set(s, 0);
			queue.push(s);
		}
	}
	for (let i = 0; i < queue.length; i++) {
		const k = queue[i]!;
		const d = out.get(k)!;
		const c = byKey.get(k);
		if (!c) continue;
		for (const t of c.calls) {
			if (t === UNKNOWN_TARGET) continue;
			if (!out.has(t)) {
				out.set(t, d + 1);
				queue.push(t);
			}
		}
	}
	return out;
}

/** 五因子回归风险（L×C 模型，数学家评审裁决 2026-08-11）。 */
export interface ChangeRisk {
	/** 归一化风险分 [0,100]；unmatchedFiles>0 时置 -1（不可评估）。 */
	readonly risk: number;
	readonly grade: "low" | "medium" | "high" | "critical" | "invalid";
	readonly factors: {
		readonly impact: number; // R_impact：反向闭包占比 |Back(Δ)|/|C|
		readonly purity: number; // R_purity：退化矩阵 D（key 稳定）∪ 现状纯度映射（key 变化）
		readonly cycle: number; // R_cycle：I(|SCC|≥2)·log₂(1+|SCC|)/log₂(1+|C|)
		readonly depth: number; // R_depth：PURE/∞→0，min(1, ch_audit/5)
		readonly fog: number; // R_fog：Fwd∩UNKNOWN/全局UNKNOWN（计数单调，seed 已在 Fwd 内单计）
	};
	/** L×C 两轴（调试/报告用）。 */
	readonly likelihood: number;
	readonly consequence: number;
	readonly maxReachable: number;
	readonly changedChunks: number;
	/** 反向闭包大小（**含 Δ 自身**——与 changedImpact.affectedChunks 的 depth≥1 口径不同，迭代2 文档化）。 */
	readonly affectedChunks: number;
	readonly unmatchedFiles: number;
	/** 证据质量（证明系统最小方案，迭代13 视角 1/3）：上层指标附输入质量——误差界 = O(missingSiteRate + k·parseErrorRate)。 */
	readonly evidence: {
		/** chain 不确定占比（与 scan 的 unknownRate 同源：chainCertain=false / verdicts）。 */
		readonly unknownRate: number;
		/** parseError 文件占比（内容不可信 → 指标低估结构复杂度）。 */
		readonly parseErrorRate: number;
		/** 未解析站点率（ΣunknownSites / Σ(calls+unknownSites)）——图指标单侧下界误差（定理1）。 */
		readonly missingSiteRate: number;
	};
}

/** 退化矩阵 D：key 稳定 chunk 的判定翻转风险（行=旧，列=新；0=无险）。 */
const D_MATRIX: Readonly<Record<number, Readonly<Record<number, number>>>> = {
	[Purity.PURE]: {
		[Purity.PURE]: 0,
		[Purity.UNKNOWN]: 0.6,
		[Purity.IMPURE]: 1.0,
	},
	[Purity.UNKNOWN]: {
		[Purity.PURE]: 0,
		[Purity.UNKNOWN]: 0,
		[Purity.IMPURE]: 0.5,
	},
	[Purity.IMPURE]: {
		[Purity.PURE]: 0,
		[Purity.UNKNOWN]: 0.3,
		[Purity.IMPURE]: 0,
	},
};
/** 现状纯度 → 风险（key 变化 chunk = 编辑/新增；公理4 内容寻址：编辑即重建）。 */
const CURRENT_PURITY_RISK: Readonly<Record<number, number>> = {
	[Purity.PURE]: 0,
	[Purity.UNKNOWN]: 0.6,
	[Purity.IMPURE]: 1.0,
};

/** 权重（L×C 幅度轴凸组合；事件轴不用权重——∏ 是保守上界）。 */
const W = { impact: 0.5, cycle: 0.3, depth: 0.2 } as const;

export function gradeOf(risk: number): ChangeRisk["grade"] {
	if (risk < 0) return "invalid";
	// 阈值按实测分布重标（迭代13 视角 1：1233 模拟改动集 0 high/critical，risk 集中 [0,35]——
	// 30/60/85 三个阈值两个死区；LOW<15/MEDIUM 15-35/HIGH 35-60/CRITICAL ≥60 按分位校准）
	if (risk < 15) return "low";
	if (risk < 35) return "medium";
	if (risk < 60) return "high";
	return "critical";
}

/**
 * 回归风险（用户核心目标：通过现有关注点实现回归风险控制）。
 *
 * R(Δ) 五因子（全部从 codeaudit 原生数据推导，零外部数据）：
 * - impact：反向可达闭包占比（复用 changedImpact 数学）
 * - purity：纯度退化（key 稳定 → 退化矩阵 D；key 变化 → 现状纯度映射）
 * - cycle：SCC 环内修改（平凡 SCC 排除 + 对数压缩）
 * - depth：效应链深（PURE/∞ → 0；饱和 0..5）
 * - fog：正向影响面内 UNKNOWN 计数占比（含 Δ 自身未知点；计数单调）
 * 聚合：L×C 风险矩阵——L = 1-(1-purity)(1-fog)（正相关 → 可证明的保守上界），
 * C = 0.5·impact + 0.3·cycle + 0.2·depth（凸组合）；Risk = 100·L·C。
 */
export function riskOfChange(
	verdicts: readonly Verdict[],
	changedFiles: ReadonlySet<string>,
	opts?: { oldVerdicts?: readonly Verdict[] },
): ChangeRisk {
	const chunks = verdicts.map((v) => v.chunk);
	const byKey = new Map(chunks.map((c) => [c.key, c]));
	const n = chunks.length;
	const UNKNOWN_COUNT = verdicts.filter(
		(v) => v.purity === Purity.UNKNOWN,
	).length;
	const unknownKeys = new Set(
		verdicts.filter((v) => v.purity === Purity.UNKNOWN).map((v) => v.chunk.key),
	);

	// 改动文件匹配（反斜杠/./ 归一化，与 changedImpact 同款）
	const norm = new Set<string>();
	for (const f of changedFiles)
		norm.add(f.replace(/\\/g, "/").replace(/^\.\//, ""));
	const chunkFiles = new Set(verdicts.map((v) => v.chunk.file));
	let matchedFiles = 0;
	for (const f of norm) if (chunkFiles.has(f)) matchedFiles++;
	const unmatchedFiles = norm.size - matchedFiles; // 口径与 influence.ts matchedFiles 差集一致
	const changed = verdicts.filter((v) => norm.has(v.chunk.file));
	const changedKeys = new Set(changed.map((v) => v.chunk.key));

	// R_impact：反向闭包占比（沿 caller 边 BFS——谁调用改动集）
	const callers = new Map<string, string[]>();
	for (const v of verdicts) {
		for (const t of v.chunk.calls) {
			if (t === UNKNOWN_TARGET) continue;
			const arr = callers.get(t);
			if (arr) arr.push(v.chunk.key);
			else callers.set(t, [v.chunk.key]);
		}
	}
	const backSeen = new Set(changedKeys);
	const backQueue = [...changedKeys];
	for (let i = 0; i < backQueue.length; i++) {
		for (const caller of callers.get(backQueue[i]!) ?? []) {
			if (!backSeen.has(caller)) {
				backSeen.add(caller);
				backQueue.push(caller);
			}
		}
	}
	const impact = n > 0 ? backSeen.size / n : 0;

	// R_cycle：SCC 环大小（平凡 SCC 排除 + 对数压缩）
	let cycle = 0;
	if (changedKeys.size > 0) {
		const edges = new Map<string, Set<string>>();
		for (const v of verdicts) {
			edges.set(
				v.chunk.key,
				new Set(
					[...v.chunk.calls].filter(
						(t) => t !== UNKNOWN_TARGET && byKey.has(t),
					),
				),
			);
		}
		const comps = tarjan(byKey.keys(), edges);
		for (const comp of comps) {
			if (comp.length < 2) continue;
			for (const k of comp) {
				if (changedKeys.has(k)) {
					const r = Math.log2(1 + comp.length) / Math.log2(1 + n);
					if (r > cycle) cycle = r;
				}
			}
		}
	}

	// R_depth：链深（PURE/∞ → 0；饱和 0..5）
	let depth = 0;
	for (const v of changed) {
		if (v.purity === Purity.PURE) continue;
		if (v.chain === Infinity) continue;
		const r = Math.min(1, v.chain / 5);
		if (r > depth) depth = r;
	}

	// R_purity：key 稳定 → D 矩阵；key 变化（编辑/新增）→ 现状纯度映射
	let purity = 0;
	const oldByKey = new Map(
		(opts?.oldVerdicts ?? []).map((v) => [v.chunk.key, v]),
	);
	for (const v of changed) {
		const old = oldByKey.get(v.chunk.key);
		let r: number;
		if (old !== undefined && old.purity !== v.purity) {
			r = D_MATRIX[old.purity]?.[v.purity] ?? 0; // key 稳定 + 判定翻转
		} else {
			r = old === undefined ? (CURRENT_PURITY_RISK[v.purity] ?? 0) : 0; // 新增/编辑（无旧判定）
		}
		if (r > purity) purity = r;
	}
	// key 稳定但 old 有、判定未变 → 0（已有：r=0）；old 缺席的旧扫描 → 现状映射

	// R_fog：正向影响面内 UNKNOWN 计数占比（裁决公式 |Fwd∩U|/|U|——seed 已在 Fwd 内，无需额外计入 Δ；
	// 计数单调：Δ 增大 → Fwd 增大 → 计数不降）
	let fog = 0;
	if (changedKeys.size > 0 && UNKNOWN_COUNT > 0) {
		const fwd = forwardClosure(verdicts, changedKeys);
		let fogUnknown = 0;
		for (const k of fwd.keys()) if (unknownKeys.has(k)) fogUnknown++;
		fog = Math.min(1, fogUnknown / UNKNOWN_COUNT);
	}

	// 聚合：L×C
	const likelihood = 1 - (1 - purity) * (1 - fog);
	const consequence = W.impact * impact + W.cycle * cycle + W.depth * depth;
	const risk = 100 * likelihood * consequence;
	const maxReachable = 100; // L×C 归一化后满值可达（阈值已按实测分位重标 15/35/60）

	// 证据质量（证明系统最小方案，迭代13）：从 verdicts 纯派生，零 stats 依赖
	const uncertain = verdicts.filter((v) => !v.chainCertain).length;
	let totalSites = 0;
	let missingSites = 0;
	for (const v of verdicts) {
		totalSites += v.chunk.calls.size + v.chunk.unknownSites;
		missingSites += v.chunk.unknownSites;
	}
	const parseErrFiles = verdicts.filter((v) => v.chunk.parseError).length;
	const evidence = {
		unknownRate: n > 0 ? uncertain / n : 0,
		parseErrorRate: n > 0 ? parseErrFiles / n : 0,
		missingSiteRate: totalSites > 0 ? missingSites / totalSites : 0,
	};

	if (unmatchedFiles > 0) {
		return {
			risk: -1,
			grade: "invalid",
			factors: { impact, purity, cycle, depth, fog },
			likelihood,
			consequence,
			maxReachable,
			changedChunks: changed.length,
			affectedChunks: backSeen.size,
			unmatchedFiles,
			evidence,
		};
	}
	return {
		risk,
		grade: gradeOf(risk),
		factors: { impact, purity, cycle, depth, fog },
		likelihood,
		consequence,
		maxReachable,
		changedChunks: changed.length,
		affectedChunks: backSeen.size,
		unmatchedFiles,
		evidence,
	};
}
