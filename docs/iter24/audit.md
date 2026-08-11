# 迭代 24 审计：stateReadPos C# 覆盖 + 读者虚高修复（scout 产出）

> 只读审计，HEAD 17adf9f。全部结论均经实证（web-tree-sitter 实际 parse + dist/cli.js 实际 scan + InitDeity 40MB 报告反查）。
> 语料：InitDeity 在 `J:/旧宇宙/代码仓库/InitDeity/Assets`（3004 文件 / 23800 chunks，本机可扫）。

---

## 0. 结论先行（与任务前提的一处重要修正）

任务前提「C# 的 member_access_expression 在 L200-201 被当成外部状态读（'instance.Method' 计入 stateReads）」**不成立**：
L181（`node.type !== "attribute" && node.type !== "member_expression"`）把 `member_access_expression` 直接过滤为 `[]`，根本到不了 L200。

**真实的读者虚高机制**（已实测确认）：
1. 遍历对每个节点调 stateReadPos，且会递归访问成员节点的**全部子节点**（extractor.ts:92 `for (const child of node.children) visit(child)`）。
2. `instance.Method()` / `Foo.instance.x` 中，成员访问结构的**对象标识符和成员名标识符**作为裸 `identifier` 子节点触发 L176-180 裸标识符读分支。
   - C# 成员名节点是 `identifier` 类型（TS/JS 是 `property_identifier` 不触发；Python 成员名也是 `identifier` 触发）→ C# 的 `instance` 对象名 + `Configure`/`Run` 等成员名**全部**裸读。
3. 第二个致命点：**L188-189 与 L193-194 用 `===` 做节点同一性比较，在 web-tree-sitter 下恒为 false**（每次属性访问返回新节点对象；`.equals()`/`.id` 才是正确判等）。实测 `fnField === me: false` 而 `fnField.equals(me): true`、`id` 相同。→ **「调用目标排除」和「赋值左值跳过」自迭代 8 起就是死代码**，对所有语言生效：
   - `user.save()`（TS/Python）→ `"user.save"` 计入 stateReads（排除从未生效）；
   - `user.status = x` → **同时**计写 `"user.status"` 和读 `"user.status"`（左值跳过失效）。

InitDeity 实证（docs/iter22/initdeity-report.json 反查，23800 verdicts）：
- 写裸 `"instance"` 的 chunk：**22 个**；读裸 `"instance"` 的 chunk：**2633 个**（与「2600+」吻合）。
- 读 `"instance.*"` 字段位置的 chunk：**0 个**（C# 成员节点被 L181 过滤，位置读从未产生——进一步证明虚高走的是裸标识符分支而非 L200-201）。
- 2633 读者的 27 份等距抽样人工分类：约 26 份是 `XxxManager.instance.xxx`（instance 作**成员名**）或 `instance.Method()`（**调用目标**）噪音；仅 1 份真实（RuntimeCommandBridge.cs:161 `instance != null` + `instance.port` 字段读）。

---

## 1. 逐行核实（任务项 1）

### extractor.ts stateReadPos L175-207
| 行 | 现状 | 问题 |
|---|---|---|
| L176-180 | `identifier` 裸读分支 | C#/Python 成员名是 `identifier` 类型 → `Foo.instance.x` 的 `instance` 与成员名全部裸读；C# 无 property_identifier 概念 |
| L181 | 只认 `attribute`(Python)/`member_expression`(TS/JS) | C# `member_access_expression`、`conditional_access_expression`(`?.`) 被整体过滤 → C# 字段读位置（`instance.Field`）**永不产生** |
| L183-190 | 赋值左值跳过 `left === node` | `===` 恒假 → 左值属性读重复计（实测 `user.status = x` 同时写+读） |
| L191-195 | 调用目标排除，parent 只列 `call`/`call_expression`/`new_expression` | (a) `===` 恒假 → 排除死代码；(b) C# 调用节点是 `invocation_expression`/`object_creation_expression`（csharp.ts:300 `callNodes`），不在列表 |
| L196-203 | obj/attr 提取用 `object`/`attribute`/`property` 字段 | C# `member_access_expression` 字段是 `expression`/`name`；`?.` 是 `conditional_access_expression`（无字段，children=[obj, ?, member_binding_expression]）→ 均取不到，靠 children 兜底取错 |

### 写侧同源缺口（不在任务范围，建议一并修）
`externalWritePos`（L337-346）只处理 `attribute`/`member_expression` → C# `this.x = v` 的 left=`member_access_expression` 落 `return null` → **C# 字段写完全不可见**（实测 `this.name = "x"` → writes=[]）。`instance = new A()`（裸标识符写）→ `"instance"` 写正常（这就是那 22 个写方的来源）。

