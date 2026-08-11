# 迭代 27 审计：声明名裸读抑制补齐（variable_declarator/foreach/catch 变量）+ Python self[k]=1 弱键评估（scout 产出）

> 只读审计，HEAD e19d756（Iter-26 闭环后），基线 269/269 全绿（已复跑实证）。
> 全部节点形态经 web-tree-sitter 0.22.6 实际 parse + `dist/cli.js` 实际 scan 实证
> （probe 脚本 `.pi-subagents/probe-iter27.cjs`、`probe2-6.cjs`，fixture `/tmp/iter27-*`）。
> 目标文件：`docs/iter27/audit.md`（本内容即其成稿，由主会话落盘）。

---

## 0. 结论先行（任务前提一处修正）

**① 任务前提「C# variable_declarator 声明名仍裸读」只对一半**：迭代 25c 已把 `variable_declarator` 并入
C# assignmentTargets（assignedNames children[0] fallback）→ **简单声明名 `var q = 1` / `int r = q*2` /
类字段 `count` 已由 stateReadPos L208 的 `assigned` 检查抑制**（实证：`S.cs::S.M` stateReads 无 q/r/arr/i，
迭代25 T3 测试即此断言）。迭代 26 只做 name 字段抑制（L207），真正**仍裸读**的声明名是三类：

| 构造 | 节点形态（实证） | 当前行为 |
| --- | --- | --- |
| C# `var (a, b) = ...` | variable_declarator children[0]=`tuple_pattern`（非 identifier）→ assignedNames 收不到 | **a/b 裸读** |
| C# `foreach (var item in arr)` | `for_each_statement` 的 `item` 是**直接 identifier 子节点**（children[3]，`in` token 在 children[4]），不在 assignmentTargets | **item 裸读** |
| TS/JS `catch (e)` | `catch_clause` children=[catch,(,identifier,),block]，**无 name 字段**、不在 assignmentTargets | **e 裸读** |
| Python `except X as e` | `except_clause`→`as_pattern`(alias 字段=as_pattern_target)→`as_pattern_target` 的唯一 identifier 子节点 | **e 裸读** |
| TS `const [a, b] = arr` | variable_declarator name 字段=array_pattern（非 identifier）→ iter26 name 检查不命中、assigned 不收 | **a/b 声明名+use 裸读** |
| C# `catch (Exception e)` | catch_declaration **有 name 字段** → 迭代26 已抑制 | ✓ 已抑制（实证 READS 无 e） |
| TS/JS/Python `for (const item of xs)` / `for item in xs` | for_in/for_of/for_statement 有 **left 字段** → assignedNames 收集 → L208 抑制 | ✓ 已抑制（实证无 item） |

**② 任务前提「需改 stateReadPos 的 self 特判」位置有误**：self[k]=1 写键产自
**externalWritePos subscript 分支 L437 的 params 短路**（self ∈ params → `return "self"`），不是
stateReadPos（其 L254 self 特判是 member 读映射，与此无关）。修复点应为 L437 附近（详见 §2b）。

---

## 1. Files Retrieved

1. `src/lang/extractor.ts` (L196-262) — **stateReadPos**：identifier 分支 L197-210（① 改动点：L202-204 成员跳过、L207 迭代26 name 字段抑制、L208 assigned/params 检查）
2. `src/lang/extractor.ts` (L369-454) — **externalWritePos**：subscript/element_access 分支 L432-452（② 修复点：L437 `params.includes → return obj.text` 即 self[k]=v → "self" 弱键源头）
3. `src/lang/extractor.ts` (L621-655) — assignedNames（L643 left/name/children[0] 提取、L632 assignmentTargets 门控）——① 的「已在 assigned 覆盖」事实源
4. `src/lang/extractor.ts` (L305-326) — declaredNames（collectPattern 递归收 pattern 名——① 可选方案 B 的镜像先例）
5. `src/core/state.ts` (L20-65) — stateDepsOf 匹配规则：前缀 L43-49（"self" 写 ↔ 一切 self.x 读 = ② 弱键机制）、根限定 ⊤ L51-58、全局 ⊤ L60；L4-5 公理3（stateDeps 纯元数据不进判定）
6. `src/lang/packs/csharp.ts` (L316-319) — assignmentTargets=["assignment_expression","variable_declarator"]（迭代25c）
7. `test/audit/csharp-lang.test.ts` (L290-383) — 迭代25 T3 / 迭代26 T1-T3（① 回归网：q/r、arr/self.items、Read/Service）
8. `test/audit/lang-features.test.ts` (L915-928) — 唯一 stateDeps 断言（user.status / self.v，① ② 均不触碰）
9. `docs/iter25/audit.md` §4.6/L157 — 声明名裸读抑制待办溯源（跨全语言 ~3 行方案）；§0.2 `.fieldName` undefined 教训
10. `docs/iter26/audit.md|impl.md|record.md|verify.md` — 迭代26 name 字段抑制实现与残余记录（L51 待办 1/3）
11. `docs/iter26/audit.md` L40 — 容器位置语义裁决（arr[i]=v → "arr" 非 "arr.⊤"）——② 修复一致性的裁决依据

