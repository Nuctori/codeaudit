# 迭代 42 数学评审：工程妥协的形式化解决候选（01-math-review）

> 评审者：范畴论/形式逻辑数学家视角。只读评审，未修改任何文件。
> 证据锚全部经源码核实（link.ts / extractor.ts / csharp.ts / analyze.ts / pack.ts / test/audit/fixture.test.ts）。

## 0. 前置事实核查（plan 的两处现状断言与仓库事实不符）

**F1 — plan 声称「fixture 存在但无断言（事件不建模）」：错误。**
`test/audit/fixture.test.ts:86-93` 有断言：`EventSubscribe.Wire` purity=2（IMPURE），注释明示「事件 += 修改事件字段 → state 写（extractor 裸标识符写判定——Wire IMPURE 语义正确）」。事件**部分被建模**：`+=` 经 `stateWritePos`（extractor.ts:474-514）+ `bareNameMeansThisInMethod`（csharp.ts）判为 state 写；触发端 `OnLevelChanged?.Invoke(level)` 经 `obj="OnLevelChanged"` 落 `markDynamic`（link.ts:1657-1658）→ `?`。

**F2 — B4/M1 的「假纯可能（订阅方判纯）」分类在当前机制下已不可达。**
- 订阅端：`evt += h` 是 state 写 → 订阅方法恒 IMPURE（或至少非 PURE）。`x.evt += h`（成员写）→ state。`evt.AddListener(h)` → markDynamic → `?`。
- 触发端：`evt?.Invoke()` / `evt.Invoke()` / 直接调用 `evt(args)`（C# 事件可像委托直接调用）全部落 `?`（obj 非 self/非 framework/非全局类/非效应表 → markDynamic）。
- 因此当前机制下**事件流不可能产生 PURE 误判**：订阅端被 state 通道（过近似）封死，触发端被 `?` 通道（诚实）封死。M1 的触发条件措辞「订阅方持有事件，事件触发执行 io 回调 → 订阅方判纯」在现实现下不可实例化。
- 结论：B4/M1 的真实残余是**安全-未知（触发端判别力损失）∪ 安全-过近似（订阅端 state 多报）**，方向分类应改标，不应留在「假纯可能」族。候选 1 的真实价值是**判别力**（`?` → 确定判定）与**效应归因**（handler 的 io 归属触发链），不是健全性闭合。这改变优先级论证：它是精度特性，不是 blocker 级修复。

这一事实翻转是下文候选 1 裁决的核心前提。

---

## 1. 候选 1（事件订阅：间接层 + 订阅边 + 触发边）

**裁决：修正后 do-now；按 plan 原样 do-later（两个 blocker 级洞，原样落地会引入新假纯）。**

### 1a. S2 方向论证（评审问题 (a)）

「可能执行 = 效应传播」的论证**只对类内 private 事件成立**，对非 private 事件不成立。形式化：

设事件 e 声明于类 C。模型语义：触发点 t 的效应闭包 ⊇ ∪_{h ∈ sub_runtime(t)} eff(h)。静态展开用 `sub_static(e)`（类内提取的全部订阅）。健全性条件：

> **订阅集合完备性引理**：sub_static(e) ⊇ sub_runtime(e) 对所有触发时刻成立。

- e 为 private（C# 语言保证：仅声明类可 `+=`/`-=`）→ 一切订阅点静态可见于 C 内 → 完备性由**提取形态完备**保证（见 1b）。
- e 非 private（public/internal）→ 类外代码可订阅 → sub_static 欠近似 → **触发端展开是下近似 = 假纯引入**。

**洞 1（不对称假纯）**：plan 对跨类订阅的处理是「`other.evt += h` → 落 `?`」——这保护了**订阅方**（该方法的闭包含 `?` → UNKNOWN，诚实），但**不保护触发方**：声明类 C 的 `Raise()` 展开 sub(e) 只含类内订阅者；若外部类订阅了 e，运行时 Raise 执行外部 handler 的 io，而静态闭包判 PURE → **建模引入的新假纯通道**。`?` 落在订阅点不会传导到事件节点，再传导到触发点——plan 未声明这条传播路径。

修正（与 H6 内建子类守卫、H4 多态守卫同族，一个「可见性守卫」）：

