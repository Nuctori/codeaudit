# 迭代37 综合裁决与「无特例语言无关」可执行改造清单（03-synthesis）

迭代37 · 综合两份评审（01-math-review 数学家 / 02-jeff-review 工程极简）· 只读综合。
基线复核（本文件作者实测）：`npx vitest run` → 29 files / **305 passed**（7.4s）；工作树无跟踪改动（仅 untracked `docs/iter37/02-jeff-review.md`）。
联合裁决原则：**数学健全性优先**（任一方证明假纯风险 → 不做或加门）、**工程成本第二**（双方都安全时取工程裁决）、**价值驱动**（D-037 精神：无真实读者的维度不加入）。

---

## 1. 议题 0（用户新增）：命题判定——「LangPack 本质 = 最小语言的前端映射」

**命题**：codeaudit 的「最小语言」= 统一抽象 {chunk, call, import, effect(7 原子), purity(3 值), chain} + 单不变式（S4 解析闭包）；LangPack 是该最小语言的「编译前端」——把各语言语法/语义降级投影（有损投影，非语义保持翻译——只保留调用图+效应维度）到这个最小语言。

### 1.1 判定：**成立**（附两条边界限定）

论证四步：

1. **最小语言存在且已是引擎唯一解释对象**。引擎决策函数 F(pack, call, ctx) 对 pack 的所有取值执行同一算法（数学评审 §1 判据：差异是参数注入非控制流分流）。最小语言元素全部有实现对应：RawChunk/RawCall/RawImport（pack.ts L18-82）、效应原子 Σ₇ = {io, net, fs, db, random, clock, state}（effectOverride.ts L40）、纯度格 Λ₃ = {PURE < UNKNOWN < IMPURE}（A7）、chain = 最短路径距离（A3）。单不变式 = S4 解析闭包（axioms.md A6：每条调用点 → 边/效应/⊥，无静默丢弃分支）——即 D-012「单不变式最小模型」。
2. **LangPack 字段 = 三类映射，正好构成前端**。(a) AST 形态映射：chunkNodes/callNodes/classNodes/nestingNodes/selfNames/assignmentTargets/literalReceivers 把 tree-sitter 具体语法投影为 {chunk, call} 抽象形态（语法降级）；(b) 符号→效应映射：12 张效应表把目标语言名字宇宙投影为 Σ₇ ∪ {pure, hof}（词典降级）；(c) 名字解析行为映射：extractImports/resolveModule/implicitThis（+ 残余 3 处 pack.name 分支，extractor L425/L432/L487）实现 ρ_L——名字解析关系是语言语义函数，不可由有限表枚举（pack.ts L10-12 设计声明「名字解析是行为不是数据」），故前端含行为钩子。
3. **有损性实证**：type-inference-design §10.2 (e)——91% 的 `?` 任何类型层救不了（投影丢弃的类型维度）；D-014 的第二抽象格 L_T 全类型层被 §10 收益审计否决（回收 ≈0-3% chunk），仅 paramTypes 数据子集存活；D-037 否决 state 原子（初版）/加权链/谱诊断 λ₂/注解账本——维度拒绝史。投影保留面 = 调用图（边）+ 效应（Σ₇）+ **有真实读者的观察面**（见 1.2 读者实证表）。
4. **有损而不漏，由 S4 保证**：投影丢弃的知识以 UNKNOWN 呈现而非错判（A7：`?` 是知识标记非效应，参与传播）；「宁 UNKNOWN 不 PURE」即投影的方向安全契约。两篇评审独立确认当前基线方向安全（305/305 + invariantViolations=0 + 未发现现存违反）。

**边界限定（不推翻命题，精确定义它）**：

- 限定 1：「最小语言」是**语义核心**（引擎数据模型 + 决策函数），不是文本 DSL——无独立语法、无解析器、无 IR 生成环节。命题在结构表征意义上成立（映射/前端角色），不在「存在一种 DSL 语言」意义上成立。
- 限定 2：「编译前端」= **数据表 + 行为钩子**，不是纯数据前端。名字解析保持行为侧（pack.ts L10-12），与数学评审 §1「行为侧语言专属是抽象边界，不是待消灭的特例」一致。

