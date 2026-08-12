# InitDeity R1 实施：Automation ForTest 隔离（迭代 33 R1）

> 实施：subagent worker（cwd=J:/旧宇宙/代码仓库/InitDeity）。按 docs/iter33/r1-audit.md 方案。
> 只改 2 个文件（158 脏文件严格隔离）；B 类 4 个记录不动。

## 改动清单

### RuntimeCommandBridge.cs（10 个 A 类全隔离）

| 方法 | 行号 | 包裹 |
| --- | --- | --- |
| `GetPortForTest` | L160-165 | `#if UNITY_EDITOR | | UNITY_INCLUDE_TESTS`（A2：PlayMode 调用方 StarterMainlineFlowTests:2020/FullFlowCoreTests:145） |
| `ResolvePortForTest` | L167-170 | `#if UNITY_EDITOR`（A1） |
| `GetPendingQueueDepthForTest` + `TryHandleImmediateCommandForTest` | L235-271 | `#if UNITY_EDITOR`（A1，合并一组） |
| `IsStrictPlayerMainlineForTest` + `ShouldRejectQuestMutationForTest` + `TryParseNudgeArgsForTest` + `BuildCommandHelpForTest` + `BuildResourceDumpForTest` | L761-786 | `#if UNITY_EDITOR`（A1，合并一组 5 个） |
| `IsLoopbackHostForTest` | L2044-2047 | `#if UNITY_EDITOR`（A1） |

### RuntimeMainlineAutopilot.cs（7 隔离 + 1 删除）

| 方法 | 行号 | 处置 |
| --- | --- | --- |
| `GetQuest12RepairMaterialStatusForTest` | L4111-4120 | `#if UNITY_EDITOR | | UNITY_INCLUDE_TESTS`（A2：PlayMode 调用方 Quest12RepairTaskSegmentDefinition.cs:98） |
| `GetQuest17IronMaterialStatusForTest` | （原 L4163-4170） | **删除**（A0 死代码——零调用者；生产基函数 L4173 保留） |
| `ShouldKillQuest7ResourceAtContactForTest` + `ShouldKillQuest17IronResourceAtContactForTest` | L5264-5274 | `#if UNITY_EDITOR`（A1，合并一组） |
| `IsStrictPlayerMainlineForTest` + `ShouldInstallHeadlessQuestCompleterForTest` | L5364-5374 | `#if UNITY_EDITOR`（A1，合并一组） |
| `GetQuest16InteractivePriorityForTest` | L6304-6309 | `#if UNITY_EDITOR`（A1） |

### B 类 4 个（记录不动）

`ShouldHandleQuest9014TeamLoadForTest` L2237 / `ShouldCloseQuest15DrawDoorAfterRewardForTest` L2377 / `ShouldCloseQuest15EmptyDrawDoorPanelForTest` L2385 / `ShouldCloseStaleDrawDoorPanelForTest` L2425——生产路径 9 处调用保留（纯谓词非效应源，改名列后续 P1，受 Quest15DrawDoorTaskSegmentDefinitionTests.cs:57 源码断言约束）。

## 验证

| 检查 | 结果 |
| --- | --- |
| RCB #if/#endif 配对 | 6/6 PAIRED（含既有 L1382 DEVELOPMENT_BUILD 未动） |
| Autopilot #if/#endif 配对 | 4/4 PAIRED |
| RCB 大括号平衡 | 487/487 BALANCED |
| Autopilot 大括号平衡 | 1199/1199 BALANCED |
| A2 用 UNITY_INCLUDE_TESTS | 2 处（RCB GetPort + Autopilot GetQuest12）✓ |
| A1 用 UNITY_EDITOR | 其余 15 个 ✓ |
| A0 死代码删除 | GetQuest17IronMaterialStatusForTest 零残留；生产基函数 3 调用点保留 ✓ |
| B 类生产调用点 | 9 处全保留（未误伤）✓ |
| 块内非 ForTest 代码 | 无（每个 #if 块内全为 ForTest 方法）✓ |

## 残余风险

- **PlayMode 测试 3 处调用**（StarterMainlineFlowTests:2020/FullFlowCoreTests:145/Quest12RepairTaskSegmentDefinition.cs:98）若被编译进 player/真机测试构建（PlayModeTests.asmdef includePlatforms=[]）→ 符号不存在编译失败。缓解：UNITY_INCLUDE_TESTS 宏已覆盖 GetPortForTest/GetQuest12；但 **GetPortForTest 的 PlayMode 调用方 StarterMainlineFlowTests 在 player 构建仍缺**（该测试文件属 PlayModeTests 程序集，宏已保护）；A2 宏选择已按审计 PlayMode 调用方覆盖。
- **未编译验证**：本环境无 Unity 编译器，仅做结构检查（括号/#if 配对/调用点保留）。需用户 Unity 编辑器 + player 构建确认。
- B 类改名（去 ForTest 后缀）未做——记录 P1。