> **事件可见性守卫**：触发端展开 = sub_static(e) ∪ (e 非 private ? {?} : ∅)。即：非 private 事件（含 static 事件、非 sealed 类上的事件——实例逃逸不可见）的触发点附加 `?`，与订阅点对称诚实。private 事件（含 private static）免守卫——语言保证完备。

等价实现：事件声明节点携带 `externalSubscribable: boolean`，两通道共同消费。这也正是 M_out 应声明的内容：**「跨类订阅」残差必须同时写触发条件在触发端**，而非仅订阅端。

另注意 private 事件仍允许**跨实例**订阅（`x.evt += h`，x 为同类另一实例，C# 私有成员类内可见）——plan 的 v1 范围「仅 bare identifier」把这种形态排除到 `?` 之外，而它**在类内静态可见**。正确做法不是排除，而是收集：private 事件的完备集合 = 类内全部形态（bare / `this.` / `x.` 任意接收者）。若实现上只能收 bare 形态，则必须把「存在其他接收者形态的订阅」标记为集合不完整 → 触发端 `?`。两种选择都方向安全；plan 的「只收 bare」+「其他形态落 ?」**没有**同时标记触发端——这是洞 1 的具体实例化。

### 1b. 完备性：订阅/触发点形态枚举（评审问题 (b)）

**订阅点形态枚举**（plan 未给出，必须显式）：
1. `evt += h`（identifier 方法组）— 注意：现提取器 RHS identifier 因 `propertyReadSkipMorphs` 含 `assignment_expression`（csharp.ts:662）被排除，不产任何调用点——订阅边必须新增专门提取；
2. `evt += this.H` / `evt += x.H`（member_access 方法组）；
3. `evt += (…) => {…}`（lambda——现 lambda 已是 chunk（D-059），可建边）；
4. `evt += new Action<int>(H)`（构造 + 方法组实参——argFns 通道可复用）；
5. 其余 RHS（方法调用返回委托、cast、条件表达式）→ **未识别形态** → 事件节点「订阅集合不完整」→ 触发端 `?`（S4 无静默丢弃的推论）。

**触发点形态枚举**（plan 只列了两种，有洞）：
1. `evt.Invoke(...)`（obj = bare 事件名）；
2. `evt?.Invoke(...)`（conditional 解包已由 M5/178d6d4 支持）；
3. **`evt(...)` 直接调用**——C# 事件在声明类内可直接像委托一样调用（`OnLevelChanged(level)` 合法），当前落 `?`（implicitThis → resolveClassMember miss），plan 未列此形态；
4. `this.evt.Invoke()` / `x.evt.Invoke()`（跨实例触发，同类）。

任何触发形态未提取 → 触发端漏展开 → 假纯。故触发形态清单必须显式且与订阅集合共享同一个完备性守卫。

### 1c. 与 B5 属性 prop 边同构性（评审问题 (c)）

**机制同构成立，健全性论证不同构**。B5 = 属性 chunk（间接层）+ 读取点 prop 边（展开）；事件 = 事件节点（间接层）+ 订阅边 + 触发边。机制层面同构：均为「声明处汇聚 + 使用处建边 + miss 判纯」。但 B5 的判纯论证是 **C# 静态语义**（getter 体在 chunk 内必被解析；成员 miss = 字段/自动属性/不存在成员，无用户代码——无条件成立，link.ts 四通道 propMissIsPure）。事件的判纯论证是**订阅集合完备性**（1a 引理），依赖 private 语言保证 + 形态提取完备——不是静态语义，是运行时不变式。plan 的「与 B5 属性读取同构」引用会让人误以为 B5 的健全性论证可平移——**不能**，必须补可见性守卫。

### 1d. `-=` 时序与 UnityEvent 跨对象派发的 M_out 措辞（评审问题 (d)）

**`-=` 时序的形式化声明（建议入 M_out 措辞）**：

> 「订阅集合按 `+=` 静态并集计算（单调不减）。`-=` 不参与减法：并集只增不减，被注销 handler 的边是多余边（S2 过近似，方向安全）；「先注册后注销再触发」与「注册晚于触发」均只产生多余边。**真正的时间残差 = 动态 handler 表达式**（RHS 非 identifier/lambda/方法组形态，如 `evt += GetHandler()`）：此类订阅不可静态提取 → 订阅集合欠近似 → 触发端 `?`（已由 1b 守卫覆盖）。注册顺序本身对并集无影响。」

