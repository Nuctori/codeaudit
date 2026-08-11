# 迭代 27 impl：声明名裸读抑制补齐（pattern/foreach/catch/except 变量）

> 实现节点（run-msp9zosx）：按 docs/iter27/audit.md §4a 方案（统一声明名抑制，P2 本轮做）。
> 基线 HEAD e19d756（269/269）→ 完成后 273/273（+4：csharp-lang 迭代27 T1-T4）。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/lang/extractor.ts` | **stateReadPos identifier 分支**（L205-222）：迭代26 单行 name 字段检查扩展为统一声明名抑制 5 规则——① name 字段（保留原行为）；② `variable_declarator` children[0]（C# 无 name 字段，简单名已 assigned 覆盖冗余无害，真收益 = pattern 名）；③ pattern 名（C# `tuple_pattern`/TS `array_pattern` 的 identifier 子节点，限 depth-1——嵌套 pattern 不命中记局限）；④ C# `for_each_statement` `in` token 之前的裸 identifier（`in` 之后的集合 arr 是真读，不得误抑制——位置判断防误伤）；⑤ TS/JS `catch_clause` 与 Python `as_pattern_target` 整类跳过（唯一 identifier 直接子节点即变量名，实证）。全部 `.id` 判等（iter24 教训：`===` 恒假） |
| `test/audit/csharp-lang.test.ts` | +4 用例：T1（C# tuple_pattern 解构名 + foreach 变量不裸读；字段集合 arr 读保留——④ 误抑制锚）、T2（TS catch 变量 e 不裸读 + 解构声明名 a/b 计数 ≤2——use 读仍存，方案B 待办）、T3（Python except as 变量 e 不裸读；Exception 类型名噪音族不动）、T4（JS catch 变量 e 不裸读） |
| `README.md` | 测试数 269→273（两处） |

**未改**：state.ts（stateDepsOf/stateCouplingOf）、analyze.ts、link.ts、types.ts、pack.ts、stateWritePos/externalWritePos（② self[k]=1 弱键按审计 P3 记录不修——纯元数据 + 与迭代26 容器语义裁决冲突；TS this[k]=v 零写盲区 P3 记录）。

## 测试

- tsc 0 错误；全量 **273/273**（26 文件）；README 门禁 OK 273。
- T1-T4 修复前均失败（T1：a/b/item 裸读在 READS；T2：e 裸读 + a/b 4 次；T3：e 裸读；T4：e 裸读）——防回归有效。
- 回归核对：迭代25 T3（q/r）、迭代26 T1-T4（arr/self.items/Read/Service/d[k].x）、lang-features stateDeps（user.status/self.v）原样通过——零断言破坏（审计 grep 实证兑现）。

## InitDeity 复扫验证（--no-cache 只读）

`node dist/cli.js scan "J:/旧宇宙/代码仓库/InitDeity/Assets" --no-cache --state --top 5`：

- 无崩溃、秒级；耦合图 top 写方结构与迭代 26 一致（BuglyAgent 1888 读者 System.⊤、UICommon.Awake 1255 ICommonUI.⊤、BreakThunder.Update 1231 等）——声明名抑制未引入新噪音、未扰动既有耦合信号。
- foreach/catch/pattern 变量的抑制面在 InitDeity 上无同名写者碰撞（裸读本就不进 stateDeps——stateDepsOf 前缀匹配要求存在同名写者）——与审计 §3 架构说明一致。

## 残余风险（audit 记录，非本轮缺陷）

- 嵌套 pattern（`const [[x]] = ...`）depth-1 限制不命中（罕见，接受）。
- 方案 B（assignedNames 收 pattern 名，连解构 use 读一起抑制）P3 待办——本轮只做声明名，use 读保留。
- Python `self[k]=1` 弱键写 "self"（P3 记录不修）、TS `this[k]=v` 零写盲区（P3 记录）——均为方向安全（元数据层/漏报侧）。
