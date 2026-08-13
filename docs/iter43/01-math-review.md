# 迭代 43 数学评审（01-math-review）——三候选形态裁决 + 事件订阅设计复核 + static-init 迁移形式化

> 评审者：范畴论/形式逻辑数学家视角。只读评审（未修改任何仓库文件）。
> 证据锚全部经源码/提交/实测核实：link.ts（全局类分支 1207-1276 / H1 ctor 并集 1241-1250 / L5 978-1017 / 通道序 1318-1698）、csharp.ts（chunkNodes 633-642 / classNodes 644-649 / propertyReadSkipParents 670-717 / propertyReadSkipMorphs 661-668）、extractor.ts（isPropertyRead 1238-1263 / callOf 1139-1231）、fixture.test.ts 86-93、EventSubscribe.cs、test/e2e/synthetic.test.ts、27282cb diff、fixture 实测 8/8。

## 0. 前置事实核查（plan 现状断言 vs 仓库事实）

**F1 — plan「合成大库（300 文件）是 TS 形态」：语言声称错误，结论不变。**
`test/e2e/synthetic.test.ts` 实测是 **300 个 Python 文件**（纯公式生成 `(i*7+d*13)%i`，无 RNG，双扫确定性断言）。plan 的结论「覆盖不了 C# 分布」仍成立，但声称必须改为 Python。

**F2 — H1 ctor 并集实测**：link.ts:1241-1250 `byQualifiedAll.get(\`${c}.${c}\`)` = C# 静态 ctor + 实例 ctor **双份**（同为 constructor_declaration，限定名均为 Class.Class）；1233-1236 class chunk 原始调用并集含静态 + 实例字段初始化器。plan「静态访问路径并入实例构造器是 S2 过近似」成立，且**过近似不止实例 ctor——class chunk 并集同样漏入实例字段初始化器**（plan 未提，见 §3）。

**F3 — `event_field_declaration` 在 src/ 全仓零匹配** → 不在 propertyReadSkipParents（csharp.ts:670-717 逐项核对无此节点）→ `public event Action OnX = HandleX;` 的 RHS identifier（直接 parent = equals_value_clause，extractor.ts:1239-1244 只查直接父节点）**当前已产 prop 读** → 隐式 this 分支 resolveClassMember 命中方法 → **class chunk 已意外获得 → handler 的调用边**（S2 方向噪音；B 落地后与新订阅边双计，见 §2a 修正 1）。

**F4 — 事件名与成员名同命名空间（C# 语言保证）**：类内 `void Foo()` 与 `event Action Foo` 不可并存 → 裸名 `evt(...)` 触发形态与普通方法解析**无歧义**（§2b 的完备性前提）。

**F5 — fixture 锚实测**：`npx vitest run test/audit/fixture.test.ts` → **8/8 通过**（含 L92 `Wire purity=2`，`+=` 双语义回归锚在 HEAD 6336d78 存活）。全量 357/357 未复跑（时间预算），接受 plan 声称 + README 门禁纪律。

**F6 — 配对审计两缺口已闭环（27282cb，HEAD 6336d78）**：见 §6，diff 实证，无需再改。

---

## 1. 候选 A（C2 回归网形态）——裁决：A1 **do-later**（独立轮，B/C 落地后校准）；A2 **defer**；A3 **并入 B 轮**（残余价值≈0）

**论证**：

- A2 否决理由：InitDeity 全量 = 3004 文件 / 23800 chunks / 扫描 18s+（iter21 超时记录同源）——作为 CI 常驻测试不可行；license/体积问题未解。仅可作**离线验证场**（J:/旧宇宙 已存在，非仓库依赖）。
- A3 残余价值≈0：H1/M1/候选7 形态已被 iter42 的 csharp-lang.test.ts 三态 in-memory 测试覆盖；「扩展 fixture」正是 B 轮验收锚本身（§2 验收锚）——A3 与 B 合并即完成，无需单独条目。
- A1 排期约束（plan 未提，决定性）：**B 改变 stats.cycles 与调用边、C 改变纯度分布（P4 裸名 `?` 消失 → new C() 翻案）**——A1 快照若在 B/C 前校准，B/C 落地后必然红一次。快照的校准时点必须在行为稳定之后。故 A1 独立轮次放最后（iter43-r3 / iter44），或接受「每行为变化显式更新数字」的持续维护成本。

