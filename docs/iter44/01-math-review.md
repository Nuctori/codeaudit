# 迭代44 数学评审（01-math-review）：工具不完备/数据债收口的极小性与收敛性

> 角色：范畴论/形式逻辑数学家评审。只读评审（未改任何仓库文件）。
> 审计基线核实：当前 HEAD = **696a255**（Iter-43 诊断修复 2），工作树仅 `docs/iter44/`、`scripts/tmp-field-probe.cjs`、`test/unit/tmp-field.test.ts` 未跟踪。测试实测 **368/368 通过**（33 文件 = 367 已提交 + 1 未跟踪探针测试），与计划声称「367/367」一致。
> 本轮新增一手实证：tree-sitter-c_sharp AST 探针（`global::`/`Foo<T>()`/枚举全限定形态/局部变量读），详见候选 3 与缺口核实节。

---

## 候选 1（主推）：局部变量 prop 读误伤——do-now，论证成立，但修复必须「早期短路」而非「豁免守卫进解析」

**机制复证**（代码级）：`assignmentTargets = ["assignment_expression", "variable_declarator"]`（csharp.ts L751）+ `assignedNames` 对 variable_declarator 的 `children[0]` fallback（extractor.ts L1621-1633，iter25 修复）→ C# 局部声明名**确实入 assigned**。裸名读 `status_` 经 isPropertyRead（identifier 父=binary_expression，不在 SkipMorphs/SkipParents）→ `propertyReadOf` 产 `obj=null attr=status_ prop=true` → resolveCall 分支 2（link.ts L1511）守卫 `!caller.assigned.includes(attr)` 失败 → **整段跳过**（含 implicitThis 的 prop-miss 判纯逃逸 L1555-1568）→ 分支 4 pureBuiltins 再被同款守卫（L1688-1691）挡 → `?`。计划对机制的描述准确。

### (a) 读取局部变量恒纯的形式化论证——与参数读取同族，先例即证明

- 设 chunk C 内裸标识符读 `x`，且 `x ∈ assigned(C)`。C# 作用域规则：裸名解析 = 最近包围声明；assigned(C) 收集 C 子树内赋值目标（variable_declarator/assignment_expression）与参数——**对方法 chunk 而言全部是存储位置（binding slots）**。读取存储位置 = 内存加载，C# 语言规范下不执行任何用户代码（无 getter、无拦截器；volatile 只约束可见性语义，不产生用户代码执行）。
- **参数读取先例**：extractor.ts L92-100 已在提取侧直接跳过参数名裸读，注释明言「assigned 含参数，裸名分支会被遮蔽守卫误挡成 ?——参数读取纯是静态事实，不需要解析」。该注释承认的正是候选 1 的病症（遮蔽守卫把纯读误挡成 ?），且已确立「纯是静态事实、不需要解析」的裁决。候选 1 是把同一论证从 params 推广到 assigned 全集：两个集合的元素在谓词 P(读取无副作用) 下不可区分（都是绑定槽），先例的合理性自动传递。✓
- 需区分的子情况：assigned 对**类 chunk** 含字段名（field_declaration → variable_declarator）。字段读取同为内存加载（字段无 getter；**属性名不入 assigned**——property_declaration 无 variable_declarator 子节点，探针实证 AST 形态），故 getter 路径不受影响；属性带 getter 的裸读（如 `if (Status == 200)`）名不在 assigned → 走既有解析 → 属性 chunk 边 ✓ 不受损。
- 遮蔽**事件**的裸名读：方法 chunk 内事件名不在 assigned → 走 miss 路径判纯（已有）✓；类级读事件名（读委托引用）→ 判纯 ✓；`evt += h` 是写形态（SkipMorphs 排除 + stateWritePos 通道），不在本候选面内 ✓。

### (b) 豁免面完备性——全分支枚举

| 路径 | assigned 守卫 | prop 读 | 裁决 |
| --- | --- | --- | --- |
| 分支 2 裸名（L1511） | 有 | 有（被误伤） | **修复点** |
| 分支 4 pureBuiltins（L1688） | 有（+moduleAssigned） | 有（被误伤，同因） | 分支 2 早期短路后对 assigned 名不可达 |
| effectFromGlobal（L1340，obj!=null） | 有 | 对象成员读 `x.foo` | **不豁免**——局部对象类型未知，`.foo` 可能是 getter，`?` 信息论正确 |
| frameworkIo/frameworkPure（L1601）、frameworkAttrPrefix（L1577）、class: 接收者（L1416）、self 分支（L1460） | 有 | 同上 | **不豁免** |
| moduleAssigned 独有路径（TS/JS 模块级变量裸读） | moduleAssigned | 有 | 同论证，但 InitDeity 为 C# 驱动（C# 无文件级裸变量）→ **本轮不做**，记后续（数据驱动决定） |