### csharp.ts:296 / 300
- L296 `classNodes`：`class_declaration/struct_declaration/interface_declaration` —— 与状态无关。
- **L300 `callNodes = ["invocation_expression", "object_creation_expression"]`** —— 确认：C# 调用节点类型与 L191 列表不匹配，是任务前提中「调用类型列表缺 C#」的实证。
- 实测 tree-sitter-c_sharp 结构（.probe 解析）：
  - `instance.Method(1)` → `invocation_expression` → `member_access_expression`（children: identifier `instance`, identifier `Method`）
  - `var x = a.b` → `member_access_expression`（字段 `expression`/`name` 存在）
  - `this.instance = new A()` → `assignment_expression` left=`member_access_expression`（children: this_expression, identifier）
  - `instance?.Method()` → `invocation_expression` → `conditional_access_expression`（children: identifier `instance`, `?`, `member_binding_expression`→identifier `Method`）——**`?.` 链没有 member_access_expression 节点**，且该 conditional 就是 invocation 的 function 字段

### state.ts:19-64 stateDepsOf 前缀匹配
确认任务所述机制：读 `"instance.Method"`（或裸 `"instance"`）经精确/前缀匹配（L42-48）命中写 `"instance"` → 全库读者。**匹配本身无误**（正是设计语义），问题全在提取侧多报了读位置。

---

## 2. 跨语言调用目标排除现状（任务项 2 回归风险面）

实测 dist/cli.js scan（当前 HEAD 行为）：

| 语言 | `user.save()`（user 为参数） | `user.status = x` | `x = user.status` |
|---|---|---|---|
| Python | reads=`["user.save","save"]`（成员名 `save` 裸读 + 排除失效） | writes=`["user.status"]` + reads=`["user.status","user","status"]` | reads=`["user.status","status"]` |
| TS/JS | reads=`["user.save"]`（排除失效） | 同左（member_expression） | reads=`["user.status"]` |
| C# | reads=`["instance","Configure"]`（成员节点被 L181 过滤 → 只余裸标识符） | writes=[]（写侧缺口）+ reads=`["name"]` | reads=`["instance","Value"]` |

**结论：调用目标排除对所有语言都未生效**（`===` 死代码）；C# 另有两层问题（成员节点不识别 + 成员名是 identifier 类型）。修复后 JS/TS/Python 的 `user.save()` 将从 reads 消失、`x = user.status` 只留 `"user.status"`——语义符合设计注释（「user.save() 不是字段值读取」），且不影响任何现有断言（见 §5）。

---

## 3. 修复方案（可直接落 docs/iter24/audit.md）

### 改动点（单文件 src/lang/extractor.ts，仅 stateReadPos + 可选 externalWritePos）

**① 节点同一性：`===` → `.id`**（根因，先修这个，否则 ③④ 的列表补全毫无意义）
```ts
// L188-189 / L193-194 两处：left/fn 与 node 的判等改为
if (left !== null && left.id === node.id) return [];
if (fn !== null && fn.id === node.id) return [];
```
web-tree-sitter 0.22.6 的 `SyntaxNode.id: number` 与 `.equals(other)` 均在类型声明中（node_modules/web-tree-sitter/tree-sitter-web.d.ts:58,91），实测同一树节点 `id` 相同。推荐 `.id`（O(1)，无对象分配）。

**② L176-180 裸标识符分支：成员访问结构的子标识符整体跳过**
```ts
const memberChildParent = (t: string): boolean =>
  t === "attribute" || t === "member_expression" || t === "member_access_expression" ||
  t === "conditional_access_expression" || t === "member_binding_expression";
if (node.type === "identifier") {
  const p = node.parent;
  if (p && memberChildParent(p.type)) return []; // 对象/成员名由成员节点统一承担
  if (!chunk.params.includes(node.text) && !chunk.assigned.includes(node.text)) return [node.text];
  return [];
}
```
语义：`instance.Method()` 的对象名、`Foo.instance.x` 的成员名（`instance`）、`?.` 的 `Method`（parent=`member_binding_expression`）全部不再裸读。裸读仅保留真正独立的标识符读（`instance == null`、`console.log(count)`、参数传递 `f(instance)`）——这些是合法变量读。**无耦合丢失**：stateDepsOf 前缀规则（state.ts:42-48）仍让写 `"instance"` 匹配读 `"instance.Field"`，写 `"user"` 匹配读 `"user.name"`。

