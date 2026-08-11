"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forwardClosure = forwardClosure;
exports.gradeOf = gradeOf;
exports.riskOfChange = riskOfChange;
const types_1 = require("./types");
const tarjan_1 = require("./tarjan");
const influence_1 = require("./influence");
/** 正向可达闭包（回归风险 R_fog / 证明完整度 Fwd 加权用）：从 seeds 沿调用边 BFS，返回 key → 深度。 */
function forwardClosure(verdicts, seeds) {
    const byKey = new Map(verdicts.map((v) => [v.chunk.key, v.chunk]));
    const out = new Map();
    const queue = [];
    for (const s of seeds) {
        if (!out.has(s)) {
            out.set(s, 0);
            queue.push(s);
        }
    }
    for (let i = 0; i < queue.length; i++) {
        const k = queue[i];
        const d = out.get(k);
        const c = byKey.get(k);
        if (!c)
            continue;
        for (const t of c.calls) {
            if (t === types_1.UNKNOWN_TARGET)
                continue;
            if (!out.has(t)) {
                out.set(t, d + 1);
                queue.push(t);
            }
        }
    }
    return out;
}
/** 退化矩阵 D：key 稳定 chunk 的判定翻转风险（行=旧，列=新；0=无险）。
 *
 * 文档化裁决（迭代14 视角 1）：语料 cell 是标注结果计数，不含跨版本翻转记录 → 无校准数据。
 * 常量满足四序公理（不可由单一两参数公式精确复现——序是约束、基数是裁决值）：
 *  1. 恢复零风险：n=PURE ⇒ D=0（改进不升险）；
 *  2. 背叛严重度随旧纯度单调：PURE→IMPURE 1.0 > UNKNOWN→IMPURE 0.5；PURE→UNKNOWN 0.6 > IMPURE→UNKNOWN 0.3；
 *  3. 新脏度单调（固定 o=PURE）：UNKNOWN 0.6 < IMPURE 1.0；
 *  4. 跨锚序：PURE→UNKNOWN 0.6 > UNKNOWN→IMPURE 0.5（背叛认证纯度 > 证实既有怀疑）；UNKNOWN→IMPURE 0.5 > IMPURE→UNKNOWN 0.3。
 * 基数被 ∏-保守 L（L≥max 通道）与阈值重标吸收；未来校准路径 = 配对扫描 git 历史（oldVerdicts 已支持），
 * 需 key 稳定翻转数据（稀有、单项目偏置）。权重 0.5/0.3/0.2 同理：序 = 爆炸半径 > 耦合放大 > 链深，
 * 基数被 15/35/60 阈值吸收——(W, 阈值, R_state) 是联合体，改任一须重标。 */
