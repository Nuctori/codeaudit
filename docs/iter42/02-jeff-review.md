# 迭代 42 工程评审（02-jeff-review）

> 评审者：Jeff Dean 评审角色（工程落地性）。只读评审，未修改任何文件。
> 前置：01-math-review.md（数学家裁决）已读；所有证据锚经源码 + 实测探针核实。
> 探针方法：以 vitest 临时用例跑 `scanProject`（in-memory 项目），实测当前行为，探针文件已全部删除，工作树干净。

## 0. 前置事实核查（工程侧补充数学家未覆盖的实证）

实测探针（临时项目，与数学评审 F1/F2 相互印证）：

**P1 — 静态成员访问路径的活假纯洞已实测确认（数学评审候选 7 成立）**：

```
public static int X = File.ReadAllText("a").Length;  // 静态字段初始化器（类型加载时执行）
public static int Get() { return X; }
User.Use() { var v = P.Get(); }   → PURE=0（运行时类型加载执行 File.ReadAllText → 现实 io）★假纯
User.ReadX() { return P.X; }      → PURE=0 ★假纯
User.Make() { new P(); }          → IMPURE=2 fs（L5 并集正确包含——对照成立）
```

证据锚：`P.cs` 探针输出 `Use purity=0` / `ReadX purity=0` / `Make purity=2 effects=fs`。
根因（与数学评审一致）：全局类分支（link.ts:1207-1237）直接解析到成员 chunk，class chunk 不在闭包上（class chunk 只经 ctor-merge 边被 new C() 路径到达，link.ts:439-448）。

**P2 — C# lambda 在事件订阅位不是 chunk（数学评审 §1b 的事实错误，工程陷阱 3）**：
`evt += (x) => {...}` 的 lambda 体调用归入**外层方法 chunk**（Wire），而非独立 chunk。
证据锚：extractor.ts chunkName 三支路——lambdaNodes 支路（extractor.ts:1078-1090）需 pack 的
`lambdaNodes` + `lambdaAssignNodes`，而 csharp.ts **未填**这两张表（csharp.ts:852 只填
fnLiteralNodes，用于 variable_declarator 支路的函数字面量判定）；`+=` 的 parent 是
augmented_assignment_expression 也不在 lambdaAssignNodes。→ 数学评审「lambda 已是 chunk
（D-059），可建边」对 C# 事件订阅位**不成立**。后果：若按该假设实现，lambda 订阅形态将
静默漏建 invoke 边（lambda 体 io 不归属触发端）——必须显式声明为「订阅集合不完整 → 触发端 ?」。

**P3 — 事件形态现状实测（EventSubscribe 同构探针）**：

```
public event Action<int> OnLevelChanged;         // event_field_declaration（AST 实证）
private event Action<int> Hidden;
public static event Action<int> StaticEvt;
static int X = Compute(1);                       // field_declaration + modifier(static)
Fire() { OnLevelChanged?.Invoke(1); Hidden.Invoke(2); StaticEvt(3); }
```

- 三种触发形态（`?.Invoke` / `.Invoke` / 直接调用 `evt(args)`）当前全部落 `?`（unknown=3）——证据锚：探针 `Fire unknown=3`。
- `+=` 订阅端 → state 写（`self.OnLevelChanged`），Wire IMPURE——与 fixture.test.ts:92 断言一致。
- AST 实证：事件声明 = `event_field_declaration`（含 `modifier` 子节点 → 可见性可取）；
  静态字段 = `field_declaration` 的 `modifier` 子节点 text === "static"；
  静态构造器 = `constructor_declaration` 的 `modifier` 子节点（探针 iter42e 输出）。

**P4 — 静态初始化器拆分附带的正向副作用（计划未提）**：class chunk（ownerClass=null）内
静态字段初始化器的裸名调用（`static int X = Compute(1)`）当前落 `?`（探针：class chunk
`E` unknown=2 → UNKNOWN）。拆分到 ownerClass=类 的 static-init chunk 后，裸名走 implicitThis
通道可解析 → **new C() 从 UNKNOWN 翻为确定判定**。这是判别力收益，但也是行为变化
（真实扫描纯度会翻），须在验收时注意分布核对。

---

## 1. 逐项工程裁决（数学评审 do-now 候选）