结论：豁免面完备 = 仅分支 2 的 `obj===null ∧ prop ∧ attr∈assigned`。其余路径的 `?` 是信息论正确的擦除（对象成员读无类型信息不可判纯），不得动。

### (c) 不引入新假纯通道——但有一个实现陷阱（修正）

- 假纯需要「读执行用户代码」；存储位置读不执行代码（(a) 论证）→ 判纯本身无假纯通道。✓
- **陷阱**：若实现为「豁免守卫、进入分支 2 解析」（而非短路判纯），局部名 `foo` 遮蔽文件内顶层同名定义时 bySimple 命中 → 假边 → 假 IMPURE（方向安全但精度回归，且与遮蔽语义矛盾）。
- **修正（锚定）**：修复必须是分支 2 顶部、bySimple/implicitThis **之前**的早期短路：

```ts
// 裸名 prop 读 + 遮蔽名：读取存储位置恒纯（与参数读取同族，extractor L92-100 先例）。
// 必须在 bySimple/implicitThis 之前短路——遮蔽语义下读的就是局部，无需解析（防顶层同名假边）。
if (call.obj === null && call.prop && caller.assigned.includes(call.attr)) return;
```

与参数先例一致（「不需要解析」），且零语言常量（TS/Python 绑定读同构成立，无需 pack 标志）。

### (d) 与 iter41 阴影守卫的语义边界

- iter41 修复对象 = **调用形态**（`const Math = evil(); Math.Round(x)`，obj="Math"、prop=false，守卫在 L1340/L1416）。候选 1 不触碰 obj!=null、不触碰 prop=false。
- 裸名调用 `var act = ()=>{io()}; act();` → prop=false → 守卫不变 → `?` ✓。
- 形式化边界：豁免谓词 = `(obj===null) ∧ prop ∧ attr∈assigned(Caller)`，三条件缺一不可。iter41 的证明义务（遮蔽后调用不得判纯）完全保留。✓

---

## 候选 2：System 枚举判纯——A do-now（并入 B1），B 否决（危险泛化成立）

- **B 的否决论证成立**：工具无类型系统，「枚举读取」不可识别。B 若实现为「未知 obj 的成员读判纯」= propMissIsPure 泛化到未解析对象——`propMissIsPure` 现有的健全性前提是「类已解析 = 工具见过整个类体 → 无 getter」；未知 obj（插件类/项目外类）无此前提，`EvilPlugin.Thing`（静态 getter）→ 假纯。B 结构性违反 A7，否决。✓
- **A 的边界裁决：类型名白名单（入 pureGlobals），而非命名空间前缀规则**：
  1. 形态实证：`StringComparison.Ordinal` → obj="StringComparison"（裸首段）——正是 pureGlobals 的形状（obj 名集合），零新机制。
  2. 前缀规则需要同样的类型知识（哪些 System 类型是枚举——仍是名单），却把匹配面扩大到全限定形态（obj="System"）。该形态 iter30 已裁决过：frameworkPure 的 System-10 是**逐类型严格白名单**（Uri/Linq/Convert/Enum/Text/Array/Math/TimeSpan/Guid/Collections），StringComparison 当时明确未入。在 frameworkPure 加子键 = 扩展 iter30 已接受的先占风险类；在 pureGlobals 加条目 = **无先占**（resolveObjDispatch 序：globalClasses 项目类优先 L1249-1262 → effectFromGlobal 只在项目类未命中时到达）。
  3. 遮蔽安全双保险：项目类同名 → globalClasses 先挡 ✓；`var StringComparison = evil()` → L1340 守卫 `!caller.assigned && !moduleAssigned` → `?` ✓（iter41 机制免费保护 A）。残余风险仅「插件类同名 + 静态 getter」——与 Math/String/Convert 既有条目的暴露面完全相同（表语义既有风险类，override 可修正），可接受。