**③ L181 节点过滤：加 C# 成员节点**
```ts
if (node.type !== "attribute" && node.type !== "member_expression" &&
    node.type !== "member_access_expression" && node.type !== "conditional_access_expression") return [];
```

**④ L191 调用 parent 列表补 C# 类型**
```ts
const callLike = (t: string): boolean =>
  t === "call" || t === "call_expression" || t === "new_expression" ||
  t === "invocation_expression" || t === "object_creation_expression";
```
`instance.Method()` → member_access_expression 的 parent 是 invocation_expression，fn（.id）=== node → 排除 ✓。`instance?.Method()` → conditional_access_expression 的 parent 是 invocation_expression 且是 function 字段 → 排除 ✓。

**⑤ 边缘：`a.b?.c()` 内层成员**（member_access_expression(a.b) 的 parent 是 conditional_access_expression，非调用）
```ts
if (parent && parent.type === "conditional_access_expression") {
  const gp = parent.parent;
  if (gp && callLike(gp.type) && parent.children[0]?.id === node.id) {
    const fn = gp.childForFieldName("function") ?? gp.children[0];
    if (fn !== null && fn.id === parent.id) return [];
  }
}
```

**⑥ obj/attr 提取按类型分支**（覆盖 C# 字段名）
```ts
let obj: SyntaxNode | null = null, attrNode: SyntaxNode | null = null;
if (node.type === "conditional_access_expression") {
  obj = node.children[0] ?? null;
  const mbe = node.children.find((c) => c.type === "member_binding_expression");
  attrNode = mbe?.namedChildren[0] ?? null;
} else {
  obj = node.childForFieldName("object") ?? node.childForFieldName("expression") ?? node.children[0] ?? null;
  attrNode = node.childForFieldName("attribute") ?? node.childForFieldName("property") ?? node.childForFieldName("name") ?? node.children[node.children.length - 1] ?? null;
}
if (!obj || !attrNode) return [];
// 后续 L199-206 不变（this→self.x；identifier 对象→obj.attr；链→根⊤）
```
字段名已实测：member_access_expression 有 `expression`/`name`；conditional_access_expression 无字段、name 在 member_binding_expression 首个子节点。

**⑦（推荐同迭代，写侧对偶）externalWritePos L342-346 后加**
```ts
if (left.type === "member_access_expression") {
  const obj = left.childForFieldName("expression") ?? left.children[0] ?? null;
  const attr = left.childForFieldName("name") ?? left.children[left.children.length - 1] ?? null;
  return readTarget(obj, attr?.text);
}
```
否则 C# `this.instance = x` 写不可见（现缺口），耦合图对 C# 字段写永远残缺。

### b) 排除逻辑的语义（写进 audit.md）
- **调用目标排除**：成员节点是调用（invocation_expression/object_creation_expression/call/call_expression/new_expression）的 function/constructor（或 `?.` 链的 function 链一部分）→ 不产生 stateRead。`instance.Method()`、`new Foo().Bar()` 同理。
- **字段读保留**：非调用位置的成员访问（`instance.Field`、`x = user.status`、`user.status == "active"`、`instance?.Field`）→ 产生 `"instance.Field"`/`"user.status"` 位置，照常进入 stateDeps 前缀/精确匹配。
- **左值读保留的镜像**：赋值左值（`user.status = x`）只算写不算读（左值跳过失修后生效）——同一位置不双计。
- 成员结构的子标识符（对象名/成员名）不再独立裸读——位置语义由成员节点单点承担，避免 `Foo.instance.x` 的 `instance` 成员名与真正的 `instance` 变量读混淆。

### c) 对 InitDeity --state 的预期效果
- 写方 `"instance"`（22 个）：读者 2633 → **显著下降**。2633 中绝大多数是 `XxxManager.instance.xxx`（成员名）与 `instance.Method()`（调用目标），修复后不再产生 `"instance"` 读；留存者 = 裸 `instance` 非成员读（`instance == null`、参数传递）+ `instance.Field` 字段读（前缀仍命中 `"instance"` 写方）。
- 27 份抽样（每 100 个取 1）人工分类：真实读者 ≈ 1/27 → 估计 **≈100 量级（与任务预估 <100 吻合，精确数需修复后重扫确认）**。
- 连带效应：C# `XxxManager.instance.x` 链式读改为 `"XxxManager.⊤"`（根限定读，state.ts:50-56 已有语义）；C# 新增 `"instance.Field"`/`"self.x"` 位置读（字段读从 0 到有，耦合图信息量上升）；TS/Python 的 `user.save()` 调用目标位置消失（全语言一致化）。