### 候选 3（enum 判纯）——工程裁决：**本轮 DO-NOW**（全迭代最小件）

- **成本**：csharp.ts 2 行（chunkNodes + classNodes 各加 `"enum_declaration"`）+ csharp-lang.test.ts 1 个 in-memory 项目（~25 行）。共 ~30 行。零新机制。
- **通道序交互**：无新通道。enum chunk（kind=class）进 globalClasses（link.ts:175-183 只收 kind=class → 命中）；读取 `GameState.Menu` 走既有 prop miss + propMissIsPure 判纯（link.ts:1224-1236）。classNodes 先行先例 = interface_declaration（csharp.ts:636/646 同构）。
- **回归风险核查（逐项排除）**：
  - enum 无方法体 → 方法归属/虚拟成员零影响；
  - `new EnumType()` 非法 C#：resolveCtorCall → resolveClassMember miss → "none" + clsEntries 命中 → 隐式默认构造判纯分支（link.ts:1000-1007）→ PURE，无害；
  - 项目 enum 撞 pureGlobals 键（Color）：globalClasses 先于 pureGlobals（link.ts:1207 vs 1239）→ 项目 enum 优先，结果同为 PURE；
  - 项目 enum 撞 impureGlobals 键（Debug）：`Debug.Log` 是调用形态（非 prop）→ resolveClassMember miss 后落 impureGlobals → io 不变；仅 `Debug.SomeMember` 读取形态被 enum 截胡判纯——编译上成员不存在，无害；
  - enum 成员读取已被 propertyReadSkipParents 排除（csharp.ts:678-679）→ 无新增噪音；
  - stats.chunks 增加（enum 数），无测试断言精确 chunk 数（grep 核实：仅 fixture 断言 files ≥ 8）。
- **范围声明**：仅顶层 enum（嵌套 enum 的 `A.B.X` obj="A.B" 不命中 globalClasses 裸名索引 → 保持 `?`，安全，数学评审 §3 同）。

### 候选 7（静态成员访问类型加载闭合）——工程裁决：**本轮 DO-NOW（最小版，不做 chunk 拆分）**

- **成本**：link.ts 全局类分支（1207-1237）追加 class chunk 边：member 解析成功（`any`）后，
  遍历 `ancestorClosureOf(call.obj)` 的 globalClasses 条目，`rc.calls.length > 0` 的 class chunk
  全部 `addEdge(e.key)`（与 L5 并集循环 link.ts:978-997 同构复用）。~15-25 行 + 1-2 个 in-memory 测试（~40 行）。
- **语义**：`C.Get()` / `C.X`（prop）触发类型加载 → 并集进类 chunk（含静态字段初始化器效应）。
  实例字段初始化器效应同包（类 chunk 本就不区分静态/实例）——**S2 过近似，方向安全**，与
  L5 的 new C() 合并语义完全一致（现状即同包，本修复只是把同一合并扩展到静态访问路径）。
- **交互风险**：全局类分支位于 impureGlobals 之前——加边后 return true 不落效应表；只影响
  项目类静态访问。纯静态工具类（无字段初始化器调用）`rc.calls.length === 0` → 不加边 → 零
  变化（对照断言锁定）。真实代码纯度翻转方向恒为 PURE→IMPURE/UNKNOWN（活洞闭合，非回归）。
- **测试策略**：in-memory csharp-lang.test.ts，不用 fixture（fixture 无此形态）。断言三态：
  (i) 表解析 io 静态初始化器（File.ReadAllText）→ `C.Get()`/`C.X` IMPURE=2 fs（修复前 PURE）；
  (ii) 裸名方法调用静态初始化器（Compute(1)）→ `C.Get()` UNKNOWN=1（诚实，非 PURE）；
  (iii) 对照：无字段初始化器纯静态类 → 仍 PURE=0。
- **注意**：本轮最小版把 static-init 效应留在 class chunk（不拆分）；iter43 做候选 2 时把本
  位置的 lumped 边改指 static-init chunk（同位置小重构，非返工）。

### 候选 2（静态初始化器独立 chunk）——工程裁决：**do-now，但延后到 iter43**

