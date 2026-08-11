# 迭代 25 审计：C# 写侧三残余（对象初始化器 / 类字段裸写 / 局部声明假裸读 / ++ 不可见）（scout 产出）

> 只读审计，HEAD acbb210（Iter-24 闭环后）。全部结论经 web-tree-sitter 0.22.6 实际 parse + dist/cli.js 实际 scan 实证（fixture：`new Config { SegmentId = v, Name = "a" }`、`score = v`、`int q = 1`、`score++`/`++score`/`this.x++`）。
> 测试基线：test/audit/csharp-lang.test.ts + lang-features.test.ts 89/89 通过（修复前）。
> 目标文件：`docs/iter25/audit.md`（本内容即其成稿）。

---

## 0. 结论先行（任务前提两处修正）

1. **② 的「variable_declarator 未列入」只对 `assignedNames` 成立，`declaredNames` 已覆盖 C#**：declaredNames（extractor.ts:290-310）直接按节点类型 `variable_declarator` 收集、`childForFieldName("name") ?? children[0]` 兜底 → C# 局部/字段声明名已在 declared（实证：`local = 5` 写侧被 declared 判局部、不产生外部写）。真正失效的是 **assignedNames（extractor.ts:546-578）**：csharp.ts:316-320 的 assignmentTargets 含 `local_declaration_statement`/`variable_declaration`，但两者 `childForFieldName("left"/"name")` 均 null（C# 这两类节点无名字段），`variable_declarator` 又未列入 → **C# 局部声明名从不入 assigned** → stateReadPos 裸读分支（L192 `!chunk.assigned.includes`）对局部失效。
   - 精确形态（实测）：`int local = 1; local = local + 1;` 的 local **入** assigned（`local = local+1` 的 assignment_expression 有 left 字段，被 assignedNames L566 收集）→ 读被抑制；`var x = new C{...}`、`int q = local*2` 这类**声明后不再裸重赋值**的局部 → 不入 assigned → 声明名+全部读 = 假裸读。实测 `L.cs::L.M` stateReads=`[M,q]`（q 假裸读、local 因重赋值被抑制）。
2. **web-tree-sitter 0.22.6 的 `.fieldName` 属性 getter 全节点返回 undefined，但 `childForFieldName()` 正常**（实测 class_declaration name→`L`、method_declaration name→`M`、assignment_expression left→`local`）。仅观察事实，不影响任何现有代码（代码全用 childForFieldName）；但任何新代码不得依赖 `.fieldName`。

---

## 1. 三残余的机制逐项核实（实证）

### ① 写侧两处假/漏

**a) C# 类字段裸写 = 全局裸名**（ConfigSingleMenu 2674 机制）
- `score = v;`（方法内、无 this）→ tree-sitter-c_sharp 产 `assignment_expression`，left 是**裸 identifier**（无 member_access_expression 包装）。
- externalWritePos（extractor.ts:353-394）identifier 分支（L355-366）：module? 否 → python? 否 → `chunk.declared.includes("score")`? **score 是类字段，不在方法 chunk 的 declared**（declaredNames 只收 chunk 根内的 declarator）→ 不在 params → `return left.text` → **外部写 "score"**。
- 实证：`S.cs::ConfigSingleMenu.Set` stateWrites=`[score, self.score, SegmentId, Name]`——裸 `score` 写与 `this.score` 写（`self.score`，iter24 ⑦ 已修）**并存两键**。
- 危害：裸写 "score" 与全库任何裸读 "score"（他类字段、局部变量名）耦合 → 跨文件假耦合（1949 读者机制同源）。

**b) 对象初始化器属性名 = 裸写**（Quest12* 1949 机制）
- `new Config { SegmentId = v, Name = "a" }` → `object_creation_expression` → `initializer_expression` → 子节点就是 **`assignment_expression`**（children: [identifier, assignment_operator, value]）。
- stateWritePos（L158-164）assignment 分支命中 → externalWritePos(identifier "SegmentId") → 裸写 "SegmentId"。
- 实证：stateWrites 含 `SegmentId`、`Name`。**每次 `new X { A = 1 }` 都产一个伪外部状态写**——这是 1949 读者的写源头。
- 已核实不触发的情形：集合初始化器 `new List<int> {1,2}`（无 assignment 子节点）；匿名对象 `new { A = 1 }`（是 `name_equals` 非 assignment_expression）；数组 `new int[]{...}`（无 assignment）。`with` 表达式（`x with { B = 2 }`）同为 initializer_expression 包装（一并覆盖，语义同为新对象）。

