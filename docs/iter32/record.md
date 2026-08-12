# 迭代 32 记录（record 节点）

> DAG run-mspib7ep-cefe9230：audit → impl → verify → record（串行）
> 基线 HEAD 0c35349（293/293）→ 当前工作树 297/297（+4：csharp-lang 迭代32 T1-T4）

## 归档清单（docs/iter32/，3 件齐全）

| 文件 | 节点 | 内容 |
| --- | --- | --- |
| `audit.md` | audit | 案 1 vs 案 2 方案对比（成员级白名单推荐）、System 10 命名空间逐成员拆分（~22 类型键）、link.ts 消费改动、classifyUsage 适配、测试点、风险 |
| `impl.md` | impl | 两级结构实现（13 整类型 pure + Linq 整类 hof + Text 3 子键 + Array 异质嵌套 17 成员）、linqHof 删除、unconditional 门、InitDeity 复扫对比、实现裁决 |
| `verify.md` | verify | 复审结论 **APPROVED**（Blocking Text 死键修复闭环，297/297 独立复跑） |

## CROSS-AUDIT.md 追加

- **迭代 31 节**（LINQ monad 建模审计 + S1 链修复 + S3 假纯堵洞）：monad 主体收益评估（359 站点 0.6% 不支撑）+ S1（invocation_expression 链修复 21,488 站点）+ S3（hofAlwaysArgs 空表假纯洞）+ HIGH-1/MEDIUM-2 复审修复 + 记账不变量 + builtinTypeEffects monad 表 + compromise-audit 9 妥协识别（3 数学最小化候选）
- **迭代 32 节**（frameworkPure 方法级白名单）：compromise-audit top1 落地——案 1 成员级白名单选型、两级结构实现、Blocking Text 死键修复、297/297、InitDeity −1/+1 正确化

## README.md / CHANGELOG.md 同步

- README：测试数 297（两处）——impl 已做，record 复核 check-readme-tests.cjs OK 297
- CHANGELOG：追加 [Unreleased] 迭代 31-32 节（新增 3 条 + 修复 6 条）——record 完成

## 下轮待办（verify 残余 + audit 记录）

1. **Linq 非委托成员**（Concat/Skip/Take/ToArray）带标识符实参 → ?（arity 感知 argFnsOf——Linq 整类 hof 过宽 Major latent）
2. **pure 成员被传真正函数实参** → 假纯理论风险（语言事实缓解，无语料实证）
3. **Linq.Expressions.\*** 收紧（Compile=动态执行，当前 PURE 是 iter30 基线延续）
4. **A1 变量类型绑定**（monad 主体——声明点类型绑定 + IEnumerable 表 + 字段绑定续接，语料收益 <300 站点）
5. **fitBaseRate 经验贝叶斯**（profile-MLE，数据门槛 ≥4 项目）
6. 延续记录：F10 缓存分片、F18 英文文档、标注文件归档（基线不可复现）

## 提交建议（主会话统一提交）

单次提交建议信息：

```text
Iter-31/32: LINQ monad 审计落地 + frameworkPure 成员级白名单（假纯结构通道关闭）

- S1: receiverTypeOf 支持 invocation_expression（C# 链第二环起恢复）+ builtinMethodReturns/TypeEffects 补链方法
- S3: hofAlwaysArgs 空表假纯洞 → linqHof 分离 + unconditional 门（命名回调未解析记 UNKNOWN）
- HIGH-1/MEDIUM-2: addArgEdges 门认 linqHof（差集 15 算子不假纯）+ Join 移出全局表（String.Join 不误伤）
- 记账不变量: addArgEdges 兜底走 markUnknown（calls[?] === unknownSites>0 恢复，标注工作流可见）
- frameworkPure 成员级白名单（compromise-audit C1）: 两级结构 + linqHof 删除 + Text 嵌套 + Array 异质拆分
- 测试 +9（S1/S3/HIGH-1/MEDIUM-2/撞名守卫 + T1-T4），297/297 全绿
- README/CHANGELOG/CROSS-AUDIT 同步（迭代 31-32 节）
```