**分布快照断言的可靠性论证**：

1. **确定性**：生成器必须为种子纯函数（synthetic.test.ts 先例：纯公式、无 Math.random；或固定种子 PRNG）；扫描管线确定性已有契约（D-056 确定性 5/5 + synthetic.test.ts 双扫相等断言先例）。断言形态 = 判定图查找（`by()` 式 map）+ 聚合计数，与文件序无关（不写「第 N 个 chunk」式索引断言）。
2. **敏感性**（三层断言金字塔）：
   - (i) **哨兵 chunk 精确判定**（10-20 个痛点形态：属性访问器 getter io 传染 / enum 读判纯 / 静态访问类型加载闭包 / 成员 miss 结算 / 事件触发 / ctor 并集）——修复引入红、无关改动绿，是主网；
   - (ii) **分布不变量带余量**（unknown-rate ≤ X%、IMPURE ≥ Y，余量取实测头部空间）——防「机械更新数字掩盖回归」；
   - (iii) **精确计数**（IMPURE/UNKNOWN/pure 总数）——最高灵敏度金丝雀，但**任何 C# 行为变化（含有意修复）都红** → 必须配显式更新纪律（测试头注释 + 每行为变化显式更新，项目手写断言惯例，不引入快照框架）。
3. **与 synthetic.test.ts 的关系**：复用其 mkdtemp + scanProject + 双扫确定性模式，新文件 `test/e2e/synthetic-csharp.test.ts`；生成器不复制到 audit/，不另起机制。

**修正**：plan 需补 (a) 语言声称（Python 非 TS）；(b) A1 校准时序 = B、C 之后；(c) 断言三层结构 + 更新纪律。

---

## 2. 候选 B（事件订阅建模）——裁决：**do-now**（iter43-r1，修正版，三处补强）

### (a) 订阅集合完备性引理 × 事件字段初始化器形态：**成立**

形式化（引理：sub_static(e) ⊇ sub_runtime(e) 对所有触发时刻成立）：

- **实例事件** `public event Action OnX = HandleX;`：C# 构造序 = 派生字段初始化器（文本序）→ 基类构造 → 派生构造体。初始化器在构造早期注册；任何实例事件触发必先有实例（this.evt 需已构造）→ 触发时刻订阅已注册 → 初始化器 handler ∈ sub_runtime ✓ ⊆ sub_static ✓。
- **静态事件** `static event Action OnX = HandleX;`：类型加载注册，先于类内任何触发 ✓。
- 边角（注册过程中被自身触发、`-=` 注销已注册 handler）：静态计入 ⊇ 运行时 → S2 方向安全 ✓。
- 引理对 private 成立（语言保证 + 提取形态完备）；非 private → 可见性守卫（§2c）。

**修正 1（plan 未提，1 行实现义务）**：`event_field_declaration` 加入 propertyReadSkipParents——否则初始化器 RHS identifier 经 B5 通道产**意外 prop 边（class chunk → handler）**，与 B 的新订阅边双计（S2 噪音 + calls/链变化不可解释，F3 实证该边现已存在）。
**修正 2**：初始化器 RHS 为**调用形态**（`OnX = Factory()`）时 Factory 真实执行于字段初始化——保留为调用边（class/static-init chunk 原始调用），与「方法组引用不执行」严格区分，不得并入订阅边语义。
**修正 3（scope 声明）**：partial 类——private 事件订阅可跨 partial 文件；v1 只查声明文件则集合不完整 → 触发端 `?`（安全，判别力损失，照 iter42 §1e）。

### (b) `evt(...)` 直接调用形态提取完备性：**可行，无歧义，须显式全枚举**