- **成本**：extractor 静态 modifier 检测 + 静态字段初始化器调用重定向（新 chunk 或 side
  table）~40-60 行；link 三个消费点（L5 并集循环、isCtor 解析、候选 7 的消费点改指）~30-50
  行；测试 ~80 行。合计 ~150-200 行——与候选 1 撞车，两件都是大件，不能同轮。
- **实现形态（规避命名冲突）**：**side table 优于合成 chunk**。`staticInitChunks:
  Record<class, chunkKey>`（RawFileFacts 新字段，同 virtualMembers 先例）→ link 建
  class→static-init key 映射。合成 chunk 方案（name="<static-init>"）会污染 bySimple/byQualified
  （link.ts:107-127 索引逻辑）；side table 零索引污染、三消费点显式消费。
- **命名冲突核查（任务点名项）**：`ctorChunkNames`（pack.ts:275）C# 不填（isCtor 分支，
  link.ts:897）→ 无直接冲突。**现存撞名事实**：静态 ctor chunk 名 = 类名（"E"）→ 与实例 ctor
  撞 byQualified "E.E" → ambiguous → 并集边（现状正确）。拆分吸收静态 ctor 后撞名自然消除。
- **标注 id 迁移**：class chunk 的 normText 是全节点归一化（extractor.ts:1489-1505 normalizeCode
  作用于整个 class_declaration 节点）→ **id 不变**（数学评审 §2c 的担心部分成立：变化的不是
  class chunk id，而是**静态 ctor chunk id 消失**——并入 static-init 后原 id 无实体，挂在该 id
  的标注静默失效；class chunk 的 calls 变化影响语料 calls 明细，C3 corpus-e2e 幂等重建可恢复）。
  发布动作：标注/语料重扫计划。
- **回归风险（比数学评审多一层）**：P4 已实测——拆分后 class chunk 丢裸名 ? → new C() 从
  UNKNOWN 翻确定判定（判别力收益，但真实扫描纯度分布会动；无回归快照，C2 债未偿 → 以
  csharp-lang 全量测试网 + 自扫描 invariantViolations=0 兜底）。

### 候选 1（事件订阅，数学评审修正版）——工程裁决：**修正版 do-now，但延后到 iter43 第一轮**

- **成本**：extractor 事件声明/订阅/初始化器订阅三形态提取 ~50-70 行 + pack 新数据表
  （P0-3 纪律）~10 行 + link 事件映射 + 尾部双出口新通道 + 私有守卫 ~40-60 行 + 测试
  ~100-120 行。合计 ~200-250 行——**超一轮规模**（iter40 参照 ~200 行含测试）。
- **通道序交互**：零优先级扰动——新通道只挂在 resolveCall 尾部两出口（markUnknown 1652 /
  markDynamic 1657）**之前**，所有既有通道先裁决；事件 invoke 在现状中本就落这两出口，拦截
  只加边不改判定序。订阅端 state 写通道不动（见陷阱 4）。
- **回归风险（实测预演，任务点名项）**：EventSubscribe fixture 两事件均 public → 守卫触发 →
  触发端保持 `?` → **purity/unknownSites 全部不变**（探针：Wire=2/HandleLevel=1/Raise=1/
  HandleQuest=1）；变化仅 (i) stats.cycles +1~2（Raise↔HandleLevel 成 SCC；HandleQuest 自环），
  (ii) 触发端多出 handler 边（反向闭包/回归风险归属——真正的消费者收益在 risk 报告而非 purity）。
  现有 fixture 断言（fixture.test.ts:86-93）零破坏。UIWorldLink 无事件 → 零影响。
- **判别力收益仅 private 事件**（触发端 ? 移除 → 确定判定）——真实 Unity 代码公共事件占多数，
  分布影响≈0；本轮延后的工程理由成立。

---

## 2. 落地顺序建议

