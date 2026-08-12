# 迭代 22-31 工程妥协综合审计（compromise-audit）

> 只读审计（HEAD d4d52d9 + 工作树 S1/S3 改动，2026-08-12 10:30 快照；290/290 测试绿）。
> 方法：`git log d4d52d9~25..HEAD`（25 提交）+ 逐提交 `git show` 核查 + 当前工作树代码走读 + 6 组合成探针实证（Math.Max/string.Join/Enumerable.Max/链式/stateReadPos）。
> 审计期间工作树为**移动靶**（S3 修复在会话中从"简单版"演进为"linqHof 分离版"）——已按最终状态核对，中间态回归另行记录（§1 C2）。
> 定义：**假纯** = 应 IMPURE/UNKNOWN 判 PURE（公理 3 违规，最重）；**假 UNKNOWN** = 应 PURE 判 UNKNOWN（方向安全，损判别力）；**过 IMPURE** = 应 PURE/UNKNOWN 判 IMPURE（方向安全，保守）。

---

## 1. 妥协清单（按严重度排序，假纯方向最重）

| # | 位置 | 妥协 | 本质 | 误判方向 | 现状证据 | 处置 |
| --- | ------ | ------ | ------ | ---------- | ---------- | ------ |
| C1 | `csharp.ts` L379-386 frameworkPure；`link.ts` L565-581 | **命名空间级前缀纯白名单**：`System` → ["Uri","Linq","Convert",...] 命中即 PURE，无方法级证明义务 | 启发式（语言事实义务以字符串前缀近似） | **假纯**（命中含副作用成员即错；iter30 S3 实证：`Enumerable.Select(xs, Console.WriteLine)` 假纯，公理 3 违规） | 已知两活洞（iter30 ForEach(xs,Save)、iter31 Select(xs,Console.WriteLine)）均为此表 + 回调吞并所致，靠 hof 表修补而非结构性收紧 | **需数学最小化（top 3 #1）** |
| C2 | `csharp.ts` L422-446 linqHof/hofCallsArgs/hofAlwaysArgs；`link.ts` L244-271, L578 | **名字基 HOF 分类**：按短方法名归类无条件/条件调用，arity 不敏感；全局表与纯静态方法撞名 | 启发式（人工裁决表 + 上下文分离半成品） | 假纯（空表/漏条，iter31 S3 前实证）；**假 UNKNOWN**（撞名，当前实证） | 当前树 `string.Join(",", xs)` → UNKNOWN（probe 实证 purity=1，Join/GroupJoin 仍留全局表）；会话早段简单版 `Math.Max(a, score)` → UNKNOWN（Unity 测试一度红，linqHof 分离后修复） | **需数学最小化（top 3 #2）** |
| C3 | `corpus.ts` L226-246 fitBaseRate | **矩估计**：μ=加权均值（w=n_j/Σn 大项目主导）、κ=μ(1−μ)/Var−1 反解、κ<0 钳 0、Var=0 钳 KAPPA_MAX=1e6、μ 钳 [1e-3,1−1e-3] | 近似（分层 Beta 的矩估计非似然最优；钳制是角情况裁决） | 无纯度影响（A7 契约：先验永不进判定）——只损标注建议质量 | 测试覆盖全角情况（corpus.test.ts L188-243）；设计文档化（iter22/base-rate-design.md） | **需数学最小化（top 3 #3）** |
| C4 | `extractor.ts` L196-280 stateReadPos + `state.ts` L20-65 stateDepsOf | **⊤ 近似 + 名基匹配**：下标/调用结果读 → "d.⊤"；多级 self 链 → "⊤"（probe 实证 `this.inner.v` → ["⊤","self.inner"]）；跨作用域同名过近似；写侧 "d.⊤" 只被 "d.⊤" 读者命中（与读侧 ⊤ 不对称） | 近似（启发式降级桶） | 纯元数据（公理 3 读非副作用）——漏/多报耦合，不进 purity；R_state 过报 → 门禁更保守 | state.test.ts 覆盖 ⊤ 暴露纪律；iter24 修复 .id 判等（=== 死代码跨语言） | 可接受（方向安全 ×2，作用域限定成本中-高、位置串格式波及缓存/语料） |
| C5 | `risk.ts` L77-117 D_MATRIX + gradeOf 15/35/60 + gateExit | **人工裁决基数 + 硬编码阈值**：D 矩阵 0.6/0.5/0.3/1.0 满足四序公理但基数无校准数据；15/35/60 按迭代 13/15 实测分布分位标定，注释明示"改任一须重标" | 硬编码 + 裁决值（已文档化联合体） | 咨询性风险分数/gate——无纯度影响；miscalibration 方向 = 门禁过严/过松 | risk.test.ts L151-159 边界全覆盖；iter13/15 标定文档 | 可接受（无 key 稳定翻转校准数据前，任何"更数学"都是虚构精度；阈值生成过程脚本化可作低成本改进） |
| C6 | `effectOverride.ts` L146-190 mergeRecord/mergeSet | **数组并集去重 + 键只增不删**：纯表只能并集不能删条；标量覆盖可换效应类但无法降级到 PURE；union 保 base 先序 | 平台语义（非数学近似） | 只增纯 → 用户无法引入假纯（方向安全）；错误内置条目只能改码 | validateEffectOverride 白名单 + 形状校验（iter28 复审 n2 补） | 可接受（能力缺口非正确性；如需删条可加 "!prefix" 删除标记，低成本可选） |
| C7 | `extractor.ts` stateReadPos 声明名抑制（iter26-27） | **结构位置启发**：name 字段/children[0]/pattern/foreach 的 `in` 之前位置枚举判定声明名 | 启发式（语法位置近似） | 漏读（声明名被抑制当非读）→ 漏耦合（元数据安全） | iter27 收尾实证（pattern/foreach/catch/except 变量），instance 读者 2633→1005 | 可接受（已迭代闭环；残余元数据级） |
| C8 | 当前工作树（S1 修补链） | **S1 修复的不完整性**：receiverTypeOf 加 invocation_expression 只修"链中继"，终端判定表 builtinTypeEffects 需同步补 TrimEnd/TrimStart 等——会话中曾测试红 289/290，补齐后绿 | 工程修补（半程修复） | 断链落 ?（诚实安全） | 已修：builtinTypeEffects L230-231 补 TrimStart/TrimEnd；S1 测试现绿 | 可接受（已闭环；教训 = 链中继与终端判定须同 PR 补表） |
| C9 | 会话早段 S3 简单版（已演进） | **快速小 diff 回归**：初始版把 29 个 LINQ 名直接塞全局 hofAlwaysArgs → Math.Max(a, score) 假 UNKNOWN（Unity 测试红） | 工程修补（撞名未预检） | 假 UNKNOWN（方向安全） | probe 实证 + 测试红记录；linqHof 分离版已修复 | 已修（见 C2 残余）——**防回归测试缺口**（Math.Max/string.Join 用例未入 csharp-lang 套件，string.Join 撞名即漏网） |

