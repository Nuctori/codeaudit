# 迭代52 记录（record）：图完整度提升循环——第一轮闭环 + 停止准则评估

> 用户睡觉授权：「开审计修复循环，思考如何正确的提升完整度。直到没有可干的工作」+「结果和思路需要交叉审计」。
> 流程：00-plan（基线）→ 双评审交叉审计（数学家 run-60cd5ddd / Jeff Dean run-889f7414）→ 03-synthesis 裁决 → 实施 → 验证 → 停止评估。

## 实施与验证（提交 b944bcb）

| 项 | 修复 | 验证 |
| --- | --- | --- |
| P1 | builtinTypeEffects + builtinMutators 成对补 StringBuilder/Queue/Stack/HashSet/Uri（S1 红线成对） | 数学家注入实测 -1927 ✓ |
| P2 | 反射链：typeOfNodes + receiverTypeOf Type 根 + builtinMethodReturns/builtinTypeEffects 补 Type/MethodInfo/PropertyInfo/FieldInfo/TypeInfo（元数据读纯；Invoke 动态执行不列入） | 补判定表后生效 ✓ |
| P3 | flattenCallTarget 加 base_expression（selfNames 既有通道，C# 非虚分派 S1 安全） | ✓ |
| P5 | postfix_unary_expression 剥 `!`（++/-- 守卫） | 归因改善 ✓ |

**总效果**：unknownSites 96059→93201（-2858）、完整度 48.2%→**49.3%**、unknownRate 26.45%→26.14%；415/415 + tsc 0 + packConsistency 5/5；InitDeity 重扫无 IMPURE→PURE 翻转（S1 保持）。

## 停止准则评估（剩余 unresolved 构成——DBG obj 类型分布）

剩余 9948 `<unresolved>`：obj=invocation 7792（链式）+ element_access 629 + member_access 413 + parenthesized 379 + type_of 236（已修）+ object_creation 169 + string_literal 65。

高频形态（unknownCalls）接收者根分布（highfreq-obj 探针）：

- Object/Text·variable = **objectResponse_** 3969 站（API.g.cs）——`var objectResponse_ = await ReadObjectResponseAsync<T>(...)` **RHS 是 await 调用非构造** → ctorClsOf 绑函数名 → globalClasses 无 kind=class → ? 诚实。真解 = **P6 返回类型传播**（跨 chunk 类型流，新机制）
- Value·variable = h_/targetGameObject 等局部变量 → 动态分派面
- SetActive/GetComponent/AddComponent = go/g/currentGameObject → Unity GameObject 变量，类型不可静态定

**结论**：剩余全部需新机制（P6 类型流 / P7 属性链 / 动态分派标注面）——**按停止准则终止本轮**（修 20 行解 2500 站的形态已做完，剩余形态成本>>收益）。

## 残余（诚实记录）

- P4 框架属性类型化：frame:gameObject 仅 8+6 站——收益极小，不做
- P6 fieldTypes（返回类型传播）：objectResponse_ 3969 站真解，需跨 chunk 类型流——新机制，延后
- P7 属性链（builtinMethodReturns 消费扩展）：变量根不可达——延后
- 动态分派面（go.SetActive 等）：标注工作流消化（--unknowns 形态批组）

## 交叉审计记录

- 我的草案 6 倍高估（~3000 → 实际 ~450-600 真可解 + P1 表补 -1927）——双评审独立探针实证修正
- A 类（泛型 attr）假设错误：generic_name 分支已工作（extractor L1893）——否决实施（空转改动）
- B 类（链式）变量根不可达：receiverTypeOf 只认三根——否决
- C 类根因 = 缺表键非 flatten：注入实测证明——采纳（P1）
- 完整度数学修正：~3000 站 → 48.9%（逐站 0.26pp/千站）——实际 49.3%（含 P2 判定表）
