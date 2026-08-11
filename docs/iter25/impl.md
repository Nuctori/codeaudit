# 迭代 25 impl：C# 状态提取精度（对象初始化器 / 类字段 self / variable_declarator assigned / ++ 写补）

> 实现节点（run-msp7t0ak）：按 docs/iter25/audit.md §2 方案 b→d→c→a 实施。
> 基线 HEAD acbb210（261/261）→ 完成后 265/265（+4：csharp-lang 迭代25 T1-T4）。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/lang/extractor.ts` | **stateWritePos**：① assignment 分支前插 `initializer_expression` parent 跳过（b——对象初始化器 `new C { A = v }` 非外部状态写）；② 补 `postfix_unary_expression`/`prefix_unary_expression` 分支（d——C# i++/this.x++，操作数 = 唯一 named 子节点；**仅认 ++/-- 操作符**，`!x`/`-x` 是读）；**externalWritePos identifier 分支**：C# 类成员方法内裸字段写 → `self.attr`（a——`pack.name==="csharp" && inClassMemberBody(left)`）；**新辅助 `inClassMemberBody`**（祖先爬：method/constructor → true；local_function/lambda/anonymous/class/struct/interface → false）；**assignedNames left 提取**加 `children[0]` fallback（c——C# variable_declarator 无 name 字段） |
| `src/lang/packs/csharp.ts` | assignmentTargets `["assignment_expression","local_declaration_statement","variable_declaration"]` → `["assignment_expression","variable_declarator"]`（c——移除无名字段的死条目，variable_declarator 收名） |
| `test/audit/csharp-lang.test.ts` | +4 用例（迭代25 T1-T4，见下） |
| `README.md` | 测试数 261→265（两处） |

## 测试（T1-T4，修复前均失败——防回归有效）

- **T1**（b）：`new Config { SegmentId = v, Name = "a" }` → stateWrites 不含 SegmentId/Name
- **T2**（d）：`score++; ++score; this.x++; int i=0; i++;` → 含 self.x + self.score，不含 i
- **T3**（c）：`int q = 1; int r = q * 2;` → stateReads 不含 q/r
- **T4**（a）：`score = v;` → 含 self.score 不含 "score"；局部 l 无写；局部函数捕获 c → 不含 self.c

## InitDeity 复扫验证（--no-cache 只读，scanProject API 内存分析）

| 指标 | 迭代24 后 | 迭代25 后 | 变化 |
| --- | --- | --- | --- |
| stateCoupling 条目 | 6860 | 5919 | −941（−14%） |
| ConfigSingleMenu.DoParse 读者 | 2674（裸写 message/messageType） | 903（self.message/self.messageType） | −66%，类字段写收敛 self 语义 |
| bare SegmentId/Name 写方 | Quest12* 1949 读者源头 | **0** | 初始化器跳过消除 |
| Quest12RepairTaskSegmentDefinition | 裸写 SegmentId/Name | self.q12Completed / task.IsCompleted | 语义收敛 |
| PURE / IMPURE / UNKNOWN | 8059/10545/5195 | 8106/10232/5461 | 方向一致（++ 写补→state 增、假裸写消→PURE 微升） |

- 残余 top 读者（真实耦合 + 已知设计边界）：PushStone.Init 1139（self.hasInit + transform.position——真实 Unity 状态）、Demo_Shaders.Update 1136（self.zoomFactor 等——真实动画状态）、SkillEntity.Init 1128（self.* 字段集——真实单例初始化）
- **local_function 捕获写保持裸外部写**（parseResult 写 result 952 读者）：审计 §2a 设计裁决（TS 闭包语义一致），非 bug
- **残余噪音（审计 §4 记录待办，未并本轮）**：lambda 参数名裸读（`x => !x` 的 x 在 stateReads——§4.6 声明名裸读抑制）、裸字段读不映射 self（§4.1 需类型解析）、element_access 左值写（§4.5）

## 关键实现细节

- **`!x` 陷阱**（实现中发现）：`!x`/`-x`/`~x` 同为 `prefix_unary_expression` 但语义是**读**——d 项补写侧时必须只认 `++`/`--` 操作符（`node.children.some(c => c.text === "++" || c.text === "--")`），否则 `RemoveWhere(x => !x)` 的 x 会被误判外部写（实测 1450 读者假耦合，修复后清零）
- **children[0] fallback 触发条件**：仅 C# variable_declarator（无 name/left 字段）；TS/JS variable_declarator 有 name、assignment_expression 有 left → fallback 不触发（审计 §3 已证）
- **inClassMemberBody 不用 ownerClass**：ownerClass 对 local_function_statement 也非 null → 祖先爬精确排除（审计 §2a）

## 测试

- tsc 0 错误；全量 **265/265**（26 文件）；README 门禁 OK 265。
- 回归核对：lang-features stateDeps 断言（user.status/[]/self.v）原样通过（T5 回归网）；effect-table C5 裸类名不受影响；iter24 T1-T3 原样通过。