**UnityEvent 跨对象派发（建议措辞）**：

> 「UnityEvent 字段是委托列表对象而非 C# event：其 `Invoke` 可能由模型外代码执行（Unity 引擎/其他组件/Inspector 接线触发）。因此 UnityEvent 的派发执行**不属于任何项目内 chunk 的控制流**——handler io 无归属 chunk（模型外执行，与 M3 项目外写者同族），订阅方方法判纯/判 IMPURE 均不因此改变。触发条件：任何 `AddListener` 后由模型外调用 `Invoke`。与 C# event 的区别：C# event 触发点恒在类内（private 守卫可闭合）；UnityEvent 触发点可在模型外（无静态守卫可闭合，只能声明）。」

### 1e. 附加形式化义务（plan 未提）

- **`+=` 双重语义**：订阅边**不得取代 state 写**。`evt += h` 同时是 (i) 委托字段变异（state 效应，现机制正确）与 (ii) 注册义务（未来回调）。两者都必须保留。若实现只建订阅边而删 state 写，`Wire()` 从 IMPURE 翻为 PURE（在 handler 全纯、事件永不触发时）——**判定回归 + 违反现有测试断言**（fixture.test.ts:92 断言 purity=2）。plan 未提测试更新。
- **事件环**：fixture 自身 `HandleLevel → Raise → (触发边) → HandleLevel` 在建模后成为真 SCC。Tarjan 凝聚处理正确（analyze.ts:45），但：(i) `stats.cycles` +1（若测试/README 断言 cycles 数需同步）；(ii) SCC 内同 chain（公理2 分量级量）——触发链的链长被扁平化，`chain(Raise) == chain(HandleLevel)`；(iii) 事件环无限触发（Runtime 上 `Raise` 递归）在模型语义中就是环，边方向正确，无不动点问题。
- **双跑区间**：边与模式无关（audit/dev 只差 `?` 处理），事件边不影响双跑；唯一影响是 1a 守卫附加的 `?`——audit 进传播、dev 不进 → 区间加宽、chainCertain=false → 诚实（用户需标注）。
- 跨文件事件（partial 类）：v1 若只查本文件事件声明，partial 场景触发端不展开 → 保持 `?`（安全，判别力损失）——scope 声明需写明。

---

## 2. 候选 2（静态初始化器独立 chunk）

**裁决：do-now（带三项必须明确的实现义务与一项声称修正）。**

### 2a. 格语义

**干净**。C# 规范：静态字段初始化器 + 静态构造器体 = 类型加载事件（首次任何使用前执行一次）；实例字段初始化器 + 实例构造器 = 实例化事件。二者是模型里不同的两个事件，合并是过近似。独立 chunk `C::<static-init>` 是**节点细化**（标注单元细化），非 A7 原子集扩展——格不变、Λ 不变、无新效应原子。与 L5 的边界（实例字段初始化器仍归 class chunk）与 C# 规范精确对齐，语义无歧义。

### 2b. 「行为零变化」断言：对 effects 可证，对 chain 不可证——必须重述

**可证部分（effects/purity 不变）**，条件是下述实现义务之一正确落地（link.ts:978-997 L5 union 循环）：
- 义务 A：L5 的并集闭包循环对每个类额外 `addEdge(C::<static-init> key)`；或
- 义务 B：class chunk 的输出 calls 增加 `C::<static-init>` 边（new C() 经 class chunk 自然到达）。

**两个义务都不做** = new C() 闭包丢失静态初始化器效应 = **假纯回归**（S1 违反）。plan 只写「new C() 的并集闭包改含该 chunk」一句，未指明实现位置——这是实现级假纯风险，必须写死。

**不可证部分（chain）**：静态初始化器调用从「class chunk 内联」变为「class chunk → static-init chunk → callee」，凡最短路径穿过它的节点 chain **+1**。这不是回归而是**模型准确**（类型加载确是一个独立事件，S3：audit 链 ≤ 模型距离仍成立），但「行为零变化」字面为假：chain 值、公理5 排序（analyze.ts:179-186）、链区间、chainPath 都可能变。修正表述：**「effects/purity 不变（可证）；chain 至多 +1（模型准确）；排序与区间可能变化（可测）」**。