## 2. Key Code

**① 现状（stateReadPos identifier 分支，extractor.ts:197-210）**：
```ts
if (node.type === "identifier") {
  const p = node.parent;
  if (p && (p.type === "attribute" || ... || p.type === "member_binding_expression")) return []; // L202-204 成员跳过
  if (p && p.childForFieldName("name")?.id === node.id) return []; // L207 迭代26：name 字段抑制
  if (!chunk.params.includes(node.text) && !chunk.assigned.includes(node.text)) return [node.text]; // L208
  return [];
}
```

**② 现状（externalWritePos subscript 分支，extractor.ts:432-446）**：
```ts
if (left.type === "subscript" || left.type === "subscript_expression" || left.type === "element_access_expression") {
  const obj = ...;
  if (obj.type === "identifier" || obj.type === "property_identifier") {
    if (chunk.kind === "module") return null;
    if (chunk.params.includes(obj.text)) return obj.text; // ← Python self[k]=v：self ∈ params → "self"
    ...
```

**实证（当前 dist 实际 scan）**：
- C# `S.cs::S.M`：`var q/int r/int[] arr/for i` 全抑制；**READS=["item","Exception","a","b"]**（item=foreach、a/b=元组解构、Exception=类型名噪音）
- Python `Registry.put` → **WRITES=["self"]**；`Registry.get` → READS=["self.store"] → **DEPS=["self","self.store"]**（"self" 来自 put 的弱键写，前缀规则命中）
- TS `catch (e)` → READS=["e"]；`const [a,b]=arr; const {x,y}=obj; return a+b+x+y` → READS=["a","b","x","y"]
- TS `this[k]=v` → **零写**（obj.type="this" 非 identifier → subscript 分支漏过，独立假纯盲区）

## 3. Architecture

extract() 单次 AST 遍历 → stateWritePos/stateReadPos 产出 chunk.stateWrites/stateReads → link.ts/state.ts
传播成 verdict.stateDeps（纯元数据，公理3 不进 purity）。裸读名只有在**全项目存在同名写者**时才进 stateDeps
（stateDepsOf L43-49 前缀逐段查）；因此① 的抑制 = 收窄裸读集合 → 假耦合面下降，对现有断言的影响只可能来自
「断言了被抑制名」——已 grep 全测试确认零冲突。② 的弱键 = 写键 "self" 是全部 "self.*" 读键的前缀 → 跨文件
全类耦合，但只影响 stateDeps/stateCoupling 元数据（stateWrites 非空 → chunk 照常 IMPURE，判定不变）。

## 4. 修复方案

### a) ① 的精确改动（stateReadPos identifier 分支，L207 处）

把迭代26 单行 name 字段检查扩展为统一声明名抑制（~12 行，全部 `.id` 判等——iter24 教训：web-tree-sitter
每次属性访问返回新包装对象，`===` 恒假，`children.indexOf(node)` 同样不可靠，必须 `.id`）：

```ts
// 迭代27：统一声明名抑制（取代 L207 单行）。
// ① name 字段（迭代26：def foo / function foo / C# method/catch_declaration name）
if (p && p.childForFieldName("name")?.id === node.id) return [];
// ② C# variable_declarator 无 name 字段——children[0] 即声明名位置（裸 identifier 或 pattern）。
//    简单名（var q=1）已被 assigned 覆盖（迭代25c），本规则对其冗余无害；真收益 = pattern 名。
if (p && p.type === "variable_declarator" && p.children[0]?.id === node.id) return [];
// ③ pattern 名（C# tuple_pattern / TS array_pattern 的直接 identifier 子节点，pattern 在声明名位置）
const pp = p?.parent;
if (pp && pp.type === "variable_declarator" && pp.children[0]?.id === p.id &&
    (p.type === "tuple_pattern" || p.type === "array_pattern")) return [];
// ④ C# foreach 变量：for_each_statement 的裸 identifier 直接子节点，且位于 `in` token 之前
//    （其后同名 identifier 是集合 arr——真读，不得抑制）。
if (p && p.type === "for_each_statement") {
  const kids = p.children;
  const inIdx = kids.findIndex((c) => c.type === "in");
  if (inIdx >= 0 && kids.some((c, i) => c.id === node.id && i < inIdx)) return [];
}
// ⑤ 异常变量：TS/JS catch_clause 唯一 identifier 直接子节点；Python except as_pattern_target 的唯一 identifier
if (p && (p.type === "catch_clause" || p.type === "as_pattern_target")) return [];
```

