# InitDeity R1 审计：Automation ForTest 隔离（迭代 33 R1，只读侦察）

> 侦察结论输出（供主会话落实）。目标文件：`Assets/InitDeity/Framework/Module/Automation/RuntimeMainlineAutopilot.cs`（7887 行）、`RuntimeCommandBridge.cs`（2140 行）。
> 仓库路径：`J:/旧宇宙/代码仓库/InitDeity`。工作树 158 脏文件，本次全程只读，未触碰任何文件。

## 0. 结论摘要

- 两文件共 **21 个 `*ForTest` 方法**（Autopilot 11 + Bridge 10），与 P0 预估 ~20 吻合。
- **A 类（仅测试调用，可 #if UNITY_EDITOR 安全隔离）：17 个**（Bridge 全部 10 个 + Autopilot 7 个）。
- **B 类（生产路径调用，不可直接 #if 隔离）：4 个**，全部在 Autopilot（L2085 / L2254 / L2276 / L2334 / L2345 共 5 处生产调用点，位于 `TryStartQuest9014TeamLoad` 与 `TryHandleVisibleDrawDoorUi` 方法体内）。与主会话初步发现一致：直接 `#if UNITY_EDITOR` 包声明会破坏生产编译。
- 生产文件内 ForTest 相关行共 23 处：11 处声明 + 12 处调用（5 处生产路径调用 + 7 处 A 类包装内部委托调用）。
- 附加发现：A 类中 `GetQuest17IronMaterialStatusForTest`（L4166）**无任何调用者**（死代码）；B 类改名受 `Quest15DrawDoorTaskSegmentDefinitionTests.cs:57` 源码文本断言约束。

## 1. ForTest 方法清单表

### 1.1 RuntimeMainlineAutopilot.cs（11 个）

| # | 方法（行号） | 调用方类别 | 判定 | 生产侧影响 | 风险 |
|---|---|---|---|---|---|
| 1 | `ShouldHandleQuest9014TeamLoadForTest` L2237 | **生产**：`TryStartQuest9014TeamLoad` L2085；测试：RuntimeMainlineAutopilotRuntimeTests.cs:375-396、Quest9014TeamLoadTaskSegmentDefinitionTests.cs:33-51 | **B** | 纯谓词（questId/条件/candidate/teamCount 入参判定），无 fs/io/clock | #if 包裹 → 生产编译断（L2085） |
| 2 | `ShouldCloseQuest15DrawDoorAfterRewardForTest` L2377 | **生产**：`TryHandleVisibleDrawDoorUi` L2254、L2276；测试：RuntimeMainlineAutopilotRuntimeTests.cs:2058-2070 | **B** | 纯谓词 | #if 包裹 → 编译断；**改名受 Quest15DrawDoorTaskSegmentDefinitionTests.cs:57 源码断言约束** |
| 3 | `ShouldCloseQuest15EmptyDrawDoorPanelForTest` L2385 | **生产**：L2334；测试：RuntimeMainlineAutopilotRuntimeTests.cs:2078-2094 | **B** | 纯谓词 | #if 包裹 → 编译断 |
| 4 | `ShouldCloseStaleDrawDoorPanelForTest` L2425 | **生产**：L2345；测试：RuntimeMainlineAutopilotRuntimeTests.cs:2103-2125 | **B** | 纯谓词 | #if 包裹 → 编译断 |
| 5 | `GetQuest12RepairMaterialStatusForTest` L4116 | 仅测试：RuntimeMainlineAutopilotRuntimeTests.cs:482、**Quest12RepairTaskSegmentDefinition.cs:98（PlayMode）** | **A** | 包装 `GetQuest12RepairMaterialStatus` L4125（生产基函数调用点 L3434 保留） | PlayMode 调用方在 player 构建下编译失败（见 §3 风险） |
| 6 | `GetQuest17IronMaterialStatusForTest` L4166 | **无调用者（死代码）**；内部委托 L4168 | **A** | 包装 `GetQuest17IronMaterialStatus` L4175（生产基函数调用点 L1717/1726/3266 保留） | 可直接删除或 #if 隔离 |
| 7 | `ShouldKillQuest7ResourceAtContactForTest` L5274 | 仅测试：RuntimeMainlineAutopilotRuntimeTests.cs:2599-2662 | **A** | 包装 `ShouldKillQuest7ResourceAtContact` L5284（生产基函数调用点 L5203 保留） | 无 |
| 8 | `ShouldKillQuest17IronResourceAtContactForTest` L5279 | 仅测试：RuntimeMainlineAutopilotRuntimeTests.cs:2974-2997 | **A** | 包装 L5311（生产基函数调用点 L5204 保留） | 无 |
| 9 | `IsStrictPlayerMainlineForTest` L5373 | 仅测试：RuntimeMainlineAutopilotRuntimeTests.cs:150、167 | **A** | 包装 `IsStrictPlayerMainline` L5388（env 读；生产基函数调用点 L276/L576 保留） | 无 |
| 10 | `ShouldInstallHeadlessQuestCompleterForTest` L5378 | 仅测试：RuntimeMainlineAutopilotRuntimeTests.cs:151、168 | **A** | 包装 L5383（生产基函数调用点 L228 保留） | 无 |
| 11 | `GetQuest16InteractivePriorityForTest` L6312 | 仅测试：Quest16RepairBuildingTaskSegmentDefinitionTests.cs:156、158 | **A** | 包装 internal `GetQuest16InteractivePriority` L6305（生产调用点 L6268 保留） | 无 |