**可测性**：新测试断言 (i) 带静态初始化器 io 的类：`new C()` 调用方 IMPURE（前后一致）；(ii) `C::<static-init>` 单独标注 PURE 后 new C() 过近似解除（这是特性的存在理由）；(iii) 经静态初始化器路径的 chain 恰好 +1。

### 2c. 未提及的第三个义务：标注/语料 id 迁移

class chunk 的 normText 因静态初始化器文本移出而**变化** → 公理4 id 变化 → 既有标注（(file,id) 锚定）与语料条目失效（annotations 拒收/语料幂等重建——axioms 四·七.2 的「重扫时标注幂等重建」机制可恢复，但必须作为发布动作计划，否则标注静默丢失）。plan 未提。

### 2d. 与候选 7 的强制交互

候选 2 落地**必须**同时裁决静态成员访问路径（见 §7）：目前 `C.StaticMethod()` / `C.X`（prop 读）的闭包**不含**类型加载效应（class chunk 不在该路径上）。分割若保持该行为 = 保持预存假纯洞；若修复（静态方法 chunk 附加 static-init 边、静态字段读 miss+prop 前先查 static-init 存在性）则「行为零变化」范围要重述。二选一都必须显式决策，不能默认。

---

## 3. 候选 3（enum 读取判纯）

**裁决：do-now（实现表述需修正：双表，不只 classNodes）。**

**静态语义论证**（C# 语义成立）：enum 成员是编译期常量（无用户代码）；读取 `Color.Red` 不执行任何方法体。与 B5 propMissIsPure 同族论证，方向安全（miss 判纯只对常量形态）。判别力收益：`Color.Red` 从 `?`（markDynamic）→ PURE。

**实现修正**：plan 只写「enum_declaration 入 classNodes」——**不够**。核实：chunk 创建由 `chunkNodes` 驱动（extractor.ts:45-57，kind 取 `classNodes` 判定）；globalClasses 索引只收 `kind === "class"` 的 chunk（link.ts:175-183）。只加 classNodes 不产生任何 chunk → globalClasses 无 enum → 行为不变。**必须同时加入 chunkNodes 与 classNodes**。

**副作用核查（全部无害）**：(i) enum 无方法 → 方法归属/虚拟成员无影响；(ii) `new Color()` 是非法 C#，即使出现，L5 union 为 0 调用 + 隐式默认构造判纯分支（link.ts:998-1007）判 PURE——非法代码，可接受；(iii) enum 不可继承 → hasSubclass/多态机制无影响；(iv) **嵌套 enum（类内）仍 `?`**：globalClasses 按裸名索引（link.ts:177-181 bySimple），`A.B.X` 的 obj="A.B" 不命中 → markDynamic——安全（判别力损失），scope 需写明「仅顶层 enum」。

---

## 4. 候选 4（B13 接口清单）

**裁决：defer（同意 plan）。**

论证：knownInterfaceNames 是「base_list 单子歧义」的启发式精化（接口 vs 外部类），收益 = 类侧残余的静态分派精度。属数据表精度工作（与 B1 同类），非公理缺口；残余方向安全（over-approx）。边界原则（D-131：「维度进入最小语言 ⟺ 有真实读者 ∧ 未命中恒 UNKNOWN」）：无读者数据（B13 自述「类侧残余罕见」）→ defer。若落地，形式化要求：knownInterfaceNames 命中 → 该 base 视为接口（隐含 virtual 的判据排除）；未命中 → 保持现状守卫——严格白名单，漏条方向恒 over-approx 非假纯。

---

## 5. 候选 5（B2 效应细分 io-read/io-write）

**裁决：defer（同意 plan，且给出更锐利的理由）。**

论证：A7 原子集扩展**形式上是廉价的**（Effect 是字符串联合，types.ts:28）——但细分对判定零影响：判定格 Λ = {PURE < UNKNOWN < IMPURE}（A7）不变，任何效应（含细分后）→ IMPURE（types.ts:24 注释「任何效应（含 state）→ IMPURE」）。即 io-read/io-write 的区分**不改变任何 purity/chain 判定**，只改变 effects 报告集合。消费者核查：risk 五/六因子（impact/purity/cycle/depth/fog/state）不按 io 读/写细分；回归风险权重（D 矩阵）无 io-read/write 维度；标注通道不消费。**无消费者区分 = 细分是死数据（违反极小性）**。成本侧：70+ 效应表条目 + 全部语言包 + framework 表逐条重分类，纯人工数据债。边界原则直接否决：do-later 直到出现「读 io 与写 io 风险权重不同」的真实消费者（如：只读配置文件 vs 写数据库的 mock 成本差异被用户点名）。

