APPROVED

# 迭代 24 verify：stateReadPos 修复复审

> 复审方式：只读复审 docs/iter24/impl.md + git diff（4 文件：extractor.ts / csharp-lang.test.ts / fixture.test.ts / README.md），
> 独立复跑全量测试（node node_modules/vitest/vitest.mjs run → 26 文件 261/261），
> 并用真实 parser AST 逐节点核对 + scanProject 端到端探针独立验证行为（非仅依赖测试断言）。

## 结论：APPROVED（无 blocker；4 条 note 见下）

## 1) stateReadPos 修复正确性

### 根因修复（`===` → `.id`）——正确

- 旧代码 `left === node` / `fn === node` 中 left/fn 来自 `parent.childForFieldName(...)`，node 是遍历包装对象——web-tree-sitter 每次属性访问新建包装，`===` 恒假 → 「调用目标排除」「赋值左值跳过」自迭代8 起死代码。改为 `.id` 比较底层节点 id，正确。
- 修复后**对所有语言生效**（impl.md 已声明）。端到端探针证实：
  - JS `user.save()` → 无 save 读（修复前噪声 `user.save`/`user` 消失）；`return user.status` → `user.status` 读保留
  - Python `user.save()` / `return user.status` → 同上
  - C# `instance.Configure()` → 无 instance/Configure/instance.Configure 读（T1 ✓）

### 非调用字段读不误伤——正确

- C# `return instance.Value`（非调用）→ `stateReads=["instance.Value"]` 保留（T2 ✓）。
  关键机制核实：C# member_access_expression 字段为 expression/name（AST 实测），分支提取正确；
  `public static Service instance;` 字段声明的名字不进 `assigned`（csharp assignmentTargets 为
  assignment_expression/local_declaration_statement/variable_declaration，均无 left/name 字段可提，
  variable_declarator 不在列）→ instance 判定外部 → 位置读成立。
- 赋值左值跳过：C# `instance.Value = 5` → 无 "instance.Value" 读，仅写 `instance.Value`（探针证实）。
- 成员访问结构子标识符不再裸读：C#/Python/JS 的 obj 名与成员名字（identifier 型）由成员节点单点承担，
  探针证实 `user.save()` 不再产生裸 "user" 读。

### JS/TS/Python 回归——无

- 全量 261/261（26 文件，含 pyshop/tsapp/jsapp 跨模块 stateDeps 传播用例）独立复跑通过；
  唯一行为断言变更是 fixture UIWorldLink（UNKNOWN→IMPURE，见 §3，正确化方向）。
- 行为变化面（裸名读消失、调用目标不再计读）是迭代8 原始意图的活化，非误伤：位置读字符串与写侧对偶匹配
  （`user.status` 读 ↔ `user.status` 写），传播链路不变。

## 2) 语义完整性

### object_creation_expression（new X()）

- **调用侧**：C# `new Foo()` 计入 callNodes（pack 既有，未改）；object_creation_expression 加入 isCallLike
  对 member/conditional 子节点的排除——但 AST 实测 C# 类型位置是 `identifier`/`qualified_name`（非
  member_access_expression），故该分支对 C# 类型位实际不触发。JS/TS `new Foo.Bar()` → constructor 字段排除生效
  （探针：newX 无 Foo/Bar 读）✓。
- **note-1（轻微，非新缺陷）**：C# `new Foo()` / `new A.B()` 的类型名标识符仍裸读（探针 stateReads 含
  `Foo`/`A`/`B`——parent 为 object_creation_expression/qualified_name，不在标识符跳过名单）。与 JS/TS
  `new Foo()` 的既有行为一致（JS 裸 `new Foo()` 同样读 `Foo`），非迭代24 引入的回归；impl.md 称
  「object_creation_expression 补进调用 parent 列表」为修复略有夸大（该入口对 C# 类型位惰性），残余风险清单
  应补「构造类型名裸读」一条（与既有「属性/字段声明标识符仍裸读」同族）。

### conditional_access（?.）

- `a?.flag`（值读）→ `a.flag` ✓；`instance?.Configure()`（调用目标）→ 排除 ✓（探针 C.cs::S.Cond）。
- JS `a?.b` → `a.b` 读；`a?.b()` → 排除 ✓（探针 J.js::cond）。
- `a?.b?.c()` 双层：探针证实内外层均排除（无 a.b 读）——impl.md 残余风险「双层 ?. 内层不覆盖」与实测不符
  （该行已实际覆盖，方向安全，仅文档措辞保守，非缺陷）。

## 3) fixture 断言变更（UNKNOWN→IMPURE）——正确化

- UIWorldLink `transform.position = screenPos + (Vector3)offset;`：C# member_access_expression 写侧对偶⑦
  生效 → 写 `transform.position` → state 效应 → IMPURE(2)。transform.position 赋值确为真实状态写，
  旧断言（UNKNOWN）是修复前 C# 字段写不可见导致的漏报。方向正确。

## 4) 测试与门禁

- tsc --noEmit：0 错误。
- 全量：`node node_modules/vitest/vitest.mjs run` → 26 文件 261/261 passed（5.53s）。
- T1/T2/T3 防回归有效性（按构造）：修复前 T1 含裸 "instance" 读 → 断言失败；T2 无 "instance.Value" 位置读 → 失败；
  T3 无 "self.counter" 写 → 失败。成立。
- README 门禁 261 ✓。

## 残余风险（复审追加，均为既有/文档化项，非本修复引入）

- **note-2（既有）**：C# 局部声明名与方法名仍裸读（探针 S.Ctor 含 `x`/`y`、S.Run 含 `Run`）——
  assignedNames 对 C# 无效（assignmentTargets 节点无 left/name 字段可提取，variable_declarator 未列入）。
  既有噪音，建议下轮把 C# variable_declarator 名字并入 assigned/declared。
- **note-3（既有）**：C# `this.x++`/`i++` 写不可见（postfix/prefix_unary_expression 不在 stateWritePos 列表），
  state.ts 匹配不到——impl.md 未列，补记。
- **note-4（impl.md 已列）**：Quest12 对象初始化器属性名裸写、C# 字段声明标识符裸读、instance 读者 1005
  （名基匹配上限）——与 impl.md 残余风险一致，未变。
