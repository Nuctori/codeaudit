# 迭代 43 工程评审（02-jeff-review）——三候选落地性裁决 + 顺序 + 陷阱 + 验收口径

> 评审者：Jeff Dean 评审角色（工程落地性）。只读评审，未修改任何仓库文件。
> 前置：00-plan.md + 01-math-review.md（数学家裁决）已读；iter42 双评审已读。
> 实证：fixture.test.ts 今日实测 **8/8 通过**（556ms，Wire purity=2 锚存活）；HEAD=6336d78、工作树干净（仅 docs/iter43/ 未跟踪）；`event_field_declaration` src/ 全仓零匹配（F3 复核）；csharp.ts 无 lambdaNodes/lambdaAssignNodes（P2 复核）；synthetic.test.ts = 300 个 Python 文件（F1 复核）；test/** 全部 cycles 断言为 ≥1 形态（无精确断言，复核）。

## 0. 前置事实核查（工程侧补充，全部与数学评审一致，无新分歧）

- **E1 — 事件触发形态现状落点实测定位**（为 B 轮通道插入点提供精确坐标）：
  裸名 `evt(...)` → implicitThis 分支（link.ts:1493-1531）resolveClassMember miss → prop=false 落出 → 效应表 miss → **markUnknown（link.ts:1691-1693）**；
  `evt.Invoke()`/`evt?.Invoke()`（obj="OnLevelChanged"）→ resolveObjDispatch（1664-1679）globalClasses/效应表全 miss → return false → **markDynamic（link.ts:1696-1697）**。
  → B 的新事件通道插入点 = 此两出口**之前**，既有通道先裁决，零优先级扰动（与 iter42 P3 一致）。
- **E2 — L5 隐式纯分支的保护结构**：link.ts:978-993 bodyEdges 计数 → 994-997 `if (r==="edges" || bodyEdges>0) return true` → **1000-1007 隐式纯分支只在闭包全部 class chunk 零原始调用时可达**。→ C 轮 staticInit 边**计入 bodyEdges** 后，隐式纯分支天然被保护（数学 修正 3 的实装位就是这个计数器，不是新条件）。
- **E3 — bySimple/byQualified 索引形态**（link.ts:107-127）：bySimple 键 = rc.name、byQualified 键 = ownerClass.name。合成 static-init chunk 命名 `<static-init>`（C# 非法标识符，尖括号不可能出现在用户标识符）→ 两个索引条目均为**死条目，零碰撞**；globalClasses 只收 kind=class（link.ts:175-183）→ static-init chunk（kind=function）走不到 globalClasses → **side table 仍是必需品**（三消费点要 class→key 映射），"防索引污染"是 side table 的次要理由。
- **E4 — iter42 候选7 测试不断言 chain**（csharp-lang.test.ts:1172-1226 只断言 purity/effects）→ C 轮 chain+1 对现有测试零破坏。
- **E5 — EXTRACT_SIDE_TABLES 白名单**（effectOverride.ts:55-60）已含 propertyRead* 全部表；C/B 若新增参与缓存的提取侧表（staticModifiers/eventFieldNodes 等）**必须同步补入**，否则 override 注入静默失效（C02 纪律）。

---

## 1. 逐项工程裁决

### 候选 B（事件订阅，数学修正版）——工程裁决：**do-now（iter43-r1），250 行封顶**

**落地成本**：extractor 三形态提取（事件声明/订阅点/初始化器订阅）50-70 行 + pack 新数据表 ~10 行 + link 事件映射 + 尾部双出口前新通道 + private 守卫 40-60 行 + 测试 100-120 行 ≈ 200-250 行。超一轮规模（iter40/42 参照 ~200 行含测试），但数学评审已交付完整修正设计（守卫公式/形态枚举/双语义声明），无设计悬案；作为单轮可接受，**超 250 行优先砍测试用例数而非机制**。

**通道序交互**：零优先级扰动（E1 坐标：插入点 = markUnknown/markDynamic 之前）。订阅端 `+=` 的 state 写通道（extractor augmented_assignment）**原样不动，只加不减**。

**测试策略**：① fixture 扩展（EventSubscribe：Raise 的 chunk.calls 含 HandleLevel key + purity 保持 1）；② in-memory private 事件判别力用例（Fire 触发端 `?` 消失→确定判定）；③ **跨实例订阅→触发端 `?` 传导用例**（数学 §2c 补强——"只收 bare+其他落 ?"只保护订阅方，验收必须断言触发端也带 `?`，这是 plan 原设计缺的传导路径）；④ 事件字段初始化器订阅用例（`public event Action OnX = HandleX;`——修正 1 + 订阅边双计防回归）。

**回归风险（实测预演）**：fixture 8/8 今日实测（Wire purity=2 锚存活）。EventSubscribe 两事件均 public → 守卫触发 → purity/unknownSites **全部不变**；变化仅 (i) stats.cycles +1~2（Raise↔HandleLevel SCC + HandleQuest 自环——现有断言全 ≥1 形态，E4 复核安全）；(ii) 触发端新增 handler 边（反向闭包/回归风险报告消费者受益——真正的价值在 risk 报告不在 purity）。UIWorldLink 无事件 → 零影响。**唯一必须盯住的回归锚：fixture.test.ts:92**。

### 候选 C（static-init side table）——工程裁决：**do-now（iter43-r2），独立轮**

**落地成本**：extractor static 修饰符检测 + 字段初始化器调用分区 + static-init chunk 创建 ~40-60 行；RawFileFacts.staticInitChunks 新字段 ~5 行；link 三消费点改指（L5 并集 978-997 / 候选7 闭包 1221-1252 / 隐式纯 1000-1007）30-50 行；测试 ~80 行。合计 ~150-200 行。与 B 不同轮（D-135：两件大件不同轮，iter42 裁决先例）。

**实现形态裁决（side table vs 合成 chunk——任务点名项）**：**兼用，不是二选一**。

- side table（`staticInitChunks: Record<class, chunkKey>`）是必需品：调用边必须挂在 chunk 上（RawCall 无独立成边能力），link 三消费点需要 class→key 映射，且 globalClasses 只收 kind=class 到不了 static-init chunk（E3）。
- 合成 chunk 命名 `<static-init>`（C# 非法标识符）→ bySimple/byQualified 死条目零碰撞（E3）——iter42 的"污染命名空间"担心在此命名下不成立，但这是命名纪律问题，不是反对合成 chunk 的理由；两者必须同时存在（side table 提供映射、合成 chunk 提供调用载体）。
- **ownerClass = 类名**（P4 收益：static-init chunk 内裸名走 implicitThis 可解析）。
- **分区逻辑是核心实现义务**：类 chunk 的调用收集必须**跳过** static field/ctor 子树，否则 class chunk 仍含静态初始化器调用 → 过近似不消除（数学 修正 1 的实装位）。静态 ctor（constructor_declaration + static modifier）并入 static-init 单元；静态字段初始化器（field_declaration + static modifier 的 value 位调用）并入；实例字段初始化器留 class chunk。

**P0-3 零语言常量纪律**：static 修饰符检测走**新数据表** `staticModifiers?: readonly string[]`（先例：virtualModifiers/sealedModifiers，pack.ts:293-295 + csharp.ts:835-836 同构），**不做新行为函数**；事件形态同：`eventFieldNodes?: readonly string[]`。`validatePackConsistency`（pack.ts:389）可选加互斥断言（staticModifiers ∩ virtualModifiers = ∅，C# 静态与虚互斥；数据上平凡成立，防未来语言包填错）。新增提取侧表同步补 EXTRACT_SIDE_TABLES（E5）。

**通道序交互**：L5 并集循环内 staticInit 边**计入 bodyEdges**（与 class chunk 边同计数）→ 隐式纯分支（1000-1007）在 bodyEdges>0 时提前 return（994-997）→ 天然被保护（E2）。契约写死：「staticInit 边必须计入 bodyEdges 守卫，否则拆分后 `class C { static int X = ReadFile(); }` + new C() 翻 PURE 假纯」。候选7 闭包改指 = 只并 staticInit（删 class chunk 并集与 `${c}.${c}` ctor 并集——实例初始化器/实例 ctor 不执行于静态访问）。

**回归风险**：P4 分布变化（class chunk 裸名 `?` 消失 → new C() 翻确定判定）——真实扫描纯度分布会动，以 csharp-lang 全量 + 自扫描 invariantViolations=0 兜底；chain+1 对现有测试零破坏（E4）；标注 id 迁移 = class chunk id 稳定（normText 全节点归一化不变）、静态 ctor chunk id 消失、staticInit 新 id 出现、class chunk calls 明细变化 → **发布动作 = 标注/语料重扫**（数学 修正 4 与 iter42 实证一致）。

### 候选 A1（C2 真实感 C# 合成大库）——工程裁决：**do-later（独立轮，B/C 后校准）**

**落地成本**：生成器 80-120 行 + 测试文件 ~100 行 + 校准一遍。复用 synthetic.test.ts 的 mkdtemp + scanProject + 双扫确定性模式（合成大库确为 Python 300 文件，F1 复核），新文件 `test/e2e/synthetic-csharp.test.ts`；生成器纯函数（固定种子/纯公式，无 Math.random）。

**分布快照断言设计（任务点名项——哪些数字可断言、哪些不能）**：

| 层 | 断言内容 | 可靠性 |
| --- | --- | --- |
| (i) 哨兵精确判定 | 10-20 个痛点形态 chunk 的 purity/effects（getter io 传染 / enum 判纯 / 静态访问类型加载 / 成员 miss 结算 / 事件触发 / ctor 并集） | **主网**：修复引入红、无关改动绿 |
| (ii) 分布不变量带余量 | unknown-rate ≤ X%、pure ≥ Y%（余量取实测头部空间）、invariantViolations=0、staleEdges=0、parseErrors=0、files/chunks 区间 | 防「机械更新数字掩盖回归」 |
| (iii) 精确三态计数 | pure/impure/unknown 总数 | **最高灵敏度金丝雀**：任何 C# 行为变化（含有意修复）都红 → 必须配显式更新纪律（测试头注释 + 每次行为变化显式更新，项目手写断言惯例，不引入快照框架） |
| ✗ 不可断言 | 精确 cycles 数（B 落地 +1~2、自环行为依赖实现细节）；穿过类型加载边的精确 chain 值（C 加边 +1）；无余量的精确 unknownRate（P4 翻案） | 断言即脆弱，会随 B/C 必然红 |

**校准时序（决定性）**：B 改变 stats.cycles 与调用边、C 改变纯度分布（P4）→ A1 快照若在 B/C 前校准，落地后必然红一次。**A1 必须排 B、C 之后**（iter43-r3 / iter44），或接受「每行为变化显式更新数字」的持续维护成本。数学裁决同意，工程侧无补充。

---

## 2. 落地顺序建议

| 轮次 | 内容 | 规模 | 依据 |
| --- | --- | --- | --- |
| **iter43-r1** | 候选 B（事件订阅修正版） | ~200-250 行 | 数学评审已交付完整修正设计；E1 已给出插入点精确坐标；fixture 回归锚实测存活 |
| **iter43-r2** | 候选 C（static-init side table）+ L1 跨语言测试（小件并入） | ~150-200 行 + ~40-60 行 | C 独立轮（D-135）；L1 是 H1 路径的 TS/Python 零覆盖补齐，成本小 |
| **iter43-r3 / iter44** | 候选 A1（C2 回归网） | ~200 行 + 校准 | 必须在 B/C 分布稳定后校准 |
| **defer（显式裁决）** | A2（InitDeity 入库）、候选 4/5/6（iter42 已裁）、--state 耦合图输出（D-127，plan 未提，维持数学裁决） | — | license/体积/18s+ 扫描不适合 CI；--state 无消费者紧迫性 |

顺序原则（延续 iter42）：**先判别力特性（B）→ 再粒度精确化（C）→ 最后回归网（A1）**。B/C 两件大件不同轮，不违反 D-135。

---

## 3. 工程陷阱（按严重度，全部经源码/实测核实）

1. **（高）`+=` 双重语义回归**：订阅边**不得取代** state 写。fixture.test.ts:92（Wire purity=2）今日实测存活（8/8）——实现后该断言必须原样保持；任何把 `+=` 从 stateWrites 移走的实现直接红。实现方向：extractor 只增订阅提取，不动 augmented_assignment 写判定。
2. **（高）事件字段初始化器意外 prop 边（F3 复核成立）**：`public event Action OnX = HandleX;` 的 RHS identifier 的 parent = equals_value_clause，**不在** propertyReadSkipMorphs（csharp.ts:661-668）也不在 propertyReadSkipParents（csharp.ts:670-717，逐项核对无 event_field_declaration）→ isPropertyRead（extractor.ts:1238-1263）判为 prop 读 → implicitThis → resolveClassMember 命中 handler → **class chunk 已意外获得 → handler 的调用边**（S2 方向噪音，且 B 落地后与新订阅边双计）。修复 = propertyReadSkipParents 加 `event_field_declaration`（1 行）。**调用形态初始化器（OnX = Factory()）不受影响**——invocation 走 callOf 非 prop 通道（数学 修正 2 自动成立）。
3. **（中）lambda 订阅形态非 chunk（P2 复核成立）**：csharp.ts 无 lambdaNodes/lambdaAssignNodes（grep 零匹配）→ v1 必须把 lambda RHS、`new Action<T>(H)` 显式分类为「订阅集合不完整 → 触发端 ?」。若未来补数据表，注意直接填 augmented_assignment_expression 会让 chunk 名取到左值 "OnLevelChanged"（撞名，必须改名槽位）——iter42 jeff 陷阱 1 原样保留。
4. **（中）跨实例订阅接收者类型不可证 → 订阅不可归属 → 触发端 `?` 传导**（数学 §2c 补强）：plan 的「只收 bare + 其他形态落 ?」只保护订阅方、未传导触发端——验收用例必须断言触发端带 `?`。
5. **（中）static-init 分区逻辑漏网**：类 chunk 调用收集必须跳过 static field/ctor 子树（否则过近似不消除）；staticInit 边必须计入 bodyEdges（E2 实装位）。两条都是「拆分没拆干净/拆出假纯」的实现级风险，必须写进实现契约 + 反例测试。
6. **（中）标注 id 迁移发布动作（C 轮）**：静态 ctor chunk id 消失 + staticInit 新 id + class chunk calls 明细变化 → 标注/语料重扫必须作为发布动作计划，防标注静默丢失。
7. **（低）A1 快照脆弱性**：三层断言 + 显式更新纪律（§1 A1 表）；校准时序 B/C 后。
8. **（低，文档）数学 §6 残余观察**：M_out 契约行「M1-M6 任一升级修复后移出清单」（technical-debt.md L57）未随 M7 更新枚举——下轮顺手改「M1-M7」。

---

## 4. 验收口径建议

**B 轮门禁**：

- 测试增量 ≤3 个新 it（~100-120 行）：private 事件判别力、跨实例订阅传导 `?`、事件字段初始化器双计防回归；fixture 扩展 1 断言（Raise 的 chunk.calls 含 HandleLevel key）。
- 回归门禁：357/357 全量（fixture.test.ts:92 Wire purity=2 原样保持）+ tsc 0 + essence 8/8 + 自扫描 invariantViolations=0 + README 测试数同步（scripts/check-readme-tests.cjs 门禁）。
- 断言形态：purity 数值 + effects 集合成员 + chunk.calls Set 包含性；**不断言精确 cycles**（+1~2 变化已声明）。

**C 轮门禁**：

- csharp-lang 全量 + 新增 static-init 拆分三态用例：(i) 静态访问含静态初始化器 io → IMPURE（精确后仍传染）；(ii) new C() 并集 = staticInit ∪ 实例初始化器 ∪ 实例 ctor（逐项写死，防 S1 回归）；(iii) 隐式纯反例（`static int X = ReadFile()` 无显式 ctor + new C() → 不得翻 PURE）。
- L1 跨语言：TS static 字段初始化器 / Python 类体赋值 → 静态访问路径 IMPURE（H1 路径语言无关性验证）。
- 分布核对（P4）+ 标注/语料重扫发布动作 + 自扫描 invariantViolations=0 + README 测试数同步。

**A1 轮门禁（延后）**：三层断言（§1 A1 表）+ 校准顺序声明（B/C 后）。

---

## Review 汇总

- **Correct**：数学评审的三项裁决（B do-now r1 / C do-now r2 / A1 do-later）工程上全部可落地；fixture 回归锚实测存活（8/8）；E1-E4 复核与数学证据全部一致，无新分歧。
- **Blocker**：无。两处实现级风险（订阅边取代 state 写、staticInit 边漏计 bodyEdges）已有现成回归锚与契约写死点。
- **Note**：B/C 都超一轮规模上限（~200 行），以 250 行封顶 + 优先砍测试用例数控制；A1 必须排 B/C 后校准，否则快照落地即红。

## 证据锚

| 发现 | 锚 |
| --- | --- |
| fixture 8/8 实测（Wire purity=2 锚存活） | npx vitest run test/audit/fixture.test.ts（本次运行 8/8, 556ms） |
| 事件触发现状落点（裸名→markUnknown / obj→markDynamic） | link.ts:1493-1531, 1691-1693, 1696-1697；resolveObjDispatch 1664-1679 |
| L5 bodyEdges 守卫 → 隐式纯分支保护结构 | link.ts:978-997, 1000-1007 |
| bySimple/byQualified 索引形态（死条目论证） | link.ts:107-127；globalClasses 只收 kind=class link.ts:175-183 |
| iter42 候选7 测试不断言 chain | csharp-lang.test.ts:1172-1226（purity/effects only） |
| event_field_declaration src/ 零匹配 | 全仓 grep（本次复核） |
| csharp.ts 无 lambdaNodes/lambdaAssignNodes | grep（本次复核） |
| 合成大库是 Python 300 文件 | test/e2e/synthetic.test.ts:9,13,52（本次复核） |
| 无精确 cycles 断言（全 ≥1 形态） | test/** grep：topology:39,98,106 / adversarial:102 / fixtures:92 / synthetic:86 |
| EXTRACT_SIDE_TABLES 白名单 | src/lang/effectOverride.ts:55-60 |
| README 测试数门禁 | scripts/check-readme-tests.cjs（D-079） |
| 基线 HEAD | git log 6336d78 + git status（仅 docs/iter43/ 未跟踪） |