---

## 6. 候选 6（开放世界 Σ_ext 参数化）

**裁决：defer（同意 plan 倾向，论证需更尖锐）。**

**关键观察：Σ_ext 假设在现机制下无行为语义——它无处挂接。** M2（外部子类）的现状：hasSubclass 只含项目内子类（link.ts:206-218）；多态守卫只对「项目内有子类」降 `?`（link.ts:862）。**外部子类不可见 = 不降级 = 现状就是「假设无外部覆写」的判定**。因此 CLI 声明「项目外无覆写」与现状**行为等价**——它不是「关闭过近似」，而是把文档化残余升级为条件承诺，而该承诺在现机制下**不可验证**（无检测外部存在性的通道）。M3/M4 同理（无机制可挂）。Σ_ext 落地 = 新增一个零消费者的 CLI 旗标 + 文档措辞——违反边界原则。

唯一有行为语义的挂接点在未来：(i) 若引入「全局 sealed」语义（声明无外部子类 → 解除 virtual 守卫的残余 ?）——但 virtual 守卫本来就只防项目内子类，外部子类从不在守卫内，故解除无对象；(ii) 若引入外部代码扫描（依赖闭包），Σ_ext 才有「声明 vs 实测」对拍价值。当前：defer，M2/M3/M4 维持 M_out 文档化。

---

## 7. 候选 7（被漏掉的一个——plan 应补）

**静态成员访问路径的类型加载效应漏报：预存假纯洞，且 B14 的方向分类错误。**

实证路径（源码核实）：`public static int X = ReadFile(); public static int Get() => X;` 调用方 `C.Get()` → globalClasses → resolveClassMember(C, "Get") → Get chunk（link.ts:1207-1236 全局类分支）→ Get 体内 `X` 裸名 prop 读 → implicitThis → resolveClassMember(C, "X") miss → propMissIsPure → **纯**（link.ts:1476-1491）。class chunk **不在该路径的闭包内**（class chunk 只经 ctor-merge 边被 new C() 路径到达，link.ts:439-448）。类型加载（首次使用 C 时执行静态初始化器）的 io **从未被归属**——只要项目不 `new C()` 而只调 `C.Get()`，整条调用链判 PURE，运行时执行 ReadFile → **S1 违反**。

- B14 在 technical-debt.md 的分类是「安全-过近似」——**该分类只对 new C() 路径成立；静态访问路径是漏报方向（假纯可能）**，B 表三值分类在此条目内部不一致。M_out 无对应条目（M_out 只列事件/外部/属性读取/enum）。
- 候选 2 的分割决策强制暴露此路径（§2d）：分割后静态初始化器效应从 class chunk 移走，静态访问路径若保持现状则洞维持；正确修复 = 静态方法 chunk 的调用闭包附加 `C::<static-init>` 边（类型加载先于方法体，模型距离 +1，S3 成立）+ 静态字段 prop 读在「类含 static-init chunk」时建边而非判纯。

**裁决：do-now（与候选 2 同批实施，作为候选 2 的组成义务；至少入 M_out 声明触发条件）。** 这是比 B4 更真实的假纯通道（B4 已被 state/? 意外闭合，此洞是活的）。

---

## 8. 评审问题清单逐条回答

