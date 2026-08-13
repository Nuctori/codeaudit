# 迭代47 计划：圈复杂度语义 + 簇聚合形态（开会审计）

> 用户指令：「圈复杂度输出，不是计算同一个簇（如模块，类，函数）的 chunk 的嵌套深度吗，开会思考下」
> 基线：c3b478b（MCCabe 近似已落地），389/389 + tsc 0。工作树含 iter46 并行工作（不冲突）。
> 流程：00-plan → 01-math-review → 02-jeff-review → 03-synthesis → 落地。

## 一、现状与实证问题

**当前实现**（iter44-r4）：每个 chunk 独立 MCCabe（分支节点 + 短路运算符 + 1 基准）。

**实证污染**（--modules 的 maxComplexity 列）：

- Framework C=1136 = **RuntimeMainlineAutopilot 类 chunk**（class_declaration 包含全部方法分支之和）
- SDK C=797 = **RewardClient 类 chunk**（API.g.cs 生成类）
- 类 chunk 的 MCCabe = 方法之和——**非标准**（MCCabe 是函数级度量）

**用户质疑点**：

1. 圈复杂度的正确语义（控制流分支 vs 嵌套深度——工具已有 nesting 字段）
2. 簇（模块/类/函数）的复杂度聚合形态——不是"同一个簇的 chunk 嵌套深度吗"

## 二、候选方案

### 方案 A：修正污染（最小）

- --modules 的 maxComplexity 排除类 chunk（kind !== class）——函数级 max
- 类 chunk 的复杂度保留在 JSON（信息不丢）但输出不混

### 方案 B：三层簇复杂度视图（推荐候选）

- **函数级**：MCCabe（标准）——`--complexity` 输出（已做）
- **类级**：函数复杂度分布（max/avg/p90）——类 chunk 的"复杂度画像"（方法数、最复杂方法、平均复杂度）——替代"方法之和"（无意义的单数）
- **模块级**：聚合类画像 + 函数分布——`--modules` 加 avg/max（函数级）

### 方案 C：嵌套深度关系（评审裁决）

- nesting（结构深度）与 MCCabe（分支数）是**正交维度**：认知负荷 ≈ 两者组合
- 是否引入组合指标（如 复杂度×嵌套 的启发式）——还是保持正交双列输出

## 三、评审问题

1. 类 chunk 的 MCCabe（方法之和）语义：应剔除（函数级标准）还是保留（类整体复杂性）？剔除后类级画像的正确形态（max/avg/p90 vs 方法数）？
2. 用户说的"嵌套深度"：nesting 字段与 MCCabe 的关系——是否应作为复杂度的一部分（组合）还是正交维度？
3. 簇聚合的正确层级：函数→类→模块——每层什么指标（单数 vs 分布）？
4. 输出设计：--complexity（函数 top）/ --modules（模块聚合）的最终字段集？
5. 是否有更优雅的复杂度模型被漏掉（如认知复杂度 Campbell、加权分支）？
