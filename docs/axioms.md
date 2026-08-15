# 公理系统审计与健全性契约（A6/A7）

2026-08-10，多数学家交叉审计（公理系统完备性 + 健全性形式化）。结论：五条公理是**一致性骨架**（内部不变量），不是**语义基础**；健全性、效应格、证据层、确定性、模块边界均未公理化。采纳 A6（健全性）+ A7（效应格），修复审计发现的 4 个实现缺口。

## 一、五条公理的可推导性质（推导线索）

| 性质 | 推导 |
| --- | --- |
| 终止性 | 公理2：凝聚 DAG + 逆拓扑单趟 |
| audit 链 ≤ dev 链 | 公理3：audit 加效应源只缩短最短路径 |
| 区间非零 ⟹ 可达未知 ⟹ chainCertain=false | 公理3 双跑构造（单向：反向不成立） |
| SCC 内同 chain | 公理2：分量级量 |
| 效应单调 purity(caller) ≥ purity(callee) | 公理1+3 + 隐含的并集传递函数 |
| 链三角 chain(caller) ≤ 1+chain(callee) | 最短路径语义 |
| 排序确定性 | 公理5 + key 唯一 + 字典序 tiebreak |
| 内容寻址稳定性 | 公理4：令牌级规范化 |
| unknown-rate = 自我报告的无知 | 公理3 |

**不可推导**：健全性（过近似方向）、效应宇宙与格性质、字节级确定性、key 稳定性（#n 重编号）、证据层语义、模块边界解析正确性、**同 id ⇒ 同判定（为假）**。

## 二、系统性缺口

- **a. 健全性（最大）**：公理3 只规定 audit 悲观，未形式化「分析是运行时行为的过近似」。机检不变量是内部一致性，不是语义健全。审计时发现 4 个现存违反通道（见第四节，已修）。
- **b. 效应格**：效应宇宙只有 {io}；并集+最短链传播是实现选择，非公理推论。
- **c. 证据/标注层**：完全在公理系统外；标注按 id 寻址隐含「同内容⇒同判定」——**为假**（同文本跨文件 import 上下文不同 → 同 id 两纯度 → 标注误放行）。
- **d. 确定性**：字节级一致只测未公理化。
- **e. 模块边界**：跨文件解析正确性靠测试。

## 三、新公理（已采纳）

**A6 健全性公理**（audit 侧；语义基础 = 工具声明模型 M=(V, E_c, ρ, Σ, κ)，静态工具无运行时，「实际效应」定义在模型真值上）：

- **S1 永不假纯**：PURE ⟹ 模型效应闭包 = ∅
- **S2 效应过近似**：报告效应 ⊇ 模型效应（漏报即违反）
- **S3 链是悲观下界**：audit 链 ≤ 模型距离
- **S4 解析闭包**：每条调用点 → 边/效应/⊥，无静默丢弃分支；audit 下 ⊥ 参与传播

对偶 **A6\***（dev 乐观上界：IMPURE ⟹ 模型效应非空）合取得**区间定理**（链真值 ∈ [audit, dev]）。

关键推论：「永不静默丢」是 S4 的推论（非风格规则）；不变量机检升格为健全性机检（invariantViolations>0 ⟸ A6 内层被机器证伪——仅单向，机检覆盖非全部模型）；标注 = 模型更新（条件健全性，三条边界：方向性/锚定/多重性）；最小可证版本 A6-inner（~15 行证明：有限格单调函数 + 凝聚 DAG = 最小不动点）+ 机检证书。

**A7 效应格公理**（伴生）：Σ 有限效应原子集（LangPack 表声明）；`?` 是知识标记非效应（参与传播与判定但不属 Σ）；判定格 Λ = {PURE < UNKNOWN < IMPURE} 安全序；传播单调并集封闭 ⟹ 不动点存在唯一。与 A6 可分但互为前提——**原公理3 = A7 的操作版 + A6 在 `?` 通道的特例**。

公理 5 降级为输出契约（不约束计算语义）；公理 4 的 module 例外正当性来自证据层（防标注泄漏）——暴露公理系统与证据层的循环依赖。

