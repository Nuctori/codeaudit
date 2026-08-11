APPROVED

# 迭代 25 verify：独立复审通过（只读，无改动）

> 复审范围：docs/iter25/impl.md + `git diff`（src/lang/extractor.ts、src/lang/packs/csharp.ts、test/audit/csharp-lang.test.ts、README.md）。
> 基线 acbb210（261/261）→ 本机独立复跑 265/265（26 文件），T1-T4 修复前均失败已验证。

## 独立验证记录（全部在 cwd=D:/node/codeaudit 实跑）

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 全量测试独立复跑 | `node node_modules/vitest/vitest.mjs run` | **26 files / 265 tests 全绿**（5.83s） |
| 修复前 T1-T4 失败（防回归有效性） | `git stash push -- src/…` 后单跑 csharp-lang.test.ts | **4 failed \| 11 passed**——T1-T4 全部失败，stash pop 干净 |
| 类型检查 | `node node_modules/typescript/bin/tsc --noEmit` | exit 0，0 错误 |
| 回归网（TS 模块级写） | lang-features.test.ts（78 passed） | `counter.ts::inc/dec`（count++/count=count-1）仍 IMPURE；`local()`（let y=0; y=5）PURE；read stateDeps 含 "count" |
| 回归网（Python/TS stateDeps） | 同上 | `a.py::send_email` stateDeps 含 "user.status"；`b.ts::Store.get` 含 "self.v" |

## 逐项核对（impl.md §2 方案 b→d→c→a）

- **a（C# 裸字段写 → self.attr，extractor.ts:378-382）**：✓ 正确。
  - 顺序正确：module 早退（L374）→ python 早退（L375）→ **declared 短路（L376）**→ params 短路（L377）→ C#+inClassMemberBody 才 self 映射。局部声明 `l=5`（T4）、局部 `i++`（T2）均不误伤。
  - inClassMemberBody（L417-427）祖先爬：method/constructor → true；local_function/lambda/anonymous/class/struct/interface → false。T4 实证 `Inner(){c=2}` 不含 self.c；audit.md §2a/§4 裁决一致。
  - 门控 `pack.name==="csharp"` → TS/JS/Python 零影响（回归网实证）。
- **b（对象初始化器跳过，extractor.ts:163）**：✓ 正确。
  - `node.parent?.type === "initializer_expression"` 直接父检查；audit.md 实证该节点结构（object_creation_expression 直接子节点即 assignment_expression）。
  - T1 实证 `new Config { SegmentId = v, Name = "a" }` 无裸写；audit.md 已核实不触发情形（集合初始化器/匿名对象 name_equals/数组/`with` 表达式一并覆盖）。
  - `initializer_expression` 仅 C# 语法存在；TS/JS 对象字面量是 pair、Python dict 是 pair → 无回归路径。
- **c（variable_declarator assignedNames 补 children[0]，extractor.ts:601）**：✓ 正确。
  - T3 实证 `int q=1; int r=q*2;` stateReads 无 q/r（修复前假裸读）。
  - fallback 触发条件与 impl.md 一致：TS/JS variable_declarator 有 name 字段、assignment_expression 有 left 字段 → 不触发；Python assignmentTargets 无 variable_declarator（python.ts:175）→ 不触发。
  - declaredNames（L314）本就有 children[0] fallback（未改）→ C# 局部写抑制（`l=5`/`i++`）成立。
- **d（++/-- 写侧补全，extractor.ts:174-183）**：✓ 正确。
  - `isIncDec` 守卫（`children.some(c=>c.text==="++"||"---")`）：`!x`/`-x`/`~x` 同为 prefix_unary_expression 但判读 → 不误写（impl.md "!x 陷阱"，audit.md 实证 RemoveWhere 假耦合清零）。
  - T2 实证 `score++/++score` → self.score、`this.x++` → self.x、`i++` 局部不写。
  - TS update_expression 路径（L168）未动 → 无回归。
- **csharp.ts assignmentTargets 改动（L316-319）**：✓ `["assignment_expression","variable_declarator"]` —— 移除无名字段死条目、declarator 收名；仅影响 assignedNames（T3 实证）。
- **README 261→265（两处）**：✓ 与实际测试数一致。

## 残余风险（均为 audit.md 已记录的设计边界/待办，非本轮缺陷）

1. **读侧不对称（audit.md §4.1）**：裸字段**读**不映射 self（需类型解析）——`this.score` 读与 self.score 写耦合 ✓，裸 `score` 读成孤儿（不与写耦合）。精度/召回权衡，purity 判定不受影响。
2. **local_function 捕获写保持裸外部写**（T4 断言 + audit §2a 裁决）：与 TS 闭包语义一致，非 bug。
3. `(i)++` 括号操作数（parenthesized_expression 不被 externalWritePos 识别）→ 极罕见假阴性，可忽略。
4. 属性 setter 写后备字段（`_p = value`）在类 chunk 被 declared 短路抑制——**迭代 24 前既有行为**，本轮未改，非回归。

## 结论

实现与 impl.md 完全一致，防回归测试有效（修复前 4 败），全量 265 绿，tsc 0 错误，无 TS/JS/Python 回归（回归网 + 门控实证）。**APPROVED**。
