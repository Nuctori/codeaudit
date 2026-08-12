# LangPack 抽象「无特例语言无关」最小路径评审

迭代37 · 工程极简/系统设计/成本收益视角（Jeff Dean 侧写）· 只读评审
基线：305/305 测试绿（实测 `vitest run` 29 files / 305 passed）、工作树无跟踪改动。

## 0. 结论先行

- **「无特例」是一个设计卫生目标，不是债单条目**。docs/technical-debt.md（迭代19 快照，`HEAD 01dd226`）B/C/D 类**没有任何一条**记录「LangPack 特例」——本轮在债单上几乎无可清项。真正的判别力债（API.g.cs 30.5%、重载断链 732、标注曲线近水平）全部在 **resolver 能力**，不在 LangPack 形状。
- **任务点名的四项（frameworkPure / pureCtor / paramTypes / implicitThis）全部是「通用机制 + 语言数据」，机制已在 link.ts 通用化，无一需要引擎改造**（与 01-math-review 结论一致）。C# 包数据最多 ≠ 特例最多——.NET/Unity API 面大是数据量，不是抽象泄漏。
- **link.ts 真正的硬编码特例只有 1 处**：L646-654 `X.gameObject.*` 前缀。数据化它（0.5-1h，行为不变）就是本轮的最小完成态。
- **统一效应表（12 表 → 1 表）是教科书级过度抽象**：零行为收益、全量回归面（effectOverride 用户 API 是契约）、唯一假纯向量（hof≡hofAlways 标签坍缩）。不做。

## 1. Q1 正确目标形态：c）+ b 的最小切片，不是 a

| 选项 | 判定 | 论证 |
| --- | --- | --- |
| a) 字段全部收敛为单一通用 schema | **不做** | 零行为收益。12 张表的通道序/匹配模式（exact/prefix/最长点分回退）是语义不是风格（link L565 注释）；收敛=重排=近似。effectOverride 白名单（effectOverride.ts L13-24）是用户 API 契约，迁移成本实付 |
| b) 只消除 link.ts 语言特例分支 | **最小必要切片（做 1 处）** | link.ts 唯一直正硬编码 = L646-654 gameObject 前缀。ctor 分支（L537-562）与 A1 分支（L726-752）内**无语言指纹**（无 pack.name），机制通用，仅数据由 C# 提取侧产出——不是特例 |
| c) 保留字段但确保语义通用 | **目标态（现状已达成）** | frameworkPure（link L671-702 两级匹配通用）/ pureCtor（L537-562 四步决策通用）/ paramTypes（L726-752 无语言指纹）/ implicitThis（L631-638 布尔参数化）——机制全部通用，差异收敛为 pack 字段值 |

**最小正确化 = c（现状确认）+ b 切片（gameObject 数据化）+ 可选的 extractor 3 处 `pack.name` 数据化（L425/L432/L487，各 1-bit，行为保持）**。a 是过度抽象，全文否决。

## 2. Q2 候选改造逐项裁决

