# LangPack 抽象「无特例语言无关」数学评审

迭代37 · 数学家视角（形式化/抽象/健全性）· 只读评审
基线：305/305 测试绿、工作树干净、`analyze.invariantViolations = 0`（A6 内层机检证书）。

## 0. 范围与验证

读：`src/lang/pack.ts`、三语言包全量、`src/engine/link.ts`、`src/lang/extractor.ts`、`src/core/analyze.ts`、`src/core/effectUsage.ts`、`src/lang/effectOverride.ts`、`docs/axioms.md`、`docs/type-inference-design.md`、`docs/iter33/{tool-pains,fix-audit}.md`。

实测探针（临时测试已删，工作树未改）：

- `vitest run` 全量 305/305 passed（29 files）。
- A1 探针：Python `def f(xs: list): xs.append(1)`、TS `function h(s: string)` 均 purity=1（UNKNOWN）；Python 无注解对照同 UNKNOWN → **A1 通道对 TS/Python 静默空**。
- AST 探针：tree-sitter-python `typed_parameter` 有 name/type 字段，但 type 字段是 `type` 包装节点（非 identifier/generic_name/…），被 `ctorTypeName`（extractor L852-870）拒绝 → paramTypes 为空。
- ctor 探针：C# `new WaitForSeconds(1f)` → IMPURE(clock)（ctor 分支 ✓）；C# `var xs = new List<int>(); xs.Add(1)` → UNKNOWN（局部变量绑定缺口实证）；TS `new Date()` → UNKNOWN。

## 1. 判定框架（特例 vs 通用机制的形式化判据）

引擎决策函数 `F(pack, call, ctx) → {edge, effect, pure, unknown}`。一个语言差异 D 是**「通用机制 + 语言数据」**当且仅当：

- **(机制)** `F(pack, ·)` 对 pack 所有取值执行同一算法 A，D 的差异仅出现在 pack 字段值上（即 D 是参数注入，非控制流分流）；
- **(方向安全)** A 的未命中回退 ≡ UNKNOWN（A7：`?` 是知识标记非效应，参与传播不判纯；axioms.md L42）。

**行为特例** = 控制结构依 `pack.name` 或硬编码字符串分流（`startsWith("gameObject.")`、`pack.name === "csharp"`）。行为特例不等于缺陷：名字解析关系 ρ_L 是语言语义函数，不能由有限表完全枚举（pack.ts L10-12 设计声明「名字解析是行为不是数据，每门语言自己实现」）。**「无特例语言无关」的可达成形态 = 引擎零硬编码语言常量；差异全部经 pack 数据字段或 pack 行为方法注入。** 行为侧（extractImports/resolveModule）语言专属是抽象边界，不是待消灭的特例。

## 2. Q1 逐字段判定：特例 vs 通用机制

### 2.1 数据字段（全部已是「通用机制 + 数据」，无需改动）

| 字段 | 判定 | 证据 |
| --- | --- | --- |
| impureBuiltins / pureBuiltins | 通用机制+数据（裸名通道） | link L707-724 |
| impureGlobals / pureGlobals | 通用机制+数据（对象通道；`impure 先于 pure` 是通用算法，P1） | link L770-798；effectUsage L97-110 |
| impureModules / pureModules | 通用机制+数据（模块通道；**最长点分前缀回退**是通用算法） | link L194-237（`for i=len..1`） |
| hofCallsArgs / hofAlwaysArgs | 通用机制+数据（**无条件子集语义**是通用算法：`unconditional \|\| has`，未解析记 UNKNOWN 防假纯） | link L280 |
| literalReceivers | 通用机制+数据（解括号/断言后查表；bytes 前缀是 Python 数据 tweak，见 2.2） | extractor L786-802 |
| builtinTypeEffects | 通用机制+数据（**两条入口**：receiver 字面量/class: 与 A1 参数类型——同一表，两个查表通道） | link L594-599、L747-749 |
| builtinMethodReturns | 通用机制+数据（链式接收者解析） | extractor L647-657 |
| frameworkIo | 通用机制+数据（段前缀匹配 `attr===p \|\| startsWith(p+".")` 通用） | link L658-670 |
| **frameworkPure** | **通用机制+数据**：两级 Record 匹配（type 键=首段；异质类型嵌套成员表）是通用算法；仅 C# 有数据 ≠ 特例 | link L671-702；csharp L433-461 |
| **pureCtor** | **通用机制+数据**：ctor 分支（impureGlobals→项目类→pureCtor→UNKNOWN 四步决策程序）通用；清单是数据 | link L537-562；csharp L375-387 |
| **implicitThis** | **通用机制+数据**：布尔参数化裸名解析（类内裸名→本类成员回退）；TS/Python false、C# true 均为数据 | link L631-638；python L179、ts L259、csharp L576 |
| selfNames / chunkNodes / classNodes / callNodes / nestingNodes / assignmentTargets | 数据（AST 形态表） | pack L92-100、L118 |