## 四、审计发现的实现缺口（已修复）

| # | 缺口 | 修复 |
| --- | --- | --- |
| 1 | **同 id ⇒ 同判定为假**：标注按纯 id 匹配，同内容跨文件误放行 | 标注支持可选 `file` 字段 → (file, id) 实例锚定；纯 id 仍为内容寻址语义 |
| 2 | 裸名遮蔽洞：分支 2 无 assigned 守卫，局部变量遮蔽顶层同名函数 → 错边 | 分支 2 加 `!caller.assigned.includes(attr)` 守卫 |
| 3 | bySimple 歧义静默取首：同名顶层重定义不记 `?`；裸名可误解析到类方法 | 仅解析唯一顶层候选；多顶层重定义 → `?`；仅方法候选 → 不解析 |
| 4 | HOF 实参静默丢：`const f = writeFileSync; [1].map(f)` → 假纯 | 无条件调用 HOF（map/filter/forEach/reduce…）实参未解析 → 记未知（`hofAlwaysArgs` 表）；条件调用（sorted key=/Array.from）保持跳过 |

回归测试：`test/audit/lang-features.test.ts`「公理审计修复」组（7 用例，含不变量机检零违规证书与两个假纯反例）。

## 四·五、后续健全性缺口（定义性事实族评审发现，2026-08-10 已修）

四方评审（模块级值绑定/构造器接收者/返回类型链/require 解构）裁决：**特性全否决**（Jeff Dean 实测触发各 0-3 处，低于停止准则；统一机制=被否决类型层换名）。但评审发现两个存活假纯洞（正确性 bug），按「只修正确性 bug」修复：

| # | 缺口 | 修复 |
|---|---|---|
| 5 | **模块级重绑遮蔽 import**：`from db import conn; conn = other`（模块顶层）→ 解析到 db 纯方法 → 假纯（实证 PURE） | module chunk 的 assigned = 文件级绑定（原恒空——模块级遮蔽守卫全死）；import 分支守卫查 moduleAssigned；require 导入声明（`const x = require(...)`）排除（是 importMap 登记，非遮蔽） |
| 6 | **参数遮蔽命名空间 import**：`import math; def f(math): math.foo()` → 纯表丢弃 → 假纯（实证 PURE） | assignedNames 同时收集参数名（参数遮蔽外层绑定）；import 分支守卫升级为 assigned ∪ 参数 ∪ 模块级 |

残余（特性否决记录）：模块级值绑定（A）、构造器接收者（B）、内建方法返回类型链（C，有害）、require 解构（D）——在出现重度语料（跨文件单例导入/字面量链）前不重审。

## 四·六、定义性事实族实施（2026-08-10，用户覆写否决）

用户「开修」覆写四方评审否决，四件按 AI 工程师方案实施（带数学家守卫）：

| 件 | 机制 | 守卫 |
| --- | --- | --- |
| A 模块级值绑定 | `moduleBindings`（模块级单赋值 name→类名，last-write-wins，解包 export/expression 包装）；from-import 成员分支查绑定 → resolveSymbol → kind=class → 类成员边 | 定义遮蔽赋值清除；require 排除；kind 判别 |
| B 构造器接收者 | `RawChunk.kind`（class/function/module）；`new C()` → receiver "class:C" → resolveSymbol → kind=class → 类成员边 | kind 判别（函数不可 new）；解析失败 → `?` |
| C 链式返回类型 | `builtinMethodReturns`（类型→方法→返回类型，语言事实）；extractor 递归 receiverTypeOf | 表外链断 → `?`；链不绕过纯度表；无跨函数 |
| D require 解构 | extractEsmImports object_pattern → from-import 绑定（{go} / {go:run}） | 仅普通属性；默认值/rest/嵌套 → 不提取 |

实测：`new Conn().open()` → IMPURE（真边）；`from db import conn; conn.execute()`（实例）→ IMPURE；`' x '.strip().upper()` → PURE；`const { go } = require('./lib')` → IMPURE。swagger 零回归。

