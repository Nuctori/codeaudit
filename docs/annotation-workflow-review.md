# 标注运营复盘：工作流改善建议（2026-08-13，InitDeity 人工标注轮）

> 基于人工标注运营实测（累计 1642 条标注 / 537 生效 / unknown 6730→4759，17.0%）。

## 标注进度（最新引擎 cd2743f 口径）

| 阶段 | 标注累计 | 生效 | unknown | rate |
| --- | --- | --- | --- | --- |
| 无标注 | 0 | 0 | 6730 | 24.0% |
| 形态批组（Count/GetType/SetActive…） | 640 | 363 | — | — |
| 全量轮（parseError + 高影响面） | 1490 | 455 | 5007 | 17.8% |
| **人工标注轮（Value/Init/事件/高影响面）** | **1642** | **537** | **4759** | **17.0%** |

## 工作流痛点与改善建议（按价值排序）

### 1. 标注生效率的可见性缺失（最大痛点）

- 1642 条 → 537 生效（33%）——**被拒/无效的 1105 条标注者无法得知**（台账只有 annotated=N 计数）
- 标注者不知道哪些标注白做了（PURE 校验拒？id 已解决？parseError？）——下一轮重复劳动
- **改善**：回读报告输出**被拒清单 + 原因分类**（校验拒绝/已解决/parseError/无效 id）——标注者按原因调整策略

### 2. 同文件方法裸名调用 miss（工具 bug，人工轮发现）

- `CombatPowerCalculator.CalculateByLayer() { Init(); }`——**同文件静态方法裸名调用解析 miss**（Init 在 unknownCalls）
- `CheckAllCharacterCondition.RefreshItemCount() { OnStepUpdateEvent(); }`——**基类方法裸名调用 miss**
- 影响：高影响面 chunk（inf=368）被这些假未知拖累；形态组（Init·bare 31 条/OnStepUpdateEvent 35 条）整体是工具残余
- **改善**：implicitThis 对静态方法/继承方法的裸名解析复核（候选 1 同族扩展）

### 3. 人工标注的工作台缺失

- 现状：标注者手工拼装（导出 → 脚本聚合 → 读代码 → 裁决）——每轮重复
- **改善**：`--unknowns` 输出加**chunk 聚合视图**（一个 chunk 的全部未知点 + 代码上下文行）——标注者一个视图裁决一个 chunk

### 4. 标注状态无回显

- 导出清单含已标注 id——标注者手工 seen 去重（本轮脚本）
- **改善**：`--unknowns` 加 `annotated` 状态列（已标/待标/被拒）——导出即工作台

### 5. parseError 条目混入主清单

- parseError 只能 IMPURE——但导出混在主清单（标注者先看到纯形态才意识到）
- **改善**：导出按 `parseError` 分组（或加标记列）——这组标注或等改名

### 6. 语料先验的轮间反馈

- 本轮 Value→PURE（37 条）裁决后语料更新——但下一轮导出时先验才可见
- **改善**：标注工具（外部）轮间展示形态历史（「Value 历史 37/37 标 PURE」）——同形态新条目自动建议

## 标注纪律（本轮确认）

1. **PURE 必须代码确认**：Value 形态确认 Nullable/JsonReader 后标（自定义 getter 风险靠看代码排除）
2. **IMPURE 保守**：网络/UI/初始化/资源加载形态（世界知识）——方向安全
3. **高影响面优先**：inf≥15 的 12 条全部裁决（网络诊断/初始化/对象池）——释放最大
4. **parseError 全 IMPURE**：QuestProgressionManager 等（改名/外部枚举解锁前唯一路径）

## 剩余 4759 条目结构（下一轮队列）

- `<unresolved>` 490（调用结果接收者——人工可裁决）
- T·bare 89（new T() 泛型构造——保持 ? 或 IMPURE 保守）
- Value 残余（chunk 多未知点被拒部分）
- 长尾形态（Linear/step/OnStepUpdateEvent 残余等）——按 chunk 聚合逐个

## 结论

工具侧残余（痛点 2）修完预估 unknown -300~-500（面扩大实测：Refresh/CopySource/count/steps/conditionals/type 全族 ~300 条——同文件符号裸名 miss 的全库范围效应，非此前估计的 150 条）；标注运营按 chunk 聚合 + 被拒反馈（痛点 1/3）可持续消化至 ~15%。建议顺序：**修痛点 2（工具，面扩大需重新评估）→ 实现痛点 3（工作台）→ 标注运营继续**。

## 迭代44-r3 追加（标注运营继续判定）

- 台账补 IMPURE 生效计数（impureApplied）：537 PURE + 1277 IMPURE 生效——标注者首次可见 IMPURE 标注实效
- 下一批 184 条（Linear→PURE 18 条——DOTween Ease 枚举，数据债：枚举白名单扩展；Append/Values/Refresh/CopySource→IMPURE 166 条）→ unknown 4758→4570（16.3%）
- **新痛点**：① 痛点 2 复发面扩大（~300 条同文件符号裸名 miss——Refresh* 同文件方法/CopySource 属性 getter/count/steps 字段读——全库范围效应，需重新评估修复）② Ease 枚举数据债（DOTween 枚举成员读取——白名单只加 4 个 System 枚举）③ `x`/`actions`/`conditionals` 等混合形态（部分工具残余部分动态分派——chunk 聚合裁决）

## 迭代44-r3 工作台轮（痛点 3 落地实证）

- `--unknowns` 导出加 `code` 字段（chunk 源码片段——标注者无需打开文件）：InitDeity 4541 条 100% 覆盖
- 工作台标注轮实测：1577 条仅凭 code 片段正则裁决（519 PURE + 1058 IMPURE）→ **unknown 4556→2966（10.6%）**——累计 3403 条标注从无标注 6730 降 56%
- **方法论**：工作台 = 导出携带代码上下文 → 标注者（含启发式批量）一个视图裁决——PURE 被拒机制兜底（校验拒绝），IMPURE 保守方向（过近似不假纯）
- **残余**：痛点 2（~300 条全库范围效应，机制未定位）；剩余 2966 条（<unresolved>/T 泛型构造/动态分派长尾）