| # | 候选 | 裁决 | 改动规模 | 测试影响 | 正确性风险 | 收益 |
| --- | --- | --- | --- | --- | --- | --- |
| a | X.gameObject.* 分支数据化 | **做** | pack.ts +1 字段（~6 行）、link L646-654 → 数据查找（~10 行）、csharp.ts 搬表、+1-2 用例 | 低：既有测试 csharp-lang.test.ts L678-700（迭代33 C2）行为不变 | 低：白名单 miss → UNKNOWN 回退保持（S4）；**分支位次（assigned 守卫之前）必须保留**——本形态主体是变量 receiver（注释自证） | 引擎零语言常量达成；新语言可表达 attr-前缀语义。行为不变 |
| b | 效应表 schema 统一 | **不做** | 大：link 查找 + effectUsage（L63-77 直读 pack 字段）+ effectOverride（用户 API）+ 4 packs + 305 测试全量回归 | 全量回归 | **唯一假纯向量 = hof≡hofAlways 标签坍缩**（A6 S1 违反）；C1-C6 保持下可证无损但零行为收益 | 撞名结构性消除——已由数据隔离解决（String.Join 先例：Join/GroupJoin 移出全局表，csharp L498-502）。schema 收益 ≠ 用户收益 |
| c | 局部变量类型推断（moduleBindingsOf 下沉函数体） | **延后（与本轮正交）** | extractor 每 chunk name→(count,class) 映射 + link 消费守卫，~2h | 中：新提取通道 + 用例 | 守卫（单赋值 ∧ declared ∧ ¬param ∧ kind=class）内安全；**放松守卫 = 假纯**（Q3 数学评审必要条件反例） | **真实但集中**：API.g.cs 单文件 18076 未知站点 = 全项目 30.5%（pain-a L18）。但可恢复的仅构造器初始化子集（urlBuilder_1173 等 ~2-3k 站）；call-result 绑定（response_ 1098 / client_ 732）需全类型层（已否决，type-inference-design §10）。且 iter22 审计裁定生成代码修复应在生成器而非仓库内 |
| d | 重载消歧 | **做（并集边，单独一轮）** | link.ts 10 处 `!ambiguous` 守卫 → 全候选并集边（~40-60 行）+ arity 收窄 | 中：行为变化（UNKNOWN → 确定判定） | 并集边唯一安全形态（Q1 数学评审 Prop 3：S1/S2/S3 全保持）；任选/arity 定选 = 假纯风险，**禁止** | TP2：ApiClientHelper.PrepareRequest 732 站点断链（pain-a L108-111）+ C# 重载密集语料普遍收益。需产品裁决（unknown-rate/标注工作流语义变化）+ 文档 |
| e1 | A1 paramTypes 补 TS/Python 数据 | **不做** | — | — | **假纯通道（本轮唯一致命风险）**：注解无运行时强制（Python duck typing / TS 类型擦除）。`def f(xs: list): xs.append(1)` → list.append=pure → 运行时自定义对象 → A6 S1 违反。`paramTypesEnforced` 门 = false 时数据无意义、true 只对 C# 诚实 → 加门加数据 = 为对称而对称 | 无（现状「意外的安全」：paramTypesOf 节点过滤 C# 形态，TS/Python 天然不触发） |
| e2 | ctor 补 TS 数据 | **可做（低成本，非必须）** | extractor ~10 行（new_expression → ctor 标记）+ TS 数据 | 低 | 方向安全（R1：`new Date()` UNKNOWN→io 为过近似 S2 安全，无假纯）；**必须保留项目类优先于 pureCtor**（L546-556 红线） | 小：TS 项目类 new 已走 class: 通道正常解析，增量仅框架类型构造效应（Date:clock 等） |
| f | frameworkPure 并入通用结构 | **不做** | — | — | — | 已是通用机制（link L671-702），「并入」= b 的子集，无独立价值 |

**附加发现（比 f 更真实的可扩展性缺口）**：frameworkPure / pureCtor **不在 effectOverride 注入白名单**（effectOverride.ts L13-24 仅 10 表）——恰是 C# 专有的两张表，用户无法用 `--effect-table` 扩展新 Unity API，必须改包代码。若本轮想付任何 schema 成本，加这两表的注入支持比统一 schema 价值高（工程量 ~15 行）。

## 3. Q3 技术债验收：本轮清什么、留什么

**前置事实：technical-debt.md 是迭代19 快照（216/216），已过期 23 轮**（现 305/305）。验收前应先重基线，否则验收对象失真。

| 债单条目 | 状态 | 本轮裁决 |
| --- | --- | --- |
| B1 效应表 70+ 类人工裁决 | 数据裁决债，非 schema 债 | **保留**（与 LangPack 形状无关；frameworkPure 成员级化已部分缓解） |
| B2 frameworkIo["this"] 组件链 | 数据判断债 | **保留** |
| B3 LINQ 链全 ? | resolver 能力债 | **保留**（c 项只覆盖构造器初始化子集，不覆盖 Where/Select 链） |
| B4 事件订阅 / B5 属性访问器 | 语义建模债 | **保留** |
| B6 隐式 this 竞态 | 极小已知限制 | **保留** |
| C1 resolveCall cognitive 290 | 部分已还（Iter-36 r2 resolveImport 拆分）；a 项再削 ~15 行 | **部分清偿**，不随本轮清零 |
| C2 真实项目 fixture | 语料债 | **保留** |
| C3 标注工作流 E2E | 流程债 | **保留**（pain-a L83：标注曲线近水平，正路是修 resolver 非标注——d/c 项间接受益） |
| C4 README 测试数漂移 / C5 效应表测试稀疏 | 测试债 | **保留**（10min/1h 项，与本轮无关） |
| D1-D3 外部债（wasm/协程/Unity 无源码） | 外部 | **保留** |

