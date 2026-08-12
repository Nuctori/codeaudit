# 迭代 37 quest-logic-downshift：quest 判定函数单元化

> 目标：把 quest 6-10 判定逻辑下沉到 PureLogic 单元层（无 Unity 引用），让主流程判定验证不依赖 Unity（641s 环境债）。
> 来源：test-debt-analysis.md 第 5 节候选清单 #1（quest 6-10 判定函数下沉）。
> 验收：① 纯函数无 UnityEngine 引用 ✓ ② 单元测试 ≥20 断言（47 个）✓ ③ csc 编译 0 错误 ✓ ④ 文档落盘 ✓

## 1. 下沉的判定函数清单（16 个纯函数 → 44 测试方法 / 47 断言）

| 函数 | Quest | 语义 | 来源（E2E 测试锚点） |
| --- | --- | --- | --- |
| `IsQuest6AdvanceObserved` | 6 | 真门链推进观测：activeMain==7 或 quest7 进行中 + quest6 完成 + 大门_打开 | StarterMainlineFlowTests.Quest6_DoorOpen 观测循环（L2804-2810） |
| `IsQuest6AdvanceSettled` | 6 | 推进沉降：activeMain==7 + quest6 完成 + quest7 进行中 + quest7 信号 | 同上尾部断言（L2848-2852） |
| `IsQuest6DoorClosedPath` | 6 | 初始之地_大门（关） | FindChildByName(door, "初始之地_大门") |
| `IsQuest6DoorOpenPath` | 6 | 初始之地_大门_打开（开） | FindChildByName(door, "初始之地_大门_打开") |
| `IsQuest7CounterTarget` | 7 | 撞罐计数器：名称"完成撞碎所有灵石" + maxCount==5 + 山洞路径 | EnsureStarterMainlineAtQuest8 CountNum 查找（L2142-2148） |
| `IsQuest7Reached` / `IsQuest7NotStarted` | 7 | 推进判定 | EnsureStarterMainlineAtQuest7（L2095-2106） |
| `IsQuest8SkillUnlockCompleted` / `IsQuest8SkillUnlockNeeded` | 8 | 飞行解锁完成：flyOpen + quest8 信号 + 已到 9/9008 | ForcePlayerLevelAtLeast2AndCompleteStarterSkillUnlock 前置检查（L2999-3006） |
| `IsQuest8Reached` | 8 | 推进判定 | EnsureStarterMainlineAtQuest8（L2125-2135） |
| `IsQuest9008FlySwordHost` | 9008 | 飞剑交互宿主：路径含"飞剑"+ 山洞 | EnsureStarterMainlineAtQuest9 FindSceneObjectByName（L2289-2298） |
| `IsQuest9008FlyUnlockCompleted` | 9008 | 飞行玩法已开 + quest8 信号完成 | Quest8To9008 观测（L232-233） |
| `IsQuest9008ReachedOrPast` | 9008 | 9008 子链进行中/已过 | L3001-3003 |
| `IsQuest9Reached` / `IsQuest9NotStarted` | 9 | 推进判定 | EnsureStarterMainlineAtQuest9（L2274） |
| `IsQuest10Reached` / `IsQuest10StartObserved` / `IsQuest10StartNeeded` | 10 | 灭魔物战斗入口判定 | EnsureStarterMainlineIntoQuest10（L918-920, L944） |
| `IsSignalLocalCompleted` / `IsSignalIncomplete` | 通用 | Signal steps/maxSteps → 完成语义 | Signal.localCompleted 用法 |

## 2. 新文件

| 文件 | 类型 | 内容 |
| --- | --- | --- |
| `Assets/InitDeity/Framework/PureLogic/QuestMainlinePureDecisions.cs` | 生产纯逻辑类 | 16 个静态纯判定（无 UnityEngine，仅 System：int?/bool/string/StringComparison/IndexOf） |
| `Assets/InitDeity/Tests/Unit/QuestMainlinePureDecisionsTests.cs` | 单元测试 | 44 测试方法 / 47 断言，覆盖 quest 6/7/8/9008/9/10 每 quest 未开始/进行中/完成场景 |