## 四·七、数学层边界（先验/曲线的已知取舍，2026-08-11 补档）

语料先验与标注曲线的数学实现（corpus.ts / influence.ts）在 A6/A7 之下自洽（算法对拍 + 随机语料 fuzz 验证），以下为**有意取舍**，非缺陷：

1. **单项目基率泄漏**：`GLOBAL_THETA0 = 0.25`（corpus.ts）来自 swagger-ui 单项目标注模拟——冷单元格 θ̂≈θ₀ 会被该基率拉动，跨项目污染。改进方向：项目级基率分层（项目随机效应，标准分层贝叶斯）或可配置基率——**卡数据**（需多个项目的标注语料，当前仅 swagger 一个）。
2. **cell 维度（v2）**：语料新增 (attr, root) 格计数（`cell` 表，version 2）——`priorFor` 的 `n` 显示与 LOO 剔除都基于真格计数，根治了 v1 的 root 桶边际虚高（多 attr 共享 root 桶时 n 虚高、LOO 过度扣除）。v1 旧语料因缺 cell 维度被拒（重扫时标注幂等重建）。
3. **曲线启发序非边际最优**：标注曲线对**给定顺序**精确（逐源释放），但顺序为 UNKNOWN 密集影响面启发序——共享源 chunk 的边际释放 < 桶大小，边际最优需贪心重算（O(n²)），成本取舍，注释明示（cli.ts）。
4. **先验永不进判定**：`suggested_prompt` 携带的先验提示是建议置信度，purity/chain/effects 判定不读语料——A7"先验不进判定通道"契约。
5. **阈值-因子联合体**：回归风险阈值 15/35/60 是对 (权重 W, R_state 加入前) 分布的实测标定（迭代13/15 真实语料验证）；改任一因子/权重/阈值组合须重标——D 矩阵/权重基数同理（迭代14 视角 1 四序公理 + 基数裁决；R_state 迭代15 复测分布未移）。

## 四·八、Iter-44 妥协最小形式化（迭代45 双评审审计，2026-08-13 落地）

Iter-44 工具不完备/数据债收口的工程妥协经数学家 + Jeff Dean 双评审审计后，按「引理（S1 侧）入本文件 / 数据债方向分类入 technical-debt.md / 运营模型入 annotation-workflow-review.md」分层落档。评审发现 1 个代码级 S1 违反（C1 反例）当场修复。

### 引理 L-C1′（绑定槽读取恒纯，修正版）

> **前提**：C#（及 TS/Python 词法作用域下同构）裸标识符解析 = 最近包围声明（C# 规范）；绑定槽（局部变量、参数、foreach/catch 变量、字段）读取 = 内存加载，不执行用户代码；属性名不入声明收集（property_declaration 无 variable_declarator 子节点，探针实证）。
> **结论**：`obj===null ∧ prop ∧ attr∈assigned(Caller) ∧ attr ∉ 类成员(ownerClass)` ⟹ 判纯（link.ts 分支 2 顶部早期短路）。
> **豁免面**：四条件缺一不可——obj===null（对象成员读可能 getter）；prop=true（调用可能执行用户代码）；attr∈assigned（非遮蔽名可能是属性）；attr ∉ 类成员（**迭代45 修正**：assigned 含 assignment_expression 左值收集，C# 隐式 this 属性写后裸读若短路 → getter io 假纯，S1 违反；类 chunk 同理——assigned = 整棵类子树，方法内局部声明名污染类级字段初始化器读属性）。局部遮蔽类成员的读退回 `?`（安全，C1 前行为）。
> **残余风险**：using-static 导入可写成员的写后裸读（memberNameExists 不可见）——与 B5 prop-miss 既有暴露同族，文档化接受，触发率 ≈0。
> **修复锚点**：link.ts isClassMemberName（C# 限定名索引 `${cls}.${attr}` 命中；TS/JS 走 memberNameExists；仅 bareNameMeansThisInMethod 语言启用）。回归测试 iter45-c1.test.ts（3 用例：类 chunk 污染非 PURE / 局部读短路保留 / 写-读属性 IMPURE）。

