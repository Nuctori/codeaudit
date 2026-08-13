# 迭代46 记录（record）

> 议题：chunk 图可规约性/最小化分析（用户「更激进点的思路，是否存在一种分析方式，可直接昭示代码和模块的可规约、最小化」）。
> 流程：00-plan → 01-math-review（数学家 subagent 卡死被停，主 agent 按 D-054 补验）→ 02-jeff-review → 03-synthesis → 实施 → 验证。
> 基线：b3e307f（并行工作树迭代44-r4 未提交改动不碰）。

## 双评审裁决

| 候选 | 数学家 | Jeff Dean | 裁决 |
| --- | --- | --- | --- |
| C SCC 外部入口（可规约性） | 采纳（Hecht-Ullman：单入口=结构化递归、多入口=纠缠；O(E)） | 做（并入 graphMetrics，0.5h） | **落地** |
| A 依赖骨架（传递约简） | 采纳修正（DAG 约简唯一；报告层非判定通道；限凝聚/文件级——8.6e8 朴素不可行） | 做（限规模，1-1.5h） | **落地**（`dependencySkeleton`） |
| 割点/桥 | 采纳（无向化凝聚图桥=唯一通道；O(V+E)；与影响面互补） | 做（1-1.5h，模块边界字面义） | **落地**（`bridgesOf`） |
| B 模块分解 | 否决（稀疏图分解树全 prime 无信息） | 否决（与谱诊断同类） | 砍 |
| D 行为等价商图 | 否决（显示关切非审计语义） | 否决（YAGNI） | 砍 |
| E 支配树 | 否决（与 layer/depth 重叠） | 否决（YAGNI） | 砍 |
| k-core | 暂缓（密度 0.000 恒浅） | 暂缓 | 暂缓 |

## 实施

| 变更 | 文件 | 内容 |
| --- | --- | --- |
| C | topology.ts | GraphMetrics + `multiEntryScc` + `sccEntryHistogram`（分量级入口计数，O(E)，真 SCC 口径） |
| A | src/core/skeleton.ts（新） | `dependencySkeleton`（凝聚 DAG 传递约简——记忆化 reach 预计算 + 冗余判定） |
| 桥 | 同文件 | `bridgesOf`（无向化凝聚图 Tarjan 桥/割点）+ `componentReps` |
| 导出 | index.ts | dependencySkeleton/bridgesOf + 类型（D-065 API 清单） |
| 测试 | topology.test.ts +2、skeleton.test.ts（新 8） | 单/多入口 SCC、自环不误计、孤立递归团 0 桶、骨架删冗余、菱形保留、SCC 凝聚、不可变性、桥/割点 |
| 文档 | README | --topology 行补多入口环、导出清单 +2 |

## 验证

- 397/397（388 + 9 新）+ tsc 0（并行工作树 cli.ts 除外）
- 规模冒烟：**InitDeity 116,374 chunks**——graphMetrics 805ms / skeleton 1.0s / bridges 0.9s（毫秒级 ✓）
- **昭示实证**：InitDeity 49 环中 **41 个多入口（纠缠递归 84%）**、sccEntryHistogram=[6,2,32,6,2,1]（入口 2 的环 32 个）、桥 9212 条、割点 3626 个——「可规约性/最小化」直接可读

## 残余

- 并行工作树（迭代44-r4 cli.ts/csharp.ts）未碰；--topology/--deps CLI 集成待并行稳定
- k-core 暂缓（图证据变化再启用）；B/D/E 明确砍（YAGNI）
- 数学家 subagent 卡死（D-054 先例）——主 agent 补验，产物 docs/iter46/01-math-review.md 明示

## 决策链

D-165（迭代46：C+A+桥落地，B/D/E/k-core 砍/暂缓）。