### 1.2 RuntimeCommandBridge.cs（10 个，全 A）

| # | 方法（行号） | 调用方类别 | 判定 | 生产侧影响 | 风险 |
|---|---|---|---|---|---|
| 12 | `GetPortForTest` L161 | 仅测试：StarterMainlineFlowTests.cs:2020、FullFlowCoreTests.cs:145（均 PlayMode） | **A** | 读 instance.port / 调 `ResolveDefaultPortForCurrentProject`（fs：Application.dataPath + Path.GetFullPath）；生产基路径 L108（EnsureInstalled）、L1862 保留 | PlayMode 调用方 ×2 在 player 构建下编译失败 |
| 13 | `ResolvePortForTest` L166 | 仅测试：RuntimeCommandBridgeTests.cs:598-605 | **A** | 包装 `ResolveDefaultPort` L2053（fs：Path.GetFullPath via NormalizeProjectPath）；生产经 L2050 保留 | 无 |
| 14 | `GetPendingQueueDepthForTest` L233 | 仅测试：RuntimeCommandBridgeTests.cs:347 | **A** | 读 commandQueue.Count（state）；生产 BuildBridgeStatus L217-221 自读，不依赖本方法 | 无 |
| 15 | `TryHandleImmediateCommandForTest` L246 | 仅测试：RuntimeCommandBridgeTests.cs:313-320 | **A** | 生产有兄弟方法 `TryHandleImmediateCommand` L449（L433 调用）完全独立 | 无 |
| 16 | `IsStrictPlayerMainlineForTest` L758 | 仅测试：RuntimeCommandBridgeTests.cs:159、176 | **A** | 包装 L799（env 读）；生产基函数调用点 L748/L796 保留 | 无 |
| 17 | `ShouldRejectQuestMutationForTest` L763 | 仅测试：RuntimeCommandBridgeTests.cs:160、177 | **A** | 包装 L794 | 无 |
| 18 | `TryParseNudgeArgsForTest` L768 | 仅测试：RuntimeCommandBridgeTests.cs:331-339 | **A** | 包装 L1453（纯解析）；生产调用点 L841 保留 | 无 |
| 19 | `BuildCommandHelpForTest` L773 | 仅测试：RuntimeCommandBridgeTests.cs:288、521 | **A** | 包装 L1937（纯字符串）；生产调用点 L262/L791 保留 | 无 |
| 20 | `BuildResourceDumpForTest` L778 | 仅测试：RuntimeCommandBridgeTests.cs:504 | **A** | 包装 L1949（state 读）；生产调用点 L1291 保留 | 无 |
| 21 | `IsLoopbackHostForTest` L2039 | 仅测试：RuntimeCommandBridgeTests.cs:25-28、RuntimeCommandDebugPanelTests.cs:26-29 | **A** | 包装 L2113（纯字符串）；生产调用点 L297 保留 | 无 |

