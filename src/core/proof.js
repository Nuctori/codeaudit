"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.proofCompleteness = proofCompleteness;
const influence_1 = require("./influence");
const risk_1 = require("./risk");
/**
 * 证明完整度计算（纯函数，单次扫描数据）。
 * @param weighted 用 |Fwd(c)| 加权缺口（未知枢纽权重）；false = 简单 UNKNOWN 计数（= annotationCurve 换名）。
 */
function proofCompleteness(verdicts, opts) {
    const chunks = verdicts.map((v) => v.chunk);
    const budget = (0, influence_1.annotationBudget)(chunks);
    const unknownKeys = (0, influence_1.unknownKeysOf)(verdicts);
    const total = unknownKeys.size;
    // 加权：每个 UNKNOWN chunk 单独的正向闭包大小 |Fwd(c)|（下游影响面权重——
    // 传播枢纽未知 chunk 权重更高；联合源集 BFS 深度是错误语义，迭代2 修正）
    const fwdWeight = new Map();
    let maxFwd = 0;
    if (opts?.weighted && total > 0) {
        for (const k of unknownKeys) {
            const w = (0, risk_1.forwardClosure)(verdicts, new Set([k])).size;
            fwdWeight.set(k, w);
            if (w > maxFwd)
                maxFwd = w;
        }
    }
    const weightOf = (k) => opts?.weighted ? (fwdWeight.get(k) ?? 1) : 1;
    const totalWeight = opts?.weighted
        ? [...unknownKeys].reduce((s, k) => s + weightOf(k), 0)
        : total;
    const order = [...unknownKeys].sort((0, influence_1.annotationCompare)(budget, unknownKeys));
    // 曲线：复用 annotationCurve 的释放语义（S2，迭代14 视角 2）——w 的全部未知源标完才释放
    // （源自含于 released(u)，标注自身即计一个源——迭代2 BLOCKER-1 修复）；weighted 传 fwdWeight。
    // 初值 = 全量累计 weight（含 deps=0 的 UNKNOWN，与 θ 口径一致；annotationCurve 每轮 push → 长度恒 order.length+1）
    const wMap = opts?.weighted ? fwdWeight : undefined;
    const curve = (0, influence_1.annotationCurve)(budget, order, unknownKeys, wMap);
    const theta = totalWeight > 0 ? 1 - curve[curve.length - 1] / totalWeight : 1;
    // 全标后剩余（被 IMPURE 带 ? 源占住的 UNKNOWN 不计入 order）——gap 用曲线终点
    const finalRemaining = curve[curve.length - 1];
    const target = opts?.targetTheta;
    let budgetToTarget = null;
    if (target !== undefined) {
        // 可达性：target 高于可达 θ（含浮点边界——BLOCKER-2 修复）→ null；否则取曲线首次 ≤ 阈值的位置
        const finalRem = curve[curve.length - 1];
        const reachable = target <= theta + 1e-9;
        if (!reachable)
            budgetToTarget = null;
        else {
            const limit = totalWeight * (1 - target);
            for (let k = 0; k < curve.length; k++) {
                if (curve[k] <= limit + 1e-9) {
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
        order,
        curve,
        budgetToTarget,
        maxFwd,
    };
}
