# 迭代52 合成（03-synthesis）：`<unresolved>` 修复交叉审计裁决

> 流程：00-plan（基线 + 6 类根因草案）→ 01-math-review（数学家，探针实证）→ 02-jeff-review（Jeff Dean，实证）→ 本合成。
> 用户要求：结果和思路交叉审计（已满足——双评审独立 fresh-context，各自探针实证）。

## 双评审关键修正（我的草案 6 倍高估）

| 类 | 我草案 | 双评审实证 | 裁决 |
| --- | --- | --- | --- |
| A 泛型 attr ~900 | flatten 分支未命中 | **根因误诊**：generic_name 分支已工作（extractor L1893）；真实根因 = link 期字段无类型 | **不做**（空转改动） |
| B 调用链 ~780 | builtinMethodReturns 补表 | 链底变量，receiverTypeOf 只认字面量/构造/调用三根——表无消费者 | **不做**（需新机制） |
| C 变量接收者 ~730 | 待探针 | **flatten 成功，根因=缺表键**：注入 StringBuilder/Queue/Stack/HashSet/Uri 实测 **-1927 站**（48.15→48.65%）——低估 2.6 倍 | **做（P1）** |
| D base ~400 | base_expression 未处理 | selfNames 已含 "base"（csharp.ts:785）+ link 分支已接——只缺 flatten base_expression→"base"；主流 base 全在项目内 | **做（P3）** ~20 行 |
| E `!` 69 | 未剥壳 | 节点 = postfix_unary_expression（`null_forgiving`/`non_null` 是**死条目**）；剥壳后仍变量接收者（收益 0，归因改善） | **做（P5）** 顺手 + 清死条目 |
| F typeof/Convert ~180 | 表可解 | typeof 真可解（真实节点 type_of_expression，csharp.ts:740 "typeof_expression" 是幽灵条目）；Convert 47 小表 | **做**（并入 P2/P3） |
| G async 家族 42 | 表补链 | **低估 50-100 倍**：MoveNextAsync 512+DisposeAsync 428+GetAsyncEnumerator 415+IsCompleted 449+OnCompleted 434+UniTask 包 ≈ 3000-4000 站——最大杠杆 | **做（P2）** |

## 裁决（按实测收益排序）

1. **P1 C 效应表补全**：builtinMutators 成对补 StringBuilder/Queue/Stack/HashSet/Uri（**S1 红线：必须成对补 mutator**——参数共享 StringBuilder 不补 mutator → 假纯）→ 实测 -1927
2. **P2 async 家族效应表**：MoveNextAsync/DisposeAsync/GetAsyncEnumerator/IsCompleted/OnCompleted + UniTask 包高频 → 估 -3000~4000
3. **P3 D base flatten**：base_expression → "base"（polymorphic=false 静态分派，闭包排除 ownerClass 自身，外部基类保持 ?）→ ~-400
4. **P4 框架属性类型机制**（SetActive 1162/GetComponent 934/AddComponent 512/InvariantCulture 465）：机制级（frameworkAttrPrefix 扩展为类型化），估 -3000+——**评估后决定**（机制成本 vs 表）
5. **P5 E 剥壳 + 死条目**：postfix_unary_expression 剥 `!`（带 ++/-- 守卫）+ 清 non_null_expression/typeof_expression 死条目
6. **P6 fieldTypes**（A 真解，-900）：跨 chunk 字段类型表——**延后**（新机制）
7. **P7 属性链**（B 真解）：builtinMethodReturns 消费扩展——**延后**（新机制）

## 验证方案（数学家给）

- 语料 diff 翻转集审计：UNKNOWN→PURE 的 chunk 逐调用点断言白名单通道
- 五类反例套件：base 三层覆写静态分派 / `x++` 不剥壳 / string.Join 链正例+错条目断链反例 / 参数共享 StringBuilder→IMPURE(state) / fieldTypes 隐藏守卫
- invariantViolations=0 + DBG 分类账精确移动 + tableMiss/topShapes 循环仪表停止准则

## 完整度数学（修正）

~3000 站 → **~48.9%**（逐站 0.26pp/千站，分母同步收缩——非草案 49.5%）