### 2.2 引擎内硬编码（行为特例清单）

| 位置 | 判定 | 论证 |
| --- | --- | --- |
| link L646-654 `attr.startsWith("gameObject.")` | **半特例**：机制（attr 首段+白名单→io）通用，白名单内容已复用 `pack.frameworkIo.gameObject`（数据）；硬编码的只是触发前缀字符串 `"gameObject."` 与「置于 assigned 守卫之前」的位次 | 收敛为 pack 数据字段（如 `frameworkAttrPrefix: Record<string, readonly string[]>`：attr 首段→白名单）即达成通用；白名单 miss→UNKNOWN 回退保持则方向安全（S4）。注意「守卫之前」是本形态主体（变量 receiver）的语义要求，数据化时位次必须保留 |
| link L537-562 ctor 分支 | **通用机制**：决策程序无语言指纹（无 pack.name）；`RawCall.ctor` 仅 C# `object_creation_expression` 产出（extractor L597-606）是**生产侧**节点形态差异 | 泛化到 TS `new_expression` 对称生产是「可做」而非「必须」——TS 现状语义等价：项目类经 bare-name→class chunk 边（L293-299 合并 `constructor` 名 chunk），框架类落 UNKNOWN 诚实。泛化需评审行为变化（见 §6 R1） |
| link L726-752 A1 | **通用机制**：分支内无语言指纹；`paramTypes` 数据 C# 独有是**提取侧**形态差异（见下） | paramTypesOf（extractor L337-350）的节点过滤表（`parameter/parameter_declaration/typed_parameter`）是 C# 形态；TS（`required_parameter`）与 Python（`type` 包装节点）**天然不触发**——实证探针确认两者 A1 通道静默。这是「意外的安全」，不是「特例」 |
| extractor L634-661 receiverTypeOf | **通用机制**：字面量/构造器/调用链三形态全部 pack 数据驱动 | 无特例 |
| extractor L425 `pack.name === "python"` | **行为特例**：Python 赋值即局部定义（无 global 声明则裸名写非外部）；TS/C# 反之 | 可数据化为 1-bit：`assignmentScopesLocals: boolean`（python true）——与 global_statement/nonlocal 分支（L155-157，已通用）正交 |
| extractor L432 / L487 `pack.name === "csharp"` | **行为特例**：C# 方法内裸字段写=this 字段（`self.x`）；TS 同形写是外层写（`x`） | 可数据化为 1-bit：`bareNameMeansThisInMethod: boolean`（csharp true）——统一标签差异（self.x vs x）即外部写位置串 |
| extractor L799-800 bytes 前缀 | Python 数据 tweak（f-string 与 bytes 同节点） | 可数据化（literalReceivers 值加标记）；1 行，低价值 |
| extractor L523-535 cjsExportName | JS 行为特例（exports.handler 命名 chunk） | 归 pack 行为 hook 可做；行为保持，低价值 |
| link L195 `replace(/^node:/,"")` | JS 模块说明符规范化 | 归 resolveModule 行为侧可做；低价值 |

**Q1 结论**：任务列出的四项（frameworkPure / pureCtor / paramTypes / implicitThis）全部是「通用机制 + 语言数据」——机制已在 link.ts 通用化，差异已收敛为 pack 字段，**无一需要引擎改造**。真正的「特例残余」是 2.2 表的 6 处引擎硬编码，且全部是**行为保持**的无损收敛对象（§7 可做列 1/2/7）。

## 3. Q2 统一作用域效应表

### 3.1 现状形式化

