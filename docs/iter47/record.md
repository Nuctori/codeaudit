# 迭代47 记录（record）

> 议题：圈复杂度语义 + 簇聚合形态（用户质疑：「不是计算同一个簇的 chunk 的嵌套深度吗」）。
> 流程：00-plan → 01-math-review → 02-jeff-review → 03-synthesis → 落地。

## 评审裁决

| 项 | 裁决 | 核心论证 |
| --- | --- | --- |
| 方案 A（module.ts kind 守卫） | do-now | 类 chunk 的 Σ 是**量纲混排**（尺寸代理，与方法数共线；max 定义域要求同量纲）——与函数级 C 混取 max 是形式错误 |
| --complexity 加 n 列 | do-now | (C, n) 正交（n ↛ C：空 lambda 嵌套；C ↛ n：平铺 elif）——双列是信息完整的正交输出，组合指标是有损投影 |
| 方案 B 类级画像 (k, M, p90) | do-later | 分布比单数信息量大（形态是唯一决策相关部分）；前置 = ownerClass 透传（嵌套类归属已实锤断裂 E10）；p90 不可组合必须基准集现算 |
| 方案 C 组合指标 | defer | 公理5 冲突 + 有损投影 + 无消费者 |
| pack 表缺口（switch_expression/match） | 记档 | 非本迭代 |

## 落地

- module.ts:54-55 kind 守卫（`kind === "class" ? 0`——类 Σ 剔除）；types.ts complexity 注释定档类 chunk 语义
- cli.ts --complexity 加 n 列（`C=xxx n=xx`，排序键仍 C）
- moduledeps.test.ts +1（类 Σ > 方法 max 时 maxComplexity = 方法级 max——修复前该断言失败）

## 验证

- 398/398 + tsc 0
- InitDeity 实证：--modules Framework C **1136→119**、SDK **797→32**、UIs **117→46**（函数级回落——评审预期两位数 ✓）
- --complexity 双列：SSUShaderGUI.OnGUI C=128 n=9（高分支+深嵌套）/ Plan C=119 n=5（高分支中等嵌套）——两轴独立肉眼可验证

## 数学落档（供方案 B 实施）

- 类级画像 = (k, M, p90) 最小充分统计量；avg 冗余（右偏下被 M 支配）
- max 是层级唯一可组合的单数（join 半格，划分无关）；p90 不可组合
- 认知负荷 = f(C, n) 双轴——组合需整体替换 Campbell（含阈值重标），触发条件 = 真实消费者
