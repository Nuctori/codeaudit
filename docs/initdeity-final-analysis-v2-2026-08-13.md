# InitDeity 分析报告 v2（2026-08-13，新能力集成版）

> 引擎：迭代 45（5d2d612，388/388）——含全部 16 处工具修复 + 新决策视图（--modules/--deps/--compare/--topology 修复）
> 口径：无标注（机器解析面）；带标注 unknown 0

## 1. 总览（机器口径）

| 指标 | 值 |
| --- | --- |
| chunks / files | 28060 / 3014 |
| pure / impure / unknown | 11131 / 12739 / **4190（14.9%）** |
| 已知边 / 未知边 | 30770 / 72549 |
| 图完整度 | **37.8%**（旧 15.9%） |
| 深度 / 自环 / 环 | 22 / 856 / 83 |
| 最长传染链 | chain=2（分布：chain≥1 共 1145） |

## 2. 拓扑健康度（--topology 修复后——不再被 IMPURE 清单淹没）

```
拓扑：28060 nodes / 30770 edges / 密度 0.000 / 自环 856 / 环 83 / 深度 22 / 未知边 72549
  ➜ 已知边内近树、耦合低（密度 0.000，完全图=1；72549 条未知边未计入）
  ➜ 856 个自递归 chunk（重构时注意终止性）
  ➜ 83 个循环依赖（SCC>1——初始化/销毁顺序风险）
  ➜ 调用图最深路径 22 层
图完整度：37.8% 调用点已解析
```

**解读**：

- **近树结构（密度 0.000）**：已知边内模块间耦合低——单模块重构隔离性好
- **自环 856**：API.g.cs 生成代码自递归族主体——R1 生成器去重后可消 ~700
- **环 83**：继承/多态环——初始化/销毁顺序风险面（旧引擎被降级压扁为 3）
- **深度 22**：副作用藏得深的链（chain 分布：0→15793 / 1→1076 / 2→69）——重构高风险面集中在 chain≥1 的 1145 个 chunk

## 3. 模块面（--modules——重构范围决策视图）

| 模块 | chunks | U | I | U% | 效应面 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| InitDeity/Framework | 9223 | 1764 | 3901 | 19.1% | 全 | **主战场（R4/R5）** |
| InitDeity/UIs | 3202 | 515 | 1819 | 16.1% | 全 | UI 面大 |
| ChillyRoomSdkClient/InitDeity | 2503 | 141 | 967 | 5.6% | 无 net | **R1 生成器（效应源 top）** |
| Plugins/Behavior Designer | 2446 | 120 | 1263 | 4.9% | 无 net/fs | **R6 插件层** |
| InitDeity/Tests | 2221 | 286 | 1305 | 12.9% | 全 | 测试面 |
| Plugins/StompyRobot | 1866 | 308 | 813 | 16.5% | 全 | **R6（传染链源）** |
| InitDeity/Generated | 1063 | 101 | **0** | 9.5% | **无** | 配置表纯数据访问（健康） |
| InitDeity/Worlds | 907 | 166 | 430 | 18.3% | 全 | 玩法区 |
| InitDeity/Bootstrap | 836 | 184 | 368 | **22.0%** | 全 | **最高 U%（启动链）** |

**模块级结论**：重构范围排序 = Framework（体量）> UIs（面）> SDK（杠杆）> 插件（隔离）。Bootstrap 的 22% U 是启动链未知面——登录/初始化重构前先标。

## 4. 依赖视图（--deps——拆分决策）

**QuestCondition**（重构核心文件）：

- 出边 3：NewQuestCondition（9 边）/ SingletonMonoBehaviour（5）/ QuestProgressionManager（1）
- 入边 6：StarterMainlineFlowTests（8）/ Signal.cs（6）/ RegionQuestConditionItem（3）/ OnceCompletable（3）/ CheckTreasureBoxOpened（2）/ CheckEquipTypeCount（1）

**拆分解读**：QuestCondition 依赖面小（出 3 入 6）——拆 QuestConditions/ 子目录（Signal/OnceCompletable/Check* 已是子目录）安全；测试耦合（StarterMainlineFlowTests 8 边）是主要约束。

## 5. 前后对比（--compare——重构验证）

同引擎对比 0 翻转（4 条测试方法 ID 抖动噪声）——重构后跑 `--compare <before.json>` 验证判定未退化。

## 6. 重构建议（更新）

| 序 | 项 | 新证据 |
| --- | --- | --- |
| R1 | 生成器去重 | 模块面：SDK 2503 chunks 5.6% U 但效应源 top + 自环主体 |
| R2 | SDK 枚举包层 | PlayerCharacterManager 55 parseError（未变） |
| R3 | 环 83 治理 | 拓扑健康度首次可读（--topology 修复） |
| R4 | 状态热点 | Framework 模块 3901 I 是主体——SkillEntity/QuestProgression 写方 |
| R5 | RMA 分解 | --deps 可用（先看 RMA 依赖面再切） |
| R6 | 插件隔离 | 模块面：Behavior Designer 2446 + StompyRobot 1866 = 4312 chunks 插件面 |
| R7 | 效应表 | Bootstrap 22% U 是最高未知模块——先标后查表 |
| R8 | 标注运营 | 4190 机器 unknown 已被标注覆盖（0）——重构后 --compare + 重标 |

**新能力闭环**：--modules（范围）→ --deps（拆分点）→ --topology（健康度）→ --compare（验证）——重构全周期信息齐备。