**为何 ⑤ 的 catch_clause 整类跳过安全**：TS/JS catch_clause 直接子节点仅 [catch, (, identifier, ), block]——
唯一 identifier 直接子节点即变量名（实证）；Python as_pattern_target 同理（children=[identifier]）。C# 已由
① name 字段覆盖（catch_declaration 有 name 字段）；Python as_pattern 的 alias 字段指向 as_pattern_target
（非直接 identifier），故用父类型判断而非 alias 字段。

**为何 ④ 必须 `in` 位置判断**：for_each_statement 含两个 identifier 直接子节点（item 与集合 arr），无差别跳过
会把 `foreach (var item in arr)` 的 arr 集合读误抑制——arr 是真外部读（若 arr 非局部）。

**为何 ③ 限 depth-1**：嵌套 pattern（`const [[x]] = ...`）的 x parent 是内层 array_pattern 非 children[0]——
不命中，记录为局限（罕见，接受）。

**可选方案 B（更彻底，针对 TS 解构 USE 读）**：`const [a,b] = arr; return a+b` 的 **use** 读 a/b 仍漏
（declaredNames 已递归收集 pattern 名、assignedNames 未收集——读侧 L208 只查 assigned）。若想连 use 一起
抑制：assignedNames 的 left 为 pattern 时递归收集 identifier/shorthand_property_identifier_pattern
（镜像 declaredNames collectPattern L308-314，~4 行）。代价：assigned 语义触达写侧判定（readTarget 局部对象
检查 L392、模块遮蔽守卫 L98）——方向安全（更多局部 → 更少假外部），但需全量回归。**建议本轮不做**（① 任务
字面范围是声明名；方案 B 记待办 P3）。

**对现有断言的影响（任务 a 问询项）**：**零影响**——全测试 grep 实证：stateReads 断言仅含 instance/Configure/
instance.Value/q/r/Read/Service（csharp-lang L207-229/L299-303/L376-383），无任何 catch/foreach/pattern 名
断言；lang-features stateDeps（user.status/[]/self.v）不触碰 identifier 分支抑制路径。269/269 应原样通过
（impl 轮复跑验证）。

### b) ② 的评估（Python self[k]=1 弱键）

**结论：记录不修（P3）**。理由：

1. **影响面纯元数据**：state.ts L4-5 公理3——stateDeps 不进 purity/effects/chain；stateWrites=["self"] 非空
   → chunk 照常 IMPURE。弱键只污染 stateDeps/stateCoupling 可见性，与 state.ts L13-14 已文档化的
   「同名异对象」过近似**同级**（任务自述「频率低，与同名异对象同级」属实）。
2. **修复位置**：externalWritePos subscript 分支 L437（params 短路 `return obj.text`），非 stateReadPos。
   若修：`obj.text ∈ {self, cls, this}` → `return "self.⊤"`（2 行，镜像迭代26 ②b 的 d[k].x→d.⊤ 降级族）。
   效果：写键 "self.⊤" 只匹配同根 ⊤ 读族（self[k].x 读者），不再前缀命中全项目 self.x——假耦合清零；
   代价是写方近乎不可见（self[k] 裸读本就不提取）→ 只漏报不假报，方向安全。
3. **不一致成本**：与迭代26 容器位置语义裁决（audit L40：arr[i]=v → "arr" 非 "arr.⊤"）冲突——除非把全部
   容器写都改 "root.⊤"（破坏迭代26 T1/T2 断言：arr/self.items，不值得）。只改 self 家族会造成 d[k]=v→"d"
   与 self[k]=v→"self.⊤" 的不对称——可辩护（self 命名空间是全项目最高频键族，碰撞烈度远超普通局部名），
   但收益/风险比不抵。
4. **实证零测试影响**：无任何断言裸 "self" 写或 "self" dep（grep 实证）。但这也说明修了也没有测试背书。