const D_MATRIX = {
    [types_1.Purity.PURE]: {
        [types_1.Purity.PURE]: 0,
        [types_1.Purity.UNKNOWN]: 0.6,
        [types_1.Purity.IMPURE]: 1.0,
    },
    [types_1.Purity.UNKNOWN]: {
        [types_1.Purity.PURE]: 0,
        [types_1.Purity.UNKNOWN]: 0,
        [types_1.Purity.IMPURE]: 0.5,
    },
    [types_1.Purity.IMPURE]: {
        [types_1.Purity.PURE]: 0,
        [types_1.Purity.UNKNOWN]: 0.3,
        [types_1.Purity.IMPURE]: 0,
    },
};
/** 现状纯度 → 风险（key 变化 chunk = 编辑/新增；公理4 内容寻址：编辑即重建）。 */
const CURRENT_PURITY_RISK = {
    [types_1.Purity.PURE]: 0,
    [types_1.Purity.UNKNOWN]: 0.6,
    [types_1.Purity.IMPURE]: 1.0,
};
/** 权重（L×C 幅度轴凸组合；事件轴不用权重——∏ 是保守上界）。 */
const W = { impact: 0.5, cycle: 0.3, depth: 0.2 };
function gradeOf(risk) {
    if (risk < 0)
        return "invalid";
    // 阈值按实测分布重标（迭代13 视角 1：1233 模拟改动集 0 high/critical，risk 集中 [0,35]——
    // 30/60/85 三个阈值两个死区；LOW<15/MEDIUM 15-35/HIGH 35-60/CRITICAL ≥60 按分位校准）
    if (risk < 15)
        return "low";
    if (risk < 35)
        return "medium";
    if (risk < 60)
        return "high";
    return "critical";
}
/**
 * 回归风险（用户核心目标：通过现有关注点实现回归风险控制）。
 *
 * R(Δ) 六因子（全部从 codeaudit 原生数据推导，零外部数据）：
 * - impact：反向可达闭包 ∪ 状态读者占比（复用 changedImpact 数学）
 * - purity：纯度退化（key 稳定 → 退化矩阵 D；key 变化 → 现状纯度映射）
 * - cycle：SCC 环内修改（平凡 SCC 排除 + 对数压缩）
 * - depth：效应链深（PURE/∞ → 0；饱和 0..5）
 * - fog：正向影响面内 UNKNOWN 计数占比（含 Δ 自身未知点；计数单调）
 * - state：stateDeps 命中的读者占比（图调用边外耦合通道，迭代14 视角 1）
 * 聚合：L×C 风险矩阵——L = 1-(1-purity)(1-fog)(1-state)（正相关 → 可证明的保守上界），
 * C = 0.5·impact + 0.3·cycle + 0.2·depth（凸组合）；Risk = 100·L·C。
 */
