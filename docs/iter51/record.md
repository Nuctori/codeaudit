# 迭代51 记录（record）：信息展示合理性 + 代码质量影响排序审计

> 用户指令：「开会审计，目前的信息展示是否合理，代码质量影响的排序。进行'审计修复循环'」
> 流程：00-plan → 01-math-review（数学家）→ 02-jeff-review（Jeff Dean）→ 03-synthesis → 修复 → 验证。
> 基线：19623ef（Iter-50-r4），407/407。并行工作树探针脚本（cache-*.cjs）不碰。
> 注：用户中途问「await 有正确处理吗」——探针实证 `await readFile()`→fs、`await fetch()`→net、`await p`（变量）→PURE、无 await 返回 promise→fs——await_expression 透明包裹，无盲区。

## 双评审发现

| # | 发现 | 评审 | 处置 |
| --- | --- | --- | --- |
| P1-1 | 纠缠环影响键被展示截断污染（comp.slice(0,6) 在 impact 前——>6 成员环排序键同错） | 数学家 | **修**：impact 用全量 size，展示再截 |
| P1-2 | 传播深度源→源调用边静默截断（isSource 跳过传播——副作用函数调副作用函数是常态，深度被压成「不经过中间源的最长源距」） | 数学家 | **修**：源不跳过，depth=max(0,1+max depth[callee]) 全跑 |
| P1-3 | --top json/text 语义分歧（json 直接 slice 扫描序，注释自称一致但过期） | 数学家 | **修**：json 同样 in-degree 治理排序 |
| P1-4 | HTML「纠缠环成员」= 拓扑治理优先级纠缠环严格子集 | 数学家 | **删**（极小性） |
| P1-5 | README 公理5 自相矛盾（字典序 vs in-degree 实装） | Jeff | **修**：改为「单量纲排序 + 平手 tiebreak」 |
| P1-6 | 默认清单组头交错（in-degree 跨组排序 → IMPURE/UNKNOWN 交替首屏噪音） | Jeff | **修**：先分组（IMPURE→UNKNOWN）组内 in-degree |
| P1-7 | density（已废判据）仍占 CLI 首行 | Jeff+数学家 | **修**：text 首行删 density（API 保留） |
| P2 | 多项（maxPropDepth=-1 哨兵/治理平手键不统一/inDeg 含自环/README 测试数漂移等） | 双评审 | 记录，部分随 P1 修复自然解决 |

## 修复与验证

- P1-1：entangled 保留 size 全量，impact=entries×size，展示 slice(0,6) 不变
- P1-2：深度 DP 源分量不跳过——InitDeity **6→22 跳**（NetworkProbeResult→MeasureNetworkAsync→ProbeBaselineAsync→... 真实长链）
- P1-3：json --top 现与 text 同序（实测 connect 2-callers 排第一）
- P1-4：纠缠环成员视图删除（0 残留）
- P1-5：README 公理5 更新为当前实装语义
- P1-6：默认清单先纯度分组、组内 in-degree（实测组头单次出现）
- P1-7：CLI --topology 首行删 density
- 407/407 + tsc 0；InitDeity HTML 61KB（v8）

## 残余（诚实）

- P2 治理平手 chain 键 policy 不统一（cli :824 用 chain、html :43 用 chain）——同键已一致，record
- inDeg 含自环（自调 chunk 的 callers 计数含自身）——方向安全（高估），记录
- README 测试数漂移（并行会话维护中）——CI 门禁兜底
- 空项目 maxPropDepth 显示「最大 -1 跳」——测试已 pin 0|-1，文案可优化
- HTML 30 秒规则（执行摘要/每视图动作标签）——Jeff 建议，列为下轮候选

## 决策链

D-167（迭代51 展示审计修复：P1-1~P1-7 全修 + await 验证）。