### 附带发现（记账不变量破坏，非独立妥协但需修）

- **`calls.has("?")` 而 `unknownSites=0`**：`link.ts` L269 `addArgEdges` 的 hofAlwaysArgs 兜底直接 `calls.add(UNKNOWN_TARGET)`，不经 markUnknown → 违反 `scan.ts` L272 文档化不变量 `calls.has("?") === (unknownSites > 0)`。
  - 后果：① 此类 UNKNOWN 不进 `unknownCalls` → `cli.ts` L443 标注导出要求 `unknownSites>0` → **标注工作流不可见、不可确证**；② `corpus.ts` L115 不学这类站点；③ `missingSiteRate`/`unknownEdges` 低估盲区。
  - TS 既有（map/filter 等，axioms.md 四#4 有意为之"记未知"），C# 由 S3 新激活（string.Join 实证 `calls=[?] unk=[]`）。
  - 修法（工程级，非数学）：addArgEdges 的 "?" 同步 `addUnknownCall` + `unknownSites++`，或把该兜底改走既有 markUnknown 通道。

---

## 2. 需数学最小化的 top 3

### #1 frameworkPure 命名空间前缀 → 方法级白名单 + 机检不变量（假纯方向，最重）

**现状**：`frameworkPure.System = [Uri, Linq, Convert, Enum, Text, Array, Math, TimeSpan, Guid, Collections]`（csharp.ts L379-386），命中 `attr === p || attr.startsWith(p+".")` → PURE。纯判定通道的直接输入，无逐方法证明义务；历史两次活洞（iter30/31）都是"纯前缀命中吞回调 io"。

