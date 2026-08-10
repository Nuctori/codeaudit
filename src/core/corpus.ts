import { type Chunk } from "./types";

/**
 * 标注语料（EVSI 先验的累积数据）。
 *
 * 结构：聚合计数（方法名 × 接收者根类别 → pure/impure）+ seen 去重集。
 * 只存原始计数不存概率（更新=自增、合并=求和，无归一化漂移；θ̂ 读取时现算）。
 * 去重：按 chunk.id（内容寻址）——同一导出反复回读不重复入账（独立性）。
 *
 * 先验：两层收缩（稀疏格统计正解）——
 *   θ̂_method = (k_m + θ₀κ₁)/(n_m + κ₁)，θ₀=0.25（实证基率），κ₁=12
 *   θ̂_cell   = (k_c + θ̂_m·κ₂)/(n_c + κ₂)，κ₂=8
 * 冷启动：语料总样本 < 30 时不提供概率（诚实，不编数字）。
 * 概率永不进判定通道：仅用于 suggested_prompt 建议（标注者以函数体为准）。
 */

export interface CorpusSite {
  readonly attr: string;
  readonly obj: string | null;
  readonly root: string;
}

export interface CorpusFile {
  readonly version: 2;
  /** 已入账的 chunk.id（去重）。 */
  readonly seen: Record<string, true>;
  /** 方法名 → pure/impure 计数。 */
  readonly method: Record<string, { pure: number; impure: number }>;
  /** 接收者根类别 → pure/impure 计数。 */
  readonly root: Record<string, { pure: number; impure: number }>;
  /** (attr, root) 格 → pure/impure 计数（v2 新增：LOO 精确化 + n 显示真格计数，根治 root 桶虚高）。 */
  readonly cell: Record<string, { pure: number; impure: number }>;
}

export function emptyCorpus(): CorpusFile {
  return { version: 2, seen: {}, method: {}, root: {}, cell: {} };
}

/** 语料结构守卫（投毒/畸形防护）：版本 + 结构 + 计数非负有限数。 */
export function isCorpus(x: unknown): x is CorpusFile {
  if (!x || typeof x !== "object") return false;
  const c = x as Partial<CorpusFile>;
  if (c.version !== 2) return false;
  if (!c.seen || typeof c.seen !== "object") return false;
  if (!c.method || typeof c.method !== "object") return false;
  if (!c.root || typeof c.root !== "object") return false;
  if (!c.cell || typeof c.cell !== "object") return false;
  const validCount = (v: unknown): boolean => {
    if (!v || typeof v !== "object") return false;
    const o = v as { pure?: unknown; impure?: unknown };
    return typeof o.pure === "number" && Number.isFinite(o.pure as number) && (o.pure as number) >= 0 &&
      typeof o.impure === "number" && Number.isFinite(o.impure as number) && (o.impure as number) >= 0;
  };
  for (const v of Object.values(c.method)) if (!validCount(v)) return false;
  for (const v of Object.values(c.root)) if (!validCount(v)) return false;
  for (const v of Object.values(c.cell)) if (!validCount(v)) return false;
  return true;
}

const GLOBAL_THETA0 = 0.25; // 实证基率：来自 swagger-ui/src/core 标注模拟（65 条中 51 条 PURE → impure≈0.22，取 0.25 保守）。
// 注意：这是单项目标签分布泄漏为全局常数（跨项目污染通道）——冷单元格 θ̂≈θ₀ 会被 swagger 基率拉动；
// 改进方向：项目级基率分层（项目随机效应）或可配置（见 docs/axioms.md 四·七）。
const KAPPA1 = 12; // 方法级收缩
const KAPPA2 = 8; // 接收者格收缩
export const MIN_TOTAL = 30; // 冷启动阈值：总样本不足不提供概率
export const MIN_CELL = 10; // 单格阈值
export const PRIOR_THRESHOLD = 0.65; // p 触发阈值（建议 PURE）