| 轮次 | 内容 | 规模 | 依据 |
| --- | --- | --- | --- |
| **本轮（iter42）** | 候选 3（enum，~30 行）+ 候选 7 最小版（~60 行）+ technical-debt.md 方向分类修正（B14 双路径、M7 标为已修、M1 措辞——数学评审 §9，~15 行） | ~100 行 + ≤3 个 it | 全迭代最小件 + **活假纯洞优先闭合**（P1 实测：S1 现实违反通道，优先于新特性）；候选 1 的判别力收益在真实代码≈0（公共事件守卫保持 ?），候选 7 的收益是实打实的健全性 |
| **iter43-r1** | 候选 1（事件订阅修正版） | ~200-250 行 | 计划主推、数学评审已给完整修正设计；本轮的实测预演（P3 + fixture）已锁定验收基线，无设计悬案 |
| **iter43-r2 / iter44** | 候选 2（static-init 拆分，并入候选 7 消费点重构） | ~150-200 行 | 依赖 iter43 的 7 升级位；标注 id 迁移须作发布动作；无消费者紧迫性（标注粒度细化是 AI 工作流增强，无用户点名） |

顺序原则：**先闭活洞（7）→ 再判别力（3）→ 再特性（1）→ 再粒度（2）**。候选 4/5/6 维持
数学评审 defer 裁决，不占本轮。

## 3. 工程陷阱（按严重度）

1. **（高）lambda 订阅形态的数学评审误判**：`evt += (x) => {}` 的 lambda 在 C# 不是 chunk
   （陷阱 P2 实证）——若按数学评审 §1b 第 3 条实现会静默漏边。v1 必须把 lambda RHS、`new
   Action<T>(H)`、事件字段初始化器订阅（`public event Action OnX = HandleX;`，数学评审 §8 次要
   候选）显式分类为「订阅集合不完整 → 触发端 ?」，或补 lambdaNodes/lambdaAssignNodes 数据
   （注意：直接填 augmented_assignment_expression 会让 chunk 名取到左值 "OnLevelChanged"——撞名，
   必须改名槽位）。
2. **（高）`+=` 双重语义回归**：订阅边**不得取代** state 写。fixture.test.ts:92（Wire purity=2）
   是现成回归网兜——实现后该断言必须原样保持；任何把 `+=` 从 stateWrites 移走的实现都直接红。
3. **（中）P0-3 零语言常量纪律**：候选 1/2 的新形态（event_field_declaration、`+=` 运算符、
   "static" modifier token）全部走 pack 数据表（astShapes 扩展或新表，token 数组模式照抄
   virtualModifiers/sealedModifiers 先例 csharp.ts:835-836），引擎零硬编码；`validatePackConsistency`
   （pack.ts:389）如需新互斥断言同步加（至少 C02 白名单纪律：EXTRACT_SIDE_TABLES 同步更新）。
   新行为函数（订阅解析、invoke 展开）放 link.ts 与 resolveClassMember 同层，不进 extractor。
4. **（中）事件环 SCC 对链/计数的连带**：HandleLevel→Raise→HandleLevel 成 SCC → 分量级链扁平化
   （公理2 同 chain）+ stats.cycles +1~2。现有测试无精确 cycles 断言（grep 核实：全部 ≥1 形态）→
   安全；但自扫描报告（scan --json）的 cycles 值变化若被任何外部快照消费需知会。audit/dev 双跑：
   守卫附加的 `?` 只进 audit 传播 → 区间加宽、chainCertain=false（数学评审 §1e 双跑区间，诚实）。
5. **（中）候选 2 的标注 id 迁移**：class chunk id 不变（全节点归一化），但静态 ctor chunk id
   消失 + class chunk calls 变化 → 发布动作 = 语料/标注重扫（C3 幂等重建已闭环，可恢复）；须显式
   计划，防标注静默丢失。
6. **（低）enum 的表键撞名**：已逐项排除（§1 候选 3 回归核查）；唯一注意项是项目 enum 与
   impureGlobals 同键时成员读取形态判纯（编译不可达成员，无害）。
7. **（低）类 chunk 裸名盲区连带**：候选 2 拆分后 class chunk 的静态初始化器裸名 `?` 消失（P4），
   纯度为真实分布变化——验收时跑一遍自扫描 + csharp fixture 全量，确认 invariantViolations=0。

## 4. 验收口径建议

- **测试增量**：本轮 ≤3 个 it（≈100 行），全部 in-memory csharp-lang.test.ts，不动 fixture：
  - 候选 3：项目 enum 读取（`GameState.Menu`）→ PURE=0（判别力：修复前 UNKNOWN）；断言形态 purity 数值 + effects 不含 io。
  - 候选 7：三态断言（§1 候选 7 测试策略）——表解析 io → IMPURE=2 fs；裸名调用 → UNKNOWN=1；
    无初始化器对照 → PURE=0。断言形态 purity + effects 集合 + chain 值。
