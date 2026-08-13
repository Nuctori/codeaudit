# 迭代45 记录（record）

> 议题：Iter-44 工程妥协最小形式化（数学家 + Jeff Dean 开会审计）+ 标注生命周期数学解。
> 流程：00-plan → 01-math-review → 02-jeff-review → 03-synthesis → 实施 → 验证。
> 基线：486dc88，380/380。

## 双评审要点

- **数学家**（/tmp/iter45-1.md）：C1 blocker（assigned 含赋值左值 → C# 隐式 this 属性写-读假纯，S1 违反；类 chunk 整树收集污染）；C5 义务未形式化 + alias_qualified_name 已知违反；C8 决定集会计（V 命题）为正确数学，工具修复不改变 chunk id → 吸收非 unmatched（pain-2 归因勘误）；fix-first-then-annotate。
- **Jeff Dean**（/tmp/iter45-2.md）：C5/C6 机检为唯一高价值代码项（grammar 13 directive 中 5 个两侧未覆盖 + 两表不一致）；C8 已够用不落代码；C9 impureGlobals 无遮蔽守卫补入清单。

## 实施（本轮）

| 变更 | 文件 | 内容 |
| --- | --- | --- |
| C1 修复 | link.ts | isClassMemberName（C# 限定名索引命中；TS/JS memberNameExists；仅 bareNameMeansThisInMethod）+ 短路谓词四条件 |
| C5 修复 | extractor.ts | pushBase 加 alias_qualified_name 剥壳（children[1] 递归） |
| C5/C6 表补 | csharp.ts | heritageSkipNodes 6→14、propertyReadSkipParents 8→14（directive 族全量） |
| 机检 | heritage-skip-completeness.test.ts | 3 用例（directive 全覆盖 / wasm 节点集对拍 / global:: 基类不降级） |
| 回归 | iter45-c1.test.ts | 3 用例（类 chunk 污染非 PURE / 局部读保留 / 写-读属性 IMPURE） |
| 形式化 | axioms.md 四·八 | L-C1′/L-C2/O-C5/O-C6/C8 V-R-O-S 命题组 |
| 台账 | technical-debt.md | C8/C9 条目 + 迭代45 清空项 |
| 计划 | docs/iter45/ | 00-plan / 03-synthesis / record |

## 验证

- 388/388（41 files）+ README 门禁绿
- tsc：并行工作树 cli.ts（迭代44-r4 未提交）除外干净——本轮不碰并行改动
- 探针实证：C1 类 chunk 污染 A（无污染 UNKNOWN）vs B（污染 PURE）——修复后非 PURE

## 残余

- C2 全限定 System.* 枚举 → top-miss 数据裁决（未跑）
- C9 impureGlobals 遮蔽守卫（安全-过近似，记录）
- 语料桥跨世代 n 虚高（YAGNI，A7 先验不进判定）
- 吸收向回显（等第二语料）
- 并行工作树迭代44-r4（cli.ts/filedeps.ts/module.ts）——非本轮范围

## 决策链

D-163（迭代45 双评审裁决：C1/O-C5/O-C6 修复 + 形式化落档 + C8 数学解不落代码）。