- **条目范围（最小性）**：只加语料实证的枚举名——StringComparison（86/单文件）、TaskStatus（1187）、BindingFlags（570）、AttributeTargets；不预测性扩表。TaskStatus 与 impureGlobals.Task（"clock"）不同键，无冲突 ✓。枚举成员是编译期常量（C# 规范），判纯在规范意义上也正确。
- **边界声明**：全限定形态（`System.StringComparison.Ordinal` → obj="System"，探针实证存在）不在 A 覆盖内 → 维持 `?` → 落 missTable(global:System) → 进候选 4 的 top-N（若频次高，按 iter30 形状补 frameworkPure System 子键，那是数据裁决不是本轮承诺）。
- **与 B1 合并：合理**。两者同是 Σ 数据表校准、同一记账通道（missTable/--table-usage missSlots）产出候选、同审查流程；合并后 pureGlobals 增 ~4-6 键 + 注释「System 枚举——枚举成员是编译期常量」。

---

## 候选 3：`<unresolved>`——do-now（已定位，2 个可解析漏网形态实证，修复 3 行级）

- **设计内形态确认**：flattenCallTarget（extractor.ts L1756-1816）返回 null 的形态 = 白名单（identifier/property_identifier/this/type_identifier/predefined_type/member_access/conditional_access）之外的一切：调用之调用 `factory()()`、下标调用 `d[k]()` 等 → sentinel `UNRESOLVED_TARGET="<unresolved>"`（pack.ts L15）→ `?`。missTable 已排除 `<unresolved>`（link.ts L1699）→ 记账不污染 ✓。这些形态是设计诚实的（不可拍平 ≠ 可判），维持。
- **漏网形态 1（本轮探针实证）**：`Foo<int>(1)` → invocation function 字段 = `generic_name` → flattenCallTarget 无 generic_name 分支 → `<unresolved>`。但 ctorTypeName（L1836-1841）已示范 generic_name 剥壳（name 字段）——同一剥壳可复用于 flatten。**可解析漏网**。
- **漏网形态 2（本轮探针实证）**：`global::System.IO.File.ReadAllText(...)` → member_access 链底 obj = `alias_qualified_name[global::System]` → flatten 返回 null → `<unresolved>`。alias_qualified_name 节点存在性已由审计缺口（global_keyword 死条目）同源实证——这是 000c0f8/696a255 修复 prop 通道后的**调用通道同族残留**。可解析（剥 global:: 前缀取内层 → "System.IO.File.ReadAllText" → obj="System" → 进 frameworkPure/missTable 分类通道）。
- **裁决**：本轮做。成本 ≈ 2 节点类型 × 3 行（generic_name → name 子节点；alias_qualified_name → 递归 flatten 内层，复用既有 typeNameNodes 数据表）；收益 = 7.9% 站点中可分类部分从盲区进入解析/missTable 通道，直接为候选 4 供数。
- **修正（实施前置）**：跑 10 分钟探针统计 InitDeity `<unresolved>` 调用点的 function 节点类型分布，确认两形态份额；若合计 <5% 可降级延后（数据驱动）。测试：+1 回归（两形态不再产 `<unresolved>`，或至少分类到 missTable）。

---

## 候选 4：top-N 补表——do-now（数据工作，N=100，双端测量）

- **数学视角**：Σ 表扩展 vs 标注替代 = 成本曲线交点问题。表条目成本 ≈ 1 行数据 + 审查（一次性），覆盖 N 站点；标注成本 ≈ 每 chunk 1-2 分钟人工。高频名表胜、长尾标注胜——决策变量是**频次**，机制已存在（missTable/--table-usage missSlots 按槽位计数，iter30 实证），本轮是数据工作不是机制工作 ✓。
- **可静态判定比例的估计方法（可执行）**：
  1. 下界 = Σ(top-N 中分类为表可修（纯类/枚举/已知效应）的站点频次) / 113529；
  2. 上界 = obj ∉ globalClasses 且非 `<unresolved>` 的 miss 站点 / 113529（表可寻址宇宙）；
  3. 帕累托经验：top-100 名通常覆盖 60-80% 站点——实测下界 ≥50% 即主通道收敛，尾部分配标注工作流。
- **修正 1（关键，测量口径）**：收益必须按 **chunk 级**报告——θ/unknown-rate 是 chunk 级指标（UNKNOWN chunks/总 chunks），站点级 113529 只是线索。实施后复扫报告 UNKNOWN chunks 7063 → ?（与候选 1 同口径）。
- **修正 2（双向数据债）**：163 条目中 80 条 InitDeity 未命中——**不自动删**（条目合理性 = 世界知识（SqlConnection/MongoDB 等 .NET API），非语料命中）；top-N 审查时顺带标注「条目依据 = 语料/世界知识」双注记，防未来误删误加。
- **N 裁决**：100（top-100 名），与候选 2 枚举白名单同批审查；覆盖 <50% 停，长尾走标注。