1. **候选 1 的订阅/触发双通道完备性与 S2 论证**：S2 论证对类内 private 事件成立（完备性引理：private 语言保证 + 形态提取完备）；对非 private 事件**不成立**——触发端展开是下近似，plan 的「跨类订阅落 ?」只保护订阅方不保护触发方，是不对称洞，必须加可见性守卫（触发端附加 `?`）。跨类订阅落 `?` **不破坏 S4**（`?` 是 S4 解析闭包的合法成员，link.ts markUnknown 通道），但「存在跨类订阅」这一事实必须传导到事件节点/触发端，plan 未声明该传播。`-=` 时序：静态并集单调吸收，只产生多余边（S2 安全）；真正的残差是动态 handler 表达式（RHS 非静态形态），由形态守卫覆盖；M_out 措辞见 §1d。
2. **候选 2 的格语义与「行为零变化」**：格语义干净（静态 field init + static ctor = 类型加载事件，C# 规范精确对应；无新原子，A6 无破坏）。「行为零变化」对 effects/purity 可证（条件：L5 union 或 class chunk 边二选一正确实现，§2b 义务 A/B）；对 chain **不成立**（+1，模型准确）；可测（闭包断言 + chain +1 断言 + 标注解除断言）。标注 id 漂移（normText 变化 → 公理4 id 变化）必须计划。
3. **候选 3-6 裁决**：3 do-now（双表修正：chunkNodes + classNodes；scope = 顶层 enum）；4 defer（数据表精度，无读者）；5 defer（Λ 不变 → 零判定影响，无消费者区分 = 死数据，边界原则否决）；6 defer（Σ_ext 无机制挂接点，与现状行为等价，纯文档化）。
4. **第 7 个候选**：有——静态成员访问路径的类型加载效应漏报（`C.Get()`/`C.X` 判纯而类型加载执行静态初始化器 io），预存活假纯洞，B14 方向分类内部不一致（new C() 路径过近似、静态访问路径漏报），候选 2 必须连带裁决。另两个次要候选：事件字段初始化器订阅形态（`public event Action OnX = HandleX;`——value 位会产 prop 读，候选 1 的范围声明需覆盖）；`--state` 状态耦合图输出（D-127 已列，非本轮范畴）。

## 9. 收敛/内敛附注（本评审的极小性观察）

- plan 候选 1 的「残余（入 M_out 更新）」清单缺**触发端不对称**与**动态 handler 表达式**两项——补入后 M_out M1 的触发条件才算完整。
- B4/M1 方向分类过时是技术债文档的**声称-事实漂移**（technical-debt.md 三值分类对 B4 标「假纯可能」而实现已意外闭合）——修文档与修代码同价。
- 候选 2「行为零变化」是**过度声称**，收窄为「effects 不变 + chain 至多 +1」后才是可证声明。
- 候选 5 若被实现，按现状消费者核查即死数据——defer 理由写入决策链即可防复活。

## 证据锚

| 发现 | 锚 |
| --- | --- |
| fixture 有断言（plan 声称错误） | test/audit/fixture.test.ts:86-93 |
| `+=` → state 写 | extractor.ts:474-514 + csharp.ts bareNameMeansThisInMethod |
| RHS identifier 被 prop 排除 | csharp.ts propertyReadSkipMorphs:662-663 + extractor.ts:1242 |
| 触发端 `?`（Invoke 不解析） | link.ts:1657-1658 markDynamic |
| B5 prop 通道 | link.ts 分支 1/2/隐式 this/全局类 propMissIsPure（:1409-1425, :1476-1491, :1224-1236） |
| L5 union（候选 2 义务位置） | link.ts:978-997 |
| ctor-merge 边（class chunk 唯一到达路径） | link.ts:439-448 |
| 静态访问路径无 class chunk | link.ts:1207-1236（全局类 → 成员 chunk，无 class chunk 边） |
| globalClasses 只收 kind=class | link.ts:175-183 |
| chunk 创建由 chunkNodes 驱动 | extractor.ts:45-57 |
| 判定格 Λ 不变（候选 5） | types.ts:24-28 + A7 |
| hasSubclass 只含项目内（候选 6） | link.ts:206-218, :862 |

---

## 10. 裁决汇总

| 候选 | 裁决 | 一句话理由 |
| --- | --- | --- |
| 1 事件订阅 | **do-now（修正后）** | 判别力价值真实；原样设计有触发端不对称假纯 + `+=` 双重语义回归两个洞，必须补可见性守卫与形态守卫 |
| 2 静态初始化器 chunk | **do-now** | 格语义干净；「行为零变化」收窄为 effects 不变 + chain 至多 +1；L5 义务 A/B 必须写死；标注 id 迁移须计划 |
| 3 enum 判纯 | **do-now** | 静态语义成立；实现必须双表（chunkNodes + classNodes） |
| 4 接口清单 | **defer** | 数据表精度，无读者（边界原则） |
| 5 效应细分 | **defer** | Λ 不变 → 零判定影响；无消费者区分 = 死数据 |
| 6 Σ_ext | **defer** | 无机制挂接点，与现状行为等价，纯文档化 |
| 7 静态访问类型加载漏报 | **do-now（并入候选 2）** | 活假纯洞；B14 分类内部不一致，M_out 缺条目 |