- 无歧义性由 F4 保证（事件名 ≠ 成员名）→ 裸名 identifier 触发判定 = name ∈ eventFields(class)，与既有方法解析互斥，**不改通道序**（事件通道挂 resolveCall 尾部出口 markUnknown/markDynamic 之前，既有通道先裁决——与 iter42 jeff P3 预演一致）。
- **触发形态全枚举**（v1 必须显式，六类）：`evt(...)` 裸名 / `evt.Invoke` / `evt?.Invoke`（M5/178d6d4 已支持 conditional 解包）/ `this.evt(...)` / `C.evt(...)`（静态，obj=类名）/ `x.evt(...)`（跨实例）。
- 跨实例触发完备性：C# 仅声明类可触发 → 合法 `x.evt(...)` ⟺ x:C（含 x:Derived——但派生 `new` 隐藏事件时 `x.evt` 指派生事件，静态不可区分）→ 接收者类型不可证 → **归「集合不完整」→ 触发端 `?`**（或按事件展开 + 守卫，两选一皆方向安全，取前者简单）。
- 逃逸形态：事件委托逃逸后被项目代码调用（`Register(evt)`）——逃逸调用点接收者为参数/字段 → 既有 markDynamic 落 `?`（S4 已保）→ v1 scope 声明即可，无新洞。

### (c) 可见性守卫对 static 事件 / 跨实例订阅：**完备，需补接收者类型条件**

- **private（含 private static）**：语言保证仅声明类可订阅 → 静态完备集合 = 类内全部形态（bare / `this.` / `C.` / `x.` 且 x 类型可证为本类——C# 私有成员类内任意实例可见）。
- **非 private（public/internal/protected）**：触发端附加 `?`（守卫公式 sub_static(e) ∪ {?}，plan 已列）——覆盖 static 事件、非 sealed 类实例逃逸、项目外订阅。
- **补强（iter42 洞 1 的实装形态）**：`x.evt += h` 接收者类型不可证 → 订阅**不可归属**到 e（可能是另一类同名事件；私有事件下该形态必为 x:C 但类型不可证时不数入）→ 标记「集合不完整」→ **触发端 `?`**。plan 的「只收 bare + 其他形态落 ?」只保护订阅方、未传导触发端——必须同时标记（iter42 §1a 的对称诚实，B 轮验收须含此用例）。
- 继承：派生类订阅基类事件——非 private 已有 `?` 守卫兜底；private 事件派生不可订阅（语言保证）→ sub_static 限于声明类，无漏。

### (d) 事件环 SCC 与双跑区间：**无新洞，数值修正一处**

- HandleLevel↔Raise 触发边成 SCC；**HandleQuest 自环**（`OnQuestComplete?.Invoke()` 在自身 handler 内）→ fixture 预期 **cycles +2**（plan 写 +1，少计自环；若断言涉及须 +2）。现有测试无精确 cycles 断言（grep 全部 ≥1 形态）→ 安全；A1 快照若含 cycles 计数，B 落地时须更新（又一条 A1 晚于 B 的理由）。
- 双跑：订阅/触发边模式无关；守卫 `?` 仅 audit 传播 → 区间加宽、chainCertain=false（诚实）。SCC 内同 chain（公理2 分量级量）——验收锚**不得断言 Raise 与 HandleLevel 的 chain 差**（同为分量值）。

### (e) `+=` 双重语义形式化：**成立，写死为模型声明**

`evt += h` 的模型贡献 = **两个独立通道的直和**：

- 通道 (i) 委托字段 read-modify-write → **state 效应**（现机制正确，extractor stateWritePos）；
- 通道 (ii) 注册义务 → 触发点展开 h 的闭包（新订阅边）。

删 (i) → Wire 翻 PURE（fixture.test.ts:92 实测 8/8 锚，本次确认存活）；删 (ii) → handler io 漏报假纯。形式声明入 M_out/README：「订阅边不得取代 state 写；`+=` 的效应贡献 = state(委托字段变异) ⊕ {handler 闭包于触发点展开}」。`-=`：静态并集单调吸收（只增不减）→ 仅多余边（S2 安全）；真正残差 = 动态 handler 表达式（RHS 非静态形态）→ 形态守卫 → 触发端 `?`。

### 新洞一枚（plan 未提）

**事件声明节点无 chunk → 事件本身不可标注**（无公理4 id）——判别力通道在触发方法（private 事件触发端去 `?`）。scope 声明需要，避免用户期待「标注事件」失败。