---

## 候选 5：类型流建模——defer（维持），但补一个非流分析子切片的探针

- **维持论证成立**：29.7% = 局部变量接收者（`response_.X`），需跨 chunk 返回类型推断 = 新机制族（数据流分析），F 因子膨胀 + A6/A7 健全性义务（跨文件类型精度、泛型、重载、partial）——成本 >> 当前可量化收益（且 chunk 级收益未测）。
- 廉价切片已被覆盖：A1 参数显式类型（iter35）+ lb 局部单赋值构造绑定（iter37 P1-2）吃掉两个便宜切片。
- **被漏掉的相邻项**：**声明位显式类型绑定**——`ObjectResponseResult response_ = GetThing(); response_.StatusCode`：类型就在声明里，同文件，无跨 chunk 流；C# 静态类型下声明类型即编译期静态类型，读取经既有 polymorphic 机制（hasSubclass/virtualMembers）解析——**复用既有健全性机制，不新增机制族**，与 P1-2 同级。裁决：候选 5 整体维持 defer；「声明位类型绑定」作为候选 6 探针项（见下）——若 InitDeity 的 29.7% 接收者多为显式类型声明（非 var），它是一个廉价传递函数；若多为 var → 维持 defer 无争议。本轮只探针，决策数据留给 03-synthesis。

---

## 候选 6（被漏掉的）——有，两个半

1. **声明位显式类型绑定**（如上）：同文件句法绑定，非流分析，复用 polymorphic 健全性机制。**探针先行**。
2. **`<unresolved>` 的 generic_name / alias_qualified_name 漏网**：已并入候选 3 的修复范围。
3. 半：**测量口径修正**——候选 1/4 的收益必须按 chunk 级报告（θ 是 chunk 级；92121 站点 ≠ 7063 未知 chunk 的 53%）。非机制，但决定收敛判定不被站点级数字误导。

计划提示三项核查结论：

- **chain=0 计数噪音**：proof.ts L59 明示「初值 = 全量累计 weight（含 deps=0 的 UNKNOWN，与 θ 口径一致）」——deps=0（无消费者）UNKNOWN 计入 θ 分母是**已记录决策**，非缺陷：未知叶仍是未证明代码，标注它仍花钱。候选 1 翻的生成代码叶 chunk 恰是此口径最大受益者。维持，无新机制。
- **selfNames**：无缺口。C# base ∈ selfNames（csharp.ts L750），`base.X` 走分支 1 多态解析；`base` 为保留字不可被局部遮蔽。✓
- **module 伪 chunk 的 ? 传导**：无传导——`<module>` 是容器叶（公理 1），无出边，自身判定只计 1 chunk 的 θ，不污染类 chunk。iter43 后 C# module chunk 噪音源（attribute/using）已排除。✓

---

## 评审问题清单逐条回答

1. **守卫收窄是否引入假纯？** 不引入。(a) 存储位置读取无用户代码（C# 规范级事实，与参数读取同族——extractor L92-100 先例直接支撑）；(b) 字段读同族（无 getter）；(c) 事件名读 = 委托引用读，纯；`evt += h` 是写形态不在此列；(d) 属性 getter 名不入 assigned（property_declaration 无 variable_declarator 子节点，探针实证）→ getter 解析路径不受损。豁免面完备性：唯一豁免面 = 分支 2 裸名 prop 读；obj!=null 成员读（局部对象 `.foo` 可能是 getter）与调用形态必须维持 `?`。实现须为早期短路（bySimple 之前），防局部遮蔽顶层同名造成假边。
2. **A vs B**：B 否决（无类型系统下「枚举读取」不可识别；泛化 = 未知 obj 成员读判纯 = 插件 getter 假纯，结构违反 A7）。A 采纳，边界 = **类型名白名单入 pureGlobals**（非命名空间前缀——前缀规则需同样类型知识但扩大匹配面且先占项目类；iter30 System-10 已示范正确形状是逐类型严格白名单）。项目类优先（L1249）+ assigned/moduleAssigned 守卫（L1340）双保险；仅加语料实证条目。**与 B1 合并合理**：同记账通道、同审查流程。
3. **`<unresolved>` 定位成本**：已定位（探针实证 2 个漏网形态）→ 修（~3 行 + 1 回归测试）；残余不可拍平形态设计内诚实维持。前置探针确认份额（<5% 可降级）。
4. **top-N 规模**：N=100 本轮做；下界估计 = top-100 分类站点和/113529；复扫报 chunk 级 delta；覆盖 <50% 停。
5. **类型流最终裁决**：defer 维持；补声明位显式类型绑定探针（非流分析，P1-2 同级），数据驱动。
6. **第 6 个候选**：有（声明位显式类型绑定 = 探针项；`<unresolved>` 漏网形态已并入候选 3；测量口径修正）。计划提示的 chain=0/selfNames/module 伪 chunk 三项核查无机制缺口。