### ② C# 局部声明名/方法名假裸读
- 机制见 §0.1（assignedNames 失效）。方法名裸读：`void Set(...)` 的 `Set`（method_declaration 的 name 字段标识符）被 visit 遍历到 → stateReadPos identifier 分支 → 裸读。实证：`Set` chunk stateReads=`[Set, x, Config]`（**含自身方法名**）；类 chunk stateReads 含 `ConfigSingleMenu`；`new Config` 的类型名 `Config` 也裸读。方法名/类型名裸读属既有噪音（仅当存在同名写时才产生假耦合）。

### ③ C# this.x++ / i++ 写不可见
- `score++` → `postfix_unary_expression`（children: [identifier, `++`(匿名 token)]）；`++score` → `prefix_unary_expression`（children: [`++`, identifier]）；`this.x++` → postfix（children: [member_access_expression, `++`]）。
- stateWritePos 只认 `update_expression`（TS/JS 节点）→ C# 三类 ++/-- 全无写。
- 实证：Set 的 stateWrites 只有 4 项，`score++`/`++score` 均不在 → **字段自增方法被标纯（假纯，purity 缺陷）**。

---

## 2. 修复方案（按任务 a–d）

全部改动收敛于 `src/lang/extractor.ts` + `src/lang/packs/csharp.ts`，且**每一项都以 C# 专属节点类型/pack 门控**——JS/TS/Python 零改动路径（详见 §3 风险逐项）。

### a) C# 类作用域字段写 → `self.attr`（externalWritePos identifier 分支）

在 extractor.ts:366 `return left.text;` 前插入：

```ts
// 迭代25：C# 类成员方法内裸字段写（score = v）→ self.score（类内状态，非全局裸名）。
// 边界：最近函数状祖先是 method/constructor_declaration 才成立——C# 无全局变量，
// 方法内可裸写的名字只有 局部(declared)/参数(params)/字段属性/静态字段，后两者即 self 语义；
// local_function_statement 排除：捕获外层局部时语义等同 TS 闭包（裸外部写，与 TS 一致）。
if (this.pack.name === "csharp" && this.inClassMemberBody(left)) return `self.${left.text}`;
```

新辅助方法（~10 行）：

```ts
/** C# 类成员方法体判定：最近函数状祖先 ∈ {method_declaration, constructor_declaration}。
 *  class_declaration 本体（kind="class"）→ false（字段声明级写由 declared 短路，不需 self）； */
private inClassMemberBody(node: SyntaxNode | null | undefined): boolean {
  let p = node?.parent;
  while (p !== null && p !== undefined) {
    if (p.type === "method_declaration" || p.type === "constructor_declaration") return true;
    if (p.type === "local_function_statement" || p.type === "lambda_expression" ||
        p.type === "anonymous_method_expression" || p.type === "class_declaration" ||
        p.type === "struct_declaration" || p.type === "interface_declaration") return false;
    p = p.parent;
  }
  return false;
}
```

- **为何写侧安全**（判定规则）：C# 无全局变量；方法内裸写名的封闭集合 = 局部（declared，已短路）+ 参数（params，已短路）+ 实例/静态字段与属性（self 语义）。`out`/`ref` 实参是参数；事件 `+=`（`OnChange += Handle`）的 left 是裸 identifier 字段名 → 本轮起映射 self.OnChange（既有裸写行为已把它当外部写，属改善）。
- **不用 chunk.ownerClass 信号的原因**：ownerClass（extractor.ts:440-450）对 local_function_statement chunk 也非 null → 简单规则会把「局部函数捕获方法局部再写」误映射 self（c 是方法局部非字段）。祖先爬精确排除；且 lambda/匿名方法体内赋值落在外层方法 chunk（lambda 不建 chunk，stack 顶层即方法），其 declared 已覆盖方法局部 → 误映射不可能。
- **读侧不动（关键设计裁决）**：C# 裸 identifier 读混有类型名/方法名/调用目标（`Destroy`、`GameObject`、`Run`、`new C` 的 C）——无符号表无法安全区分字段读。若把裸读也映射 self 会灾难性误标。**代价**：`this.score` 读 → `self.score` 与写耦合 ✓；裸 `score` 读（隐式 this）成为孤儿读（不与 self.score 写耦合）。这是精度/召回权衡，记为残余（见 §4.1）。purity 判定不受影响（stateWrites 非空即 state，link.ts:289）。

### b) 对象初始化器属性写跳过（stateWritePos）

extractor.ts:158 的 assignment 分支前插：

```ts
if (node.parent?.type === "initializer_expression") {
  // 迭代25：C# 对象初始化器（new C { A = v }）——新鲜对象属性初始化，非外部状态写。
  // TS/JS 对象字面量是 pair 节点、从不触发写分支；Python dict 同理——本跳过是对齐语义。
  return [];
}
```

- 实证节点结构：`initializer_expression` 是 object_creation_expression 直接子节点，其直接子节点即 assignment_expression（parent 检查足够，无需祖先链）。
- 附带收益：`with` 表达式同包装一并跳过（新对象语义一致）。

