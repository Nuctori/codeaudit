# InitDeity 重构诊断报告（2026-08-13，codeaudit 迭代 43 引擎）

> 扫描对象：`J:/旧宇宙/代码仓库/InitDeity/Assets`（3014 文件 / 28056 chunks）
> 引擎：codeaudit 迭代 43-r2（含事件订阅 + static-init 精确化 + 本轮诊断修复 000c0f8，367/367 测试）
> 基线对比：迭代 30 引擎（0.3.1，commit 99fb99a）同目录重扫（24040 chunks）
> 口径：无标注；IMPURE = 直接/传递调用 io/net/fs/db/random/clock/state；UNKNOWN = 不可静态解析

## 总览（迭代 43 修复后 vs 迭代 30 基线）

| 指标 | 迭代 30 | 迭代 43（修复后） | 变化 |
| --- | --- | --- | --- |
| chunks | 24040 | 28056 | +4016（B5 属性 chunk + 事件/static-init 新单元） |
| PURE | 8089 | 9925 | +1836 |
| IMPURE | 10820 | 10840 | +20（持平） |
| UNKNOWN | 5131 | 7291 | +2160 |
| unknown-rate | 21.3% | 26.0% | +4.7pp（主要为新 chunk 的判定） |
| cycles | 11 | 3 | -8（B5 属性 chunk 化拆环 + 事件 SCC 合并） |
| parseErrors | 78 文件 | 78 文件 | 持平（中文标识符，外部债 D1） |

## 发现 1（重要）：工具回归 2 处——本次诊断发现并已修复

迭代 43 引擎首扫 unknown-rate 43.2%（12132）——定位为 **iter40 B5 属性读取通道对编译期声明位置的误提取**：

1. **attribute 参数**：`[JsonProperty(Required = Required.Default)]` 的枚举参数被当 prop 调用（全库 `Newtonsoft|Json.Required.Default` 728 次）——attribute 是编译期常量，无运行时读取
2. **using 声明**：`using Newtonsoft.Json;` 的 qualified_name 被当模块级调用（`(null)|Newtonsoft/Json/UnityEngine` 各 800+ 次）；`global::` 限定符同族

**修复**（000c0f8）：propertyReadSkipParents 加 attribute_list/attribute/attribute_argument_list/attribute_argument/name_equals/using_directive/qualified_name/global_keyword。

**实证**：全库 unknown 12132→7291（43.2%→26.0%）；API.g.cs unknown 1348→189；回归测试 +1（367/367）。

## 发现 2：生成代码（API.g.cs）判定质量实质提升

| 指标 | 迭代 30 | 迭代 43（修复后） |
| --- | --- | --- |
| chunks | 1573 | 2503（属性 chunk 细化） |
| PURE | 510 | 1347 |
| IMPURE | 460 | 967（+507） |
| UNKNOWN | 603 | 189（-414，比基线还少） |

**归因**：事件订阅建模（迭代 43）——生成代码的事件触发（`OnXxx?.Invoke()`）现在展开订阅 handler 闭包 → 从 `?` 翻确定判定；attribute/using 噪音清除。**生成代码（60+ 客户端类 × ConvertToString 自递归复制）仍是重构债**（自环主体，生成器侧去重是唯一根治）。

## 发现 3：最近重构目标文件判定（未提交 27 文件 diff + 近 30 提交）

最近重构主题：**quest 系统一致性修复 + EditMode 测试支持的防御性重构**（DestroyAutopilotObject 提取、null 防御、守卫复位——为测试可运行性）。

