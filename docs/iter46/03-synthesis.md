# 迭代46 合成（03-synthesis）：chunk 图可规约性/最小化——实施裁决

> 流程：00-plan → 01-math-review（数学家，主 agent 补验——原 subagent 卡死）→ 02-jeff-review（Jeff Dean）→ 本合成 → 实施 → 验证。
> 用户原话：「更激进点的思路，这个项目的chunk图，是否存在一种分析方式，可直接昭示代码和模块的（可规约，最小化）」

## 双评审结论

| 候选 | 数学家（01） | Jeff Dean（02） | 合成裁决 |
| --- | --- | --- | --- |
| **C 可规约性/SCC 入口** | 采纳（Hecht-Ullman：单入口=结构化递归，多入口=纠缠；O(E) 精确可算） | 做（并入 graphMetrics，~0.5h） | **落地**（P0） |
| **A 传递约简** | 采纳修正形态（DAG 传递约简唯一；骨架是报告层非判定通道；必须限凝聚/文件级——8.63e8 朴素不可行） | 做（限凝聚/文件级，~1-1.5h） | **落地**（P1，`dependencySkeleton`） |
| **割点/桥（补入候选）** | 采纳（无向化凝聚图桥=唯一通道；O(V+E)；与影响面互补） | 做（~1-1.5h，模块边界字面义） | **落地**（P1，`bridgesOf`） |
| B 模块分解 | 否决（稀疏近树图分解树全 prime 无信息；无库无 oracle） | 否决（与谱诊断同类） | **砍** |
| D 行为等价商图 | 否决（显示关切非审计语义） | 否决（YAGNI） | **砍** |
| E 支配树 | 否决（与 layer/depth 重叠，近树图平凡） | 否决（YAGNI） | **砍** |
| 候选6 k-core | 暂缓（密度 0.000 恒浅） | 暂缓 | **暂缓** |
| 逐节点杠杆排序 | — | 可选（与 forwardClosure 重叠） | 可选，非本轮 |

## 实施清单（本轮）

1. **C**：topology.ts GraphMetrics 增 `multiEntryScc`（外部入边进入 >1 节点的 SCC 数）+ `sccEntryHistogram`（入口数分布）——复用既有 comps/succComp，O(E) 单遍
2. **A**：新 `src/core/skeleton.ts`：`dependencySkeleton(verdicts)`（分量级 DAG 传递约简——`{from,to}[]` 骨架边）+ 保可达性断言
3. **桥**：同文件 `bridgesOf(verdicts)`（无向化凝聚图桥边——`{from,to}[]` + 割点分量）
4. **index.ts 导出** + 类型（D-065 库 API 清单）
5. **cli.ts**：--topology 文本追加「多入口环 X（纠缠递归）」；--deps 追加骨架注记（如并行工作树稳定则做，冲突则只落库 API）
6. **测试**：topology.test.ts 扩 C（菱形图 multiEntryScc=1 / 单入口 0 / 自环不误计）；skeleton.test.ts 新（A→B→C 且 A→C 骨架删 A→C / 桥两分量单桥边 / 不可变性）
7. **文档**：README --topology/--deps 各一句 + D-065 API 清单

## 验证

- 388 + 新增（+4~6）→ ~394 全绿 + tsc 0 + README 门禁
- 规模冒烟：合成 28K 级图（或 InitDeity 报告规模）毫秒级

## 残余

- 并行工作树（迭代44-r4 cli.ts/csharp.ts 未提交改动）——cli 集成视冲突定；库 API 必落
- k-core 暂缓（图证据变化再启用）；B/D/E 明确砍（YAGNI 与谱诊断同判据）