**形式化方案**（两级收紧，可择一）：

1. **方法级白名单**：`frameworkPure: Record<namespace, Record<member, "pure" | "hof">>`（如 `Text: { StringBuilder: "pure", Encoding: "pure", Regex: "pure" }`、`Linq: { Enumerable: "hof" }`）。命中粒度从命名空间降到成员，未列成员落 `?`（诚实）。表条目要求 .NET 语言事实证据（文档链接或生成脚本）。
2. **机检不变量**（若保留前缀级）：把 S3 修补提升为可机检断言——"纯前缀命中 ⇒ (argFns 为空) ∨ (回调已解析) ∨ (回调入 linqHof → 记 ?)"。即对每条命中路径断言"回调义务已履行"，在 analyze 的不变量机检（countInvariantViolations 同层）或测试套件中落断言。

**成本**：方案 1 表体 ~10 命名空间 → 30-60 成员条目（一次性）+ 既有测试调整；方案 2 约 20 行断言 + 3 用例。**收益**：堵死该通道结构性假纯；漏条方向恒为 ?。

### #2 HOF 表 → 上下文限定 + arity 感知 + 记账修复（历史假纯实证 + 当前撞名残留）

**现状**：linqHof（LINQ 上下文）已与全局表分离，但分离不彻底——**Join/GroupJoin 仍留全局 hofCallsArgs/hofAlwaysArgs**（csharp.ts L432-446）→ `string.Join(",", xs)` 假 UNKNOWN（probe 实证）且记账不可见。全局表的触发面（纯静态类成员 string/List/…）与 LINQ 算子短名重叠是结构性风险。

**形式化方案**：

1. **上下文/arity 双感知**：LINQ 上下文 → linqHof（已建）；全局表条目加回调实参位置约束——`Record<name, { argPos: number }>`（`Enumerable.Max(xs)` 无 selector 不触发；`Select(xs, cb)` 的 cb 在 pos 1 触发）。argFnsOf 已提取实参列表，改动 ~10 行。
2. **记账不变量修复**：addArgEdges 的 "?" 走 markUnknown 通道（unknownSites++ + addUnknownCall），恢复 `scan.ts` L272 不变量。
3. **立即止血（工程级）**：Join/GroupJoin 移出全局表（LINQ 上下文由 linqHof 覆盖，全局无其他合法触发面——C# 无全局裸 Join 调用）。

**成本**：止血 2 行；arity 感知 ~10-15 行 + 4 用例。**收益**：消灭当前假 UNKNOWN + 恢复标注工作流可见性 + 防未来撞名。

### #3 fitBaseRate 矩估计 → 经验贝叶斯 profile-MLE（或最小：信息量加权）

**现状**：μ = Σ w_j·θ̂_j（w=n_j/Σn），κ = μ(1−μ)/Var − 1。矩估计非似然最优：① 大样本项目权重过大（信息量 ∝ n·κ/(κ+n)，大项目应下压）；② 项目数少时矩估计高方差；③ κ<0 钳 0 丢弃负相关性信息。

**形式化方案**：

1. **信息量加权（最小改动）**：w_j ∝ n_j·κ̂₀/(κ̂₀+n_j)（κ̂₀=12 初值），固定点迭代 2-3 轮——比纯 n 加权更接近 EB 最优，~8 行。
2. **profile-MLE（完整）**：对边际似然 ∏_j BetaBin(k_j; n_j, μ, κ) 一维数值优化 κ（μ 固定为加权均值；或 logit 尺度二维 grid）。~20-30 行（无新依赖，手写 Newton/黄金分割即可）+ 2 测试（对拍矩估计：同数据 κ_MLE ≥ κ_MOM 的关系断言 + 单峰性 sanity）。
3. 钳制（KAPPA_MAX/MU_CLAMP/κ<0→0）保留为序列化守卫，但参数估计在 logit/方差点上做可消除大部分钳制需求。