/** 合并两个语料（counts 求和、seen 并集）。 */
export function mergeCorpus(a: CorpusFile, b: CorpusFile): CorpusFile {
  const out = emptyCorpus();
  const add = (target: Record<string, { pure: number; impure: number }>, key: string, p: number, i: number): void => {
    // 与 bump 同款 hasOwn+defineProperty：JSON.parse 语料可含 own __proto__ 键 → 裸赋值污染原型
    const e = Object.hasOwn(target, key) ? target[key] : undefined;
    const fresh = { pure: (e?.pure ?? 0) + p, impure: (e?.impure ?? 0) + i };
    Object.defineProperty(target, key, { value: fresh, enumerable: true, writable: true, configurable: true });
  };
  for (const [k, v] of Object.entries(a.method)) add(out.method, k, v.pure, v.impure);
  for (const [k, v] of Object.entries(b.method)) add(out.method, k, v.pure, v.impure);
  for (const [k, v] of Object.entries(a.root)) add(out.root, k, v.pure, v.impure);
  for (const [k, v] of Object.entries(b.root)) add(out.root, k, v.pure, v.impure);
  for (const [k, v] of Object.entries(a.cell)) add(out.cell, k, v.pure, v.impure);
  for (const [k, v] of Object.entries(b.cell)) add(out.cell, k, v.pure, v.impure);
  for (const k of Object.keys(a.seen)) out.seen[k] = true;
  for (const k of Object.keys(b.seen)) out.seen[k] = true;
  return out;
}

/**
 * 用标注结果更新语料（按 chunk.id 去重，幂等）。
 * PURE 标注（"全部调用点确证"）→ 每个未知站点计 pure；IMPURE → 全部站点计 impure（保守偏置）。
 */
export function updateCorpus(
  corpus: CorpusFile,
  chunks: readonly Chunk[],
  annotations: ReadonlyMap<string, "PURE" | "IMPURE">,
): CorpusFile {
  let out = corpus;
  for (const c of chunks) {
    // 标注键解析与 scan.ts 回读同构：优先 (file, id) 实例锚定（显式实例覆写），无 file 锚定则裸 id
    const fileKey = `${c.file}\u0000${c.id}`;
    const annKey = annotations.has(fileKey) ? fileKey : (annotations.has(c.id) ? c.id : fileKey);
    const v = annotations.get(annKey);
    // 去重门：实例锚定按实例键（不同文件实例可获不同判定——异实例证据保留，迭代3 #3）；
    // 裸 id（内容寻址）按裸 id 门（同内容同判定）。双键写入保跨格式幂等（迭代2 #2）。
    const gate = annKey.includes("\u0000") ? out.seen[annKey] === true : out.seen[c.id] === true;
    if (v === undefined || gate) continue;
    // 已 parseError 的 chunk 不计入语料：判定侧已拒其 PURE 标注，语料侧不得借"body 不可信"的标注累积先验
    // （迭代4 F1：scan 拒标注 vs updateCorpus 计入的闭环污染）
    if (c.parseError) continue;
    if (c.unknownCalls.length === 0) continue;
    out = {
      version: 2,
      seen: { ...out.seen, [annKey]: true, [c.id]: true },
      method: bump(out.method, new Set(c.unknownCalls.map((s) => s.attr)), v),
      root: bump(out.root, new Set(c.unknownCalls.map((s) => s.root)), v),
      cell: bump(out.cell, new Set(c.unknownCalls.map((s) => `${s.attr}\u0000${s.root}`)), v),
    };
  }
  return out;
}