**验收锚核验**（plan 与 iter42 一致）：EventSubscribe fixture——Raise 的 `chunk.calls` 含 HandleLevel key（Set 包含性）+ purity 保持 1 + Wire purity=2 保持（本轮实测锚）+ in-memory private 事件判别力用例。与现有断言零冲突 ✓。

---

## 3. 候选 C（static-init side table）——裁决：**do-now**（iter43-r2，独立轮），三处修正

### lumped → 精确迁移的形式化

现状（6336d78，link.ts）：静态访问路径（1207-1276）与 new C() 路径（978-1017）都并集 = **class chunk 原始调用（静态 + 实例字段初始化器）∪ `${c}.${c}` ctor 并集（静态 ctor + 实例 ctor）**。

目标状态（精确）：

- **TypeInit(C)** = staticInit(C)（静态字段初始化器调用 ∪ 静态构造器体调用，单一单元）；
- **InstanceInit(C)** = classChunk(实例字段初始化器) ∪ instanceCtor(C)。

迁移后两路径：

- **静态访问路径（C.Get()/C.X）**：TypeInit(C) —— 现状是 TypeInit ∪ InstanceInit（过近似）。
  - **修正 1（plan 漏项）**：改指 = **同时替换 ctor 并集与 class chunk 并集**。plan 只写「全部 ctor chunk 并集 → 仅 static-init」——若 class chunk 并集保留，**实例字段初始化器仍经 class chunk 漏入静态路径**，过近似不消除。
- **new C() 路径（L5）**：TypeInit(C) ∪ InstanceInit(C) —— **并集逐项等价于拆分前**（static ctor chunk 被吸收、class chunk 保留实例初始化器、staticInit 边补入）。
  - **修正 2（防假纯回归，必须写死）**：plan「L5 new C() 闭包从全部 ctor chunk 并集精确为仅 static-init」措辞危险——按字面只并 staticInit 会丢失实例字段初始化器 + 实例构造器效应 = **S1 假纯回归**。L5 = staticInit ∪ classChunk ∪ instanceCtor，逐项写死。
  - **修正 3（隐式纯条件同步）**：link.ts:1000-1007 隐式默认构造判纯条件「闭包零显式 ctor ∧ 全部 class chunk 零调用」——拆后 class chunk 零调用 ≠ 类型加载零效应：`class C { static int X = ReadFile(); }` 无显式 ctor + `new C()` → 只查 class chunk 会翻 PURE **假纯**。条件须同步查 staticInit 零调用。

### 格语义（静态字段初始化器 + 静态构造器体合并为 static-init 单元）

C# 规范：静态字段初始化器按文本序执行、随后静态构造器体，均在**类型加载事件**内（首次任何使用前一次）→ 合并为一节点 = 类型加载事件的精确建模。**节点细化**（标注单元细化）非 A7 原子集扩展：Σ 不变、Λ 不变、无新效应原子。效应并集对执行序不敏感 → 合并零信息损失。与 L5 边界（实例字段初始化器留 class chunk）精确对齐 C# 规范。side table（`staticInitChunks: Record<class, chunkKey>`，RawFileFacts 新字段）优于合成 chunk：合成 chunk 名会入 bySimple/byQualified 索引（link.ts:107-127）污染命名空间——plan 判断正确。

### 标注 id 迁移（plan 声称修正）

**修正 4**：plan「class chunk normText 变化 → 公理4 id 漂移」与 iter42 工程评审实证**矛盾**（jeff §1 候选2：class chunk normText 是全节点归一化 normalizeCode，**id 不变**）。最小实现（side table + 调用过滤，不改 class chunk normText）下：class chunk id 稳定；**静态 ctor chunk id 消失**（并入 static-init，挂旧 id 的标注静默失效）；staticInit 新 id 出现；class chunk calls 明细变化（语料 calls 明细，C3 corpus-e2e 幂等重建可恢复）。正确声明：发布动作 = 标注/语料重扫（iter42 §2c 同旨，但 id 漂移主体是静态 ctor chunk 而非 class chunk）。

### 附带收益与验收