### 1.2 「最小语言」边界原则（一句可检验原则）

读者实证（保留侧）与拒绝史（D-037/§10.2）：

| 观察维度 | 真实读者（src/ 实证） | 裁决 |
| --- | --- | --- |
| stateWrites | link.ts L303 `direct.add("state")` | 保留 |
| stateReads | core/state.ts L33-36（state 效应计算） | 保留 |
| thrownTypes / catches | core/analyze.ts L83-88、L130-135（`throwsTypes = thrown − coveredBy(catches)`） | 保留 |
| chainPath | cli.ts L394-395（传染链诊断输出） | 保留 |
| 加权链（D-037） | 无独立读者（读者 = 链度量自身，循环论证） | 拒绝 |
| 谱诊断 λ₂（D-037） | 无动作语义（数字无判定/输出消费） | 拒绝 |
| 注解账本（D-037） | 无动作绑定（廉价版 TS 计数无消费方） | 拒绝 |
| 全类型层 L_T（D-014/§10.2） | 收益 0-3% chunk + F1-F11 假纯缺口 | 拒绝（paramTypes 数据子集除外） |

**原则（可检验）**：
> 观察维度 d 进入最小语言 ⟺ d 存在至少一个真实读者（src/ 中消费 d 的判定/传播/诊断/输出逻辑）**且** d 的未命中方向恒 UNKNOWN；无读者的维度一律拒绝——不因跨语言对称性、完备性幻觉或假设性收益加入（判例：D-037 加权链/λ₂/注解账本、§10.2 全类型层；唯一例外通道 = 用户显式需求创建读者，如 state 原子 2026-08-11 用户覆盖）。

检验方式：对任一候选维度枚举消费者 C(d)；C(d)=∅ → 不入模型；C(d) 存在但未命中不落 UNKNOWN → 修回退。

### 1.3 对「无特例语言无关」目标的形式化影响

目标形态 = **E/Φ 分解**：

```
E（引擎）= 解释器(M)，M = 最小语言模型 {RawChunk, RawCall, RawImport, Σ₇, Λ₃, chain}
           且 E 源码无语言名/语言构造字符串字面量参与控制流（零语言知识）
Φ（pack）= 前端 Φ_L: (L 语法 × L 语义) → M，数据表 + 行为钩子，全量消化语言差异
单不变式：S4 解析闭包（Φ 的有损投影不漏 → 漏变 UNKNOWN）
```

**该形态是两份评审结论的自然推论（且就是它们各自目标态的同一结构）**：

1. 数学评审 §1：「无特例语言无关」的可达成形态 = 引擎零硬编码语言常量；差异全部经 pack 数据字段或 pack 行为方法注入。§2.1：12 张表 + 布尔参数**全部已是通用机制**（数据侧已达成）。§2.2：残余 6 处引擎硬编码**全部可行为保持收敛**。
2. Jeff 评审 §1：目标态 = c（保留字段、确保语义通用——即 E 是唯一解释器）+ b 切片（只消除 link.ts 语言特例分支——即完成 E 的零常量）；a（统一 schema）被否决——即不改变 Φ 的通道结构。
3. 推论链：(i) 数据侧已通用 ⟹ E 已无语言指纹控制流，仅残余 6 处字符串/分支；(ii) 6 处全部行为保持可收敛 ⟹ E 零语言常量**可达**（P0 项即最后一步）；(iii) 名字解析不可枚举 ⟹ Φ 必须含行为钩子 ⟹ 「pack 全量消化」= 数据+行为，非纯数据；(iv) S4 是 Φ 的健全性契约（有损投影方向安全）⟹ 形态完成即目标达成，且达成后**不得再动抽象边界**（Jeff §5-3：pack.ts 头注释就是正确边界）。

---

## 2. 交叉验证：共识与分歧裁决

### 2.1 共识项（直接采纳）