### 引理 L-C2（枚举成员判纯）

> **前提**：C# 规范：枚举成员是编译期常量；白名单条目名称 = 语料实证的 BCL/第三方枚举类型名（StringComparison/TaskStatus/BindingFlags/AttributeTargets/Ease）；遮蔽守卫（globalClasses 优先 + assigned/moduleAssigned）在位。
> **结论**：`obj ∈ pureGlobals` 且未遮蔽 ⟹ 成员读取判纯。
> **豁免面**：插件同名 + 静态 getter = 表语义既有风险类（override 可修正）；全限定形态 System.X.Y（obj="System"）→ **形式强加的 `?`**（知识在 pureGlobals，键形状不匹配——非信息论必然擦除）→ 数据裁决（top-N 频次）或 frameworkPure.System 子键闭合（iter30 逐类型白名单先例形状）。

### 义务 O-C5（heritage 接受集完备性）

> 设 B = grammar 中 base_list 直接子节点可达类型集，A = {identifier, type_identifier, property_identifier} ∪ heritageWrapNodes ∪ typeNameNodes ∪ heritageSkipNodes ∪ {ERROR}。
> **不变量**：B ⊆ A。
> **违反后果**：∃t ∈ B∖A ⟹ hasDynamicExtends=true ⟹ 规则3 语言级降级（全库 C# 多态/隐式 this → unknown，安全-未知，判别力 -37% 级实测）。
> **机检形态**：heritage-skip-completeness.test.ts（directive 族 14 节点全量入表断言 + wasm grammar 节点集对拍）；alias_qualified_name（global:: 基类）剥壳修复（extractor pushBase）。
> **已知违反（已修）**：alias_qualified_name（D-144 实证节点存在，迭代45 补接受集）；region/endregion 不对称（迭代45 两表全量补齐）。

### 义务 O-C6（排除表完备性）

> 同 O-C5 检查器；违反后果 = 局部 unknown 噪音（安全-未知，非全局降级）——优先级低于 O-C5。propertyReadSkipParents 13 directive 节点全量入表（迭代45 补 line/error/warning/pragma/nullable/extern_alias）。

### C8 标注生命周期命题组（V / R / O / S）

> **V（决定集）**：V(A) = {c : J_M(c) ≠ J_{M+A}(c)}；v(a) = I[a ∈ V]。标注价值 = 机器判定差集；「生效」计数是决定集的**上界**（含冗余吸收——工具修复后 chunk 不再 UNKNOWN，标注应用为 no-op 仍计生效）。工具修复**不改变 chunk id**（id = hash(normText)，公理4）→ 吸收是 matched 且冗余，非 unmatched。
> **R（引用衰减）**：id = h∘norm（公理4）；编辑 → id 变是确定性谓词（编辑改变规范化令牌流 ⟺ id 变）；编辑过程随机 ⟹ 生存函数 S(t) = P(id 稳定)，λ_eff = 编辑率 × P(id 变|编辑)，期望寿命 1/λ_eff（仅 R 子过程；记忆less 需泊松假设，git 历史可检验）。**半衰期模型只对引用性衰减成立**——操作吸收不是随机过程（发布排期驱动），无概率模型。
> **O（操作吸收）**：确定性反事实——工具修复后重扫，吸收集 = 修复前决定 ∧ 修复后冗余；pain-2 的 1123→857（-24%）是吸收（机器证明取代人工断言，正向），非标注资产损失。
> **S（调度）**：标注序按 E[value] = influence × S(存活|年龄) × I[机器届时 unresolved]；**fix-first-then-annotate**（工具修复先于标注轮——pain-2 的 266 条失效标注是违反该顺序的实测代价）；失效三向分解：吸收（matched ∧ 冗余）/ 引用失效（unmatched，id 消失）/ 矛盾（rejected）——吸收向现无回显（D-155/157 只覆盖后两向），是三向归因错误的根源。
> **语料桥计数泄漏（方向安全）**：seen 双锚定只保证单世代幂等——逻辑代码改名/重构 → 新 id → 重标 → 同一 (attr,root) 格跨世代重复 bump，cell n 虚高 → 先验置信过信。先验永不进判定（A7 契约）→ 失真限于建议通道，无健全性后果。修复候选（非本轮）：cell 计数按 chunk 世代去重或计数衰减——YAGNI 裁决。
> **工程裁决（Jeff Dean）**：数学解不落地代码（无第二语料/无扫描历史账本/唯一语料 100% 覆盖无消费者）；已够用闭环 = unmatched 回显 + 语料吸收 + seen 去重 + 台账；唯一值得的工程延伸 = unmatched 回显补失效原因分类（吸收 vs id 死亡 vs 拼写错误，标注者感知错位才是痛点本体）。