## 2. 隔离方案

### A 类（17 个）：`#if UNITY_EDITOR` 包裹（方法体或整个方法声明）

- 生产编译不破坏：全仓库 grep 证实 A 类方法在生产（非 Tests）文件中**零调用**；唯一生产文件内出现处是 Autopilot 内 7 处包装内部委托（L4118/4168/5277/5282/5375/5380/6314），随方法体一起包裹即闭合。
- 测试不受影响：`UNITY_EDITOR` 在编辑器内对 EditMode + PlayMode 测试程序集均定义（EditorTests.asmdef includePlatforms=[Editor]；PlayModeTests.asmdef includePlatforms=[]，但在编辑器中编译时 UNITY_EDITOR 全局定义）。Framework 生产程序集已有大量同类先例（如 RuntimeCommandBridge.cs:1376 `#if UNITY_EDITOR || DEVELOPMENT_BUILD`、Enemy.cs、WorldLoader.cs 等）。
- 建议形态（示例，Autopilot L5373）：

```csharp
#if UNITY_EDITOR
        public static bool IsStrictPlayerMainlineForTest() => IsStrictPlayerMainline();
#endif
```

- `GetQuest17IronMaterialStatusForTest`（L4166）：零调用者 → **直接删除**（比 #if 更干净；`#if` 亦可）。
- **已知残余风险**：PlayMode 测试文件 3 处调用（StarterMainlineFlowTests.cs:2020、FullFlowCoreTests.cs:145、Quest12RepairTaskSegmentDefinition.cs:98）若被编译进 player/真机测试构建（PlayModeTests.asmdef includePlatforms=[] 允许），符号不存在 → 编译失败。缓解选项：接受（PlayMode 测试常规在编辑器跑）；或后续把这些调用改为非 ForTest 生产 API（如 GetPortForTest → 复用 `ResolvePortForTest`/生产常量；Quest12 → 调生产基函数 `GetQuest12RepairMaterialStatus()`）。

### B 类（4 个）：记录不动，理由

- 生产方法体直接调用（L2085/2254/2276/2334/2345），`#if UNITY_EDITOR` 包裹声明会破坏 player 构建编译。
- 它们是**纯谓词**（入参 + 静态常量判定），本身不携带 fs/io/clock 效应——不是 --sources 效应源，隔离对效应归属无收益。
- 真正的债是**命名**（生产逻辑挂了 ForTest 后缀），修法是改名去后缀（如 `ShouldHandleQuest9014TeamLoad`）。
- 改名硬约束：`Quest15DrawDoorTaskSegmentDefinitionTests.cs:57` 断言生产源码包含字符串 `"ShouldCloseQuest15DrawDoorAfterRewardForTest"`——改名需同步改该测试；`RuntimeMainlineAutopilotRuntimeTests.cs:189-190` 源码断言针对生产基逻辑文本（`!IsStrictPlayerMainline()` 调用形态），与 ForTest 方法名无关，不受影响。
- 建议：改名列为迭代 33 后续 workitem（P1），R1 本次不触碰。

## 3. 预期效应变化（隔离后 --sources 该模块 fs/io 源减少量）

对 17 个 A 类包装做传递效应归因（按 codeaudit 效应表口径）：