| # | 共识 | 依据 |
| --- | --- | --- |
| C1 | 任务点名的四项（frameworkPure/pureCtor/paramTypes/implicitThis）全部是「通用机制 + 语言数据」，机制已在 link.ts 通用化，**无一需要引擎改造** | 数学 §2.1 逐字段表 + Jeff §1-c |
| C2 | link.ts L646-654 `X.gameObject.*` 是引擎唯一直正硬编码前缀 → 数据化（P0） | 数学 §2.2 + Jeff §1-b（两份独立确认同一处） |
| C3 | extractor 3 处 `pack.name`（L425/L432/L487）是行为特例 → 2-bit 数据化，行为保持 | 数学 §2.2 + Jeff §1-c（实测 grep 确认 3 处，L104 仅记账非分流） |
| C4 | A1 无门泛化到 TS/Python = **唯一假纯通道**（注解无运行时强制）→ 不做 | 数学 R2 + Jeff e1（`def f(xs: list): xs.append(1)` 反例） |
| C5 | 重载消歧：任选/arity 定选 = 假纯风险，**禁止**；并集边 = 唯一通用安全启发式（S1/S2/S3 可证保持） | 数学 §5 命题 1-4 + Jeff d |
| C6 | 局部绑定守卫 = 单赋值 ∧ declared ∧ ¬param ∧ kind=class；放松守卫 = 假纯 | 数学 §4.2（必要条件反例）+ Jeff c |
| C7 | ctor 泛化到 TS 方向安全（无假纯，io 过近似 S2 安全）但非必须；必须保留「项目类优先于 pureCtor」红线（link L546-556） | 数学 R1 + Jeff e2 |
| C8 | frameworkPure 已是通用机制（两级匹配通用），「并入通用结构」无独立价值 | 数学 §2.1 + Jeff f |
| C9 | 统一效应表在 C1-C6 保持下可证无损（数学），但零行为收益（双方） | 数学 §3.4 + Jeff §1-a |
| C10 | 现状方向安全基线：305/305 + invariantViolations=0 + 无现存违反（双方独立复核） | 数学 §0/§8 + Jeff §6 |

### 2.2 分歧项（联合裁决：数学健全性优先，工程成本第二）

| 分歧 | 数学评审 | Jeff 评审 | 联合裁决 | 裁决理由 |
| --- | --- | --- | --- | --- |
| D1 统一效应表（12→1） | 可做（无损简化），**非必须做**；若做必须 C1-C6 + effectUsage/effectOverride 同步迁移（G3）；不做须注释护栏（G3'） | **不做**——教科书级过度抽象：零行为收益、全量回归（effectOverride 用户 API 是契约）、唯一假纯向量（hof≡hofAlways 标签坍缩，A6 S1 违反） | **不做**（P2-1）；采纳 G3' 注释护栏（P2-5） | 数学自身裁定「非必须做」+ Jeff 成本裁决 + D-037 价值驱动原则（schema 收益 ≠ 用户收益）；C3 标签坍缩是数学评审指出的唯一假纯统一失误，排除它即排除该路径 |
| D2 A1 节点过滤数据化（parameterNodeTypes） | 可做-8：提取侧形态收敛的前提工作，仅配合 G1 门启用 TS，Python 无门不启用 | **不做**：无启用门则数据无意义，「加门加数据 = 为对称而对称」 | **不做**（P2-2） | 议题 0 边界原则直接裁决：无启用门 = 无真实读者 = 维度拒绝（1.2）；重开条件 = TS 重度语料 + 接受 tsc 严格检查义务（届时门与数据一起启用） |
| D3 局部绑定优先级 | 可做不做亦可（egg/swagger 语料 ≈0，YAGNI） | 延后独立轮次（API.g.cs 30.5% 真实痛点，但可恢复仅构造器初始化子集 ~2-3k/18076） | **P1-2 独立轮次**，前置 InitDeity 语料度量验证 | 数学健全性无反对（守卫内可证安全）；工程收益真实但集中且语料驱动——先度量后实施，回收低于阈值则降级 P2 |
| D4 低价值清理（node: 剥离 / cjsExportName / bytes 前缀） | 可做-7：行为保持，成本极低 | 未提及 | **P2-4 可选** | 采纳数学；其中 link.ts L195 `node:` 剥离是引擎内第 2 处语言字符串字面量，对「引擎零语言常量」收尾有意义 |