P4 实证确认：static-init chunk 置 ownerClass=类 → 裸名走 implicitThis 可解析 → class chunk 的 `?` 消失 → new C() 翻确定判定（判别力收益，纯度分布变化）→ 验收 = csharp-lang 全量 + 自扫描 invariantViolations=0 + 分布核对（jeff 先例）。**分布核对正是 A1 应排在 C 之后的原因之二**。另注：static ctor 与实例 ctor 的 `C.C` 撞名歧义在拆分后自然消除（jeff 观察）——行为变化方向 = 并集单化，无害。

---

## 4. 范围裁决

- **A1+B 同轮（~300 行）：否决**。项目惯例 ~200 行/轮（iter40 参照；jeff 已裁 B 单独 200-250 行临界）。且时序约束（A1 快照须在 B、C 分布稳定后校准）使 A1+B 同轮产生「快照落地即红」的必然维护事件。
- **建议排程**：iter43-r1 = B（事件订阅修正版）；iter43-r2 = C（static-init side table）+ L1 跨语言测试（§5，小件并入）；iter43-r3/iter44 = A1（回归网，B/C 后校准）+ A2 离线验证场（可选）。
- **C 独立轮：是**（150-200 行 + 标注迁移发布动作 + P4 分布核对；与 B 撞车违反「两件大件不同轮」既有裁决 D-135）。

---

## 5. 第 4 个候选（被漏掉）——**L1 跨语言静态访问路径测试：成立，必补**

iter42 候选7/H1 闭包测试全在 csharp-lang.test.ts（C# 三态）；H1 代码路径语言无关（globalClasses 分支共享，link.ts:1207-1276）但 **TS（static 字段初始化器 = 类型加载）与 Python（类体赋值 = 类定义时执行，同为类型加载）零测试覆盖**。C 拆分后「静态访问不含实例构造器」的精确性断言也应跨语言。成本 ~40-60 行，并入 C 轮。

次要候选：--state 状态耦合图输出（D-127 候选——D-128 只修了崩溃，write→readers 映射输出未落地）plan 未提，需显式裁决（defer 或独立小候选）。

---

## 6. 配对审计缺口核实（修复后自动再审）

两缺口**均已修复**，落在 HEAD 6336d78（提交 27282cb，diff 实证）：

- **缺口 1（M6 行丢失 / M7 重复，L54-55）**：27282cb 恢复 M6 行（含「已修（迭代40 M6，TS/JS）；Python 保持（`__getattr__` 动态，静态不可判定）」+ 接受列「Python：文档化接受（动态属性协议）」），删除重复 M7 行。当前文件 L54-55 = M6 + M7 各一行，无重复。
- **缺口 2（L199 B4/B8/B12 → B8/B12）**：27282cb 已改，当前 L199 = 「假纯可能通道（B8/B12）」。
- 本轮无需写文件，无「无法修复」项。
- **残余观察（低）**：M_out 契约行「M1-M6 任一升级修复后移出清单」（L57）未随 M7 条目更新枚举——M7 已修但保留 + 已修标注（与 M5/M6 先例一致），契约文字应写「M1-M7」或改为「任一已修条目」；下轮可顺手。

---

## 7. 评审问题清单逐条回答（plan 五个问题）

1. **范围裁决**：A1+B 同轮超规模（否决，§4）；B 独轮 iter43-r1；C 独立轮 iter43-r2；A1 最后（B/C 后校准）。
2. **候选 A 形态裁决**：A1 do-later（独立轮；快照可靠性 = 纯函数生成 + 三层断言：哨兵精确判定 / 分布不变量带余量 / 精确计数显式更新纪律；敏感性论证：修复红、无关绿、C# 行为变化红是特性非缺陷）；A2 defer（license/体积/18s+ 扫描不适合 CI）；A3 残余价值≈0（iter42 已覆盖，B 验收锚即 fixture 扩展）。plan 语言声称修正：现有合成大库是 Python 非 TS。
3. **候选 B 设计复核**：(a) 引理对初始化器形态成立（构造序论证，S2 方向安全）；须补 propertyReadSkipParents +1 行（F3 意外 prop 边）；(b) `evt(...)` 提取完备（F4 同命名空间无歧义；六类触发形态全枚举 + 逃逸落 `?`）；(c) 可见性守卫对 static/跨实例完备（接收者类型条件：不可证 → 集合不完整 → 触发端 `?`）；(d) 环 SCC cycles +2（自环），双跑区间诚实；(e) `+=` 双语义 = state ⊕ 订阅边直和（fixture.test.ts:92 实测锚）。新洞：事件不可标注、初始化器 RHS 意外 prop 边。
4. **候选 C 衔接**：lumped→精确 = TypeInit/InstanceInit 分离；静态路径改指须**同时替换 ctor 并集与 class chunk 并集**；L5 并集不变（措辞修正防 S1 回归）；隐式纯条件同步查 staticInit；id 迁移按 jeff 实证修正（class chunk id 不变，static ctor id 消失）。
5. **第 4 候选**：L1 跨语言静态访问路径测试（TS/Python 零覆盖，必补，并入 C 轮）；--state 输出未落地需显式裁决。