现有表族 `T = {T_i}`，`T_i: K_i → V_i` 偏函数。实际 12 张（任务列 9 名，含纯侧共 12）：impureBuiltins / pureBuiltins / impureGlobals / pureGlobals / impureModules / pureModules / hofCallsArgs / hofAlwaysArgs / builtinTypeEffects / frameworkIo / frameworkPure / pureCtor。（builtinMethodReturns 是返回类型表非效应表，排除。）判定函数 F = 带优先级的顺序查找：receiver → self → 裸名 → frameworkIo/frameworkPure → import → 效应表（impure 先于 pure）→ 星号回退 → UNKNOWN。

### 3.2 无损性定理（构造式）

**命题**：存在统一表 `T*: (scope × match × matchMode) → tag` 与查找过程 P，使对任意调用点 `L(c; T) = L(c; T*)` 逐点成立（effects/purity/chain/chainCertain 全同），当且仅当下列保持条件成立：

- **C1 通道序**：现有 F 的优先级是语义不是风格（receiver 命中必须早于裸名，防字面量被劫持——link L565 注释）。T* 的行必须携带通道（scope），P 保持分支序；「按统一优先级排序单扫」等价于重排 = 近似。
- **C2 匹配模式**：现三类匹配算法不同：(a) 精确（impureBuiltins、impureGlobals 成员）；(b) 段前缀（frameworkIo `attr===p||startsWith(p+".")`、frameworkPure 首段+嵌套段）；(c) **最长点分前缀回退**（effectFromModule `for i=len..1`，L210-217）。单一 `match` 字符串无法区分 (b)/(c)——必须带 matchMode ∈ {exact, prefix, longest-prefix, tagged}。
- **C3 标签原子**：hof（条件调用，addArgEdges 不带 unconditional）与 hofAlways（无条件，未解析记 UNKNOWN）是**不同语义原子**（link L280）。`:p` 纯标记 / `:效应` 后缀是 (member, tag) 数据级编码，结构化展开无损。tag 集下界：{effect, pure, hof, hof-always, member-effect, member-pure, member-hof}。
- **C4 遮蔽序**：同键 impure 先于 pure（P1，effectUsage L37-41 依赖其不可达性做 provably-dead 判定）。统一时同键纯行不可达，可直接合并进效应行（无损）；若保留独立行，P 必须 impure 先查。
- **C5 回退不变量**：任何 miss → UNKNOWN（S4）。不得引入默认标签（如「ns 键存在即纯」）——这就是 A7 红线。
- **C6 hof 咨询面**：现 hofCallsArgs 仅在特定通道被咨询（模块成员 L382/L416/L479、裸名 L713/L720、纯全局 L795），**不在** impureGlobals 字符串命中（L771-774）、frameworkIo 命中（L662-670）、字面量接收者命中（L594-599）上咨询。这是既有行为契约，统一时必须逐通道复刻（或显式评审为行为变化）。

在 C1-C6 下，e: ∪T_i → T* 是数据层双射重排，L 逐点不变 ⟹ 判定逐点不变 ⟹ **可判定性不变**（有限键哈希查找，O(1) 期望）且**方向不变**（miss→UNKNOWN、impure-先查均保持）。

### 3.3 反例边界（不满足则非无损）

1. frameworkIo 的 (b) 与 impureModules 的 (c) 混为同一 match 字符串 → 匹配算法歧义 → 行为漂移。
2. hof 与 hofAlways 并为一个标签 → hofAlways 的 UNKNOWN 门失效 → **假纯通道**（A6 S1 违反）。这是唯一会引入假纯的统一失误。
3. 提议 scope 集缺两个成员：impureGlobals/impureModules 的**成员数组形态**是 object-member / module-member 作用域，不在 {bare, object, module, ns-prefix, type-member, ctor} 内。最小完备集 ≥ {bare, object, object-member, module, module-member, ns-prefix(分 1/2 级), type-member, ctor}（ns-prefix 的 1 级/2 级也要 matchMode 区分）。

### 3.4 价值评估

- 结构性收益（真实）：跨通道撞名**构造性消除**。实证先例：csharp.ts L498-502 因 `String.Join` 撞名被迫从 hofCallsArgs 删除 Join/GroupJoin（数据损失换行为正确）；统一后 object 域 `Join` 与 type-member 域 `Join` 天然隔离。
- 成本：link.ts 查找 + effectUsage.ts 枚举（L63-77 直接读 pack 字段）+ effectOverride.ts 形状校验（L13-38，**用户 API 契约**）+ 4 packs + 305 测试。
- **裁决：可做（无损简化），非必须做**——零行为收益、纯 schema 收益；若做，必须按 C1-C6 交付且 effectUsage/effectOverride 同步迁移。

