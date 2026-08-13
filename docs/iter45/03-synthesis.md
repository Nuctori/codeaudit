# 迭代45 合成（03-synthesis）：Iter-44 妥协最小形式化 + 标注生命周期数学解——实施裁决

> 流程：00-plan → 01-math-review（数学家）→ 02-jeff-review（Jeff Dean）→ 本合成 → 实施 → 验证。
> 基线：HEAD 486dc88（Iter-44-r3），380/380 + tsc 0（两评审独立实测一致）。

## 双评审结论

| 项 | 数学家（01） | Jeff Dean（02） | 合成裁决 |
| --- | --- | --- | --- |
| C1 局部读判纯短路 | **blocker**：assigned 含赋值左值——C# 隐式 this 属性写后裸读短路判 PURE → getter io 假纯（S1 违反，反例 1.3）；类 chunk 同理（整树收集污染） | 做（形式化）——三条件豁免面充分，缺口 catch/foreach 已闭合但无测试 | **修复**（探针对照实证：类 chunk 污染 A=UNKNOWN vs B=PURE）+ 3 回归 |
| C2 System 枚举白名单 | 成立；残余分类修正——全限定 `?` 是**形式强加**非信息论必然（知识在 pureGlobals，键形状不匹配） | 数据续项：frameworkPure.System 子键 1 行/名，先测 top-miss 频次 | 形式化（L-C2）+ 数据裁决待跑 |
| C3 `<unresolved>` 剥壳 | 成立（修复非妥协）；factory()() 才是真·信息论正确擦除 | 移出形式化清单 | 移出（修复已闭环） |
| C4 top-N 补表 | 成立（数据债）；「80 条死条目不删」对；维护纪律入 B 表 | 一句纪律注记 | B 表注记（已落） |
| C5 heritageSkipNodes | **义务未形式化 + 已知违反**：alias_qualified_name 缺位（D-144 实证节点存在）；region/endregion 不对称；计划「7 节点」vs 代码 6 | **机检**（唯一高价值代码项）：grammar 13 directive 中 5 个两侧未覆盖；事故成本 2-4 人日 vs 机检 1-2h | **机检 + 修复**（pushBase 剥壳 + 两表全量补齐 + 3 回归） |
| C6 预处理排除 | 成立；失败方向 = 安全-未知（局部噪音，非 C5 全局降级） | 并入 C5 机检 | 并入（同检查器） |
| C7 sourceSnippet | 成立（渲染修复） | 移出 | 移出 |
| C8 标注生命周期 | 候选 1 修正（半衰期只对引用子过程）/ 2 成立+计数漏（跨世代 n 虚高）/ 3 降格 / **4 采纳（决定集 = 机器判定差集，零新机制可测）** / 5 新方向：fix-first-then-annotate + 三向失效分解 | **已够用不落代码**（无第二语料/无历史账本/唯一语料 100% 覆盖）；方向 2 是已实现事实；唯一工程延伸 = unmatched 回显补原因分类 | **形式化落档**（V/R/O/S 命题组 axioms.md 四·八）；代码不落（YAGNI，等第二语料）；pain-2 归因勘误 |

## 实施清单（本轮落地）

1. **C1 修复**：link.ts isClassMemberName（成员互斥，仅 bareNameMeansThisInMethod 语言）+ 短路谓词四条件；iter45-c1.test.ts 3 用例（类 chunk 污染非 PURE / 局部读短路保留 / 写-读属性 IMPURE）
2. **C5 修复**：extractor pushBase 加 alias_qualified_name 剥壳；heritageSkipNodes 补 region/endregion/line/error/warning/pragma/nullable/extern_alias（6→14）
3. **C6 修复**：propertyReadSkipParents 补 line/error/warning/pragma/nullable/extern_alias（8→14，与 C5 对称）
4. **O-C5/O-C6 机检**：heritage-skip-completeness.test.ts 3 用例（directive 族全覆盖断言 + wasm grammar 节点集对拍 + global:: 基类不降级）
5. **形式化落档**：axioms.md 四·八（L-C1′/L-C2/O-C5/O-C6/C8 命题组）；technical-debt.md（C8/C9 条目 + 迭代45 清空项）；annotation-workflow-review.md 归因勘误
6. **决策链**：D-163 记录

## 验证

- 388/388（380 + 3 C1 + 3 O-C5/C6 + 2 迭代44-r4 并行工作树）
- tsc：干净（并行工作树 cli.ts 未提交改动除外，非本轮范围）
- README 门禁绿（check-readme-tests）

## 残余（诚实）

- C2 全限定形态 → top-miss 数据裁决（脚本已存在 scripts/top-miss.cjs，未跑 InitDeity 频次）
- C9 impureGlobals 无遮蔽守卫（安全-过近似，iter41 已知，补 B 表记录）
- 语料桥跨世代 n 虚高（方向安全，YAGNI 裁决；先验不进判定 A7）
- 标注三向失效分解吸收向回显（等第二项目语料）
- 并行工作树（迭代44-r4 cli.ts/filedeps.ts/module.ts）未碰——非本轮范围