## 五、残余

## 五、残余

- 外层保真度不可证（效应表数据错误/语言演进）——审查纪律承担
- 标注正确性无统计建模（语料先验只进建议，不进判定）
- 同 id⇒同判定在纯 id 标注（无 file）下仍是设计假设——导出默认带 file，建议标注时使用

## 六、迭代56：A6-inner 形式化落地 + 函子性闭合（轮8 审计）

### A6-inner 最小不动点证明（~13 行，机检证书见 ct-adversarial8 law:fixpoint）

> 设凝聚 DAG D = (V, E)，效应格 L = P(Σ ∪ {?})（Σ 有限 ⟹ L^V 有限，A7）。
> 定义 F: L^V → L^V，F(X)(v) = direct(v) ∪ ⋃_{(v,u)∈E} X(u)。
>
> 1. F 逐点单调（并集保序）且 L^V 有限 ⟹ Tarski/Kleene：μF = ⋃ₖ Fᵏ(∅) 存在，
>    且上升链在 ≤ |V|·|Σ∪{?}| 步内稳定（每步至少新增一个格元素或终止）。
> 2. D 无环（凝聚）⟹ 逆拓扑序 v₁…vₙ（(vᵢ,vⱼ)∈E ⟹ i>j）存在（拓扑排序定理）。
> 3. 单趟逆拓扑 X(vᵢ) = direct(vᵢ) ∪ ⋃ X(后继) 恰为 F 的一步（后继分量已算），
>    n 趟后 = Fⁿ(∅)（n = |V|）。
> 4. 最小性：Fⁿ(∅) 的每个元素有 well-founded 推导链到 direct（拓扑深度归纳）；
>    任何不动点 Y 满足 Y ⊇ F(∅) 且归纳 Y ⊇ Fᵏ(∅) ∀k ⟹ Y ⊇ Fⁿ(∅) ⟹ Fⁿ(∅) = μF。
> 5. SCC 收缩保持不动点方程（分量内并集封闭，公理2）⟹ 单趟逆拓扑即最小不动点。∎
>
> 机检证书：test/audit/ct-adversarial8.test.ts law:fixpoint —— 对手动 Kleene 迭代
> （Fᵏ(∅)）断言：单调不变量、≤|V|·|Σ∪{?}| 收敛、不动点方程、与 analyze 输出逐点相等
> （含 SCC/未知/悬垂边 fixture）。

### 函子性闭合（迭代56，两处违反处理）

