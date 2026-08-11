# InitDeity 迭代 22 复扫审计（scout 产出）

> 扫描：`J:/旧宇宙/代码仓库/InitDeity/Assets`，codeaudit 0.2.0（本次已重新 build：`tsc` EXIT 0）
> 命令：`node dist/cli.js scan "J:/旧宇宙/代码仓库/InitDeity/Assets" --no-cache --json`（EXIT 0，耗时约 1 分钟）
> 原始报告：`initdeity-report.json`（40.8MB，同目录）｜脏文件清单：`dirty.txt`（156 条，同目录）
> 扫描为只读：`--no-cache` 不写 cache、语料被禁用（cli.ts:198 逻辑）——**InitDeity 工作树零改动**（扫描前后 git status 156 条，md5 一致）

---

## a) 复扫现状

### 判定分布（无标注回读）

| 指标 | 本轮复扫 | 基线（CODEAUDIT-TECH-DEBT.md） | Δ |
|---|---|---|---|
| files | 3004 | 3004 | 0 |
| chunks | 23800 | 23800 | 0 |
| PURE | 8590 | 9548 | −958 |
| IMPURE | 9449 | 10803 | −1354 |
| UNKNOWN | 5761 | 3449 | **+2312** |
| unknown-rate | 27.7% | 18.0% | +9.7pp |
| parseErrors | 77 文件 / 1034 chunks | 77 文件 | 0（中文标识符） |
| cycles | 11 | — | — |
| 自环 chunks | 72 | 「72 个自环的主体」 | 0（API.g.cs 占 47） |
| invariantViolations / staleEdges | 0 / 0 | — | — |

### 差异归因（关键，写报告时必带）

**Δunknown +2312 ≈ 基线 2654 条标注未生效，基线不可复现。**
- 基线数字（9548/10803/3449）是「标注清零后」的**带标注**扫描：`initdeity-annotations.json`（PURE 1331 / IMPURE 1323，见 `D:/node/codeaudit/docs/iter21-review.md:29`）。
- 该标注文件**两个仓库都找不到**（已搜 `D:/node/codeaudit`、`J:/旧宇宙/代码仓库/InitDeity`，仅剩 `Assets/.codeaudit/corpus.json` 形态先验——只有 method/cell 计数，**无 per-chunk verdict，无法重建**）。
- 任务给定命令无 `--annotations` 参数，且 `--no-cache` 同时禁用语料（cli.ts:198）。`src/engine/scan.ts:235-260`：标注在扫描期按 chunk.id（内容寻址）注入——PURE 删 `?`、IMPURE 加 io。无标注 → 这些 chunk 全部回落 UNKNOWN。
- 另：用户 156 个脏文件（Assets 下 72 个，其中 66 个在扫描语料内）内容已变 → 即使有标注文件，这些 chunk 的 id 也已漂移，标注会静默不匹配。
- **结论**：本轮数字 = 诚实无标注基线。要复现原基线需找回 `initdeity-annotations.json`；否则 9548/10803/3449 应标注为「含 2654 条人工标注证据，当前不可复现」。

### 效应源 top（IMPURE + direct，按调用者数）

| 调用者 | chunk | 位置 | 效应 | 备注 |
|---|---|---|---|---|
| 254 | ChillyRoomService.GetSdk | ChillyRoomSdkClient/ChillyRoomService.cs:154 | state | 惰性单例（真实 state，非假阳） |
| 46 | RuntimeMainlineAutopilotRuntimeTests.SetPrivateField | InitDeity/Tests/Editor/...:4702 | io | 测试反射写 |
| 43 | NullSafetyAuditTests.ReadSource | InitDeity/Tests/Editor/NullSafetyAuditTests.cs:20 | fs+io | 测试读源码 |
| 37 | RuntimeMainlineAutopilot.RecordSnapshot | InitDeity/Framework/Module/Automation/RuntimeMainlineAutopilot.cs:4825 | io+state(+fs,clock) | 自动化主循环 |
| 36 | LoginManager.MarkValidationStage | InitDeity/Framework/Module/Online/LoginManager.cs:88 | state+io | **脏文件** |
| 34 | GizmosExtension.Draw2DCircle | InitDeity/Bootstrap/Utils/GizmosExtension.cs:18 | io | Debug.DrawLine 惯例 io |
| 28 | RewardClient.ConvertToString | ChillyRoomSdkClient/InitDeity/API.g.cs:48407 | io | **假源（见 c)）** |
| 26 | ConfigTable.LoadAllConfigTables | InitDeity/Framework/Module/Utils/ConfigTable.cs:225 | state+io | **脏文件** |
| 24 | PlayerCharacterManager.ToCharacterInfo | InitDeity/Framework/NonModule/CharacterGrow/...:2156 | io | |
| 23 | DOTweenTMPAnimator.ValidateChar | Plugins/Demigiant/DOTweenPro/DOTweenTextMeshPro.cs:303 | io | 插件 |
| 18 | L.Assert | CosmosFramework/AOT/Misc/L.cs:27 | io | |
| 17 | BuglyAgent.DebugLog | Plugins/BuglyPlugins/BuglyAgent.cs:299 | io | |
| 16/15/14/13/13 | Building/Dev/Weapon/Quest/ShopClient.ConvertToString | API.g.cs | io | **假源** |