**单方新增采纳**：Jeff §2「附加发现」——frameworkPure/pureCtor **不在 effectOverride 注入白名单**（effectOverride.ts L13-24 仅 10 表），恰是 C# 专有的两张表，用户无法用 `--effect-table` 扩展新 Unity API。第一手复核确认（EffectTables 10 键，无 frameworkPure/pureCtor）。采纳为 **P1-1**（补全映射，~25 行，方向安全）。

---

## 3. 可执行改造清单

> 每项标注「映射纯粹性」标签：**消除引擎语言常量** / **补全映射** / **明确拒绝**。
> 硬约束贯穿：不引入假纯（A6 S1）、不破坏 305 测试、漏条方向恒 ?（S4，宁 UNKNOWN 不 PURE）。

### P0-1 gameObject 前缀数据化 【消除引擎语言常量】

- **文件**：src/lang/pack.ts（+字段 `frameworkAttrPrefix: Readonly<Record<string, readonly string[]>>`）；src/engine/link.ts L646-654；src/lang/packs/csharp.ts（搬表）
- **改动描述**：link 以 `pack.frameworkAttrPrefix[call.obj]` 白名单替换 `call.attr.startsWith("gameObject.")` 触发；位次**必须保留在 assigned 守卫之前**（本形态主体是变量 receiver，link L642-645 注释自证）；白名单 miss → 落回后续分支 → UNKNOWN 保持。csharp.ts 数据 = 现 frameworkIo.gameObject 清单（搬移或共享引用）。
- **正确性论证**：数学 §2.2——机制（attr 首段+白名单→io）本就通用，硬编码仅触发前缀字符串与位次；数据化后 F 逐点不变（白名单同集、位次同、miss 回退同）→ S4 保持。半特例收敛为全数据，无行为变化。
- **测试影响**：既有 csharp-lang.test.ts L678-700（迭代33 C2）断言逐字不变；+1 用例（非 C# 语言用 frameworkAttrPrefix 表达 attr 前缀语义）；305/305 保持。
- **预计行数**：~16（pack +6、link 改 ~8、csharp 搬表 ~2）
- **优先级**：P0（本轮最小完成态——Jeff §0：数据化它是本轮的最小完成态）

### P0-2 extractor 2-bit 数据化（assignmentScopesLocals / bareNameMeansThisInMethod）【消除引擎语言常量】

- **文件**：src/lang/pack.ts（+2 布尔字段）；src/lang/extractor.ts L425 / L432 / L487；三语言包（python: true/false、ts: false/false、csharp: false/true）
- **改动描述**：`assignmentScopesLocals: boolean`（python true → L425 分支数据化：Python 赋值即局部定义）；`bareNameMeansThisInMethod: boolean`（csharp true → L432/L487 分支数据化：C# 方法内裸字段写 = this 字段）。分支体不变，仅判据从 `pack.name === "x"` 换为字段值。
- **正确性论证**：数学 §2.2——统一标签差异（self.x vs x）即外部写位置串，E 谓词逐点不变；纯重构，零假纯面（写侧定位语义不变，仅来源从语言名变数据）。
- **测试影响**：Python/TS/C# 既有 stateWrites 断言全绿；+1 用例（字段翻转后写位置语义跟随）；305/305 保持。
- **预计行数**：~14（pack +4、extractor 改 3 处、packs 各 1 行）
- **优先级**：P0（可选但低成本；Jeff §0b 1h、数学 §7 可做-2）

### P1-1 effectOverride 注入白名单补全（frameworkPure / pureCtor）【补全映射】

