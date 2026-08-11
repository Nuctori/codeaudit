# 迭代 25 记录（record 节点）

> DAG run-msp7t0ak-955b9ff5：audit → impl → verify → record（串行）
> 基线 HEAD acbb210（261/261）→ 当前工作树 265/265（+4：csharp-lang 迭代25 T1-T4）

## 归档清单（docs/iter25/，4 件齐全）

| 文件 | 节点 | 内容 |
| --- | --- | --- |
| `audit.md` | audit | C# 写侧三残余机制实证（对象初始化器/类字段裸写/局部声明假裸读/++ 不可见）+ 方案 a-d + 4 项待办 |
| `impl.md` | impl | b→d→c→a 实施 + InitDeity 复扫对比（stateCoupling 6860→5919 −14%）+ !x 陷阱 |
| `verify.md` | verify | 复审结论 **APPROVED**（逐项实证 + 修复前 4 败验证 + 265/265 独立复跑） |
| `record.md` | record | 本文件 |

## CROSS-AUDIT.md 追加

「## 迭代 25（C# 状态提取精度：对象初始化器 / 类字段 self / 局部声明 / ++ 写补）」节已追加（迭代 24 节之后）：

- 真实项目驱动（迭代 24 残余处置）：对象初始化器属性名裸写（Quest12 1949 读者）、类字段裸写全局名（ConfigSingleMenu 2674）、++ 写不可见（假纯缺陷）
- 修正任务前提：declaredNames 已覆盖 C#，真正失效是 assignedNames（variable_declarator 无名字段）
- 修复 4 项全 C# 门控零跨语言风险：b 初始化器跳过 / d ++/-- 写补（isIncDec 操作符白名单防 !x 陷阱）/ c variable_declarator→assigned（children[0] fallback 仅 C# 触发）/ a 类字段写→self.attr（inClassMemberBody 祖先爬）
- InitDeity 复扫：stateCoupling 6860→5919（−14%）、ConfigSingleMenu 2674→903（−66%）、SegmentId/Name 裸写清零、PURE/IMPURE/UNKNOWN 8059/10545/5195→8106/10232/5461 方向一致
- 测试 +4（修复前均失败），265/265 全绿
- 工具盲区处置：① 已闭环；② 读侧不对称（需类型解析）→ 待办；③ lambda 参数名裸读、element_access 左值写 → 记录待办
- 复审 APPROVED 无 blocker

## README.md / CHANGELOG.md 同步

- README：测试数 265（两处）——已由 impl 完成，`check-readme-tests.cjs` 门禁通过
- CHANGELOG：[Unreleased] 标题改「迭代 22-25」；修复条目追加 5 条（对象初始化器跳过 / 类字段 self 收敛 / ++ 写补 / variable_declarator assigned / 语义延续）

## 下轮待办（verify 非 CHANGES，从 audit.md §4 与 impl.md 残余提取）

1. **裸字段读不映射 self**（§4.1，需类型解析）：`score` 裸读成孤儿（不与 self.score 写耦合）——精度/召回权衡，purity 判定不受影响，优先级 P3
2. **lambda 参数名裸读**（§4.6 声明名裸读抑制）：`x => !x` 的 x 在 stateReads——需参数作用域感知，跨语言，P2
3. **element_access 左值写**（§4.5）：`arr[i] = v` 写侧不可见——C#/JS 数组下标写，P2
4. 延续记录待办：F4 sideEffects 认证、F10 缓存分片、F16 效应表注入、F18 英文文档、标注文件归档（基线不可复现）

## 提交建议（主会话统一提交）

单次提交建议信息：

```
Iter-25: C# 状态提取精度（对象初始化器 / 类字段 self / 局部声明 / ++ 写补）

- b: 对象初始化器属性写不再裸写全局（new C { A = v } 非外部状态写——Quest12* 1949 假读者源头消除）
- a: C# 类字段裸写收敛 self.attr（inClassMemberBody 祖先爬；ConfigSingleMenu 2674→903 读者 −66%）
- c: variable_declarator 并入 assignedNames（children[0] fallback 仅 C# 触发）——int q=1 不再假裸读
- d: C# i++/this.x++ 写侧补全（仅认 ++/-- 操作符，!x/-x 是读不误写——字段自增方法不再假纯）
- InitDeity 验证: stateCoupling 6860→5919（−14%），PURE/IMPURE/UNKNOWN 8059/10545/5195→8106/10232/5461
- 测试 +4（csharp-lang T1-T4，修复前均失败），265/265 全绿
- README/CHANGELOG/CROSS-AUDIT 同步
```
