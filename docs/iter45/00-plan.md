# 迭代45 计划：Iter-44 工程妥协最小形式化 + 标注生命周期数学解（开会审计）

> 用户指令：「最近一轮迭代有那些工程妥协需要最小形式化，数学家和jeff dean开会审计。」
> 追加：标注不是永久资产（代码变化 → chunk id 变化 → 标注失效；工具再修复 → 标注被机器取代，
> 痛点2 例子 -37% 标注 chunk 回归机器判定）——「这个痛点也看看有没有数学解」。
> 基线：HEAD 486dc88（Iter-44-r3），380/380 + tsc 0，工作树 clean。
> 流程：00-plan → 01-math-review（数学家）→ 02-jeff-review（Jeff Dean）→ 03-synthesis → 落地。

## 一、Iter-44 轮工程妥协盘点（从 record/双评审/提交提炼）

| # | 妥协 | 实现形态 | 方向分类 | 现状 |
| --- | --- | --- | --- | --- |
| C1 | **局部变量 prop 读判纯短路** | link.ts 分支 2 顶部 `obj===null ∧ prop ∧ attr∈assigned → return`（判纯） | 安全-判纯（读取存储位置不执行用户代码，C# 规范级事实，与参数读取同族先例） | 已落地 9c38853；残余：catch/循环变量 assigned 缺口（iter44-r2 ee3fbc6 补 foreach/catch 变量） |
| C2 | **System 枚举白名单判纯** | pureGlobals 4 键（StringComparison/TaskStatus/BindingFlags/AttributeTargets） | 安全-判纯（枚举成员 = 编译期常量）；B 泛化否决（无类型系统 = 插件 getter 假纯，A7 结构违反） | 已落地 9c38853；残余：全限定形态 `System.X.Y` → obj="System" → `?`；数据债与 B1 合并 |
| C3 | **`<unresolved>` 漏网剥壳** | flattenCallTarget 加 generic_name（name 子节点）/alias_qualified_name（children[1] 递归） | 修复（非妥协）；残余不可拍平形态（factory()()/d[k]()）→ `<unresolved>` → `?` 设计诚实 | 已落地 9c38853（<unresolved> 13575→11702） |
| C4 | **top-N 补表（数据校准）** | top-miss.cjs 脚本 + pureCtor 首批 3 条目（HttpRequestMessage/HttpMethod/StringContent） | 数据债（B1 合并：Σ 表条目 = 世界知识，语料频次驱动） | 已落地 9c38853；top-100 剩余 ~20-30 条分轮 |
| C5 | **heritageSkipNodes 数据化** | pushBase 硬编码 → 表（predefined_type + 预处理 7 节点 + ERROR 解析层兜底） | **数据债（高杠杆）**：漏一节点 → classExtendsOf 误判动态 heritage → hasDynamicExtends=true → 规则3 语言级降级（全库 C# 多态/隐式 this → unknown） | 已落地 37eb151（6700→4199 -37%）+ 486dc88 表化；**完备性义务未形式化** |
| C6 | **预处理指令符号排除** | propertyReadSkipParents 加 8 预处理节点（if/elif/else/endif/define/undef/region/endregion） | 安全-排除（编译期位置无运行时读取） | 已落地 cd2743f（unknown 6853→6730）；同 C5：节点清单数据债 |
| C7 | **sourceSnippet 越界夹紧** | start>end → 夹到 end 前（slice 空修复） | 渲染修复（非妥协） | 已落地 88accb1 |
| C8 | **标注生命周期**（用户新痛点） | 标注按 chunk.id 寻址；代码变化 → id 变化 → 标注失配（unmatched 回显揭示）；工具修复 → chunk 不再 UNKNOWN → 标注被机器取代 | 非缺陷（正向：机器证明取代人工断言） | 实测：1123→857 PURE 标注失效（痛点2 修复后）；**无数学建模** |

## 二、C8 标注生命周期的候选数学方向（待评审裁决）

1. **标注价值 = 半衰期模型**：标注有效 ⟺ chunk ∈ UNKNOWN 集；代码变更率 λ → 期望寿命 ~1/λ；
2. **标注的持久价值在语料先验，不在标注条目**：chunk 消亡后标注的"知识"经 corpus cell 计数（attr,root）转移到同类新 chunk——标注是桥不是资产；
3. **失效检测已完备**（unmatched 回显 D-155/157），缺的是**失效预算**：标注曲线 + 变更率 → 期望失效标注数的核算；
4. 反问题：工具修复（M 扩大）使标注吸收——已标 chunk 回归机器判定是否影响语料账目（seen 双锚定已去重）。

## 三、评审问题

1. C1-C6 的"最小形式化"应写在哪里、什么形态（axioms.md 四·八 引理？technical-debt.md B 类方向分类？）？
2. C5/C6 的节点清单完备性义务：是否应形式化为「跳过表必须与 grammar 节点集对拍」的机检（vs 文档化）？
3. C2 全限定形态残余（System.X.Y → ?）是否值得补（frameworkPure System 子键 vs 数据裁决）？
4. C8 标注生命周期的数学解：哪个方向是"正确的数学"？标注半衰期可测吗（需要什么数据）？
5. 是否有漏掉的 Iter-44 妥协？