| 违反 | 处置 | 证据 |
| --- | --- | --- |
| globalClasses 同名类跨文件并集 | **已修（轮9 修正）**：classEntriesFor 作用域化语言门控——Python/TS/JS 类模块私有（`fileScopedClasses: true`）→ 调用方文件有同名类 → 只解析本文件条目；无则回退并集。C# 恒并集（`fileScopedClasses` 缺省 false）——**轮8 对 C# 误用文件作用域：partial 类下回退条件永不触发（调用方文件总有 partial 声明 chunk），跨文件 ctor/成员被吞 → S1 假纯实证（ct-adversarial9 law:functoriality 两用例：ctor 假纯 PURE、静态成员 UNKNOWN 噪音）**。修复 = pack 标志 + classEntriesFor 门控（link.ts classEntriesFor/6 调用点，<30 行）；ct-adversarial8 f1-ctor 锚随语义翻转（并集 = S2 方向安全过近似） | link.ts classEntriesFor（fileScoped 参数）；pack.ts `fileScopedClasses`；python/typescript/javascript 包置 true；ct-adversarial9 law:functoriality（3 用例）；ct-adversarial2 law:functoriality（Python 锚不动） |
| stateDeps 全局 ⊤ 匹配一切写者 | **明确否决**（不修）：⊤ 是提取器降级的全局量词（extractor.ts:917），匹配一切写者是声明的过近似（state.ts:13-18），只影响耦合元数据与 R_state，不进 purity/effects/chain（公理3）；耦合视图下「新增写者 ⟹ ⊤ 读者依赖集增长」是量词语义而非函子性违反；按文件作用域化会使跨文件全局容器耦合漏报（方向安全承诺翻转），且修不掉合成 fixture 的同文件场景。真修复需提取器根追踪（消除裸 ⊤）——语义变更 >30 行，记录不修 | state.ts:37-46；ct-adversarial:193（保留 it.fails 锚定） |

### 标注层循环依赖收口（任务3：grep 全部消费点）

(file, id) 实例锚定已闭合于全部五个消费点：cli.ts:575-580（键构造）、scan.ts:462（判定应用，file 锚定优先）、scan.ts:451（未匹配回显）、corpus.ts:104-106（语料，file 锚定优先）、cli.ts:715-719（语料写，拒收按裸 id 拆分）。剩余面 = **裸 id 回退**（`ann.get(c.id)`，无 file 字段的标注按内容寻址匹配全部同 id chunk）——这是公理4 内容寻址契约本身（cli.ts:575 注释、axioms 五），非锚定修复的泄漏；导出恒带 file（cli.ts:1319）。边界已显式声明，标注工作流建议恒用 (file, id)。

### 效应宇宙退化评估（任务4：Σ 完备性——只评估不实施）

现状：判定格 Λ = {PURE<UNKNOWN<IMPURE} 与效应宇宙 Σ = {io, net, db, random, clock, state}（A7，LangPack 表声明）；**标注注入通道只产生 io**（scan.ts:467），`--effect-table` 注入可带任意效应类但标注协议固定 io。

- **健全性**：不构成障碍——io 是最粗效应类（supremum 方向），标注 IMPURE→io 是过近似（S2 方向安全），永不假纯。
- **完备性/精度**：构成精度天花板——标注 `net` 类函数后报告 {io}，`--sources`/chain 视图退化为「最近的 io」，db/random/clock 的源头定位在标注通道内不可分辨；内部表通道（impureGlobals 等）不受影响。
- **结论（产品决策，不实施）**：扩展需标注协议 v2（verdict 带效应类）+ 语料 schema v3 + 效应表校准重标——收益（源头分类精度）低于成本（协议迁移 + 既有 ~1500 条标注失效），记录为有意取舍，与四·七 5（阈值标定）同族。

### 残余（迭代56 记录）

- superMap/virtualMembers/staticInitKey 仍按类名并集（C# partial 语义需要）；Python/TS/JS 跨文件同名类**继承**污染（a.py Svc extends 基类被 b.py 同名类基类并集）未堵——方向安全（过近似），类名+文件双键化需 >30 行，记录不修。
- memberNameExists 仍跨文件并集（TS/JS 无 partial，并集是良性过近似；C# 无 memberNames 表不受影响）；isClassMemberName 并集是 C# partial 必需（不可作用域化）。
- stateDeps ⊤ 的 it.fails 保留（锚定明确否决的偏差，防回归）。

### 六·五、stateDeps ⊤ 的语义契约（迭代57 轮9 审计——降级面显式化）

轮8 明确否决「⊤ 作用域化」后，轮9 把 ⊤ 的影响面写成可审计契约。**⊤ 是提取器降级的全局量词**：

**何时引入**：