**未被 technical-debt.md 追踪、但已实际清空的条目**（来自 iter31 compromise-audit CHANGES，当前树已全部闭环，验收文档应更新）：

1. frameworkPure 假纯通道（C1）→ 成员级白名单（iter32，csharp L433-461）✓
2. string.Join 撞名（C2 残留）→ Join/GroupJoin 移出全局 hof 表（csharp L498-502）✓
3. 记账不变量破坏 → addArgEdges 同步 unknownSites/addUnknownCall（link L278-284）✓

**验收标准建议**（本轮可达且可机检）：

1. link.ts 零语言常量（gameObject 硬编码清零）——`grep "gameObject" src/engine/` 仅剩记账槽位字符串（可随数据化一并参数化）；
2. 行为无变化：305/305 绿 + 全量 e2e 断言不变；
3. extractor `pack.name` 计数 ≤ 0（若做 2-bit 数据化）或维持 3 处并在 pack.ts 声明行为边界（不做也成立）。

## 4. Q4 实施顺序（先小后大，每步可验证）

| 步 | 内容 | 规模 | 验收 |
| --- | --- | --- | --- |
| 0a | gameObject 前缀数据化（pack 新字段，复用 frameworkIo.gameObject 白名单语义） | 0.5-1h | 305/305 绿 + csharp-lang L678-700 断言逐字不变 |
| 0b | （可选）extractor 2-bit 数据化：`assignmentScopesLocals`（L425）/ `bareNameMeansThisInMethod`（L432/L487） | 1h | 行为保持（E 谓词逐点不变）；Python/TS/C# 既有断言全绿 |
| 1 | （独立轮次）局部 ctor 绑定：moduleBindingsOf 下沉函数体，单赋值 ∧ declared ∧ ¬param ∧ kind=class 守卫 | 2h | InitDeity 语料 unknown-rate/图完整度度量（可恢复 ~2-3k 站/18076） |
| 2 | （独立轮次）重载并集边 + arity 收窄 | 0.5-1d + 文档 | TP2 732 站恢复；unknown-rate 下降；产品文档同步「并集=精确语义非猜测」 |
| — | 永不：b 统一效应表 / e1 A1 无门泛化 / f frameworkPure 并入 | — | — |

## 5. 过度抽象警告（三条）

1. **为统一而统一**：12 表 → 1 表，零行为收益 + effectOverride 用户 API 契约迁移 + 唯一假纯向量。撞名的正确解是数据隔离（已做），不是 schema 统一。**「字段全收敛」是抽象之美，不是系统收益。**
2. **对称性诱惑**：C# 有 paramTypes 所以 TS/Python 也该有——这是本轮唯一致命风险（假纯）。注解无运行时强制是语言事实，不是数据缺口。**为对称补数据 = 制造正确性风险。**
3. **数据多 ≠ 特例多**：C# 包 150+ 条效应表是 .NET/Unity API 面的资产，不是债。pack.ts 头注释（「数据侧覆盖同构；行为侧诚实承认名字解析是行为」）就是正确的抽象边界——**本轮完成后不要再动它**。

## 6. 验证记录

- `npx vitest run`：29 files / **305 passed**（实测，7.9s）。
- 工作树：无跟踪改动（仅 untracked `docs/iter36/stage2-preflight.md`、`docs/iter37/`——本轮产物）。
- 读：pack.ts / csharp.ts / python.ts / link.ts / extractor.ts / effectOverride.ts / effectUsage.ts / technical-debt.md / iter31 compromise-audit / iter33 pain-a / type-inference-design / 01-math-review。
- 与 01-math-review 无分歧：数据侧已通用、唯硬编码是 link L646-654 与 extractor 3 处 pack.name、A1 无门泛化是唯一假纯风险。本评审差异点 = 工程裁决（统一表不做、局部推断延后、重载并集边单列一轮）与债单验收（本轮几乎无清项，需先重基线）。
