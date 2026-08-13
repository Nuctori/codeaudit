# InitDeity 治理优先级排序（2026-08-13，全能力综合）

> 综合因子（建议权重，非工具判定——公理 5 管输出契约，本表是报告层建议）：
> 治理价值 ≈ 效应面（I+U，需治理的量）× 复杂度（重构难度/收益）× 未知率（判定盲区）× 状态热点（重构影响）× 体量（覆盖面）
> 数据源：--modules / --complexity / --topology / --state / --sources（最终引擎 783e451，机器口径）

---

## 一、模块级治理优先级（8 个模块，按治理价值降序）

| 序 | 模块 | 效应面(I+U) | C | U% | 状态热点 | 体量 | 治理价值判定 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **InitDeity/Framework** | 5665 | 119 | 19.1% | SkillEntity.Init 23 / RMA.StartAutopilot 19 / QuestProgression 18 | 9223 | **最高**：效应面最大 + 最复杂函数 + 状态热点密集 |
| 2 | **ChillyRoomSdkClient** | 1108 | 32 | 5.6% | ObjectResponseResult 94（全库最高写） | 2503 | **杠杆**：生成器一次改全库受益（效应源 top + 构造器 94 写） |
| 3 | **InitDeity/UIs** | 2334 | 46 | 16.1% | BagItemSlot.InitItemInfo 46C | 3202 | 高：UI 效应面大 + 复杂度中 |
| 4 | **Plugins（Behavior Designer + StompyRobot）** | 2504 | 22 | 16.5% | — | 4312 | 隔离：插件面 4312 chunks——依赖倒置或升级评估 |
| 5 | **InitDeity/Bootstrap** | 552 | 16 | **22.0%** | — | 836 | 最高 U%：启动链判定盲区——先标后治 |
| 6 | **InitDeity/Tests** | 1591 | 68 | 12.9% | — | 2221 | 测试面：复杂度 68 中（StarterMainlineFlowTests 56C） |
| 7 | **InitDeity/Worlds** | 596 | 22 | 18.3% | — | 907 | 中：玩法区未知率偏高 |
| 8 | **InitDeity/Generated** | 101 | 4 | 9.5% | — | 1063 | **健康**：全纯 + 无效应——无需治理 |

## 二、文件级治理优先级（top 6）

| 序 | 文件 | 证据 |
| --- | --- | --- |
| 1 | **API.g.cs**（SDK 生成） | 效应源 top（ReadObjectResponseAsync ×52/份×60+）+ ObjectResponseResult 94 写 + 自环主体 + 2503 chunks——**R1 生成器去重** |
| 2 | **RuntimeMainlineAutopilot.cs** | 344 chunks + Plan C=119 + BuildSnapshot C=47 + 状态热点（StartAutopilot 19）——**R5 分解** |
| 3 | **QuestProgression/QuestCondition** | 状态热点（QuestProgression 构造 18）+ 任务主链 + 重构进行中 |
| 4 | **PlayerCharacterManager.cs** | 55 chunks 全 parseError（外部 SDK 枚举）——**R2 包层** |
| 5 | **SkillEntity.cs** | Init 23 写（22 字段单例）——**R4 状态热点** |
| 6 | **Player.cs** | SetupPlayer 25 写 |

## 三、函数级治理优先级（复杂度 × 效应结合）

| 函数 | C | n | 判定 |
| --- | --- | --- | --- |
| SSUShaderGUI.OnGUI（插件编辑器） | 128 | 9 | 插件内最复杂——升级/替换时重构 |
| **RuntimeMainlineAutopilotPlanner.Plan** | 119 | 5 | 主链规划——**R5 拆分首要目标** |
| ShaderFaderSSUEditor.OnInspectorGUI | 74 | 6 | 插件 |
| DOTweenAnimationInspector.OnInspectorGUI | 72 | 4 | 插件（Demigiant） |
| StarterMainlineFlowTests.EnsureStarterMainlineAtQuest9 | 56 | — | 测试复杂度高（契约脆弱信号） |
| RuntimeMainlineAutopilot.BuildSnapshot | 47 | — | 快照构建（状态热点） |
| BagItemSlot.InitItemInfo | 46 | — | UI 初始化 |

## 四、治理行动序列（建议）

```
1. R1 生成器去重（SDK——杠杆最大：效应源/自环/94 写一次消除）
2. R2 SDK 枚举包层（PlayerCharacterManager 55 chunks 解锁 + 重构回归网）
3. R5 RMA 分解（Plan C=119 拆分 + 依赖视图 --deps 已可用）
4. R4 状态热点（SkillEntity/QuestProgression——重构前查 --state）
5. R3 环 83 治理（初始化/销毁顺序——--topology 已可读）
6. R6 插件隔离（4312 chunks 面——升级时评估）
7. R7 效应表（Bootstrap 22% U 先标后查表）
8. R8 标注运营（重构后 --compare + 重标）
```

## 五、排序原则声明

- 本排序是**报告层建议**（多因子综合的治理价值启发），非工具判定排序——公理 5 的输出契约（字典序）不受影响
- 因子权重可调（用户偏好：效应优先 vs 复杂度优先）——如需参数化可后续做 `--priority` 视图（需评审）
- 唯一"无需治理"模块：Generated（全纯 + 无效应——配置表健康）
