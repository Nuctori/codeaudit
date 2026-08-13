# InitDeity 最终引擎分析报告（2026-08-13，痛点 2 修复后重跑）

> 引擎：迭代 44-r3（486dc88，380/380）——含 15 处工具修复（attribute/using/global/预处理/局部读/枚举×2/编译期操作符/foreach-catch/**动态 heritage 误判**）
> 口径：**无标注**（机器解析面）——标注后 unknown 0（见 annotation-workflow-review.md）
> 对比基线：旧引擎（9c38853，unknown 24.4%）

## 总览（无标注，机器口径）

| 指标 | 旧引擎 | 最终引擎 | 变化 |
| --- | --- | --- | --- |
| unknown / rate | 6853 / 24.4% | **4199 / 15.0%** | **-39%** |
| 已知边 | 16104 | **30770** | +91%（机器解析恢复） |
| 未知边 | 172746 | **72364** | -58% |
| 深度 | 5 | **22** | 传染链真实化 |
| 自环 | 60 | **856** | 自递归真实可见 |
| cycles | 3 | **83** | 继承/多态环恢复（旧值被降级压扁） |
| 传染链（chain≥1） | ~101 | **1145** | 恢复 |
| parseErrors | 78 | 77 | 持平 |

**核心变化**：动态 heritage 误判修复（枚举底层类型/预处理指令被当动态 extends → 语言级降级）——机器解析面大幅恢复，**此前被降级掩盖的真实结构（环/自环/深链/效应传播）全部可见**。

## 拓扑（真实结构）

```
28060 nodes / 30770 已知边（未知边 72364）
密度 0.000（近树）· 深度 22 · 自环 856 · SCC 环 83
图完整度 = 已知边/(已知+未知) = 29.8%（旧 15.9%）
```

- **自环 856**：API.g.cs 生成代码自递归族（ConvertToString 等 60+ 复制）为主体——生成器去重后大幅消除
- **环 83**：继承/多态环真实化——初始化/销毁顺序风险面明确
- **深度 22**：副作用藏得深的重构风险链（旧引擎只能看到 5）

## 效应源（10185 个 chain=0 IMPURE）

- **top 全部是 API.g.cs 生成代码**：`ReadObjectResponseAsync` ×52 调用/份 × 60+ 客户端（复制模式）
- 效应分布（机器解析恢复后）：state 10951 / io 6455 / fs 1871 / clock 1837 / net 1350 / random 798

## 状态耦合 top（写方 → 读者面）

- `API.g.cs::ObjectResponseResult` 构造器 94 写（生成代码聚合写）
- `Player.SetupPlayer` 25 / `SkillEntity.Init` 23 / `RuntimeMainlineAutopilot.StartAutopilot` 19
- `QuestProgression.QuestProgression` 18（任务推进构造——重构高影响）

## 重构目标文件判定（痛点 2 修复后）

| 文件 | chunks | PURE | UNKNOWN | IMPURE | 变化 vs 旧 |
| --- | --- | --- | --- | --- | --- |
| RuntimeMainlineAutopilot.cs | 344 | 124 | 98 | 122 | UNKNOWN -71（痛点 2 修复） |
| QuestCondition.cs | 29 | 14 | 6 | 9 | UNKNOWN -3 |
| SettlementStartGate.cs | 27 | 25 | **0** | 2 | UNKNOWN 清零（重构面干净 ✓） |
| Buff.cs | 155 | 111 | 7 | 37 | UNKNOWN -6 |
| FastChatManager.cs | 29 | 12 | **1** | 16 | UNKNOWN -10（痛点 2） |
| API.g.cs | 2503 | 1395 | 141 | 967 | UNKNOWN -48 |
| PlayerCharacterManager.cs | 55 | 0 | 23 | 32 | **全文件 parseError（外部 SDK 枚举）** |
| CombatPowerCalculator.cs | 15 | 3 | 8 | 4 | Init 解析恢复（痛点 2 实证） |

## 残余 unknown 4199 构成（无标注）

- **动态分派**（变量接收者 `response_.X`）：设计边界——标注覆盖（保守 IMPURE）
- **`<unresolved>`**（调用结果接收者 `f().x`）：不可拍平——标注覆盖
- **`T` 泛型构造** `new T()`：标注覆盖
- 长尾形态：工具残余 + 数据债（第三方枚举/API 未入表）

**带标注后 unknown 0**（6335 条标注）——但标注是外部证据（非机器证明），代码变化即失效。

## 建议（更新）

1. **P0 API.g.cs 生成器去重**（docs/generator-dedup-initdeity.md 方案 A/B）：自环 856 主体 + 效应源 top + 构造器 94 写
2. **P1 环 83 的初始化/销毁顺序**：机器恢复后首次可见——重构前查 `--topology` + `--state`
3. **P1 状态热点**：QuestProgression 构造 18 写 + SkillEntity.Init 23——任务/技能系统重构高影响
4. **P2 PlayerCharacterManager**：外部 SDK 枚举中文成员（parseError 55 chunks）——包层映射或接受
5. **标注运营**：4199 残余已被标注覆盖（0）——新代码/重构后重跑标注（语料先验复用）

## 方法说明

- 无标注口径 = 机器解析面（工具能力上限）；标注后 0 = 联合覆盖
- 旧引擎报告（initdeity-diagnosis-2026-08-13.md）数字被动态 heritage 误判污染——以本报告为准