- **文件**：src/lang/effectOverride.ts（EffectTables + EFFECT_TABLE_SHAPES + applyEffectOverrides + mergeNested 扩展）；CLI/README 文档
- **改动描述**：frameworkPure（nested-pure-hof 两级形状）与 pureCtor（set 形状）加入注入白名单与校验；合并逻辑：frameworkPure 两级深合并（外层 ns 键、内层成员表并集），pureCtor set 并集。
- **正确性论证**：注入 = 数据并集，不改变 link 查找算法（方向安全）；frameworkPure 未列键 → ? 保持（严格白名单语义不动，S4）；无假纯面（注入数据与手写包数据等价，A6 无新增通道）。收益 = C# 用户可注入新 Unity API 而不改包代码（Jeff §2 附加发现）。
- **测试影响**：effectOverride 校验测试扩展（合法注入生效 + 非法形状拒绝）+ 1 注入端到端用例；305/305 保持。
- **预计行数**：~25
- **优先级**：P1（补全映射类高价值小项；若本轮付任何 schema 成本，它比统一表价值高一个量级——Jeff 原话）

### P1-2 局部 ctor 绑定（moduleBindingsOf 下沉函数体，守卫版）【补全映射】

- **文件**：src/lang/extractor.ts（每 chunk 维护 name→(赋值计数, 类名) 映射）；src/engine/link.ts（消费守卫）
- **改动描述**：函数内单赋值类构造绑定 `x = new Foo()` → 消费端 `x.m()` 经 class: 通道解析到 Foo 类成员边；消费守卫 = 单赋值 ∧ declared ∧ ¬param ∧ kind=class；miss 仍 UNKNOWN。
- **正确性论证**：数学 §4.2 断言 + 证明思路——单赋值 ⟹ 任何可达路径 x ≡ 该值；非支配路径（赋值在未执行分支）⟹ 运行时未定义 → 无效应执行 → 不产生假纯；declared 排除外层别名（`if p: x = Foo()`）；参数排除（调用方控制类型）；函数名 RHS 安全（kind=class 消费端校验）。方向：绑定只**新增**边，纯增益。
- **测试影响**：守卫反例组（多赋值/未 declared/参数 → 仍 UNKNOWN）+ InitDeity 语料恢复度量（API.g.cs 构造器初始化子集 ~2-3k/18076 站）；305/305 保持。
- **预计行数**：~60-80（extractor ~40、link ~30）
- **优先级**：P1（独立轮次；**前置语料验证**——egg/swagger 回收 ≈0，InitDeity 是唯一语料驱动，回收低于阈值则降级 P2）

### P1-3 重载并集边 + arity 收窄 【补全映射】

- **文件**：src/engine/link.ts（10 处 `!ambiguous` 守卫 → 全候选并集边；实参计数收窄）；src/core/analyze.ts（SCC 凝聚已有，环安全复用）；文档（标注/unknown-rate 语义）
- **改动描述**：同限定名多定义 → 对全候选建边（效应 = ∪ 闭包）；提取实参计数 n 收窄候选集 Oₙ = {fᵢ: arity=n}；**禁止**任选/arity 定选（C# int/string 同 arity 无法消歧，退化为命题 1 不安全）。
- **正确性论证**：数学 §5 命题 3（S1：PURE ⟺ ∀i eff(fᵢ)=∅ ⟹ eff(f*)=∅；S2：eff(∪O) ⊇ eff(f*) 单调并集封闭；S3：minᵢ(1+chain(fᵢ)) ≤ 1+chain(f*) 悲观下界）+ 命题 4（三语言均运行时强制 arity ⟹ 真分派 ∈ Oₙ）；环安全 = SCC 凝聚 + 最小不动点（A7）。把 UNKNOWN 提升为确定判定，非猜测——「宁 UNKNOWN 不 PURE」不违反。
- **测试影响**：TP2 恢复断言（ApiClientHelper.PrepareRequest 732 站断链）+ 假纯反例回归（任选被禁止）+ unknown-rate 度量；**产品裁决前置**（unknown-rate/标注工作流语义变化需文档配套）。
- **预计行数**：~40-60
- **优先级**：P1（独立轮次，0.5-1d + 文档；C# 重载密集语料普遍收益）

### P2-1 统一作用域效应表 【明确拒绝】

