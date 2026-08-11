# 迭代 24 记录（record 节点）

> DAG run-msp6owmq-6cf5dc0e：audit → impl → verify → record（串行）
> 基线 HEAD 17adf9f（258/258）→ 当前工作树 261/261（+3：csharp-lang T1/T2/T3）

## 归档清单（docs/iter24/，4 件齐全）

| 文件 | 节点 | 内容 |
| --- | --- | --- |
| `audit.md` | audit | 根因链审计（`===` 死代码实证 / C# 成员节点缺口 / 写侧对偶缺失；InitDeity 2633 读者虚高机制；跨语言回归面） |
| `impl.md` | impl | stateReadPos 重写 + externalWritePos 写侧对偶；InitDeity 复扫对比（2633→1005）；+3 测试 |
| `verify.md` | verify | 复审结论 **APPROVED**（根因修复实证 + 261/261 独立复跑；无 blocker） |
| `record.md` | record | 本文件 |

## CROSS-AUDIT.md 追加

「## 迭代 24（状态耦合精度修复：提取层死代码根因闭环）」节已追加（466 行尾部）：

- 真实项目驱动发现（--state 实战 InitDeity：instance 2600+ 误读者）
- 根因① `===` 判等死代码（跨语言，自迭代 8 起——调用目标排除/赋值左值跳过从未生效）
- 根因② C# 成员节点全覆盖缺口（字段读永不产生 + 子标识符裸读）
- 根因③ 写侧对偶缺失（C# this.x=v 写不可见）
- 修复（stateReadPos 重写 + externalWritePos 补对偶）
- InitDeity 验证（instance 读者 2633→1005 −62%；UNKNOWN 28.1%→25.0% 正确化）
- 工具盲区处置（① 死代码已闭环 ② 对象初始化器/类字段名裸写待下轮 ③ 局部声明名/this.x++ 记录待办）
- 复审 APPROVED（无 blocker）

## README.md / CHANGELOG.md 同步

- README：测试数 261（两处）——已由 impl 节点完成，`check-readme-tests.cjs` 门禁 OK 261
- CHANGELOG：[Unreleased] 标题改「迭代 22-24（真实校准 + 门禁 + 状态耦合图 + 效应表收紧 + 状态耦合精度修复）」；修复段追加 3 条目（`===`→`.id` 死代码、C# 成员节点覆盖、externalWritePos 写侧对偶）——本节点完成

## 提交清单（主会话统一提交）

```
迭代 24：stateReadPos 死代码修复（===→.id）+ C# 成员节点 + 写侧对偶

- extractor.ts: stateReadPos 重写——===→.id（web-tree-sitter 节点同一性死代码，跨语言）；成员子标识符抑制；C# member_access_expression/conditional_access_expression 覆盖；调用 parent 补 invocation_expression/object_creation_expression；?. 边缘；obj/attr 字段分支
- extractor.ts: externalWritePos 写侧对偶——C# this.x=v 字段写可见
- csharp-lang +3 测试（T1 调用目标不产生 stateRead / T2 字段读保留 / T3 字段写可见）；fixture UIWorldLink UNKNOWN→IMPURE 正确化
- InitDeity: instance 写方读者 2633→1005（−62%）；UNKNOWN 28.1%→25.0%（正确化）
- 测试 +3，261/261 全绿；README/CHANGELOG/CROSS-AUDIT 同步
```

## 下轮待办（verify 补充 + 本节点汇总）

1. **C# 对象初始化器/类字段名裸写**（P2）：Quest12 对象初始化器属性名 1949 读者、ConfigSingleMenu 类字段名裸写 2674 读者——C# 类作用域字段应 self.x 语义（非全局裸名），需类作用域感知的裸标识符判定
2. **C# 局部声明名/方法名裸读**（P3）：assignedNames 对 C# 无效（assignmentTargets 节点无 left/name 字段，variable_declarator 未列入）——把 C# variable_declarator 名字并入 assigned/declared
3. **C# `this.x++`/`i++` 写不可见**（P3）：postfix/prefix_unary_expression 不在 stateWritePos 列表——补写侧增量
4. 延续：标注文件归档（基线不可复现）、F4 sideEffects 认证、F10 缓存分片、F16 效应表注入、F18 英文文档