（复用现有 `InitDeity.PureLogic.asmdef`（noEngineReferences:true）与 `InitDeity.UnitTests.asmdef`——无需新 asmdef）

## 3. 离线编译验证（Roslyn csc，绕过坏 MSBuild）

统一用 Unity Mono 4.7.1-api 引用（与 Unity 2022 实际编译目标一致；避免 net10/nunit-net35 版本冲突）：

```
csc -target:library -nostdlib -noconfig -r:{4.7.1-api}/*.dll
    QuestMainlinePureDecisions.cs → QuestMainlinePureDecisions.dll   (0 错误)
csc -target:library -nostdlib -noconfig -r:{4.7.1-api}/*.dll -r:nunit.framework.dll
    -r:QuestMainlinePureDecisions.dll
    QuestMainlinePureDecisionsTests.cs → QuestMainlinePureDecisionsTests.dll  (0 错误)
```

- **strings 检查 dll 无 "UnityEngine"**——纯逻辑无 Unity 依赖实证
- 程序集归属 `InitDeity.PureLogic`（命名空间一致）

## 4. 测试真实执行（反射 runner + Mono 运行时）

```
TESTS=44 PASSED=42 FAILED=2  （首跑）
  → 修复 IsQuest6AdvanceObserved 逻辑漏洞（quest7InProgress 不能独立于 activeMain 放行）
TESTS=44 PASSED=44 FAILED=0  （修复后）
```

**测试抓出的真 bug**：`IsQuest6AdvanceObserved(6, true, true, true)` 首版返回 True（应 False）——quest7InProgress=true 时未校验 activeMain 是否真的离开了 6。修复：`(activeMain == 7 || (quest7InProgress && activeMain.HasValue && activeMain.Value != 6))`。这正是"判定下沉后行为可验证"的价值——E2E 里此路径永远测不到（quest7InProgress 与 activeMain==7 恒同现），纯函数暴露了边界。

## 5. 行为保真说明

- 每个纯判定从 E2E 测试的断言/查找条件**逐字提取**（不改生产代码，仅新增）
- 路径判定用 `IndexOf(..., StringComparison.Ordinal) >= 0`（net4.7.1 无 Contains(string, StringComparison) 重载——语义等价）
- 生产代码零改动；E2E 测试未动——零回归风险

## 6. 验收自检

- [x] 纯函数无 UnityEngine 引用（strings 实证 + noEngineReferences asmdef 复用）
- [x] 单元测试 ≥20 断言（47 个；44 测试方法）
- [x] csc 编译 0 错误（PureLogic + Tests 双文件）
- [x] 测试真实执行 44/44 通过（非仅编译）
- [x] 覆盖 quest 6/7/8/9008/9/10 每 quest ≥3 场景（未开始/进行中/完成）
- [x] 生产逻辑未改（只新增文件）

## 7. 残余风险

1. **MSBuild 环境坏**（已知）——本轮用 Roslyn csc + 反射 runner 绕过；`dotnet test` 需修 MSBuild
2. **Unity 侧未验证**（asmdef 编译 + TestRunner 集成）——Unity batchmode 有 641s 环境债，本轮离线验证；asmdef 结构与现有 PureLogic/UnitTests 一致（复用），Unity 导入应直接编译
3. 未做"生产转发"（RuntimeMainlineAutopilot 等尚未调这些纯函数）——本轮只提取验证；转发是后续重构
4. quest 7 撞罐的"5 个罐子宿主绑定"（signal 宿主）判定未完全下沉（E2E 里是场景对象绑定，非纯逻辑）——留在 E2E 层

## 8. 证据文件

- 编译产物：`InitDeity/Logs/downshift-verify/QuestMainlinePureDecisions.dll` + `QuestMainlinePureDecisionsTests.dll`
- 测试运行：`TESTS=44 PASSED=44 FAILED=0`（反射 runner，上述输出）
- 新源文件：PureLogic 类 + 测试类（本节列出的 2 个）