## 4. Q3 局部变量类型推断（moduleBindingsOf 扩展）

### 4.1 现状健全性（为何模块级 last-write-wins 是安全的）

moduleBindingsOf（extractor L115-151）只遍历 `root.children`（模块顶层直语句），按程序顺序 last-write-wins，非类赋值/定义即删除。**结构性安全**：顶层直语句按程序顺序执行（无分支），最后一次赋值 = 终值；条件/循环内赋值不在 root.children（分支被结构性排除）；函数体内重绑不可见（消费侧由 caller.assigned / moduleAssigned 守卫兜底：link L438、L501、L739）。残余缺口（del/import 重绑等）方向恒保守（删除绑定 → UNKNOWN）。

### 4.2 函数内扩展的正确性边界

**断言（充分条件）**：x ∈ declared(C)（或 Python 语义下在本 chunk 赋值声明）∧ C 中 x **恰有一个**赋值语句 ∧ RHS 是类构造调用 ∧ x ∉ params(C) ⟹ 解析 `x.m()` 到 K.m 健全。

**证明思路**：

- 单赋值 ⟹ 任何可达路径上 x ≡ 该赋值的值（flow-insensitive 直接安全）；
- 非支配路径（赋值在未执行分支）⟹ 运行时 x 未定义（TS `let x` 未初始化 → TypeError；Python 函数作用域 → UnboundLocalError）→ **无效应执行** → 不产生假纯；
- 参数排除：调用方控制类型（参数通道 = A1 声明类型，独立信任源）；
- declared 排除：`if p: x = Foo()` 中 p 假时 x 是**外层对象**——未 declared 则外层别名 → 可能错边。

**必要条件反例（放松即假纯）**：多次赋值（需支配/并集分析，非 O(1)）；未 declared（外层别名）；参数（调用方注入）。**函数名 RHS 安全**：`x = makeFoo()` 绑定 x→"makeFoo"（函数名），消费端 `kind === "class"` 校验（moduleBindings 通道 L458 同款）→ 非类 → UNKNOWN ✓。

**实施面**：需新提取通道（每 chunk 的 name→(count, class) 映射，count 语义区别于现有 assigned 集合）；消费端守卫 = 单赋值 ∧ declared ∧ ¬param ∧ kind=class。方向：绑定只**新增**边，miss 仍 UNKNOWN——纯增益。

**收益现实**：探针实证 C# `var xs = new List<int>(); xs.Add(1)` 当前 UNKNOWN（InitDeity 量级与 A1 970 站同源）；但 type-inference-design.md §10.2 收益审计：全类型层在 egg/swagger 语料回收 ≈0-3% chunk（构造器类 ≈1.5%），且 91% 的 `?`（无注解/局部/闭包）任何类型层救不了——本机制是其中「单赋值构造器」子类。**裁决：可做（方向安全前提可满足），不做亦可（语料驱动不足时 YAGNI）**。

## 5. Q4 重载消歧（tf.ambiguous 命中即弃边）

现状：同限定名多定义 → `ambiguous`（link L92-94）；各解析分支 `!ambiguous` 守卫命中即放弃 → UNKNOWN（L154/L258/L447/L461/L551/L584/L608/L634/L741/L763 共 10 处）。

记重载集 O = {f₁…fₙ}，真分派 f* ∈ O。效应用于沿图传播的单调并集闭包（A7）。

**命题 1（任选不安全）**：任意选 k 建边，∃j: eff(fⱼ) ⊄ eff(fₖ) 且 f*=fⱼ ⟹ 报告效应 ⊉ 模型效应（S2 违反）；fⱼ 不纯、fₖ 纯时 PURE ⟹ **A6 S1 违反（假纯）**。无支配信息时任意选恒不安全。

**命题 2（「同效应任选」link 期不可实现）**：eff(fᵢ)=eff(fⱼ) 需**传播闭包**（callee 链效应），link 期只有 direct 效应；direct 相同 ≠ 闭包相同。推迟到 analyze 后需不动点迭代——其安全形态即命题 3 的并集。

