# InitDeity B 类改名实施（迭代 34 B-rename）

> 实施：subagent worker（cwd=J:/旧宇宙/代码仓库/InitDeity）。按 r1-audit 的 B 类 4 个"名字带 ForTest 的生产决策函数"改名去后缀。
> 范围：4 个文件（严格非脏隔离——158 脏文件未触碰）。

## 改名清单（4 声明 + 5 生产 + 26 测试 + 1 断言 = 36 处）

| 旧名 | 新名 |
| --- | --- |
| `ShouldHandleQuest9014TeamLoadForTest` | `ShouldHandleQuest9014TeamLoad` |
| `ShouldCloseQuest15DrawDoorAfterRewardForTest` | `ShouldCloseQuest15DrawDoorAfterReward` |
| `ShouldCloseQuest15EmptyDrawDoorPanelForTest` | `ShouldCloseQuest15EmptyDrawDoorPanel` |
| `ShouldCloseStaleDrawDoorPanelForTest` | `ShouldCloseStaleDrawDoorPanel` |

## 改动文件（4 个，35+/35- 纯改名）

| 文件 | 处数 | 内容 |
| --- | --- | --- |
| `RuntimeMainlineAutopilot.cs` | 9 | 4 声明 + 5 生产调用（L2085/2254/2276/2334/2345） |
| `Quest9014TeamLoadTaskSegmentDefinitionTests.cs` | 4 | 测试调用 |
| `RuntimeMainlineAutopilotRuntimeTests.cs` | 21 | 测试调用（L2058-2125） |
| `Quest15DrawDoorTaskSegmentDefinitionTests.cs` | 1 | 源码断言 Does.Contain("ShouldCloseQuest15DrawDoorAfterReward")——新名是断言文本子串 ✓ |

## 验证

| 检查 | 结果 |
| --- | --- |
| 旧名全库零残留 | ✓（git grep -c 空） |
| 新名 4 声明存在 | ✓（L2237/2377/2385/2425） |
| 新名调用点计数 | Autopilot 9 + Quest9014 4 + RuntimeTests 21 + 断言 1 = 35（grep -c 按行，跨行调用点差异已核） |
| 大括号平衡 | 4 文件全平衡（1199/1199、4/4、5/5、415/415） |
| git diff --stat | 仅 4 文件、35+/35-（纯改名零净增删） |
| 源码断言一致性 | Does.Contain 子串含新名 ✓（断言检查"方法名出现在源码"，改名后仍真） |

## A2 宏确认（GetPortForTest/GetQuest12RepairMaterialStatusForTest）

- `RuntimeCommandBridge.cs:160` `#if UNITY_EDITOR || UNITY_INCLUDE_TESTS` ✓（GetPortForTest）
- `RuntimeMainlineAutopilot.cs:4111` `#if UNITY_EDITOR || UNITY_INCLUDE_TESTS` ✓（GetQuest12RepairMaterialStatusForTest）
- `UNITY_INCLUDE_TESTS` 是 Unity 内建宏——`Assets/InitDeity/Tests/PlayMode/InitDeity.PlayModeTests.asmdef` 存在（Test 程序集自动触发宏）✓
- ProjectSettings.asset 无显式 define（正确——内建宏不需要）✓

## 残余风险

- 无 Unity 编译器本环境——未做真实编译验证（需用户 Unity 编辑器确认改名无编译错误）。
- 测试文件 3 个虽非脏但属用户测试套件——改名后测试语义不变（同名引用同步更新）。
- 源码断言 `Does.Contain` 是子串匹配——新名 `ShouldCloseQuest15DrawDoorAfterReward` 是旧名去后缀，断言仍覆盖（宽松但保持）。