- **文件**：无（保持 12 表现状）
- **改动描述**：不做。数学 C1-C6 保持下可证无损，但零行为收益 + 全量回归面（link + effectUsage L63-77 + effectOverride 用户 API + 4 packs + 305）+ 唯一假纯向量（C3 hof≡hofAlways 标签坍缩，A6 S1 违反）。撞名已由数据隔离解决（csharp L498-502 Join/GroupJoin 先例）。
- **正确性论证**：不实施即无风险；实施则需 C1-C6 全部满足（通道序/匹配模式/标签原子/遮蔽序/回退/miss→UNKNOWN/hof 咨询面）且 effectUsage/effectOverride 同步迁移——工程成本实付、收益为零，价值驱动原则拒绝。
- **测试影响**：无（+G3' 护栏注释）
- **预计行数**：0（护栏 ~5 行注释见 P2-5）
- **优先级**：P2（过度抽象）

### P2-2 A1 节点过滤数据化 / 无门泛化 【明确拒绝】

- **文件**：无
- **改动描述**：不做。paramTypesOf 节点过滤表（extractor L337-350）是 C# 形态，TS/Python 天然不触发 = 「意外的安全」（实证探针：Python typed_parameter 的 type 包装节点被拒、TS 无注解语料）。补数据 + 补门 = 为对称而对称（Jeff e1）；无门启用 = 假纯通道（数学 R2：`def f(xs: list): xs.append(1)` → 运行时自定义对象 → A6 S1 违反）。
- **正确性论证**：现状安全由形态差异结构性保证；改动任何一侧都需 `paramTypesEnforced` 门（C# true；TS/Python false；Python 永不无门启用——G1）。
- **测试影响**：无
- **预计行数**：0
- **优先级**：P2（过度抽象/制造风险；议题 0 边界原则判例：无启用门 = 无读者）

### P2-3 ctor 对称泛化到 TS 【明确拒绝（暂缓，记录重审条件）】

- **文件**：src/lang/extractor.ts（new_expression → ctor 标记，~10 行）；src/lang/packs/ts.ts（数据）
- **改动描述**：不做本轮。TS 现状语义等价（项目类经 bare-name→class chunk 边正常解析；框架类落 UNKNOWN 诚实——探针实证 `new Date()` = UNKNOWN）。泛化后 `new Date()` → io 是行为变化（需显式评审）；若未来做必须保留「项目类优先于 pureCtor」（link L546-556 红线）且注意 Array→io 防御分支首次可达（link L541-545）。
- **正确性论证**：方向安全（io ⊇ {clock} 过近似，S2 安全，无假纯——数学 R1）；价值不足（增量仅框架类型构造效应，TS 项目类 new 已走 class: 通道）。
- **测试影响**：若做：new Date() UNKNOWN→IMPURE 断言翻转需评审
- **预计行数**：~10（做时）
- **优先级**：P2（低价值）

### P2-4 低价值清理（node: 剥离 / cjsExportName / bytes 前缀）【消除引擎语言常量】

- **文件**：src/engine/link.ts L195（`replace(/^node:/,"")` 归 resolveModule 行为侧）；src/lang/extractor.ts L523-535（cjsExportName 归行为 hook）、L799-800（bytes 前缀数据化，1 行）
- **改动描述**：三处行为保持收敛：node: 规范化移入 resolveModule（JS 包行为）；cjsExportName 提为包行为钩子；bytes 前缀在 literalReceivers 值加标记。
- **正确性论证**：纯重构（数学 §7 可做-7）；link.ts L195 是引擎内第 2 处语言字符串字面量，收敛后达成完整「引擎零语言常量」。
- **测试影响**：module 解析断言 / bytes 断言逐字不变；305/305 保持。
- **预计行数**：~8
- **优先级**：P2（可选收尾；低价值但使「引擎零语言常量」验收完整）

### P2-5 G3' 注释护栏 + 债单重基线 【明确拒绝的护栏 / 流程】

