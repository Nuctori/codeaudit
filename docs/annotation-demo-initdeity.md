# 标注工作流演示记录（InitDeity，2026-08-13）

> 目的：以 InitDeity 为例演示 AI 标注闭环三环（导出 → 标注 → 回读 + 语料），并量化标注效率。
> 基线：iter44 引擎（9c38853），InitDeity 无标注 unknown 6853 chunks（24.4%）。

## 环 1：导出（--unknowns）

- 产出：`initdeity-unknowns.json`，**6825 条目**（6853 UNKNOWN chunks 的源符号去重）
- 排序：按 UNKNOWN 影响面（反向可达闭包内 chunk 数）——max=376、p90=1（长尾为主）
- 每条含：id（内容寻址锚）/symbol/file/line/influence/unknownSites/calls/shape/prior/suggested_prompt
- 形态分组（batchable 基础）：`Count·variable` 106 / `SetActive·variable` 71 / `GetType·variable` 63 / `Invoke·variable` 82 / `<unresolved>·bare` 544 / `UNITY_EDITOR·bare` 117（#if 条件编译）/ `T·bare` 94（泛型参数名误收）
- suggested_prompt 工作 ✓（含 parseError 提示：PURE 标注会被忽略，只标 IMPURE）

## 环 2：标注（人工裁决，演示 27 条）

形态组裁决（世界知识 + 语料频次）：

| 组 | 裁决 | 依据 | 条数 |
| --- | --- | --- | --- |
| `Count·variable` | PURE | C# List.Count 属性纯读取 | 12 |
| `GetType·variable` | PURE | 反射元数据读无副作用 | 10 |
| `SetActive·variable` | IMPURE | Unity GameObject 状态变更 | 8 |
| `nameof·bare` | PURE | 编译期操作符 | 3 |
| 高影响面（RequestStart/ResolveRequestGuid/CompleteTimeline 等） | IMPURE | 网络诊断/请求准备（世界知识） | 6 |

（parseError 文件条目跳过 PURE——工具会忽略，suggested_prompt 已提示）

## 环 3：回读 + 语料

- `--annotations`：27 条输入 → **59 条生效**（annotated=59）→ **unknown 6853 → 6717（-136）**
- **标注效率**：1 条标注平均释放 5 个 chunk（含下游 derived 释放）——影响面排序 + 形态批组的价值
- `--corpus`：corpus.json 幂等累积（version 2）——`seen` 双锚定（file\0id + id）防重复计；形态先验 cell 数据：`Count·variable pure 9/impure 0`、`GetType·variable pure 2/0`、`SetActive·variable pure 0/impure 8`、`<unresolved>·bare pure 5/0`
- 二次导出：标注生效的形态已不在 unknowns（正确——先验服务于**未标注**条目的建议）

## 效率推断（投影）

- 6825 条目中形态组可批处理：Count 106 + GetType 63 + SetActive 71 + TryGetValue 108 + Invoke 82 + Value 80 ≈ **510 条（7.5%）形态批组**——标完预计释放 ~2500 chunk（按 1:5 效率）
- 高影响面（inf ≥ 50）条目数少但释放大——优先标
- 长尾（p90=1 叶子）走语料先验自动建议 + 批量

## 经验

1. **形态批组是标注的主要杠杆**：同形态同裁决（Count 全纯、SetActive 全 state）——AI 标注时按 shape 分组裁决，一次标一组
2. **parseError 文件**：只能标 IMPURE（PURE 被忽略）——这类文件应先改名/修源码（PlayerCharacterManager 中文标识符）
3. **<unresolved>·bare 544 条**：不可拍平形态（factory()()/d[k]()）——标 PURE 有假纯风险（不可拍平 ≠ 纯）——建议跳过或标 IMPURE 保守
4. **先验冷启动**：首轮无 prior（n=0）——第二轮起同形态新条目带「形态历史 ≈X 成标 PURE（n=N）」建议

## 工具侧观察（演示中发现）

- `T·bare` 94（泛型参数名误收）——flattenCallTarget 对泛型类型参数的处理残余，下轮可修
- `UNITY_EDITOR·bare` 117——#if 条件编译块内调用未解析——设计内（条件编译不可静态判定）