function riskOfChange(verdicts, changedFiles, opts) {
    const chunks = verdicts.map((v) => v.chunk);
    const byKey = new Map(chunks.map((c) => [c.key, c]));
    const n = chunks.length;
    // D5：UNKNOWN_COUNT/unknownKeys 单遍合一（迭代14 视角 2）
    const unknownKeys = new Set(verdicts.filter((v) => v.purity === types_1.Purity.UNKNOWN).map((v) => v.chunk.key));
    const UNKNOWN_COUNT = unknownKeys.size;
    // 改动文件匹配（反斜杠/./ 归一化，与 changedImpact 同款）
    const norm = new Set();
    for (const f of changedFiles)
        norm.add(f.replace(/\\/g, "/").replace(/^\.\//, ""));
    const chunkFiles = new Set(verdicts.map((v) => v.chunk.file));
    let matchedFiles = 0;
    for (const f of norm)
        if (chunkFiles.has(f))
            matchedFiles++;
    const unmatchedFiles = norm.size - matchedFiles; // 口径与 influence.ts matchedFiles 差集一致
    const changed = verdicts.filter((v) => norm.has(v.chunk.file));
    const changedKeys = new Set(changed.map((v) => v.chunk.key));
    // R_impact：反向闭包（S1 复用 changedImpact——同 caller 边/同跳 ?/同含 seed，
    // 迭代14 视角 2 实证逐步骤同构；changed+affected 即含 Δ 自身的全闭包）
    const ci = (0, influence_1.changedImpact)(verdicts, norm);
    const backSeen = new Set();
    for (const c of ci.changed)
        backSeen.add(c.key);
    for (const c of ci.affected)
        backSeen.add(c.key);
    const impact = n > 0 ? backSeen.size / n : 0;
    // R_cycle：SCC 环大小（平凡 SCC 排除 + 对数压缩）
    let cycle = 0;
    if (changedKeys.size > 0) {
        const edges = new Map();
        for (const v of verdicts) {
            edges.set(v.chunk.key, new Set([...v.chunk.calls].filter((t) => t !== types_1.UNKNOWN_TARGET && byKey.has(t))));
        }
        const comps = (0, tarjan_1.tarjan)(byKey.keys(), edges);
        for (const comp of comps) {
            if (comp.length < 2)
                continue;
            for (const k of comp) {
                if (changedKeys.has(k)) {
                    const r = Math.log2(1 + comp.length) / Math.log2(1 + n);
                    if (r > cycle)
                        cycle = r;
                }
            }
        }
    }
    // R_depth：链深（PURE/∞ → 0；饱和 0..5）
    let depth = 0;
    for (const v of changed) {
        if (v.purity === types_1.Purity.PURE)
            continue;
        if (v.chain === Infinity)
            continue;
        const r = Math.min(1, v.chain / 5);
        if (r > depth)
            depth = r;
    }
    // R_purity：key 稳定 → D 矩阵；key 变化（编辑/新增）→ 现状纯度映射
    let purity = 0;
    const oldByKey = new Map((opts?.oldVerdicts ?? []).map((v) => [v.chunk.key, v]));
    for (const v of changed) {
        const old = oldByKey.get(v.chunk.key);
        let r;
        if (old !== undefined && old.purity !== v.purity) {
            r = D_MATRIX[old.purity]?.[v.purity] ?? 0; // key 稳定 + 判定翻转
        }
        else {
            r = old === undefined ? (CURRENT_PURITY_RISK[v.purity] ?? 0) : 0; // 新增/编辑（无旧判定）
        }
        if (r > purity)
            purity = r;
    }
    // key 稳定但 old 有、判定未变 → 0（已有：r=0）；old 缺席的旧扫描 → 现状映射
    // R_state（迭代14 视角 1）：状态写改动 → stateDeps 命中的读者——图调用边外耦合通道
    // （读者 r 不调用写者 w 也可能受影响：共享对象 user.status）。s 入 L（∏ 保守上界，
    // 与 fog/purity 无结构性相关——全静态解析的库可状态耦合极密）；impact' 拓宽为 Back∪broken
    let state = 0;
    let brokenKeys = new Set();
    if (changedKeys.size > 0) {
        const writeSet = new Set();
        for (const v of changed)
            for (const w of v.chunk.stateWrites)
                writeSet.add(w);
        let readers = 0;
        for (const v of verdicts) {
            if (v.stateDeps.length === 0)
                continue;
            readers++;
            if (!changedKeys.has(v.chunk.key) && v.stateDeps.some((d) => writeSet.has(d))) {
                brokenKeys.add(v.chunk.key);
            }
        }
        state = readers > 0 ? brokenKeys.size / readers : 0;
    }
    // impact'：反向闭包 ∪ 状态读者（broken 已排除 Δ）——状态耦合场景有判别力（探针 278 读者 0→50）
    const affectedUnion = new Set(backSeen);
    for (const k of brokenKeys)
        affectedUnion.add(k);
    const impactWide = n > 0 ? affectedUnion.size / n : 0;
    // R_fog：正向影响面内 UNKNOWN 计数占比（裁决公式 |Fwd∩U|/|U|——seed 已在 Fwd 内，无需额外计入 Δ；
    // 计数单调：Δ 增大 → Fwd 增大 → 计数不降）
    let fog = 0;
    if (changedKeys.size > 0 && UNKNOWN_COUNT > 0) {
        const fwd = forwardClosure(verdicts, changedKeys);
        let fogUnknown = 0;
        for (const k of fwd.keys())
            if (unknownKeys.has(k))
                fogUnknown++;
        fog = Math.min(1, fogUnknown / UNKNOWN_COUNT);
    }
    // 聚合：L×C（R_state 入 L——∏ 保守上界；impact' 入 C）
    const likelihood = 1 - (1 - purity) * (1 - fog) * (1 - state);
    const consequence = W.impact * impactWide + W.cycle * cycle + W.depth * depth;
    const risk = 100 * likelihood * consequence;
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
            factors: { impact: impactWide, purity, cycle, depth, fog, state },
            likelihood,
            consequence,
            changedChunks: changed.length,
            affectedChunks: affectedUnion.size,
            unmatchedFiles,
            evidence,
        };
    }
    return {
        risk,
        grade: gradeOf(risk),
        factors: { impact: impactWide, purity, cycle, depth, fog, state },
        likelihood,
        consequence,
        changedChunks: changed.length,
        affectedChunks: affectedUnion.size,
        unmatchedFiles,
        evidence,
    };
}