**顺带发现（同族独立盲区，一并记录 P3）**：TS `this[k]=v` **零写不可见**——obj.type="this"（非 identifier/
property_identifier）→ subscript 分支 L435 类型检查漏过 → 假纯盲区（与 ② 方向相反：漏报）。C# `this[k]=v`
→ "self.this" 怪键（L440-441 inClassMemberBody 分支 obj.text="this" → `self.this`；低频，同类记录）。

### c) 每项跨语言回归面 + 测试点

**① 回归面（改动全在 extractor.ts stateReadPos，零 pack 改动、零 state.ts 改动）**：

| 规则 | C# | TS | JS | Python |
| --- | --- | --- | --- | --- |
| ② variable_declarator children[0] | 触发（对简单名冗余——已 assigned 覆盖，行为不变） | 触发（对 name 字段标识符冗余——迭代26 已覆盖） | 同 TS | 无 declarator 概念，不触发 |
| ③ pattern 名 | 触发（tuple_pattern——**真修复**） | 触发（array_pattern 声明名——**真修复**；use 读仍漏=方案 B） | 同 TS | 无 array_pattern/tuple_pattern，不触发 |
| ④ for_each `in` 前 identifier | **真修复** | 不触发（for_in_statement 非 for_each_statement；其 left 字段已入 assigned） | 同 TS | 不触发（for_statement left 字段已入 assigned） |
| ⑤ catch_clause / as_pattern_target | 不触发（catch_declaration 有 name 字段，已覆盖） | **真修复** | **真修复** | **真修复**（as_pattern_target） |

**现有断言面**：269 全绿基线已复跑；① 抑制名与全部现有 stateReads/stateDeps 断言零交集（grep 实证）。

**测试点（新增 ~4 用例，落 test/audit/csharp-lang.test.ts + lang-features.test.ts，project/by 模式）**：
- T1（C# pattern + foreach）：`var (a, b) = Tuple.Create(1, 2); foreach (var item in arr) { r += item; } return r;`
  → stateReads **不含** a/b/item，**含** arr（集合读保留——防 ④ 误抑制的回归锚）。修复前：a/b/item 均在 READS。
- T2（TS catch + 解构声明名）：`try {} catch (e) {}` → 不含 e；`const [a, b] = arr;` 声明名不裸读
  （断言 stateReads 的 a/b 数量 ≤ 修复前——若方案 B 不做，use 读 a+b 仍存在，断言用「仅一次出现」
  或改为断言不含与 use 名不同的解构名——实现时按方案 A 定稿后校准）。
- T3（Python except 变量）：`except Exception as e:` → 不含 e；**含 Exception**（类型名噪音族不动——防误伤锚）。
- T4（JS catch）：`catch (e)` → 不含 e。
- T5（回归）：迭代25 T3（q/r）、迭代26 T3（Read/Service）、lang-features L915-928 stateDeps 原样通过。

**② 若修（本轮不做，仅预案）**：改动点 externalWritePos L437 前插 2 行；Python 真修复、C# this[k]=v 从
"self.this"→"self.⊤"（行为变化，需 grep 断言确认——已证无）、TS 不触发（this 非 identifier 类型，独立盲区
不由此修）；测试点 = Registry.put 写 "self.⊤" 且 get() 的 stateDeps 不再含 "self"（1 用例）。

## 5. 优先级判断

| 项 | 优先级 | 理由 |
| --- | --- | --- |
| ① a（variable_declarator/pattern/foreach/catch 统一声明名抑制，~12 行单文件） | **P2 本轮做** | 跨语言统一、零断言破坏、实证真收益（item/a/b/e 四类裸读清零）；注意任务字面范围（仅 variable_declarator）实际收益只剩 pattern 名——建议按 §4a 全族做（同机制 +6 行） |
| ① 方案 B（assignedNames 收 pattern 名，连带解构 use 读） | **P3 待办** | 独立收益（use 读）、触及 assigned 写侧语义、需全量回归 |
| ② self[k]=1 弱键 | **P3 记录不修** | 纯元数据、低频、与迭代26 容器语义裁决不一致；修复点（externalWritePos L437）已修正 |
| 顺带：TS this[k]=v 零写盲区 | **P3 记录** | 假纯方向漏报，obj.type="this" 类型检查漏过 |

**实施顺序**：① → 全量 `npm test`（预期 269 原样 + 新 T1-T5 → 273 左右）→ README 测试数同步。
