# 数学层精度循环日志（自主循环，用户入睡期间执行）

目标：非标注、数学层精度提升，减少 `--unknowns` 标注负担。循环：独立数学家会议 → 共识特性落地 → 实测效果 → 按痛点再开会 → 直到边际效益不再明显。

基线（循环开始前，commit a964576）：

- swagger-ui/src/core：798 chunks，304 PURE / 440 UNKNOWN / 54 IMPURE，unknown-rate 57.5%，421 个 `?` 源（344 个单哨兵）
- egg controller：22 chunks，7/9/6，9 个 UNKNOWN 全来自 ctx.service/ctx.model 框架注入
- 测试：84 tests，81 passed（3 个既有 Windows 路径分隔符失败）

## 迭代 1：会议 #1（4 独立数学家，选题）

- 会议问题：从候选清单 A-G（字面量接收者 / objlit 方法容器 / .then Promise 来源证明 / 模块导出签名 / 返回溯源摘要 / 元素类型域 / 其他）选一个最高价值、健全、~100 行内、非标注的特性
- 会议结论（分歧→综合）：
  - **阻断级发现（图论）**：`influence.ts` 的 I(u) 方向反了——实现是前向闭包（u 的后代），标注语义需反向闭包（u 的调用方）。实证：a 调 b、b 含 `?`，标注 b 释放 a → I(b)=2。`--unknowns` 排序整体错向（top8 全为 inDeg=0 叶子）
  - **活假纯洞（类型论）**：`Array.from(xs, this.log)`——HOF 成员形回调被丢（argFnsOf 只收标识符），UI.build 报 PURE 但 this.log 有 io
  - **选型**：抽象解释/图论选 A（字面量，但实测仅 4 源 0.5pp）；类型论选 D（模块导出面，修 3 个已确认 bug + 默认导入噪音）；概率选 G（纯库表 + from-import 成员，实测 13 源）
  - **综合**：先修两个正确性问题，再落地 D 四件套 + G2 纯库表（D 是唯一同时修 bug、含 G2 机制、为 .then 级联铺路的选项）
- 落地（commit 5a14521）：影响面方向修复（含回归测试 a→b）；HOF 成员形回调（this./self. 前缀解析）；模块导出面解析（from-import 类成员真边、别名再导出跟随、export * as ns 命名空间链、Python 点连模块前缀剥离、assigned 遮蔽守卫防重绑假纯）；G2 纯库表（immutable/reselect/classnames/prop-types）；缓存 v3（顺带修 1fd2d22 的 latent warm/cold 缺口）
- 实测效果（swagger 798 chunks）：
  - UNKNOWN **440→428（−12）**，PURE 304→316，`?` 源 **421→408（−13）**，unknown-rate **57.5%→56.0%**
  - 影响面方向修复后 top 源：`isOAS3`(18)、`Store.getType`(11)——调用方枢纽（修复前是 inDeg=0 叶子）
  - egg controller：7/9/6 不变（框架注入，D 不触——符合会议预测）
  - 新增 8 个回归测试，92/95（3 个既有 Windows 失败）
- 痛点分析（迭代 2 的输入）：剩余 428 UNKNOWN 中，头部源（isOAS3 等）是 ident.*/参数方法调用（类型层已否决，只有标注能救）；egg 9 个 UNKNOWN 全为 ctx.service/ctx.model 框架注入；字面量接收者（A）尚未落地（会议实测仅 4 源）

## 迭代 2：会议 #2

- 会议问题：迭代 1 后剩余 428 UNKNOWN 的痛点下，下一个特性 or 停止？含停止评估授权
- 会议结论（概率视角完成；抽象解释/图论 agent 因探针卡住被中断，报告缺失）：
  - **Blocker（正确性）**：module chunk id 硬编码 "module"——swagger 164 个 module chunk 共享同一 id，标注一次泄漏到全部（标注工作流的正确性漏洞）
  - **可答性分析（实证抽样 73/408）**：90.4% 可答（读函数体即可判定），不可答仅 ~9.6%——"剔除不可答"假设被拒绝，瓶颈是标注成本（408 条 × 1-2 分钟）非可答性
  - **特性量化**：字面量 A = -0.3~-0.5pp（2-3 源，边际）；.then C 否决（仅 3 源且机制不匹配）；**egg 框架表 = 唯一 >1pp 特性**（egg 41%→9%）
  - **标注模拟实测**：top-29 标注 → -4.9pp；PURE-only 51 条 → -7.5pp；全样本 65 条 → -9.3pp——标注是高杠杆人工路线
  - **停止准则**（可执行阈值）：连续两迭代 unknown-rate 降幅 <1pp 且清单缩减 <10 条且无正确性 bug → 停止新特性；egg 表单独计
