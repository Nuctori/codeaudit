"use strict";
/**
 * 核心数据模型 —— 五条设计公理的载体。
 *
 * 公理1（边的守恒）：每个调用点恰归属一个 chunk（含文件级伪 chunk）。
 * 公理2（先凝聚后计算）：一切传播在 SCC 凝聚后的 DAG 上进行。
 * 公理3（纯度三值，未知不猜）：PURE / UNKNOWN / IMPURE，audit 开关决定未知倒向。
 * 公理4（身份即内容）：chunk.id = hash(规范化源码文本)，搬家改名不漂移。
 * 公理5（排序不混合量纲）：报告排序只用字典序。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Purity = exports.UNKNOWN_TARGET = void 0;
/** 图中表示"存在未解析调用"的哨兵目标。 */
exports.UNKNOWN_TARGET = "?";
var Purity;
(function (Purity) {
    Purity[Purity["PURE"] = 0] = "PURE";
    Purity[Purity["UNKNOWN"] = 1] = "UNKNOWN";
    Purity[Purity["IMPURE"] = 2] = "IMPURE";
})(Purity || (exports.Purity = Purity = {}));