### c) variable_declarator 并入 assigned（C# 局部假裸读消除）

**csharp.ts:316-320**：`["assignment_expression", "local_declaration_statement", "variable_declaration"]` → `["assignment_expression", "variable_declarator"]`

**extractor.ts:566**（assignedNames 的 left 提取）改为：

```ts
const left = n.childForFieldName("left") ?? n.childForFieldName("name") ?? n.children[0] ?? null;
```

- **必须移除 `variable_declaration`**：若保留，children[0] fallback 会命中类型名（`Foo bar` 的 `Foo` 是 identifier 类型子节点）→ 把类型名误收进 assigned。`variable_declarator` 无 name 字段（实证：`childForFieldName('name')` → null，名字是裸 identifier 子节点）→ 靠 children[0] fallback 收名。
- `local_declaration_statement` 一并移除（children[0] 是 variable_declaration，收不到名；留之无害但死条目，删）。
- 效果：C# 局部 `x`/`q` 入 assigned → stateReadPos L192 抑制假裸读；字段声明（class 级 variable_declarator）也入 assigned → 类 chunk 内字段初始化互引读被抑制（安全方向，见 §4.3）。

### d) postfix/prefix_unary_expression 写补（stateWritePos）

extractor.ts:172 前（update_expression 分支之后）插入：

```ts
if (node.type === "postfix_unary_expression" || node.type === "prefix_unary_expression") {
  // 迭代25：C# i++ / this.x++ / ++i。操作数是唯一 named 子节点（++/-- 是匿名 token）。
  const arg = node.children.find((c) => c.isNamed) ?? null;
  const pos = this.externalWritePos(arg, chunk);
  return pos !== null ? [pos] : [];
}
```

- **不要**用 `children[0]`（prefix 的 children[0] 是 `++`）；**不要**用 `c !== op` 排除操作符（web-tree-sitter 每次访问返回新包装对象，引用比较恒真——iter24 的 `===` 教训，extractor.ts:176 注释）。
- 效果链：`this.x++` → member_access_expression → `self.x` 写（假纯修复）；`i++`（局部）→ declared 短路 → null；`++score` → `self.score`（配合 a）。

---

## 3. 每项风险（JS/TS/Python 回归面）与测试点

| 项 | JS/TS | Python | 其他 |
|---|---|---|---|
| a（self 映射） | 无（`pack.name === "csharp"` 门控） | 无（python 早退 L362 之前即短路） | C# 内 local_function 保持原裸写（与 TS 闭包语义一致） |
| b（初始化器跳过） | 无（TS/JS 无 `initializer_expression` 节点；对象字面量是 pair 不触发写） | 无（dict 字面量不触发） | 无 |
| c（variable_declarator→assigned） | **唯一跨语言接触点**：assignedNames 的 children[0] fallback——TS variable_declarator 有 name 字段、assignment_expression 有 left 字段 → fallback 永不触发，零行为变化 | Python assignment 有 left 字段 → 不触发 | csharp assignmentTargets 仅本包生效 |
| d（++ 写补） | 无（TS 用 update_expression，非 postfix/prefix_unary_expression） | 无（Python 无 ++） | 无 |

- 缓存：scan.ts:28 注释「提取行为变更走自动指纹（computeFingerprint）」→ 无需 bump CACHE_VERSION。
- 现有断言面：lang-features.test.ts:915-926 是唯一 stateDeps 断言（`user.status`、`[]`、`self.v`）——a–d 均不触碰 Python/TS 提取路径 → 原样通过（已跑 89/89 基线）。

**测试点（落 test/audit/csharp-lang.test.ts，仿现有 project/by 模式，verdict.chunk.stateWrites/stateReads 可断言——scan JSON 实证字段存在）：**

- T1（b）：方法含 `new Config { SegmentId = v, Name = "a" }` → 断言 stateWrites **不含** `SegmentId`/`Name`。
- T2（d）：`score++; ++score; this.x++; int i = 0; i++;` → stateWrites 含 `self.x`（仅来自 this.x++）；**不含** `"i"`；`score` 的两次自增合并为 `self.score` 写。
- T3（c）：`int q = 1; int r = q * 2; return r;` → stateReads **不含** `q`/`r`（修复前：`q` 假裸读）。
- T4（a）：`score = v;`（无 this）→ stateWrites 含 `self.score` 且**不含** `"score"`；`int l = 0; l = 5;` → 无写；局部函数捕获 `void L() { c = 2; }`（c 为方法局部）→ **不产生** `self.c`。
- T5（回归）：lang-features.test.ts:915-926 三条 stateDeps 断言原样通过（现有测试即回归网，无需新增）。

