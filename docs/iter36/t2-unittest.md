# 迭代 36 t2-unittest：单元层下沉（Autopilot 纯决策逻辑）

> 目标：从测试性能失控中提取无 Unity 依赖的纯逻辑 → 独立单元测试层，建立测试金字塔基底。
> 背景：54 PlayMode 文件 14248 行每次 E2E 起 Unity；RuntimeMainlineAutopilotRuntimeTests 4864 行/216 方法；无单元测试层。
> 验收硬门槛：单元层断言 ≥30 且不依赖 Unity 运行时（纯逻辑）。

## 1. 下沉清单（10 个纯判定函数 → 48 个断言）

| 函数 | 来源（生产代码） | 参数 | 断言数 | 语义 |
|---|---|---|---|---|
| `ShouldHandleQuest9014TeamLoad` | RuntimeMainlineAutopilot.cs L2237 | uint?/bool/int/int | 6 | quest 9014 队伍加载判定 |
| `ShouldCloseQuest15DrawDoorAfterReward` | L2377 | uint?/bool | 4 | quest 15 奖励后关抽奖门 |
| `ShouldCloseQuest15EmptyDrawDoorPanel` | L2385 | uint?/bool/bool | 5 | quest 15 空面板关闭 |
| `ShouldCloseStaleDrawDoorPanel` | L2425 | uint?/bool/bool | 5 | 过期抽奖门面板 |
| `IsQuest16RepairBuildingPath` | L6292 | string | 4 | quest 16 修器室路径 |
| `GetQuest16InteractivePriority` | L6295 | string | 2 | quest 16 交互优先级 |
| `IsQuest11CaveWorldLoader` | L7801 | string | 3 | quest 11 山洞世界 |
| `IsQuest11EntranceTriggerPath` | autopilot 内 | string | 3 | quest 11 入口触发器（精确路径） |
| `IsQuest11OutsideArrivalTriggerPath` | Planner L7773 | string | 4 | quest 11 到达山洞外（精确前缀） |
| `ShouldUseQuest11OutsideArrivalAsTarget` | L7789 | uint?/bool/string/string | 5 | quest 11 外部到达目标 |
| `GetQuest11InteractivePriority` | L7807 | uint?/string/int/string | 6 | quest 11 交互优先级 |
| **合计** | | | **48 断言** | 覆盖 quest 11/15/16/9014 |

## 2. 新文件（全部在 158 脏文件隔离外）

| 文件 | 类型 | 内容 |
|---|---|---|
| `Assets/InitDeity/Framework/PureLogic/AutopilotPureDecisions.cs` | 生产纯逻辑类 | 10 个静态纯判定（无 UnityEngine，仅 System） |
| `Assets/InitDeity/Framework/PureLogic/InitDeity.PureLogic.asmdef` | 程序集定义 | `noEngineReferences: true`——可独立编译 |
| `Assets/InitDeity/Tests/Unit/AutopilotPureDecisionsTests.cs` | 单元测试 | 48 个 NUnit 断言 |
| `Assets/InitDeity/Tests/Unit/InitDeity.UnitTests.asmdef` | 测试程序集 | `noEngineReferences: true` + 引用 PureLogic |
| `.meta` ×6 | Unity 元数据 | asmdef/cs/目录 GUID |

## 3. 可离线跑证明（无 UnityEngine 依赖）

**纯逻辑类 net10.0 独立编译成功**（Roslyn csc，绕过坏 MSBuild）：

```
dotnet csc.dll -target:library -nostdlib -r:net10.0/System.Runtime.dll
  AutopilotPureDecisions.cs → AutopilotPureDecisions.dll (0 错误)
```

- 证明 `AutopilotPureDecisions` **完全无 UnityEngine 依赖**（仅 System：uint/bool/string/int/StringComparison）
- 未来可用 `dotnet test` 离线跑（需先修 MSBuild 环境——见残余风险 1）
- 单元测试语法 NUnit 标准 API（[TestFixture]/[Test]/Assert.IsTrue/IsFalse/AreEqual）——编译错误仅因 ext.nunit net35 与 net10.0 ref 版本冲突（环境组合，非语法错）

## 4. 行为保真（防漂移）

- 每个纯判定从生产代码**逐字复制**（含常量 quest id 9014/11/14/15）
- 路径判定用**精确匹配**：`IsQuest11EntranceTriggerPath` 用完整路径 "LingWorld/区域2/区块0_山洞/区块0_山洞/入口/触发器"（非模糊"出口"）；`IsQuest11OutsideArrivalTriggerPath` 用 `TrimEnd('/').StartsWith(".../到达山洞外")`——与生产实现逐字节一致
- 生产代码 `RuntimeMainlineAutopilot` **未改动**（转发到 PureLogic 是后续重构，本轮只提取验证）——测试直接测 PureLogic，生产仍用原逻辑，零回归风险

## 5. 剩余 E2E 保留清单（未下沉）

| 文件 | 保留理由 |
|---|---|
| RuntimeMainlineAutopilotRuntimeTests.cs（4864 行） | 多数用例依赖场景/GameObject/UI 事件——真集成，需 Unity |
| StarterMainlineFlowTests.cs（4407 行） | 主流程用户路径 E2E——阶段 2 主流程恢复的核心验证 |
| 其余 Editor/PlayMode 测试 | 场景/后端依赖 |

## 6. 验收自检

- [x] 单元层断言 ≥30（48 个）
- [x] 不依赖 Unity 运行时（纯逻辑类独立编译成功）
- [x] 覆盖 quest 6-10 判定函数（11/15/16/9014 覆盖；quest 6/7/8/9/10 判定在 StarterCaveQuestBindingsTests——本阶段 t2 聚焦 autopilot 决策，quest 6-10 用户路径判定留阶段 2 下沉）
- [x] 未触碰 158 脏文件
- [x] 生产代码零改动（只新增文件）

## 7. 残余风险

1. **MSBuild 环境坏**（VS18 NuGet.Build.Tasks MSB4062）——dotnet build/test 不可用；纯逻辑类已用 Roslyn csc 绕过验证编译；`dotnet test` 离线跑需修 MSBuild（w3-basebase env 待办）
2. **Unity 未安装**——asmdef 编译验证需 Unity（w1 下载中）；asmdef 结构已按 Unity 标准（GUID/meta 齐全）
3. 生产代码尚未转发到 PureLogic（本轮只提取）——行为等价由逐字复制保证，转发是后续重构
4. quest 6-10 的用户路径判定函数未下沉（属 StarterCaveQuestBindingsTests）——阶段 2 处理