### d) 测试点 2 个（建议加进 test/audit/csharp-lang.test.ts，仿其现有 project/scanProject 模式）
- **T1 C# 方法调用目标不产生 stateRead**：fixture `class Service { public static Service instance; void Run() { instance.Configure(); } void Configure() {} }` → 断言 `Service.Run` 的 `stateReads` 不含 `"instance"`/`"Configure"`/`"instance.Configure"`（修复前：含 `"instance"`+`"Configure"`；修复后空）。
- **T2 C# 字段读仍产生 stateRead**：fixture `class Service { static Service instance; void Read() { var x = instance.Value; } int Value; }` → 断言 `Service.Read` 的 `stateReads` **包含** `"instance.Value"`（修复前：只含 `"instance"`+`"Value"` 裸读，无位置读；修复后含位置读）。

### e) 回归风险（逐 fixture 核实）
- **csharp-lang.test.ts**：只断言 purity/effects/calls（L48-193 全部核实），零 stateReads/stateDeps 断言；stateReads 是纯元数据（types.ts:58-79 注释 + analyze.ts:159 注入，不进 purity/effects/chain，公理 3）→ **不受影响**。
- **effect-table.test.ts / iter18-real-driven.test.ts**：grep 确认零 stateReads/stateWrites/stateDeps 断言 → **不受影响**。
- **lang-features.test.ts:915-926**（唯一断言 stateDeps 的测试）：
  - `a.py::send_email` stateDeps 含 `"user.status"` —— 来自 `user.status == 'active'`（非调用 attribute 读）→ 修复后保留 ✓；
  - `a.py::validate_user` stateDeps `toEqual([])` —— 修复后左值自读消失（左值跳过生效），但原本就被 stateDepsOf 自写自读排除 → 仍 `[]` ✓；
  - `b.ts::Store.get` stateDeps 含 `"self.v"` —— `this.v` 是 return 位置非调用读 → 保留 ✓；
  - 以上 purity 断言全部不受 stateReads 影响 ✓。
- **state.test.ts / risk.test.ts**：fixture 直接构造 chunk 字段，不经过提取器 → 不受影响。
- 全量回归：`npm test` 即可（提取层断言仅上述 lang-features stateDeps 两条）。

---

## 4. 残余风险 / 盲区

1. **修复后 InitDeity 精确读者数未实测**：需修复后 `node dist/cli.js scan "J:/旧宇宙/代码仓库/InitDeity/Assets" --no-cache --state --json` 重扫（~1 分钟，语料只读）。本审计只能给抽样估计（≈100）。
2. **C# 属性/字段声明标识符仍裸读**（`public static T instance` 的声明名 identifier，parent=property_declaration 不在抑制集）——SingletonManager.cs:7 样本即此形态；属既有噪音，不在本修复范围（如需可把抑制集扩到声明节点，建议另立议题）。
3. **写侧缺口（⑦）若不修**：C# `this.x = v` 写仍不可见，耦合图对 C# 字段写保持残缺（不影响读者虚高修复本身，22 个 `"instance"` 写方是裸标识符写）。
4. **`a.b?.c()` 内层成员排除（⑤）**是专门边缘分支；不覆盖 `a?.b?.c()` 双层 `?.` 的内层（罕见，建议以 ⑤ 的祖父链思路扩展或在 audit.md 注明）。
5. 语义变化会改变**所有语言**的 stateDeps 元数据（调用目标位置消失、C# 位置读新增）——R_state（risk.ts:217-234，--changed 路径）与 --state 数字会整体变动，属预期；README 已知限制段可补一句「调用目标不计字段读」的语义说明。

## 5. 关键文件索引（供实施者）

| 文件 | 位置 | 作用 |
|---|---|---|
| src/lang/extractor.ts | L35-94 visit / L153-172 stateWritePos / L175-207 stateReadPos / L314-348 externalWritePos | 全部改动点 |
| src/lang/packs/csharp.ts | L300 callNodes、L364-369 pack 定义 | C# 节点类型事实源（invocation_expression/object_creation_expression） |
| src/core/state.ts | L19-64 stateDepsOf、L99+ stateCouplingOf | 匹配/聚合（无需改动） |
| src/core/analyze.ts | L159,173 | stateDeps 注入 verdict（无需改动） |
| test/audit/csharp-lang.test.ts | 全文件 | T1/T2 落点（现有 fixture 模式） |
| test/audit/lang-features.test.ts | L915-926 | 唯一 stateDeps 断言（回归基准） |
| docs/iter22/initdeity-report.json | 反查数据源（40MB，23800 verdicts） | 2633/22 读者/写方实证 |