**命题 3（并集边安全——唯一通用安全启发式）**：对 O 全候选建边。eff(∪O) = ∪eff(fᵢ) ⊇ eff(f*)（单调并集封闭 ⟹ S2 ✓）；PURE ⟺ ∀i eff(fᵢ)=∅ ⟹ eff(f*)=∅（S1 ✓）；chain(∪O) = minᵢ(1+chain(fᵢ)) ≤ 1+chain(f*)（S3 悲观下界 ✓）。并集边把 UNKNOWN 提升为确定判定（判别力增益）。环安全：并集边可能造环 → SCC 凝聚 + 最小不动点（A7）处理。

**命题 4（arity 收窄是安全的过滤非定选）**：提取实参计数 n，收窄 Oₙ = {fᵢ: arity=n}。三语言均运行时强制 arity ⟹ 真分派 ∈ Oₙ ⟹ 对 Oₙ 做并集边仍安全且更精确。arity **定选**（单候选）退化为命题 1 → 不安全（C# int/string 同 arity 重载无法消歧）。

**产品面注意**：并集边改变 unknown-rate 与标注工作流语义（UNKNOWN → 确定判定）——采纳需配套文档/标注说明（工具哲学「宁 UNKNOWN 不 PURE」不违反：并集边不是猜测，是精确并集语义；PURE 只在全纯时给出）。

**裁决**：并集边（可做，数学可证安全）；任选/同效应 link 期版（不做）。

## 6. Q5 统一/泛化后的近似与假纯风险（对照 A6/A7）

| # | 泛化项 | 风险 | 判定 |
| --- | --- | --- | --- |
| R1 | ctor 对称泛化到 TS | link L541-545 Array→io 防御分支**首次可达**（TS `impureGlobals.Date=["now:clock"]` → `new Date()` → io）。io ⊇ {clock} 过近似（S2 安全）；无假纯。**前提**：必须保留「项目类优先于 pureCtor」（L546-556，L531-532 既有红线——项目类撞 pureCtor 名单且构造体有 io 时先查 pureCtor 会假纯）；TS 现状 `new Date()` = UNKNOWN（探针实证），泛化后 UNKNOWN→IMPURE 是行为变化需显式评审 | 可做（方向安全）；默认不做 |
| **R2** | **A1 泛化到 Python/TS** | **假纯通道（本次评审唯一）**：Python/TS 注解无运行时强制。`def f(xs: list): xs.append(1)` 若启用 → builtinTypeEffects["list"]["append"]="pure" → PURE；运行时传入自定义对象（impure append）→ **A6 S1 违反**。type-inference-design.md §10.1 F1/M3 既有裁决同此。**现状安全原因**：paramTypesOf 节点过滤 C# 形态（TS/Python 静默空——实证）。**门**：启用前必须加 `paramTypesEnforced: boolean`（C# true；TS/Python 默认 false）。TS 也非无条件安全（类型擦除 + 运行时鸭子类型；仅当项目过 tsc 严格检查且接受义务） | **不做（无门）**；带门可做 |
| R3 | 统一效应表 | 唯一假纯风险 = C3 标签坍缩（hof≡hofAlways）或 C4 遮蔽反转或 C5 默认标签 | C1-C6 保持下无风险 |
| R4 | 局部绑定 | 守卫放松（多赋值/未 declared/参数）→ 假纯 | 守卫内安全 |
| R5 | gameObject 数据化 | 白名单 + miss→UNKNOWN 保持则无增量；「全前缀 io」→ 过近似精度损失（S2 安全，iter33 fix-audit L42 已拒绝） | 白名单版安全 |
| R6 | extractor 行为 hook 化 | 纯重构，零风险 | — |

**结论**：统一/泛化后无固有近似增量。唯二假纯来源是 R2（A1 无门泛化）与 R4（守卫放松），均可由门/守卫**结构性关闭**。当前 305/305 + invariantViolations=0 = 方向安全基线，本评审未发现现存违反。

## 7. 三栏清单

### 【必须做】（正确性/方向安全前提）

现状**无违反项**（必须做列实质为空）。下列为**采纳对应「可做」项时的强制前提**（护栏，非当前缺陷）：