- **文件**：src/engine/link.ts / src/lang/pack.ts（注释声明 8 张表为「通道分派语义」防未来误合并）；docs/technical-debt.md（重基线——Jeff Q3：迭代19 快照已过期 23 轮）
- **改动描述**：(a) 统一表不做 → 注释护栏声明通道序/匹配模式是语义非风格（数学 G3'）；(b) 债单以 305/305 基线重写（B/C/D 分类 + 已闭环项归档）。
- **正确性论证**：护栏防未来误合并（C1 通道序是语义非风格，数学 §3.2 C1 + 不做-7）；重基线使验收对象不失真（Jeff Q3 前提）。
- **测试影响**：无
- **预计行数**：~10（注释 + 文档）
- **优先级**：P2

---

## 4. 「清空技术债」范围映射（对照 docs/technical-debt.md）

前置事实（Jeff Q3，采纳）：**technical-debt.md 是迭代19 快照（216/216），已过期 23 轮**——本轮验收前应先重基线（P2-5b），下列映射在重基线前为近似。

| 改造 | 债单条目 | 清偿性质 |
| --- | --- | --- |
| P0-1 gameObject 数据化 | C1（resolveCall cognitive 290） | **部分清偿**（link 分支削 ~15 行，Jeff §3-c1） |
| P0-2 2-bit 数据化 | C1 | **部分清偿**（extractor 分支简化） |
| P1-1 effectOverride 补全 | D3（Unity 引擎不可扫，效应表人工维护） | **部分清偿**（新 Unity API 可注入免改包代码） |
| P1-2 局部绑定 | 无对应条目（**新识别**；iter33 pain-a API.g.cs 30.5% 的构造器初始化子集） | 债单外新增（B3 保留——LINQ 链非本项覆盖） |
| P1-3 并集边 | 无对应条目（**新识别**；iter33 pain-a TP2 PrepareRequest 732 站断链） | 债单外新增（resolver 能力债，债单未追踪） |
| P2-1 统一表不做 | 无（保持现状） | — |
| P2-4 低价值清理 | C1 | 微额 |
| P2-5 重基线 | C 类全（C1-C5） | 流程债：重基线本身 + 验收标准更新 |

**明确保留（与 LangPack 形状无关，本轮不清）**：B1 效应表 70+ 类人工裁决（数据裁决债；frameworkPure 成员级化已部分缓解）、B2 frameworkIo["this"] 组件链、B3 LINQ 链全 ?（P1-2 只覆盖构造器子集）、B4 事件订阅、B5 属性访问器、B6 隐式 this 竞态、C2 真实项目 fixture、C3 标注工作流 E2E、C4 README 测试数漂移、C5 效应表测试稀疏、D1 tree-sitter Unicode 缺陷、D2 协程构造 ?。

**未被债单追踪但已闭环**（Jeff §3，验收文档应更新归档）：frameworkPure 假纯通道（iter32 成员级白名单，csharp L433-461）✓、string.Join 撞名（csharp L498-502）✓、记账不变量破坏（addArgEdges 同步 unknownSites，link L278-284）✓。

**本轮验收标准（可机检，Jeff §3 采纳）**：① `grep "gameObject" src/engine/` 仅剩记账槽位字符串；② 305/305 绿 + 全量 e2e 断言不变；③ `pack.name` 计数：extractor 控制流 = 0（若做 P0-2）或维持 3 处并在 pack.ts 声明行为边界（不做也成立）。

---

## 5. 实施顺序与每步验证