- 落地（commit d97b599）：module id 文件限定（module@<file>，~3 行）；frameworkIo 框架命名空间表（egg ctx.model/service/app → io 边界，link 分支 + 遮蔽守卫）
- 实测效果：
  - **egg controller：9→3 UNKNOWN，40.9%→13.6%**（6 个 UNKNOWN 转 IMPURE——ctx.model/service 兑现）
  - swagger：428/316/54 不变（零回归）；module id 唯一性修复
  - 测试 97 总，94 过（3 个既有 Windows 失败）
- **停止决策（循环终止）**：
  - swagger 特性路线已到边际：字面量 A（-0.5pp）与 .then C（否决）均低于阈值；剩余 428 中 90% 可答、头部源是 ident.* 参数调用（类型层已否决，只有标注能救）
  - 迭代 2 是最后一个特性迭代（egg 表按"单独计"例外执行）
  - 后续：只修正确性 bug，不立项新特性；标注工作流（--unknowns 影响面排序 + --annotations 回读）是剩余精度的主路线

## 循环总结（2 迭代，4 commits）

| 指标 | 循环前 | 循环后 | Δ |
|---|---|---|---|
| swagger unknown-rate | 57.5% | 56.0% | **-1.5pp** |
| swagger UNKNOWN chunk | 440 | 428 | **-12** |
| swagger `?` 源（标注清单） | 421 | 408 | **-13** |
| egg controller unknown-rate | 40.9% | 13.6% | **-27.3pp** |
| egg controller UNKNOWN | 9 | 3 | **-6** |
| 测试 | 84/81 | 97/94 | +13 回归测试 |

**正确性修复**（数学层）：影响面方向（--unknowns 排序错向）、HOF 成员形假纯洞、module-id 标注泄漏、缓存 v3（修 1fd2d22 latent 缺口）。
**精度提升**（数学层，非标注）：模块导出面解析（from-import 成员、别名再导出、export * as ns、Python 点连模块）、G2 纯库表、egg 框架命名空间。
**主路线确认**：会议 #2 实证——剩余精度的主杠杆是**标注工作流**（top-29 标注 -4.9pp），数学层特性已到边际收益。

## 循环后追加：标注预算数学（用户追问「数学层没有可优化的地方了吗」）

用户挑战停止决策 → 澄清：停止的是"精度特性"（unknown-rate 降幅度量），数学层还有**会计/预算/补全**类未做。采纳其中两件（commit a990231）：

- **`?` 多重性会计**：`Chunk.unknownSites`（calls 是 Set 只记一个 `?`，多重性丢失；标注需全部调用点确证）——导出清单与 suggested_prompt 均带调用点数
- **标注曲线（预算数学）**：`annotationBudget`（每源影响面 + 每 chunk 依赖数 |S(w)| + 释放桶，单趟 Tarjan）+ `annotationCurve`（贪心序逐条标注后的**精确**剩余 UNKNOWN，目标过滤为当前 UNKNOWN 集）
- **swagger 实测曲线**（直接回答「标多少个到 X%」）：
  ```
  标0条→428 (53.6%) | 标41条→372 | 标102条→306 (38.3%) | 标204条→204 (25.6%) | 标306条→102 | 标408条→0
  ```
  想降到 25% → 标 ~204 条；降到 <13% → 标 306 条。确定性承诺，非估计。
- 测试 99 总，96 过（3 个既有 Windows 失败）

**仍未做（用户可选）**：state 效应原子（效应格 {io}→{io,state} 补全）、加权链（阅读量语义）、谱诊断（λ₂）、正确性清单（缓存信任边界/深度上限/--strict 崩溃）。
