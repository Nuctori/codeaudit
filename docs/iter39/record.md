# 迭代39 实施记录（record）

> 规格：docs/iter39/00-model.md（数学模型 M=(IR,Σ,Λ,π,H,F) + 引理 L1-L7）。
> 基线：迭代38 提交 `9589e33`。验收：335/335 + tsc 干净 + 真实扫描冒烟 + 独立审计。

## 实施内容

| 项 | 落地 | 模型条款 |
| --- | --- | --- |
| P0-1/B11 | ctor 分支：闭包（ancestorClosureOf）全部 class chunk 原始调用并集（字段初始化器/访问器/静态初始化器）+ 隐式纯条件收紧（闭包零显式 ctor ∧ 全部 class chunk 零调用） | L5 |
| B7 | pack.polymorphicMethods（csharp false）+ facts.virtualMembers（virtual/override/abstract，sealed 排除，base_list≥2 接口启发）+ link 合并 + resolveClassMember BFS 首声明层 virtual 守卫 | L4 + 1.4 |
| B9 | HierarchyCtx 参数束 + resolveFromObjectImport moduleBindings → resolveClassMember(polymorphic=false) | F 通道 |
| B10 | Sink.addStateWrite → extraStateWrites → out.stateWrites 合并（位置 = 参数名） | L6 |
| node: | pack.stripModulePrefixes + link.effectModuleName + effectUsage P2/P4 判据数据化 | π 行为侧 |
| P2-2 | test/audit/ast-shape.test.ts：6 契约（提取产物断言，wasm 升级防静默失效） | π 形状契约 |
| P2-1 | pack.astShapes 19 集投影表（py/ts/js/cs 全声明）+ extractor 17 函数节点类型判定走 shapesOf；identifier/property_identifier/type_identifier/predefined_type 保留为跨语言公共名（模型注明非语言常量） | π 数据侧 |

## 探针实证修复（P2-1 过程中）

- **TS class_heritage 内包 extends_clause**：静态基类提取全漏 + 误标 dynamic（此前 dyn-ext 测试只验证了 dynamic 侧，静态侧是死路径）——pushBase 加 extends_clause 剥壳，形状契约网捕获。
- virtualMembersOf 方法在 declaration_list 内（非类直接子节点）——递归 walk + 嵌套类边界。
- 修饰符 token 可能命名/匿名——全子节点文本匹配。

## 测试

- inheritance.test.ts：B7 拆分（非 virtual → PURE 精度回收 / virtual+覆写 → UNKNOWN）+ 迭代39 缺口闭合 4 反例（字段初始化器×2、B9、B10）。
- ast-shape.test.ts：6 形状契约（Python typed_parameter / superclasses 逗号 / C# base_list 子节点 / virtual 修饰符+sealed / 接口启发 / TS heritage+dynamic）。
- 基线：迭代38 的「C# 多态守卫」测试按 B7 语义翻转（非 virtual → PURE）。

## 独立审计（FAIL → 修复 → 复核）

审计抓出 2 个 S1 假纯反例 + 3 处 P2-1 语义偏差，全部必修落地：

1. **显式 ctor + 字段初始化器假纯**：bodyEdges 并集循环移至 `r==="edges"` return 之前（L5 并集语义，非 XOR）。反例测试：`static int x = ReadLine()...` + `public B() {}` → new B() IMPURE。
2. **接口接收者假纯回归**（B7 引入）：`interface_declaration` 全部方法无条件标 virtual（接口分派恒动态）。反例测试：`IRepo r; r.Get()` → UNKNOWN。
3. **moduleBindingsOf/localBindingsOf**：`bindAssigns` 新投影集（不含 augmented——`x += C()` 假绑定）；TS/C# stmtWrapNodes 补 expression_statement（模块级裸赋值绑定回归）。
4. **C# catchNodes 补 catch_clause**（异常捕获减法静默失效）。
5. 可选：literalReceiverType 走 unwrapNodes（csharp 补 as_expression/non_null_expression 保等价）；B13/B14 债单描述修正（接口接收者才是真洞；「属性访问器并入」是文档幻觉——实际残余 = 静态初始化器并入过近似）。

复核：337/337 + tsc 干净。