| # | 前提 | 触发条件 |
| --- | --- | --- |
| G1 | A1 泛化必须带 `paramTypesEnforced` 门（C# true；TS/Python false）；Python 永不无门启用 | 若做可做-8 |
| G2 | ctor 泛化必须保留项目类优先于 pureCtor（L546-556 顺序）；Array→io 防御分支可达性变化须显式评审 | 若做可做-5 |
| G3 | 统一效应表必须保持 C1-C6（matchMode/标签原子/通道序/遮蔽序/miss→UNKNOWN/hof 咨询面）；effectUsage + effectOverride 同步迁移 | 若做可做-4 |
| G3' | 统一效应表若不做，须以注释声明 8 张表为「通道分派语义」防未来误合并 | 若不做可做-4 |
| G4 | 局部绑定必须满足单赋值 ∧ declared ∧ ¬param ∧ kind=class | 若做可做-6 |
| G5 | 歧义并集边必须对所有候选建边（含跨文件 globalClasses 多命中）；不得退化为任选 | 若做可做-3 |

### 【可做】（无损简化，按价值序）

1. **gameObject 前缀数据化**（link L646-654 → pack 数据字段 `frameworkAttrPrefix`）：半硬编码收敛；白名单 miss→UNKNOWN 保持；位次（assigned 守卫之前）保留。**理由**：行为保持、方向安全（S4 回退不变）、达成「引擎零硬编码」的最后一处 link 特例。
2. **extractor 3 处 pack.name → 2-bit 数据**（`assignmentScopesLocals` / `bareNameMeansThisInMethod`）：行为保持重构（E 谓词逐点不变，仅标签 self.x vs x 由数据驱动）。**理由**：与 pack.ts「行为属语言包」设计意图对齐。
3. **歧义并集边**（Q4 命题 3，可叠加 arity 收窄命题 4）：可证安全（S1/S2/S3 全保持），UNKNOWN → 确定判定；需标注/文档配套。**理由**：判别力增益 + 可判定性不变。
4. **统一作用域效应表**（Q2）：C1-C6 下可证无损；结构性消除跨通道撞名（Join/GroupJoin 先例）。**理由**：schema 收益 > 行为收益；工程量大，非紧急。
5. **ctor 对称泛化到 TS**（R1）：方向安全，行为变化（new Date(): UNKNOWN→io）需评审；TS 现状语义等价。**理由**：统一生产侧形态。
6. **moduleBindingsOf 局部扩展**（Q3 守卫版）：方向安全；收益受语料驱动。**理由**：InitDeity 量级痛点，egg/swagger ≈0。
7. 低价值清理：`node:` 剥离归 resolveModule；cjsExportName 归行为 hook；bytes 前缀数据化。**理由**：行为保持，成本极低。
8. **A1 节点过滤数据化**（parameterNodeTypes 入 pack）：仅配合 G1 门启用 TS；Python 无门不启用。**理由**：提取侧形态收敛的前提工作。

### 【不做】（引入近似或过度抽象）

1. **同效应任选 / arity 定选**（Q4 命题 1/2）：link 期不可判定「同效应」（需传播闭包）；任选可假纯（S1 违反）。
2. **局部绑定守卫放松**（多赋值/未 declared/参数）：假纯（Q3 必要条件反例）。
3. **A1 无门启用 Python/TS**（R2）：假纯通道（F1/M3 既有裁决）。
4. **全类型层**（RT 跨函数传播、类层次闭包、字段类型、装饰器）：既有审计否决（type-inference-design.md §10：收益 0-3% + F1-F11 缺口）——本评审维持（局部绑定子集除外，见可做-6）。
5. **flattenCallTarget / receiverTypeOf 节点类型全数据化**：tree-sitter 家族成员节点形态已成事实标准，数据化 = 过度抽象，成本无收益。
6. **frameworkPure / gameObject 全前缀 io**：过近似精度损失（S2 安全但判别力毒化），iter33 既有裁决维持。
7. **单表线性化重排查找序**：C1 通道优先级是语义非风格；「重排即近似」。

## 8. 总评

「无特例语言无关」目标在**数据侧已达成**（12 张表 + 布尔参数全部通用机制）；残余 6 处引擎硬编码（1 处 link 前缀 + 3 处 extractor pack.name + 2 处小 tweak）全部可**行为保持**收敛。达成后引擎不包含任何语言常量，差异全经 pack 数据/行为接口注入。**唯一的假纯风险存在于未来泛化路径**（R2 A1 无门启用），由 G1 门结构性关闭。当前状态方向安全：305/305 + invariantViolations=0 + 本评审未发现现存违反。