---

## 8. 收敛/内敛附注（极小性观察）

- plan 声称-事实漂移 2 处：合成大库语言（Python 非 TS）；class chunk normText/id 漂移（与 jeff 实证矛盾，应改 static ctor id 消失）。
- 无死字段/重复实现新增：事件注册表与 staticInit side table 均走既有先例（virtualMembers 侧表 / propertyReadSkipParents 数据表），新形态进表即最小实现，引擎零语言常量纪律保持（P0-3）。
- 趋势：iter42 三项落地（候选7/候选3/文档改标）全部在基线声明内；B/C 均带验收锚 + 回归锚（fixture.test.ts:92 实测、EventSubscribe 扩展、三态对照）——收敛方向单调，无停滞重复；本轮裁决无「被噪声满足的停止准则」迹象（357/357 基线 + 门禁绿 + 锚实测）。

## 证据锚

| 发现 | 锚 |
| --- | --- |
| 合成大库是 Python（plan 声称 TS 错误） | test/e2e/synthetic.test.ts:9,56 |
| H1 ctor 并集 = 静态+实例双份 | link.ts:1241-1250（byQualifiedAll `${c}.${c}`） |
| 候选7 闭包含 class chunk（实例字段初始化器漏入静态路径） | link.ts:1226-1236 |
| L5 并集循环 + 隐式纯条件 | link.ts:978-997, 1000-1007 |
| event_field_declaration 零匹配（不在 skipParents） | src/ 全仓 grep + csharp.ts:670-717 |
| isPropertyRead 只查直接父节点 | extractor.ts:1239-1244 |
| Wire purity=2 锚实测通过 | fixture.test.ts:92 + vitest 8/8（本次实测） |
| 事件触发现状落 ?（三形态） | link.ts 通道序 1318-1698（obj 事件名 → markDynamic 1696-1697；裸名 → markUnknown 1691-1693） |
| 无精确 cycles 断言 | test/** grep stats.cycles 全 ≥1 形态（iter42 jeff 实证） |
| 配对审计两缺口已修复 | 27282cb diff（M6 恢复/M7 去重/B4→B8/B12）+ 当前文件 L54-55/L199 |
| C# 静态 ctor 与实例 ctor 撞名现状 | csharp.ts:638 constructor_declaration ∈ chunkNodes + link.ts:905 isCtor 限定名 |

## 9. 裁决汇总

| 候选 | 裁决 | 一句话理由 |
| --- | --- | --- |
| A1 真实感 C# 合成大库 | **do-later**（独立轮，B/C 后校准） | 快照须在行为稳定后校准；三层断言 + 显式更新纪律 |
| A2 InitDeity 完整入库 | **defer** | license/体积/18s+ 扫描不适合 CI；仅离线验证场 |
| A3 维持摘录级扩展 | **并入 B 轮** | 残余价值≈0（iter42 已覆盖），B 验收锚即 fixture 扩展 |
| B 事件订阅（修正版） | **do-now**（iter43-r1） | 引理/守卫/双语义均成立；补 3 修正（skipParents +1 行、接收者类型条件、cycles +2） |
| C static-init side table | **do-now**（iter43-r2） | 格语义干净；L5 措辞修正防 S1 回归；id 迁移声明修正 |
| L1 跨语言静态访问测试 | **do-now**（并入 C 轮） | TS/Python 零覆盖，H1 路径语言无关 |
| --state 耦合图输出 | **defer**（显式裁决） | D-127 候选未落地，plan 未提，需主会话裁决 |