/** 每个去重键 +1 次纯/不纯计数（PURE 标注 = 该 chunk 全部站点确证）。 */
function bump(
  table: Record<string, { pure: number; impure: number }>,
  keys: ReadonlySet<string>,
  verdict: "PURE" | "IMPURE",
): Record<string, { pure: number; impure: number }> {
  const out = { ...table };
  for (const k of keys) {
    // hasOwn + defineProperty：k 可为 "__proto__"/"constructor"（x.__proto__() 调用点已实证可达），
    // 裸 `out[k] =` 会改原型而非建键 → 计数丢失 + 原型污染
    const e = Object.hasOwn(out, k) ? out[k] : undefined;
    const fresh = verdict === "PURE"
      ? { pure: (e?.pure ?? 0) + 1, impure: e?.impure ?? 0 }
      : { pure: e?.pure ?? 0, impure: (e?.impure ?? 0) + 1 };
    Object.defineProperty(out, k, { value: fresh, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function total(c: CorpusFile): number {
  let n = 0;
  for (const e of Object.values(c.method)) n += e.pure + e.impure;
  return n;
}

export interface Prior {
  /** P(PURE)，收缩后估计。 */
  readonly pPure: number;
  /** 该格样本数。 */
  readonly n: number;
  /** 覆盖的项目数（无项目维度，恒 1——单语料文件）。 */
  readonly projects: number;
}

/**
 * 计算站点的先验建议：两层收缩。总样本不足 / 单格样本不足 / p 不显著 → null。
 * p = P(PURE) = 1 − θ̂_impure（θ̂ 为两层收缩的 impure 率）。
 */
export function priorFor(corpus: CorpusFile, site: CorpusSite): Prior | null {
  if (total(corpus) < MIN_TOTAL) return null; // 冷启动：不编数字
  // hasOwn 守卫：method/root 是普通对象，裸下标命中继承的 Object.prototype 键（toString 等）→ NaN 先验
  const m = Object.hasOwn(corpus.method, site.attr) ? corpus.method[site.attr] : undefined;
  // 冷 attr（方法级零证据）不提示：其 p̂ 完全来自 root 异质池借力（GLOBAL_THETA0 + 池频率），
  // 显示的 n 会误导为"该形态的实证"——宁缺毋滥（统计评审迭代2 #4）
  if (!m) return null;
  // 两层收缩：先方法级，再接收者格；任一维样本不足都拒绝（宁缺毋滥）
  if (m.pure + m.impure < MIN_CELL) return null;
  // v2 cell 维度：(attr, root) 真格计数——n 显示与 LOO 精确化（根治 root 桶虚高）
  const cellKey = `${site.attr}\u0000${site.root}`;
  const c = Object.hasOwn(corpus.cell, cellKey) ? corpus.cell[cellKey] : undefined;
  const nCell = (c?.pure ?? 0) + (c?.impure ?? 0);
  if (nCell < MIN_CELL) return null;
  const kCell = c?.impure ?? 0;
  // 方法级 θ̂ 用 leave-one-out（剔除本 cell 计数，防双重计数——cell ⊆ method 同源入账）。
  // clamp 防御（cell 计数精确后 LOO 不会为负，保留兜底防数据畸形）
  const mImpureLOO = Math.max(0, m.impure - kCell);
  const mTotalLOO = Math.max(0, m.pure + m.impure - nCell);
  const thetaM = (mImpureLOO + GLOBAL_THETA0 * KAPPA1) / (mTotalLOO + KAPPA1);
  // 角冲突（迭代4 F2）：root 边际 ≥ 方法总数且方法 impure 残差 > 0（mTotalLOO 被 clamp 归零但
  // mImpureLOO 保留）→ thetaM 由方法残差主导，与真实方法率相去甚远 → 宁缺毋滥回退 null
  if (mTotalLOO === 0 && mImpureLOO > 0) return null;
  const thetaCell = (kCell + thetaM * KAPPA2) / (nCell + KAPPA2);
  const pPure = 1 - thetaCell;
  if (pPure < PRIOR_THRESHOLD && pPure > 1 - PRIOR_THRESHOLD) return null; // 分歧大，无建议
  return { pPure, n: nCell, projects: 1 };
}

/** 语料摘要（闭环报告用）。 */
export function summarize(corpus: CorpusFile): { total: number; pure: number; impure: number } {
  let pure = 0;
  let impure = 0;
  for (const e of Object.values(corpus.method)) {
    pure += e.pure;
    impure += e.impure;
  }
  return { total: pure + impure, pure, impure };
}

export interface SiteShapeInfo {
  /** 代表性形态（attr·root，取先验样本数最大的站点）。 */
  readonly shape: string;
  /** 代表性站点的先验（无则 null）。 */
  readonly prior: Prior | null;
  /** 是否可批量处理：全部站点同向且高置信 PURE（p̂≥0.9、n≥30）——仅供人工分组，非自动判定。 */
  readonly batchable: boolean;
}

/** 站点形态信息（导出分组视图用）：代表性形态 + 先验 + 批量标记。 */
export function siteShapeInfo(corpus: CorpusFile, sites: readonly CorpusSite[]): SiteShapeInfo {
  let best: { shape: string; prior: Prior | null } = { shape: "", prior: null };
  let bestN = -1;
  let allBatchable = sites.length > 0;
  for (const s of sites) {
    const p = priorFor(corpus, s);
    const shape = `${s.attr}·${s.root}`;
    if (p && p.n > bestN) {
      bestN = p.n;
      best = { shape, prior: p };
    }
    if (best.shape === "") best = { shape, prior: null };
    // 批量标记（仅供人工分组提示）：要求方法级（attr 专属）证据——root 是垃圾箱类目（variable 塌缩
    // 一切变量接收者），root 兜底先验 = 异质池频率，不足以支持批量；p̂≥0.9、方法 n≥30 且全部站点满足
    // （cell 侧沿用 priorFor 的 MIN_CELL=10，不额外设限）
    const m = Object.hasOwn(corpus.method, s.attr) ? corpus.method[s.attr] : undefined;
    if (!m || m.pure + m.impure < 30 || !p || p.pPure < 0.9) allBatchable = false;
  }
  return { shape: best.shape, prior: best.prior, batchable: allBatchable };
}
