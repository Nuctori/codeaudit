# InitDeity 痛点挖掘 A（迭代 33）— pain-a.md 草稿

扫描基线：`docs/iter33/id-baseline.json`（`node dist/cli.js scan "J:/旧宇宙/代码仓库/InitDeity/Assets" --no-cache --table-usage --sources --state --top 20` 冷扫复跑，数字与基线**逐项一致**）。
工作树 158 脏文件，全程只读，未改动任何文件。

## 0. 总览（复跑校验）

| 指标 | 值 |
|---|---|
| chunks / files | 23799 / 3004（parse-errors 77） |
| pure / impure / unknown | 8045 / 10652 / 5102（unknown-rate 24.7%） |
| 图完整度 | **27.3%** 调用点已解析（59313 未知站点） |
| 效应源（chain=0 IMPURE 且 direct>0） | 9380 |
| 状态耦合写方 / 含 ⊤ | 6591 / 951（14.4%） |
| cycles | 11 |
| 效应表命中 | csharp 80（entries 161）；python/ts/tsx/js 全未中（语料为纯 C#） |

unknown 站点按目录：Framework 26636（44.9%）/ SdkClient 18393（31.0%，其中 **API.g.cs 单文件 18076 = 全项目 30.5%**）/ Tests 6812（11.5%）/ Plugins 5627（9.5%）。

## a) missSlots top 15：可表修 vs 动态分派不可修

csharp pack（五语言 pack 输出同一列表，见 e-TP4）：

| # | 槽位 | miss | 形态 | 可表修？ |
|---|---|---|---|---|
| 1 | `global:urlBuilder_` | 1173 | API.g.cs 局部变量 StringBuilder（API.g.cs:73-83 链） | **否**（局部变量动态分派；global 槽位是解析器兜底落槽） |
| 2 | `global:response_` | 1098 | API.g.cs 局部变量 HttpResponseMessage | **否** |
| 3 | `builtin:PrepareRequest` | 732 | 裸名调用（生成器未限定，API.g.cs:95） | 否（应解析为当前类方法，类内裸名解析缺失） |
| 4 | `global:ApiClientHelper` | 732 | 静态类调用（API.g.cs:96）| **是**，但被重载歧义挡住（见 e-TP2） |
| 5 | `global:client_` | 732 | 局部变量 HttpClient | **否** |
| 6 | `global:request_` | 713 | 局部变量 HttpRequestMessage | **否** |
| 7 | `global:ICommonUI` | 529 | 单例链 `ICommonUI.Common.instance.M()` | **是**（impureGlobals 成员级 `ICommonUI:[...:state]`；整类均为 UI 副作用） |
| 8 | `global:ConfigTable` | 447 | 单例链 `ConfigTable.tables.…` | 是（成员级：读表纯 / 写表 state） |
| 9 | `global:BagManager` | 404 | `BagManager.instance.SyncBag` 等 | 是（成员级：SyncBag/SyncBagWithClassify:state，GetItemCount:p） |
| 10 | `global:BaseUrl` | 366 | API.g.cs 实例属性 TrimEnd | 否（实例属性） |
| 11 | `global:StringAssert` | 345 | NUnit 断言 | **是**（pureGlobals，见 e-TP5） |
| 12 | `global:Does` | 330 | NUnit 断言 | 是（pureGlobals） |
| 13 | `global:context` | 303 | 局部变量 | 否 |
| 14 | `global:QuestProgressionManager` | 286 | 单例 `instance.…` | 是（成员级） |
| 15 | `builtin:GetDefaultGameObject` | 282 | 插件裸名/基类方法（281 调用点） | 否（基类方法，C# 继承不可见） |

结论：前 6 位（~5180 站点）是**生成代码局部变量动态分派**——表修无效，只能靠解析器（局部类型推断 / 生成代码模式识别）或标注；第 7-12/14 位是**项目类成员级表修**高 ROI 区（约 2341 站点），但注意 impureGlobals 会烘焙项目知识进跨项目工具——正路是用 `--effect-table` 注入项目表或修 resolver。

## b) 效应源 top 10（归类 + 技术债对照）