---

## 4. 残余风险 / 盲区

1. **裸字段读不映射 self**（设计裁决）：`self.score` 写与裸 `score` 读不耦合；`this.score` 读仍耦合。修复需符号表/类型解析，本轮不可行 → 记待办。
2. **local_function_statement 捕获写保持裸外部写**：与 TS 闭包语义一致（`function outer(){ let c=0; function inner(){ c=5 } }` 同路径）；局部函数内嵌 lambda 再写方法局部（罕见^2）会误映射 self → 接受。
3. **类 chunk 字段名入 assigned**（c 的副作用）：`private int a = b;` 的 `b` 读在类 chunk 内被抑制（b 是字段声明 → assigned）——安全方向（不再产假外部读），轻微欠报。
4. **静态字段写标 `self.score`** 与类名限定读 `ConfigSingleMenu.score`（obj=类名 → readTarget 产出 `ConfigSingleMenu.score`）不耦合——**既有现象**（修复前裸写 "score" 同样不匹配），非本迭代引入。
5. **element_access_expression 左值写**（`this.arr[0] = v` / `arr[0]++`）：externalWritePos 无此分支 → 仍不可见。独立待办。
6. **方法名/类型名裸读**（`Set`、`Config`、`ConfigSingleMenu`）：跨语言通用噪音（TS `function foo(){}` 名同样裸读）；仅当存在同名写时产假耦合 → 低频。修复 = 声明名标识符抑制（identifier 的 parent 的 `childForFieldName("name").id === node.id` → 跳过），~3 行、**跨全语言**，需全量回归 → 记待办，不并本轮。
7. **修复后 InitDeity 重扫数字未实测**：预期 `"SegmentId"/"Name"` 写清零、`"score"` 裸写转 `self.score`、1949/2674 读者大幅回落；精确数需修复后 `node dist/cli.js scan "J:/旧宇宙/代码仓库/InitDeity/Assets" --no-cache --state --json` 验证。

---

## 5. 优先级判断

**本轮做（收益大、风险面全部限于 C# 且已逐项核实）：**
- **b（初始化器跳过）**：消灭最大伪写源——Quest12* 1949 读者机制的写源头（`SegmentId`/`Name`）。每处 `new X { A = 1 }` 都少一个外部状态写。零跨语言风险。**最高收益**。
- **d（++/-- 写补）**：修复假纯（`score++` 方法被标 purity=0）。`this.x++` → self.x 写。零跨语言风险。**纯 bug 修复**。
- **c（variable_declarator → assigned）**：消除 C# 局部假裸读（`x`/`q` 噪音），收窄裸读集合 → 假耦合面下降。C# 包内改动 + 一处全语言 fallback（已证不触发）。**低风险高确定性**。
- **a（字段写 → self.attr）**：ConfigSingleMenu 2674 机制根因——类字段写从全局裸名收敛为 self 语义。~15 行（含辅助函数），判定边界清晰（方法体祖先 + declared/params 短路）。读侧不对称性已文档化（§4.1）。**值得做**。

**记录待办（不并本轮）：**
- 裸字段**读** → self 映射（需类型解析，§4.1）。
- 声明名（方法/类/字段名）裸读抑制——跨全语言通用项（§4.6），~3 行但需全量回归评审。
- element_access_expression 左值写（`arr[i] = v`，§4.5）。
- 静态字段 self 标签与类名限定读耦合缺失（§4.4，既有现象，如需再立议题）。

**实施顺序建议**：b → d → c → a（先除最大伪源，再补漏，最后语义收敛），单文件改完跑 `npm test`（~2s，89 tests）即可，T1–T4 随改随加。

---

## 6. 关键文件索引

| 文件 | 位置 | 作用 |
|---|---|---|
| src/lang/extractor.ts | stateWritePos L153-172（b/d 改动点）、externalWritePos L353-394 identifier 分支 L355-366（a 改动点）、assignedNames L546-578 L566（c 改动点）、stateReadPos L184-193（② 待办落点）、ownerClass L440-450（a 备选信号，弃用原因） | 全部本轮改动 |
| src/lang/packs/csharp.ts | assignmentTargets L316-320（c 改动点）；chunkNodes L286-293、selfNames L315（事实源） | 本轮 1 行 |
| test/audit/csharp-lang.test.ts | 全文件（project/by 模式，scanProject 实证可用） | T1–T4 落点 |
| test/audit/lang-features.test.ts | L915-926 | T5 回归基准（唯一 stateDeps 断言） |
| docs/iter24/audit.md | §3 ⑦ externalWritePos member_access_expression 分支先例；§1 `===` 教训 | 对偶先例 |
| src/core/state.ts | L19-64 stateDepsOf（无需改动，匹配语义不变） | 读方 |