- **回归门禁**：352/352 全量（含 fixture.test.ts:92 Wire purity=2 原样保持）+ tsc 0 + 自扫描
  invariantViolations=0 + essence 8/8 + README 测试数同步（C4 check-readme-tests.cjs 门禁，iter42
  收尾时同步漂移的 343/337）。
- **文档同步**：technical-debt.md——B14 改双路径分类（new C() 过近似 / 静态访问路径漏报，后者
  本轮已修则移出假纯族）、M7 标记已修（enum 入 classNodes 后移出 M_out）、M1 触发条件措辞按
  数学评审 §1d 补触发端不对称 + 动态 handler 表达式两项。
- **iter43 候选 1 的验收锚**（本轮预演已锁定）：EventSubscribe fixture 附加断言——Raise 的
  `chunk.calls` 含 HandleLevel chunk key（Set 包含性断言）、HandleLevel/Raise purity 保持 1、
  Wire purity=2 保持；in-memory 补 private 事件判别力用例（Fire 触发端 ? 消失 → 确定判定）。

## 5. 裁决汇总

| 候选 | 数学评审 | 工程裁决 | 一句话理由 |
| --- | --- | --- | --- |
| 3 enum 判纯 | do-now | **本轮 DO-NOW** | 2 行 + 1 测试，零机制，回归逐项排除 |
| 7 静态访问闭合 | do-now（并入 2） | **本轮 DO-NOW（最小版）** | P1 实测活假纯洞（S1 违反），~60 行闭合，S2 方向与 L5 同构 |
| 2 static-init chunk | do-now | **iter43** | 150-200 行大件 + 标注 id 迁移发布动作；与 1 撞车不能同轮 |
| 1 事件订阅（修正版） | do-now（修正后） | **iter43-r1** | 200-250 行超一轮规模；真实代码收益以归属改善为主（公共事件守卫保 ?），判别力仅 private；P3 预演锁定验收基线 |

---

## 证据锚

| 发现 | 锚 |
| --- | --- |
| 静态访问假纯洞实测（Use/ReadX PURE=0, Make IMPURE=2 fs） | 探针 P1（临时项目，已删） |
| 全局类分支不含 class chunk 边 | link.ts:1207-1237；ctor-merge 唯一路径 link.ts:439-448 |
| L5 并集循环（候选 7 复用同构） | link.ts:978-997 |
| C# lambda 非 chunk（chunkName 三支路） | extractor.ts:1077-1105；csharp.ts:852（无 lambdaNodes/lambdaAssignNodes） |
| 事件三触发形态全落 ?（Fire unknown=3） | 探针 P3 |
| `+=` → state 写 + fixture 断言 | extractor.ts:931-932 + fixture.test.ts:86-93 |
| event_field_declaration / static modifier AST 形态 | 探针 iter42e（AST dump） |
| enum 撞表键回归排除 | link.ts:1207（globalClasses 先于 impureGlobals 1239）、link.ts:1000-1007（隐式纯）、csharp.ts:678-679（读取排除） |
| 类 chunk 裸名 ? 在拆分后消失（P4 附带收益） | 探针 P1/P3：class chunk unknown=2（Compute 裸名） |
| 无精确 cycles 断言 | test/** grep stats.cycles：全部 ≥1 形态（topology/synthetic/fixtures/adversarial） |
| 静态 ctor chunk 与实例 ctor 撞名现状 | constructor_declaration ∈ chunkNodes（csharp.ts:638）+ chunkName 取 name 字段 → 双 "C.C" ambiguous 并集 |

## 附注

- 本轮只读评审；探针临时文件已全部删除，`git status` 仅剩 iter41 既有 dirty（7 文件），无新增。
- 与数学评审唯一分歧：§1b lambda 形态的「已是 chunk」假设（P2 实证推翻）；其余裁决一致。
- 候选 1 延后的另一工程理由：P0-3 数据表设计（事件形态表 + 互斥断言）需要与
  validatePackConsistency（iter41 新增）同步演进，放 iter43 有完整设计窗口。