---

## 审计缺口核实：global_keyword 死条目——缺口成立，且已在 HEAD 修复

- **缺口成立**（审计基线 7877021 属实）：000c0f8 声称的「global_keyword 排除」未生效——tree-sitter-c_sharp 中 `global::` 的真实节点是 `alias_qualified_name`，不存在 `global_keyword` 节点类型；488 个 (null)|global 未知点残留。
- **已修复**：HEAD = 696a255「Iter-43 诊断修复 2：alias_qualified_name 排除（审计实证 global_keyword 死条目）」，diff = propertyReadSkipParents `global_keyword` → `alias_qualified_name`（csharp.ts L681-682 现状核实）。提交实证：InitDeity 重扫 (null)|global 488→0、unknown 7291→7063（25.2%）、61/61 csharp 测试。
- **本轮独立复证**（探针）：`typeof(global::System.Text.Json.JsonConverter)` AST = qualified_name → alias_qualified_name[global::System] → identifier[global]——`global_keyword` 确实不出现，修复方向正确。全量套件本轮实测 368/368 绿。
- **结论**：无需代码修复（已闭环）。可选文档债：000c0f8 提交信息中的 global_keyword 表述勘误。残余风险：propertyReadSkipParents 其余条目未与 c_sharp grammar 全量对拍（global_keyword 同类死条目的系统性排查建议作为实施轮小任务）。

---

## 收敛/内敛状态与未收敛点

- **收敛趋势**：unknown-rate 43.2%（iter43 回归峰）→ 26.0%（000c0f8）→ 25.2%（696a255）——单调下降无反弹；cycles 11→3；测试 367→368 全绿。**停止准则核查**（math-loop.md L35：连续两迭代降幅 <1pp 且清单缩减 <10 且无正确性 bug → 停新特性）：26.0→25.2 = 0.8pp，为第一次 <1pp——**iter44 若再 <1pp 即触发准则**。本轮工作性质 = 数据/判别力收口（非新特性），且候选 1/3 属精度正确性修复、候选 2B 是正确性风险否决——与准则精神一致；iter44 后应正式评估触发停止并转入标注工作流。
- **内敛**：决策链 D-134~D-143 与代码一一对应（阴影守卫/枚举判纯/事件订阅/static-init/attribute 排除均有提交锚）；theta 口径（deps=0 计入）与 UNRESOLVED/missTable 记账不变量（scan.ts L272）均已文档化且保持。
- **未收敛点（锚定）**：
  1. link.ts **L1511** 分支 2 守卫——裸名 prop 读 + assigned → `?`（候选 1，92121 站点面）；
  2. extractor.ts **L1756** flattenCallTarget 无 generic_name/alias_qualified_name 分支 → `<unresolved>`（候选 3，13575 站点面）；
  3. link.ts **L1340** effectFromGlobal pureGlobals 缺枚举名（候选 2，StringComparison/TaskStatus/BindingFlags 站点面）；
  4. 全限定 `System.*` 枚举形态（obj="System"）→ 候选 4 top-N 数据裁决；
  5. 声明位显式类型绑定 → 探针项（候选 6）。
- **最小性发现**：未发现新死字段/死表条目；tmp-field.test.ts 形态弱（`expect(true).toBe(true)`，仅打印）——实施时升级为断言式回归（候选 1 验收：局部读不产 unknownCalls + 遮蔽调用仍 `?`）。

## 残余风险

- propertyReadSkipParents 未与 tree-sitter-c_sharp 节点集全量对拍（global_keyword 同类死条目系统性排查未做）。
- InitDeity 复扫未由评审独立重跑（只读；证据 = 提交实证 + 代码现状 + AST 探针）。
- 候选 1/4 的 chunk 级收益未测量（计划缺失，已列为实施验收口径）。