| 步 | 内容 | 规模 | 验证（每步后跑） |
| --- | --- | --- | --- |
| 0a | P0-1 gameObject 数据化 | 0.5-1h | `npx vitest run` → 305/305；csharp-lang.test.ts L678-700 断言逐字不变；`grep -rn "gameObject" src/engine/` 仅剩槽位字符串 |
| 0b | P0-2 extractor 2-bit 数据化 | 1h | 305/305；Python/TS/C# stateWrites 断言全绿（E 谓词逐点不变）；`grep -n "pack.name" src/lang/extractor.ts` 控制流计数 0 |
| 0c | P2-4 低价值清理（可选） | 0.5h | 305/305；module 解析/bytes 断言不变 |
| 0d | P1-1 effectOverride 补全 | 0.5-1h | 305/305；新注入用例（frameworkPure/pureCtor 注入生效、非法形状拒绝） |
| 0e | P2-5 重基线 + G3' 护栏 | 0.5-1h | 文档评审；305/305 无变化 |
| 1 | P1-2 局部绑定（独立轮次） | 2h + 度量 | **先** InitDeity 语料 unknown-rate/可恢复站点度量（验证 >阈值才实施）；守卫反例测试（多赋值/未 declared/参数 → 仍 UNKNOWN）；305/305 |
| 2 | P1-3 并集边 + arity 收窄（独立轮次） | 0.5-1d + 文档 | 305/305；TP2 732 站恢复断言；unknown-rate 下降度量；假纯反例回归（任选被禁止）；产品文档同步「并集=精确语义非猜测」 |
| — | 永不：P2-1 统一表 / P2-2 A1 无门 / 任选消歧 / 守卫放松 | — | — |

每步之间工作树干净、测试全绿后才进入下一步（执行-门禁分离，docs/iter36 纪律）。

---

## 6. 硬约束对照（验收自检）

| 硬约束 | 满足方式 |
| --- | --- |
| 不引入假纯（A6 S1） | P0 项行为保持（F 逐点不变）；P1-2 守卫内可证（非支配路径无效应执行）；P1-3 并集边 S1 可证（PURE ⟺ ∀i 纯）；P2 拒绝项 = 唯一假纯向量（A1 无门/标签坍缩/任选）全部排除 |
| 不破坏 305 测试 | 每步全量 `vitest run` 验证（基线 305/305 已实测复核） |
| 漏条方向恒 ?（宁 UNKNOWN 不 PURE） | S4 回退保持：P0-1 白名单 miss → 后续分支 → UNKNOWN；P0-2 无判定面；P1-2 miss 仍 UNKNOWN；P1-3 未命中候选 → UNKNOWN（禁止默认标签，A7 C5） |
| 产出文件非空 | 本文件 + 两份评审 |

---

## 7. 残余风险

- **债单过期**：technical-debt.md 快照失真（迭代19 vs 现 305/305），P2-5 重基线前 §4 映射是近似。
- **并集边行为变化**：UNKNOWN → 确定判定改变 unknown-rate 与标注工作流语义——需产品裁决 + 文档配套（两份评审共同前置条件），未裁决前不得实施。
- **A1 假纯通道**：永久「不做」红线；重开条件 = TS 重度语料 + tsc 严格检查义务接受 + G1 门 + 数据四件套一起启用（Python 永不无门启用）。
- **局部绑定收益未验证**：egg/swagger ≈0，InitDeity 是唯一语料驱动；度量先行，回收低于阈值降级。
- **P0-2 行为保持依赖测试覆盖**：E 谓词逐点不变靠 Python/TS/C# stateWrites 断言守护，需确认现有断言覆盖 3 个分支形态（裸标识符写 / 字段写 / 下标容器写）。
- **议题 0 命题表述防误读**：「最小语言」是语义核心非文本 DSL、「前端」= 数据+行为钩子——文档已精确定义，防未来按字面理解而立项「DSL 语法/IR 设计」。

## 8. 总评

「无特例语言无关」在**数据侧已达成**（12 表 + 布尔参数全通用）；残余 6 处引擎硬编码（link L646-654 + extractor 3 处 pack.name + node: 剥离 + bytes 前缀）全部可**行为保持**收敛；P0-1 是 Jeff 认定的最小完成态，P0-2/P2-4 使「引擎零语言常量」验收完整；P1 三项是判别力收益（重载断链 732 站 / API.g.cs 构造器子集 / 注入面补全）且数学可证安全；P2 拒绝项 = 过度抽象与假纯向量，与议题 0 边界原则（价值驱动 + 漏条方向 ?）一致。唯一假纯风险（A1 无门泛化）由 G1 门结构性关闭。综合后两篇评审无实质性冲突，分歧全部由「数学健全性优先 + 工程成本第二 + 价值驱动」原则裁决。