| 文件 | chunks | PURE | UNKNOWN | IMPURE | parseErr | 诊断 |
| --- | --- | --- | --- | --- | --- | --- |
| RuntimeMainlineAutopilot.cs | 343 | 90 | 169 | 84 | 0 | 50% unknown：StringComparison.Ordinal（System 枚举读取，工具残余）+ BuildTransformPath（真未知）+ 事件守卫 |
| QuestCondition.cs | 29 | 13 | 7 | 9 | 0 | 纯函数（OnQuestConditionStateUpdated/OnInit 判纯）✓；事件/状态面（UpdateStates io+state）✓ 真实 |
| PlayerCharacterManager.cs | 55 | 0 | 27 | 28 | **55** | **整个文件 parseError**（中文标识符）——重构改动不可见，须先改名 |
| SettlementStartGate.cs | 27 | 22 | 3 | 2 | 0 | 22/27 PURE——重构面干净 ✓ |
| InteractiveBootstrap.cs | 13 | 3 | 5 | 5 | 0 | 混合（事件守卫 + 真实效应） |
| RobotCheckDangerArea.cs | 7 | 1 | 1 | 5 | 0 | 高风险区（危险检测，5/7 IMPURE） |
| PlayerStShadow.cs | 14 | 2 | 4 | 8 | 0 | 状态热点（迭代 30 已知：SetUp 1132 读者） |
| Buff.cs | 155 | 110 | 13 | 32 | 0 | 110/155 PURE——战斗 Buff 计算面干净 ✓ |
| FastChatManager.cs | 29 | 9 | 11 | 9 | 0 | 混合 |

## 发现 4：QuestCondition 判定明细（重构核心文件）

- **判纯**（重构方向正确）：`OnQuestConditionStateUpdated`、`OnInit`、字段 chunk（steps/maxSteps/conditionStates 等）
- **判 IMPURE**（真实副作用面）：`UpdateStates`（io+state）、`DispatchStepChangedEvent`（io+state——事件派发）、`OnEnable/OnDisable/OnQuestActive` 等生命周期（state）
- **UNKNOWN 7 个**：`QuestCondition`（类 chunk 本体）+ 部分方法——事件守卫（public 事件触发端 `?`）为主

**风险提示**：`UpdateStates` 是 io+state 双效应且被链传播——quest 状态机重构时它是最大影响面（与 QuestProgressionManager 的 51 UNKNOWN 同族：parseError + 动态分派）。

## 发现 5：状态耦合热点（--state）

- `API.g.cs::ObjectResponseResult.ObjectResponseResult`（构造器写响应字段，94 处状态写）——生成代码构造器聚合写
- 基线热点（PushStone.Init 1139 读者 / PlayerStShadow.SetUp 1132）未变——**重构这些写方前查 --state 读者**

## 发现 6：残余 unknown 归因（26.0% vs 基线 21.3% 的 +4.7pp）

1. **新 chunk 分母**：+4016 chunk（属性 getter/setter 独立判定）——属性 chunk 的调用解析是新信息，含未知
2. **System 枚举读取**（StringComparison.Ordinal 等）：iter42 候选3 只修了项目 enum——System 枚举（StringComparison/AttributeTargets）读取仍落 `?`——数据表可修（B1 校准）
3. **真未知**：动态分派（变量 receiver）、`<unresolved>`（局部/外部符号）——诚实保留

## 建议

**工具侧**（codeaudit）：

1. System 枚举读取判纯（StringComparison.Ordinal 86 次/单文件——进 pureGlobals 或枚举类型表）——B1 数据债
2. PlayerCharacterManager 的中文标识符——tree-sitter 外部债（D1），项目侧改名更实际

**项目侧**（InitDeity）：

1. **PlayerCharacterManager.cs 中文标识符改名**（55 chunks 全 parseError——未提交重构在其中不可见，改名后重构才有回归网）
2. **API.g.cs 生成器去重**（ConvertToString 60+ 复制 + ObjectResponseResult 构造器 94 写）——生成代码是最大未知/状态面
3. **RuntimeMainlineAutopilot**（343 chunks 最大单文件）：EditMode 防御重构方向正确（DestroyAutopilotObject 提取）；其 unknown 面以工具残余为主，标注工作流可消化
4. 重构前查 --state 读者（PushStone/PlayerStShadow 是最高影响写方）

## 方法说明

- 迭代 43 引擎首扫 unknown 43.2% 为**工具回归**（attribute/using 误提取），非项目问题——已修复并回归测试
- cycles 11→3 的机制未完全归因（B5 属性 chunk 化 + 事件 SCC 的混合效应），方向为环减少（健康）
- 自环计数：全库 JSON 序列化 Set 不可见，单目录探针确认 API.g.cs 464 个自环（ConvertToString 族）——与基线 72 个 SCC 主体一致
