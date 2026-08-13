# 迭代47 合成（03-synthesis）：圈复杂度语义修正

> 流程：00-plan → 01-math-review → 02-jeff-review → 本合成。双评审无 blocker、无分歧。

## 裁决

| 项 | 裁决 | 落地 |
| --- | --- | --- |
| 方案 A：module.ts kind 守卫（类 chunk 剔除） | **do-now** | 守卫在 module.ts:54-55（循环累加点——工程评审 E1 修正锚点）；types.ts 注释定档类 chunk 语义 |
| --complexity 加 n 列（嵌套深度，正交双轴） | **do-now** | cli.ts 1 行展示（排序键仍 C） |
| 方案 B：类级画像 (k, M, p90) | do-later | 报告层纯派生；前置 = ownerClass 透传（link.ts 1 行 + types.ts 1 行）——嵌套类归属已实锤断裂（E10） |
| 方案 C：组合指标 | defer | 公理5 冲突 + 有损投影 + 无消费者；双列正交即信息完整 |
| pack 表缺口（C# switch_expression/Python match） | 记档 | 非本迭代 |

## 数学要点（落档）

- 类 chunk 的 Σ 是**量纲混排**（尺寸代理，与方法数共线）——max 定义域要求同量纲，异质 max 不可解释
- (C, n) 正交：n ↛ C（空 lambda 嵌套）且 C ↛ n（平铺 elif）——组合指标是有损投影
- max 是层级唯一可组合的单数（join 半格，划分无关）；p90 不可组合（必须从基准集现算）

## 验收（工程评审 §四）

- 单元：新断言（类 Σ > 方法 max 时 maxComplexity = 方法级 max）+ 389/389 + tsc 0
- 实证：InitDeity --modules Framework C 1136 → 函数级 max（预期两位数回落）；--complexity 出现 n 列
- 反向证伪：若 C 回落不足 = 真实超复杂函数（写清原因非静默）
- JSON 不动（类 chunk complexity 保留，D-065 公共工件）