全部 9380 个：Framework 5267（56%）/ Plugins 2339（25%）/ Tests 947（10%）/ SdkClient 494 / Editor 161 / CosmosEditor 45。top 10（按出度）：

| # | 源 | 文件:行 | 类别 | 技术债 |
|---|---|---|---|---|
| 1 | RuntimeCommandBridge.Execute (30) | Framework/Module/Automation/RuntimeCommandBridge.cs:623 | 生产·自动化桥 | P0「Automation ForTest 侵入生产」 |
| 2 | StarterInteractionCapability.Run (30) | Tests/PlayMode/FullFlowCore/Capabilities/StarterInteractionCapability.cs:25 | 测试 | — |
| 3 | StarterMainlineFlowTests.EnsureStarterMainlineAtQuest9 (26) | Tests/PlayMode/StarterMainlineFlowTests.cs:2261 | 测试 | — |
| 4 | LocalOnlineValidationRunner.ValidateInPlayMode (23) | Editor/OfflineValidation/LocalOnlineValidationRunner.cs:242 | 工具（Editor 验证器） | — |
| 5 | StarterMainlineFlowTests.Quest9_Diagnostic_… (23) | Tests/PlayMode/StarterMainlineFlowTests.cs:581 | 测试 | — |
| 6 | RuntimeMainlineAutopilot.TickOnceAsync (22) | Framework/Module/Automation/RuntimeMainlineAutopilot.cs:531 | 生产·自动化 | P0 同 1 |
| 7 | RuntimeMainlineAutopilot.ApplyDecision (18) | 同上 :628 | 生产·自动化 | P0 同 1 |
| 8 | RuntimeMainlineAutopilot.HasVisibleInteractiveButton (17) | 同上 :2525 | 生产·自动化 | P0 同 1 |
| 9 | RuntimeMainlineAutopilot.TryClickVisibleInteractiveButton (17) | 同上 :1534 | 生产·自动化 | P0 同 1 |
| 10 | StarterMainlineFlowTests.AdvanceStarterMainlineFromQuest6ToQuest7ByOpeningDoor (17) | Tests/PlayMode/StarterMainlineFlowTests.cs:2680 | 测试 | — |

归类：**测试** 5/10（另 StarterMainlineFlowTests 系还有 12 调用×4 个在 11-20 位）；**生产（Automation 模块）** 4/10——直接对应技术债 P0「Automation ForTest 侵入生产」（fs/io 效应从生产模块消除的迁出/#if 隔离目标）；**工具/Editor** 1/10。下方 11-20 位还含 TransportManager.Transport（生产）、SSUShaderGUI.OnGUI / DOTweenAnimationInspector.OnInspectorGUI（Plugins Editor）。测试类源占 9380 的 10%——隔离测试效应（如 P0 迁出）可直接消除约 947 个源头。

## c) 状态耦合 top 20 写方（真实信号 vs ⊤ 降级噪音）

6591 个写方，951 个含 ⊤（14.4%）。top 20 全部 1100+ 读者——读数被 ⊤/同名放大，需分类：

**⊤ 降级（根限定/全局 ⊤，计数含放大）**：
- BuglyAgent._UnregisterExceptionHandler（1888 读者，Plugins/BuglyPlugins/BuglyAgent.cs:786，写 `Application.logMessageReceived` + `System.⊤`）——事件订阅，语义真实但 1888 被 System.⊤ 放大
- UICommon.Awake（1255，UIs/UICommon.cs:42，写 `ICommonUI.⊤`）——单例 UI 总写，语义真实
- PlayerCharacterManager.UpdateMainCharacterData（1226，Framework/NonModule/CharacterGrow/PlayerCharacterManager.cs:957，`PlayerDataManager.⊤`/`player.⊤`）
- SetupLocalPlayer.FinalizeCombatState（1224，Framework/Module/Player/SetupLocalPlayer.cs:620，`PlayerDataManager.⊤`）
- 7 个写 `PlayerDataManager.⊤` 的 UI/玩家写方（各 1127 读者：CreateCharacterUI.cs:310、PlayerTimeLineGroupManager.cs:40、CreateCharacterPanel.cs:292、CreateCharacterPanelNew.cs:134、DeathPanel.cs:276、WonderStuffInfoUI_New.cs:297 等）
- transform.position 系（P1 已知 1100+ 读者）：BreakThunder.Update（1231）、PushStone.Init（1139）、Demo_Shaders.Update（1136）