1. **读侧全局 ⊤**：`f().x`/`d[k].x` 等非标识符接收者的成员读取，`subscriptRoot` 回溯失败 → `["⊤"]`；回溯到根标识符 → 根限定 `["d.⊤"]`（extractor.ts:917）。
2. **写侧根限定 ⊤**：`d[k].x = v` 下标写 → `d.⊤`（与读侧对偶）；局部下标根 `dd[k].x=` 的 `dd` 过近似为 `dd.⊤`（state.ts 头注释）。
3. **匹配规则**（state.ts:12-16,39-46）：全局 ⊤ **读**匹配一切写者位置；全局 ⊤ **写**（state.ts:46 `writes.has("⊤")`）匹配一切读者；根限定 `d.⊤` 匹配同根（`d.` 前缀）一切写者。

**影响什么（噪音面——耦合元数据与风险似然，不进判定）**：

- `verdict.stateDeps`（analyze.ts:170,184）——纯元数据。
- R_state 似然因子（risk.ts:217-232）：⊤ 写者改动 → `writeSet={⊤}` → 全部 stateDeps 非空读者 broken（state=1 饱和）——L×C 风险矩阵的**似然噪音**，方向安全（过近似），不反向跳变。
- `--state` 耦合图（state.ts:69-140，stateCouplingOf）：⊤ 写者出现在耦合链并耦合全部读者；⊤ 读者耦合全部写者——**可观测 false coupling**（两个调用边零交集的 chunk 因 ⊤ 显示耦合），已测试锚定为「已知近似」（ct-adversarial9 law:edge-case 首两用例）。
- htmlreport 耦合 top-15（htmlreport.ts:376）、cli JSON 序列化（cli.ts:859-865,1014）。

**不影响什么（判定面）**：

- purity/effects/chain/chainCertain——stateDeps 在判定计算中零消费点（公理3：读不是副作用；⊤ 只是耦合可见性）。ct-adversarial9 锚定：⊤ 写者/根限定 ⊤ 读者场景下读者 purity 恒 PURE。
- 标注通道、效应表、反向闭包（changedImpact）不读 stateDeps。

**已知近似锚定（非静默）**：

- 读者侧全局 ⊤ 的函子性偏差：`it.fails`（ct-adversarial.test.ts:193）——防回归。
- 写者侧全局 ⊤ 与根限定 ⊤ 的耦合行为：**通过态测试**锚定当前语义（ct-adversarial9 law:edge-case），含 R_state 饱和边界。

**未来真修复路径（记录不修，>30 行）**：提取器**根追踪**——`subscriptRoot` 失败点改为追溯变量声明链（`this.cache[k]` → 根 `this`，`getStore()[k]` → 根 `getStore` 返回类型），消除裸 ⊤ 与根限定 ⊤ 的语义差；修复后 it.fails 可翻转。风险：跨函数返回类型链（四·五 C 特性已否决）是根追踪的依赖，需先决策。

### 迭代57 其余记录（轮9）

- **A6-inner 证书补强**（任务2）：证明步骤1「每步至少新增一个格元素」机制与有限格高度界 |V|·|Σ∪{?}| 原仅以宽松常数（8+4）断言；轮9 补满格攀登对拍（7 原子链，ct-adversarial9 law:fixpoint）——严格 +1 增长、恰 |Σ∪{?}| 步稳定、analyze == Kleene、幂等吸收。证明-测试对应审计：单调性（显式断言 + 轮8 判定格单调测试）、有限格（新高度界测试）、凝聚性（轮8 SCC fixture + 单趟对拍）三条件全覆盖，无漂移。
- **S2/S4 通道穷举**（任务3）：轮7 三通道（裸名 miss/动态成员/HOF 实参）之外补 8 通道：C# 构造器 miss、C# 构造器别名 miss、C# base.M() 基类项目外、Python super().m() 哨兵、TS/Python 模块导入 miss（resolveMod null）、TS 泛型类型参数接收者、C# 重载并集边——全部「要么边要么 unknown」（ct-adversarial9 law:edge-case 8 用例）。
- **⊤ 降级面**（任务1）：本节契约 + 3 锚定测试（写者全局 ⊤ / 根限定 ⊤ / R_state 饱和）。
- **轮8 作用域化缺陷修复**（任务4）：见上表 globalClasses 行——C# partial S1 假纯闭合。