| 效应类型 | 携带的 A 类包装 | 隔离后变化 |
|---|---|---|
| fs | `GetPortForTest`、`ResolvePortForTest`（Path.GetFullPath / Application.dataPath） | 这 2 个符号从模块效应归属消失；**但底层 fs 载体（ResolveCurrentProjectPath L2069、ResolveDefaultPort L2053）仍被生产路径 L108/L1862/L2050 调用 → 模块 fs 源绝对值仅减约 2 符号归属，总量降幅小** |
| state | `GetPendingQueueDepthForTest`、`TryHandleImmediateCommandForTest`、`BuildResourceDumpForTest`、`GetQuest12/17RepairMaterialStatusForTest`（ConfigTable/BagManager/instance 字段） | ~5 符号消失（ConfigTable 属 fs 派生配置态，按工具口径归 state/unknown） |
| env | `IsStrictPlayerMainlineForTest`（两文件）、`ShouldRejectQuestMutationForTest`、`ShouldInstallHeadlessQuestCompleterForTest` | ~4 符号消失 |
| 纯 | `TryParseNudgeArgsForTest`、`BuildCommandHelpForTest`、`IsLoopbackHostForTest`、`ShouldKillQuest7/17ResourceAtContactForTest`、`GetQuest16InteractivePriorityForTest` | 本就不计效应，隔离无变化 |
| clock | 无（包装路径无 Time.realtimeSinceStartup） | 0 |

**诚实预期**：隔离是**归属卫生**收益（测试钩子符号从生产模块 --sources 效应表整体消失、player 构建不再携带测试符号），fs/io **数值减少量有限**（fs 约 2 符号、state/env 约 9 符号）。该模块 --sources top 的 fs/io 主导源在**生产路径本身**（TcpListener 端口绑定、ResolveCurrentProjectPath 路径读、ConfigTable 配置加载、日志 io），A 类包装只是其中一小部分符号；B 类纯谓词完全不贡献效应。若目标是显著压低模块 fs/io 计数，需另查生产路径效应源，超出本次 R1 范围。

## 4. 验证手段

1. **编译确认（双路径）**：
   - 编辑器全编译通过（EditMode + PlayMode 程序集）。
   - Player 构建（出包，无 UNITY_EDITOR 定义）编译通过——验证 A 类隔离不破坏生产。
2. **codeaudit --sources 前后对比**：对 `Assets/InitDeity/Framework/Module/Automation` 跑 `codeaudit --sources`（参照 CODEAUDIT-TECH-DEBT.md 口径，codeaudit 0.3.1 HEAD 99fb99a，288/288 基线），对比 top 效应源列表：
   - 预期消失：17 个 A 类符号（fs 2 + state/env 9 + 其余）。
   - 预期保留：B 类 4 个（纯，本就不在效应源）+ 生产基函数。
3. **测试回归**：RuntimeCommandBridgeTests（L25-28/159-177/288/313-347/504/598-605）、RuntimeMainlineAutopilotRuntimeTests（L150-168/375-396/482/2058-2125/2599-2662/2974-2997）、Quest9014TeamLoadTaskSegmentDefinitionTests、Quest16RepairBuildingTaskSegmentDefinitionTests、Quest12RepairTaskSegmentDefinition（PlayMode）、StarterMainlineFlowTests（PlayMode）、FullFlowCoreTests（PlayMode）、RuntimeCommandDebugPanelTests。
4. **B 类改名验证（若做）**：同步更新 `Quest15DrawDoorTaskSegmentDefinitionTests.cs:57` 断言字符串。

## 5. 关键文件索引

- `Assets/InitDeity/Framework/Module/Automation/RuntimeMainlineAutopilot.cs`（7887 行）— 11 个 ForTest，4 B + 7 A
- `Assets/InitDeity/Framework/Module/Automation/RuntimeCommandBridge.cs`（2140 行）— 10 个 ForTest，全 A
- 测试程序集：`Assets/InitDeity/Tests/Editor/InitDeity.EditorTests.asmdef`（includePlatforms=[Editor]）、`Assets/InitDeity/Tests/PlayMode/InitDeity.PlayModeTests.asmdef`（includePlatforms=[]，可进 player）— 均引用 Framework 生产程序集
- 源码断言测试（B 类改名约束）：`Assets/InitDeity/Tests/Editor/Quest15DrawDoorTaskSegmentDefinitionTests.cs:57`、`Assets/InitDeity/Tests/Editor/RuntimeMainlineAutopilotRuntimeTests.cs:189-190`
- 基线口径：`CODEAUDIT-TECH-DEBT.md`（P0 行 83：Automation ForTest 侵入生产模块）
