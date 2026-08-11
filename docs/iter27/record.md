# 迭代 27 记录（record 节点）

> DAG run-msp9zosx-74cceb7c：audit → impl → verify → record（串行）
> 基线 HEAD e19d756（269/269）→ 当前工作树 273/273（+4：csharp-lang 迭代27 T1-T4）

## 归档清单（docs/iter27/，4 件齐全）

| 文件 | 节点 | 内容 |
| --- | --- | --- |
| `audit.md` | audit | 声明名抑制补齐审计（4 类真裸读定位：tuple_pattern/foreach/catch/except-as；self[k]=1 弱键 P3 评估；TS this[k]=v 零写盲区） |
| `impl.md` | impl | 统一声明名抑制 5 规则实现 + InitDeity 复扫（273/273，+4 测试） |
| `verify.md` | verify | 复审结论 **APPROVED**（5 规则 4 语言 15 构造实证 + 273/273 独立复跑；无 blocker） |
| `record.md` | record | 本文件 |

## CROSS-AUDIT.md 追加

「## 迭代 27（声明名抑制收尾：pattern/foreach/catch/except 变量）」节已追加（498 行尾部，508 行总）：

- 统一声明名抑制 5 规则（① name 字段 ② variable_declarator children[0] ③ pattern 名 depth-1 ④ foreach in 位置判断 ⑤ catch_clause/as_pattern_target 整类，全 .id 判等）
- 任务前提修正（简单声明名已被迭代 25c 覆盖；真裸读是 4 类构造）
- self[k]=1 弱键 P3 记录不修（修复点在 externalWritePos params 短路，与迭代 26 容器语义裁决冲突）
- InitDeity 复扫无噪音（top 写方结构与迭代 26 一致）
- 复审 5 规则实证 + 273/273 独立复跑

## README.md / CHANGELOG.md 同步

- README：测试数 273（两处）——impl 节点已同步，`check-readme-tests.cjs` 门禁通过（record 复核 OK 273）
- CHANGELOG：[Unreleased] 标题「迭代 22-26」→「迭代 22-27」；修复列表补迭代 27 条目（声明名裸读抑制补齐：C# tuple_pattern/foreach/catch/except-as 统一 5 规则，嵌套 pattern depth-1 局限记录）

## 下轮待办（verify 无 blocker，残余记录）

1. TS/JS object-pattern 声明名（`const {n: o} = obj` 的 o）与 for-of 解构名（`for (const [a,b] of pairs)`）仍裸读（迭代 26 既有行为，声明范围外）
2. 方案 B（assignedNames 收 pattern 名连解构 use 读一起抑制）P3
3. Python `self[k]=1` 弱键 "self" + TS `this[k]=v` 零写盲区 P3
4. 读侧不对称（裸字段读不映射 self，需类型解析）
5. 记录待办（延续）：F4 sideEffects 认证、F10 缓存分片、F16 效应表注入、F18 英文文档

## 提交建议（主会话统一提交）

```text
Iter-27: 声明名裸读抑制补齐（pattern/foreach/catch/except 变量统一 5 规则）
Iter-27: 声明名裸读抑制补齐（pattern/foreach/catch/except 变量统一 5 规则）

- 统一声明名抑制: name 字段/variable_declarator children[0]/pattern 名 depth-1/foreach in 位置/catch+as_pattern_target
- foreach in 位置判断防集合误抑制（T1 锚）；.id 判等防 === 恒假
- self[k]=1 弱键 + TS this[k]=v 零写 P3 记录不修（与容器语义裁决一致）
- 测试 +4（T1 C# tuple+foreach/T2 TS catch+解构/T3 Python except-as/T4 JS catch），273/273 全绿
- InitDeity 复扫无崩溃、耦合图结构稳定（无新噪音）
- README/CHANGELOG/CROSS-AUDIT 同步
```