**假热点（同名异对象，见 e-TP1）**：EditorFastLayerAggregation.CopyIfPresent / FullFlowCoreRunner.CopyIfPresent / TaskSegmentPlayModeContext.Copy（各 1143 读者，写测试辅助的**局部参数** `target`）——排第 6-8 位，高于真实玩法写方，是 top 20 里最纯的噪音。

**精确 self/字段写（真实信号）**：SkillEntity.Init（1129，self.* 精确）、Player.RefreshTeam（1135）、PlayerStShadow.SetUp（1138）、NameSectPanel.NameSect（1130，canvas+self）。

技术债对照：P1「transform.position 状态写（1100+ 读者）」在 top 20 中可见 3+ 处；P1「OnEnable 副作用」可见于 ScrollToBottomBehaviour.OnEnable（链长 2 治理项）。真实信号 = PlayerDataManager 单例写 + self 精确写；噪音 = `target` 同名 + System.⊤/transform.position ⊤ 放大（951/6591 写方）。

## d) 标注候选 top 10（annotatable 且高影响面）

`--unknowns` 语义（rel = released∩UNKNOWN，CLI 主排序；inf = 反向可达闭包影响面）：4903 源中 4413 可标注。**关键发现：标注曲线近水平**——标 400 条仅释放 546 个 UNKNOWN（5102→4556）；4904 源全标才清零（每条平均释放 ~1.04）。原因是 API.g.cs 的 1573 个端点各自携带独立 `?` 站点（urlBuilder_/response_），影响面互不相交——**标注 ROI 极低，降 unknown-rate 正路是修 resolver/表，不是标注**。

CLI 序 top 10（rel 降序）：

| # | 符号 | 文件:行 | rel | inf | uSites |
|---|---|---|---|---|---|
| 1 | TaskSegmentReportWriter.EndProperty | InitDeity/Tests/TaskSegments/TaskSegmentReportWriter.cs:183 | 12 | 14 | 1 |
| 2 | TaskSegmentReportWriter.Escape | 同上 :239 | 12 | 14 | 13 |
| 3 | Context.BorrowEmptyDictionary | Framework/Module/Online/DataCollect.cs:199 | 12 | 13 | 4 |
| 4 | QuestMinimalCapability.ParseSummary | Tests/Editor/CapabilityValidation/QuestMinimalCapability.cs:314 | 11 | 17 | 5 |
| 5 | CombatPowerCalculator.LoadPerkValue | Framework/Module/Player/CombatProperty/CombatPowerCalculator.cs:513 | 10 | 30 | 2 |
| 6 | RuntimeMainlineAutopilot.MatchesStarterQuest6DoorPath | Framework/Module/Automation/RuntimeMainlineAutopilot.cs:6317 | 9 | 97 | 4 |
| 7 | RuntimeMainlineAutopilotPlanner.IsQuest11OutsideArrivalTriggerPath | 同上 :7779 | 8 | 92 | 2 |
| 8 | RuntimeMainlineAutopilot.IsDrawDoorInteractivePath | 同上 :6332 | 8 | 28 | 2 |
| 9 | DispatchFollowerManager.GetNowStageName | Framework/NonModule/Sect/DispatchFollowerManager.cs:79 | 8 | 13 | 1 |
| 10 | DispatchFollowerManager.GetFollowerId | 同上 :89 | 8 | 9 | 1 |

总影响面（inf）最大的另有：HttpRequestTimelineRecorder.GetTimeline（374，ChillyRoomSdkClient/Diagnostics/HttpRequestTimelineRecorder.cs:231）、ApiClientHelper.ResolveRequestGuid（371，ApiClientHelper.cs:39）、GetOriginalUrl（370，:84）——rel 小但 inf 大，若目标是减传播面也值得标。

## e) 工具痛点候选（5 个，含证据）

