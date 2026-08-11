APPROVED

# 迭代 27 复审（只读）：声明名裸读抑制 — verify

> 复审基线：HEAD e19d756 + 工作区 diff（src/lang/extractor.ts / test/audit/csharp-lang.test.ts / README.md）。
> 独立验证：web-tree-sitter 实际 parse 树 dump（4 语言 × 15 构造）+ 全量测试复跑 + InitDeity 复扫。

## 1. 声明名抑制正确性（逐规则实证）

全部经 `web-tree-sitter` 实际 parse 验证节点形态（脚本 /tmp/iter27-verify/*.js，scratch 不入库）：

- **① name 字段**（迭代26 保留）：行为未变。C# `catch_declaration` 实证 name-field=`e`、type-field=`Exception` → catch 变量 e 抑制、异常类型名不抑制（噪音族不动，与 T3 意图一致）。
- **② variable_declarator children[0]**：C#/TS/JS 的 declarator 结构均为 `name '=' value`，children[0] 恒为名字位置（实证：`var q=1`→c0=q、`int x=(a,b)`→c0=x、`const x=[a,b]`→c0=x、`const [a,b]=arr`→c0=array_pattern、`const {m,n:o}=obj`→c0=object_pattern）。**值读不可能出现在 children[0]** → 无误伤通道。C# `using var f` / `using(StreamReader r)` 同样 c0=名字 ✓。
- **③ pattern 名（限名字位）**：`pp.children[0].id === p2.id` 守卫实证有效——**值位 pattern 不误伤**：C# `var x = (a, b)` 的 tuple 是 `tuple_expression`（非 tuple_pattern）；TS `const x = [a, b]` 是 `array`（非 array_pattern）→ a/b 保持真读 ✓。名字位 `var (p,q)=t` / `const [p,q]=arr` → 抑制 ✓。
- **④ C# foreach**：`for_each_statement` children 实证含 `in` token（type="in"）；`in` 之前 identifier（item/类型名）抑制，`in` 之后（集合 arr）保留——T1 断言 arr ∈ stateReads 通过，误抑制锚成立 ✓。注意：`foreach (Item y in items)` 的**类型名 Item 也随 ④ 抑制**（新副作用，语义正确——类型引用非变量读，方向安全；测试未覆盖，仅记录）。
- **⑤ catch_clause / as_pattern_target 整类跳过**：
  - TS/JS `catch (e)`：catch_clause 唯一 identifier 直接子节点即绑定名（实证 kids=[catch,(,identifier,),block]；`catch (err: Error)` 的 Error 在 type_annotation 嵌套内不受影响）→ 无第二个直接 identifier 可误伤。
  - C# catch **不**命中 ⑤（identifier 在 catch_declaration 下，非 catch_clause 直接子节点）→ C# 异常类型名不会被 ⑤ 误抑制，由 ① 处理 ✓。
  - Python：as_pattern_target 覆盖 `except X as e`、`except* X as eg`（except_group_clause，实证）、以及 **`with ... as fh`**（同 alias）——三者为绑定目标、永非读，整类跳过安全 ✓。类型名（Exception/ValueError）在 as_pattern/as_pattern 外层，保留 ✓。
- **`.id` 判等**：五条规则全部 `.id` 比较（iter24 教训），未引入 `===` 恒假死代码 ✓。

**误伤（值读）面**：未发现任何把值读当成声明名的通道——②/③ 有 children[0] 位守卫，④ 有 `in` 位置守卫，⑤ 有节点形态保证。

## 2. 全量测试独立复跑

`node node_modules/vitest/vitest.mjs run` → **26 文件 273/273 通过**（6.34s）。与 impl.md、README（两处）273 一致。迭代25 T3（q/r）、迭代26 T1-T4（arr/self.items/Read/Service/d[k].x）、lang-features（user.status/self.v）等既有断言零破坏——回归锚原样通过。

`node node_modules/typescript/bin/tsc` → 0 错误。

T1-T4 修复前必败的结构性佐证：C# for_each 非 assignmentTarget（item ∉ assigned）、tuple_pattern 非 identifier（assignedNames 不收 a/b）、TS/JS catch_clause 无 name 字段、Python as_pattern_target 无 name 字段——修复前均落 L208 之后的 `return [node.text]` 裸读路径，断言方向与 impl.md「修复前均失败」自洽。

## 3. InitDeity 复扫（--no-cache 只读）

复跑 `scan ... --no-cache --state --top 5`：无崩溃、秒级；top 写方结构与 impl.md/迭代26 一致（BuglyAgent 1888 读者 System.⊤、UICommon.Awake 1255 ICommonUI.⊤、BreakThunder.Update 1231）。声明名抑制未引入新耦合噪音。

## 4. 残余风险/观察（非阻塞，无需改动）

- TS/JS **object pattern 声明名**（`const {n: o} = obj` 的 o、`catch ({e})` 的 e）仍裸读；shorthand（`{m}`）是 `shorthand_property_identifier_pattern` 节点类型、本就不走 identifier 分支。与迭代26 行为一致，非回归；impl.md 残余风险未列 object pattern（仅 depth-1 嵌套 + 方案B）——记录级小缺口。
- TS/JS **for-of 解构名**（`for (const [a,b] of pairs)`）不抑制（for_in_statement 无 variable_declarator；assignedNames 仅收 identifier left）——同样迭代26 既有，声明范围外。
- ④ 对 C# foreach 类型名的抑制为新增未测副作用（语义正确，见 §1④）。
- ⑤ 对 Python with-as 目标抑制为正确行为但无测试锚（T3 只覆盖 except）。

结论：五条规则结构均实证、值读零误伤、全量 273/273、无回归、复扫无噪音。无 blocker。