**成本**：方案 1 ~8 行；方案 2 ~30 行 + 2 测试。**收益**：先验建议的统计最优性（判别力），方向安全（不进判定）故非正确性必需——**若语料项目数长期 < 3，矩估计与 EB 差异不可观测，可延后**（数据门槛：≥4 个有计数项目才值得）。

---

## 3. 可接受的妥协（方向安全、成本不抵）

| # | 妥协 | 接受理由 |
| --- | ------ | ---------- |
| C4 stateDepsOf ⊤/名基 | 纯元数据（不进 purity）；读/写两侧 ⊤ 不对称但都方向安全（读侧过报 → 门禁更保守；写侧漏报 → 耦合图是下界，文档化）；作用域限定成本中-高（位置串格式波及缓存/语料/既有报告），收益仅为耦合图精度 |
| C5 D_MATRIX/gateExit 阈值 | 已文档化"联合体改任一须重标"+ 分位校准流程；**无 key 稳定翻转校准数据**（稀有、单项目偏置）——任何更严格的基数都是虚构精度。可做低成本改进：阈值生成过程脚本化（可复现重标），非数值最小化 |
| C6 mergeRecord/mergeSet | 平台语义非数学近似；只增纯的合并方向安全（用户无法引入假纯）；删条缺口可用 "!prefix" 删除标记补（低成本可选，非必需） |
| C7 stateReadPos 抑制规则 | 迭代 24-27 已实证收敛（instance 读者 2633→1005，判定 UNKNOWN 28.1%→25.0% 正确化）；残余为元数据级漏耦合 |
| C8 S1 表补齐 | 已闭环（builtinTypeEffects 补 TrimStart/TrimEnd）；教训已记录（链中继与终端判定同 PR 补表） |
| fitBaseRate 的钳制常量（KAPPA_MAX/MU_CLAMP） | 纯序列化/数值守卫，测试全覆盖；在 §2#3 方案中保留 |

---

## 4. 结论

**CHANGES** — 存在需修的妥协（均为低成本工程修补，非大改）：

1. **C2 残留撞名（当前活缺陷）**：`string.Join(",", xs)` → 假 UNKNOWN 且标注工作流不可见（probe 实证 `purity=1, calls=[?], unknownCalls=[]`）——Join/GroupJoin 移出全局 hof 表（2 行），并补 Math.Max/string.Join/Enumerable.Max 防回归用例（本次会话 S3 简单版即因此回归过一次）。
2. **记账不变量破坏**：addArgEdges 的 "?" 不经 markUnknown → 违反 `scan.ts` L272 不变量，此类 UNKNOWN 不可标注确证——同步 unknownCalls/unknownSites（~5 行）。
3. **frameworkPure 假纯通道（结构性）**：按 §2#1 方案 2（机检不变量）或方案 1（方法级白名单）收紧——历史上两个假纯活洞均出于此表，当前只靠 hof 表修补。

数学最小化优先级：§2#2（含止血）→ §2#1 → §2#3（可等数据门槛 ≥4 项目）。

---

## 附：验证记录（本审计实证）

| 探针（合成 C#） | 结果 |
| --- | --- |
| `"  hello  ".Trim().ToUpper().TrimEnd()` | PURE ✓（S1 闭环） |
| `Math.Max(a, b)` | PURE ✓（linqHof 分离修复） |
| `System.Linq.Enumerable.Max(xs)`（无 selector） | PURE ✓（arity 不敏感已随分离缓解） |
| `string.Join(",", xs)` | **UNKNOWN + calls=[?] + unknownCalls=[]**（C2 残留，记账破坏） |
| `Enumerable.Select(xs, Console.WriteLine)` | UNKNOWN ✓（S3 目标行为） |
| `this.inner.v` 读 | stateReads=["⊤","self.inner"]（C4 ⊤ 降级实证） |
| 测试套件 | 290/290 绿（当前工作树快照） |