直接效应源 chunk 总数 8118：InitDeity 5404（66.6%）、Plugins 2045、ChillyRoomSdkClient 530、CosmosFramework 79、CosmosEditor 42、其余 <10。
（口径注：基线「Framework 2673 效应源 / 6006（44%）」是效应计数口径；本轮为 direct-IMPURE chunk 数——不可直接比对，仅给量级。）
效应类型分布（IMPURE chunks）：state 7108 / io 4019 / fs 588 / net 378 / random 274 / clock 165。
最深链：chain=3 仅 SRList.SRList；chain=2：PlayerCharacterSprite.OnEnable（脏）、ScreenShake.TestShake、LiveMainlinePlayRunner.BuildRuntimeObservationSummary（Editor）、RuntimeCommandBridge.GetPortForTest/ResolvePortForTest/ShouldRejectQuestMutationForTest、RuntimeMainlineAutopilot.ShouldInstallHeadlessQuestCompleterForTest。

### unknown 形态

- 未知站点 60490（裸调 obj=null 24473 / 链式 36017）——注意基线 §六 的 2443/6595 是**标注后**口径（PURE 标注清零站点），且只统计 unknown verdict；本轮为全量，不可直接比。
- unknown 最多文件：API.g.cs 509、RuntimeMainlineAutopilot.cs 124、HttpRequestTimelineRecorder.cs 69、GMPanel.cs 48、StarterMainlineFlowTests.cs 47、QuestProgressionManager.cs 33（中文标识符+动态分派，与基线一致）。

---

## b) 安全重构清单（不在脏集合、方向明确、低风险）

筛选前提：仅列 156 脏文件之外的项；脏集合内（含 OnEnable 的 PlayerCharacterSprite.cs、ConfigTable.cs、NetCall.cs、LoginManager.cs 等）一律排除。

### 1. `Assets/Plugins/StompyRobot/SRF/Scripts/Collections/SRList.cs:30` — SRList(IEnumerable) 构造器去 state（P1 债项，低收益）
- **改动**：`public SRList(IEnumerable<T> source) { AddRange(source); }` → 一次性拷贝，不再走 AddRange→Add 状态写入链。例：`_buffer = new List<T>(source).ToArray(); _count = _buffer.Length;`（语义等价：新实例 append 全量 ≡ 数组拷贝；null 入参两种写法都 NRE）。
- **预期效应变化**：该 chunk 从 IMPURE(state, chain=3) 去 state（可能因 List/LINQ 解析落 UNKNOWN 而非 PURE——去 state 目标仍达成）；SRList.cs 内部 3 环消失。
- **诚实标注**：实测该构造器**全语料 0 直接调用者 / 0 传递调用者**（泛型构造解析可能低估，见 c)）。债务文档「任意使用 SRList 的代码被污染」的**传染主张数据不支持**——重构收益≈0，仅清理内部环。低优先级，可选。

### 2. `Assets/InitDeity/Vfx_Test/ScreenShake.cs:254` — 删/隔离 TestShake（chain=2 state+random 源）
- **改动**：删除 `[ContextMenu("手动测试震动")] TestShake()`，或包 `#if UNITY_EDITOR`（文件本身已是 Vfx_Test 手测目录）。
- **预期效应变化**：消除 1 个 state+random 效应源；`TriggerShakes` 若仅被 TestShake 调用也可下沉。零生产调用者，零运行时风险。
- **诚实标注**：收益同样≈0（Vfx_Test 手测文件）；价值在去噪音，非去污染。