**TP1（误标·状态耦合假热点）** `target` 局部参数写 → 1143 读者。
- 工具当前：`EditorFastLayerAggregation.CopyIfPresent`（InitDeity/Tests/PlayMode/FullFlowCore/EditorFastLayerAggregation.cs:80-85）写局部参数 `target[key]=value` → stateWrites=[target] → 1143 读者，排 --state 第 6-8 位（与 FullFlowCoreRunner.cs:432、TaskSegmentPlayModeRunner.cs:161 并列）。
- 预期：读方（GetRewardBar.cs:93、TurntableShowUI.cs:38、DOTweenTextMeshPro.cs:297 的 `target`/`target.position`/`target.color`）是各自作用域的不同对象——同名异对象应 0 耦合。README 已知限制「同名异对象过近似」被此放大成 top-8 热点；--state 输出未标注该风险。

**TP2（断链·C# 方法重载歧义挡住项目类解析）** `ApiClientHelper.PrepareRequest` 732 站点断链。
- 工具当前：API.g.cs:96 `ApiClientHelper.PrepareRequest(...)` 未解析（`global:ApiClientHelper` miss 732）→ 端点方法 UNKNOWN。
- 机制：ApiClientHelper.cs 有两个重载（:226、:244，均 IMPURE chain=0）→ `tf.ambiguous` 命中 → link.ts:638-641 守卫拒绝建边。方向安全（重载皆 impure，审计结论不变）但图完整度受损。
- 预期：重载存在时按签名/参数数消歧，或至少解析到任一重载（链传播语义一致）。

**TP3（假 IMPURE·生成代码 30.5% 未知站点）** API.g.cs 单文件 18076 未知站点 / 1573 chunks。
- 工具当前：`var urlBuilder_ = new StringBuilder()`（API.g.cs:73-83）的 `.Append/.ToString/.Length` 与 `response_.Content.ReadAsStringAsync`（:105 起）、`client_.SendAsync`（:366 组）全部 `?` → 每个端点方法 UNKNOWN→audit IMPURE（1573 chunks）。纯字符串构建操作被计入未知 → 图完整度 27.3% 被单文件拉低。
- 预期：`StringBuilder` 局部变量可经轻量类型推断/生成代码模式识别为纯链（Append/EscapeDataString/ToString 纯），只留 SendAsync 等真 io——端点仍 IMPURE（结论不变），但 unknown-rate 与图完整度显著恢复。此类不可表修、不可逐条标注（d 节曲线证明），是解析器能力缺口。

**TP4（误标·效应表 miss 记账全语言共享）** 5 个 pack 行输出相同数据。
- 工具当前：`--table-usage` 输出 python/typescript/tsx/javascript/csharp 五行，**每行都是同样的「咨询未中 37292 站点」和同一 missSlots top 15**——本语料纯 C#，python 行 37292 miss 纯属误导。
- 机制：tableHit/tableMiss 是 link.ts:172-173 的**单全局 Map**（不分语言），classifyUsage（src/core/effectUsage.ts:48-188）却按 pack 循环输出同一数据。
- 预期：按实际文件语言分桶记账（或只输出语料内语言行），否则补表候选语义错位、误导补表决策。

**TP5（误标·NUnit 断言类未入白名单）** `StringAssert` 345 / `Does` 330 站点。
- 工具当前：测试中 `StringAssert.Contains(...)`（root=variable）与 `Does` 未命中任何表 → `?` → 测试方法 UNKNOWN→impure。
- 预期：NUnit StringAssert/Assert.That/Does 是纯断言（抛异常≠副作用）——入 pureGlobals 白名单即恢复 675 站点（同类 `builtin:GetDefaultGameObject` 282 站点是插件基类方法，C# using/继承不可见导致断链，同属 C# 解析能力缺口）。

## 附件：复跑与计算证据
- `node node_modules/typescript/bin/tsc` exit 0（dist 最新，提交 34848a8）
- 冷扫输出 `scan.txt` 与基线 stats 逐项一致（23799/8045/10652/5102/77/11；效应源 9380；写方 6591；图完整度 27.3%）
- 本目录 mine*.js：从基线复算 missSlots/sources/stateCoupling/unknowns/曲线（复用 dist/core/influence.js + dist/core/state.ts 同款算法），与 CLI 输出交叉验证一致