### 方向明确但**非低风险**（不满足清单门槛，供父会话决策）
- **ForTest 方法族迁出生产模块**（P0 债项）：`RuntimeCommandBridge.cs`（GetPortForTest/ResolvePortForTest 等 5+ 个，fs/io）与 `RuntimeMainlineAutopilot.cs`（ShouldInstallHeadlessQuestCompleterForTest/IsStrictPlayerMainlineForTest/GetQuest16InteractivePriorityForTest 等，io）。两文件**均不在脏集合**，方向明确（`#if TESTING` / 迁 Tests/），但 RuntimeMainlineAutopilot.cs 6300+ 行、是用户自动化主循环核心，且 ForTest 方法被生产路径调用（headless 模式）——**手术风险高，非低风险项**。建议等用户脏工作收敛后再议。
- **API.g.cs ConvertToString**（P0 债项）：47 个 chunk 全自环（自环 72 个中的 47）。文件不在脏集合，但属 NSwag 生成代码——修复应在生成器（generate_locust_sdk）而非仓库内；且其 io 效应是工具假阳（见 c)），仓库内「去 io」无从谈起。

---

## c) 工具盲区观察（新发现假纯/假 IMPURE 候选）

1. **【假 IMPURE·强证据】API.g.cs `ConvertToString` ×47 direct io —— System.Reflection/Runtime 前缀误伤**（与迭代 21 删除的 ApiClientHelper.SetOriginalUrl / HttpRequestTimeline.BuildUrl 同一家族）。
   - 机制：`src/lang/packs/csharp.ts:270-273` `frameworkIo.System` 含 `"Reflection"`、`"Runtime"`、`"Globalization"` 等前缀 → 任何 `System.Reflection.*` / `System.Runtime.*` 调用被标记 io。
   - 47 个 ConvertToString 均为纯字符串/反射元数据读取（`IntrospectionExtensions.GetTypeInfo` / `CustomAttributeExtensions.GetCustomAttribute` / `EnumMemberAttribute` 读属性 + 自递归数组 join），无任何真实 io，但全部 `direct=['io']`、全部 IMPURE。
   - 同类成员：`InitDeity/Bootstrap/BootScript.cs`（GetCustomAttribute）、SRF/SRDebugger 插件内 8 处反射调用（SRReflection.cs、NetFxExtensions.cs、SRServiceManager.cs 等）。
   - 修复方向：frameworkIo.System 收紧——只保留真 io 类（Console/Environment/Diagnostics/IO/Net/Data/Threading/Process/GC），把 Reflection/Runtime/Globalization/Text 移出；或对元数据读取 API（GetTypeInfo/GetDeclaredField/GetCustomAttribute）加 pure 例外。**注意**：MethodInfo.Invoke 是动态调用，不应放行——建议按方法名白/黑名单而非前缀。
2. **【真 state·大传播面观察】ChillyRoomService.GetSdk（254 调用者, state）**——惰性单例赋值是真实 state 写，非假阳；但 254 个调用者被一个三行 getter 污染是效应表口径的放大效应。不构成重构建议（SDK 层），供效应表/口径讨论。
3. **【修正债务文档】SRList 构造器传染主张与数据不符**：`chain=3` 真实，但全语料 0 调用者。可能因泛型构造调用解析弱（`new SRList<T>(x)` 的 object_creation 对泛型类型构造可能解析到类级而非构造器 chunk）——属工具盲区候选：**泛型实例化目标解析存在低估，建议抽查 `new SRList<...>(collection)` 形态在 extractor 的解析路径**。
4. **【基线不可复现】标注文件缺失**：`initdeity-annotations.json`（2654 条）不在任何仓库；corpus.json 只存形态先验不存 verdict。任何「与基线对齐」的复扫都必须显式声明口径（带标注 vs 不带）。建议：父会话决定是否接受本轮无标注基线作为新基准，或将标注文件归档入库（.codeaudit/annotations.json 惯例位）。
5. **假纯候选（弱）**：本轮 PURE 8590 无 chain=inf 之外的可疑形态；已知盲区（Unity 生命周期方法 OnEnable/Start 内的副作用、`?.Invoke()` 事件触发）在基线已覆盖。未发现新的高置信假纯。

---

## 附：文件与数据位置

- 报告 JSON（40.8MB）：`initdeity-report.json`（与本文同目录）
- 脏文件清单：`dirty.txt`（156 条，`git status --short` 原始输出）
- 脏文件构成：Assets 下 72 个（66 个在扫描语料）；其余为 `_mimo_correctness_reports/` 删除（59）、Tools/（6）、docs/bugfix-ledger.md、.gitignore、meta 等
- codeaudit 关键源码：`src/cli.ts:136-160`（标注注入）、`src/engine/scan.ts:233-260`（标注应用）、`src/lang/packs/csharp.ts:257-279`（frameworkIo 前缀表）
