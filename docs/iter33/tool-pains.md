# 工具痛点挖掘 C — InitDeity 语料 UNKNOWN 形态深扫与工具改进候选（迭代 33）

范围：只读分析。基线 `docs/iter33/id-baseline.json`（HEAD 34848a8，files 3004 / chunks 23799 / PURE 8045 / IMPURE 10652 / UNKNOWN 5102 / unknownCalls 站点 12150）。源码实证读自 `J:/旧宇宙/代码仓库/InitDeity/Assets`。任务形态的"744/77/90/109/48"对应 analyze-id-report.cjs 的 chunk-bucket 口径（前两 attr 组合），本报告深扫用站点级口径（更精确），两者都给出。

## 0. 基线补充信号（任务给出 + 复核）

- **UNKNOWN chunk 5102**，其中 **no-sites UNKNOWN 411** = parseError 212（scan.ts L241-247 H1 守卫：整文件降级 UNKNOWN，PURE 标注不可撤销）+ has-calls 传播型 199（? 源在调用链上游，样本 `RuntimeMainlineAutopilot.GetRequiredGuideInteractiveSemantic` calls 两个 chunk、eff []）。
- **IMPURE chain=0 且 direct 空 741**（纯传递型：效应全由被调链传导，本 chunk 无自证直接效应）。
- **效应源 top**：Automation 主导（RuntimeMainlineAutopilot.TickOnceAsync [state]、RuntimeCommandBridge.Execute [io]、StarterInteractionCapability.Run [io]）+ PlayMode 测试（StarterMainlineFlowTests ×5）——"Automation/测试主导"属实。

## 1. 各形态痛点清单

### 1.1 Invoke — 311 站点 / 242 chunks（bucket 口径 77 单 + 18 `<unresolved>+Invoke` = 95）

| 项 | 值 |
|---|---|
| 站点数 | 311（root: variable 269 / bare 42） |
| 子形态 | ① **UnityEvent 字段 `.Invoke()`**：onBuffRemove（EntityBuffController.cs:294，`onBuffRemove.Invoke(eachBuff)`）、onDestroy/onDestroyUI/onRunUI/onTrigger/onClickClose/completeEvent/onAllOpen…（占多数）；② **Action/Func 委托 `?.Invoke()`/`.Invoke()`**：onComplete（GetRewardPanel.cs:457 `onComplete?.Invoke(new())`）、mintGetter（MintTweener.cs:192 `mintGetter.Invoke()`）、setStringMethod ×10（测试 helper）、listener（onClick.Invoke）；③ **反射 MethodInfo.Invoke**：method 7 站（EditorAccessor.cs:33 `method.Invoke(null, args)`，method = `editorAssembly.GetType(t).GetMethod(n)`） |
| 可建模性 | **低**。UnityEvent 监听者多为 inspector 接线（AddListener 代码内只是少数），无跨站点注册分析不可解析；委托回调 = 间接调用，UNKNOWN 诚实；MethodInfo.Invoke = 真动态（iter23 已裁定）。mono-cause 106 chunks（全部 unknownCalls 都是 Invoke）保持 UNKNOWN |
| 预期收益 | 基本为 0（正确性上不应改）。唯一小例外：MonoBehaviour `InvokeRepeating/CancelInvoke(nameof(X))`（SteerChaseBehaviour.cs:73/81、CultivatePathPreviewTips.cs:66）——`nameof` 给出目标方法名，可低成本加边；语料量小（≈10 站） |
| 成本 | 例外项低（extractor 取 nameof 实参 + addEdge）；主体为 0 |
| 风险 | 主体建模风险极高（inspector 接线推断 = 假纯通道）；不做 |

### 1.2 TryGetValue — 304 站点 / 218 chunks（bucket 90 = TryGetValue+TryGetValue 50 + TryGetValue 40）

| 项 | 值 |
|---|---|
| 站点数 | 304（root 全 variable；attr 裸 TryGetValue 238 + 全链 66：`tables.bagItems.TryGetValue`/`instance.bagSlots.TryGetValue`/`info.upgradeConfig.TryGetValue` 等） |
| 子形态 | 全部是真字典实例读，receiver 类型来源四层：① **显式类型参数**（FastLayerReportIngestion.GetLong `this Dictionary<string,object> dict`、API.g.cs `headers.TryGetValue` IReadOnlyDictionary 参数 ×N、ApiClientHelper `request.Properties.TryGetValue`）；② **字段声明**（RushTowerManager `rushTowerDic.TryGetValue`）；③ **var 初始化**（NormalShopBuyPanel `var buyDic = temp.value.info.NormalShopBuyDic`）；④ **成员-字段链**（ConfigTable.tables.bagItems —— 字段类型续接） |
| 可建模性 | 中。①=便宜（参数声明即可绑定）；②③=声明点绑定（A1）；④=字段绑定续接（A1 深水区）。**关键机制**：frameworkPure.Dictionary 表（csharp.ts L266-269，TryGetValue:"pure"）按 obj 文本键命中，变量 receiver 永不命中——表对实例方法实际是死的；builtinTypeEffects 同样只在 `call.receiver !== null`（字面量/`class:` 构造器）时生效（link.ts L483-516）。mono-cause 107 chunks，建模后全部可翻 PURE（字典读无副作用） |
| 预期收益 | 中高：107 mono 翻 PURE + 混合 chunk 降噪 + ContainsKey 43/Contains 197/Add 325/Remove 85/Clear 165 同类受益（集合实例方法整体 ~600 站） |
| 成本 | 中高（取决于取 A1 子集还是全量；参数显式类型子集 = 低） |
| 风险 | 中：流不敏感绑定需单赋值保守约束；绑定错型（Dictionary 字段实为自定义包装）→ 假纯 |

### 1.3 SetActive — 388 站点 / 234 chunks（bucket 109 = SetActive 47 + SetActive+SetActive 34 + gameObject.SetActive 28）

| 项 | 值 |
|---|---|
| 站点数 | 388（attr 裸 SetActive 229 + `gameObject.SetActive` 115 + `target.SetActive` 12 + `selfGameObject.SetActive` 2 + 误含 `instance.SetActiveQuestProgression` 4 / `Profiler.SetActive` 1） |
| 子形态 | 主体两类：`X.SetActive(...)`（X 变量）与 **`X.gameObject.SetActive(...)`（X 变量）**。实证样本：ResourceName.HideSign `sourceSign.gameObject.SetActive(false)`、Player.OnEnable/OnDisable `item.gameObject.SetActive(true/false)`、RideCore `speedLine.gameObject.SetActive(isActive)`、RobotTeamController ×2、WhiteLineFocus、EquipCompareUI（`root.gameObject.RefreshSelf(true)`——注意是项目扩展方法） |
| 可建模性 | 中高，且只针对 **`X.gameObject.*` 前缀子集**：mechanism——frameworkIo.gameObject 表（csharp.ts L375）只按 obj="gameObject"/obj="this" 命中；`X.gameObject.SetActive`（obj=X 变量）全漏（link.ts L560-605 前前缀查 obj 键）。`gameObject.*` 前缀 chunks 98（mono 34），其中精确 `gameObject.SetActive` 82 chunks（mono 33），115 站点 |
| 预期收益 | 中：98 chunks / 34 mono 翻 IMPURE(io)（与既有 `gameObject.SetActive` 直呼的 frameworkIo 判定一致），115 站点从 `?` 变确定效应；UI 显隐代码（foreach 显隐列表）判别力确定性提升 |
| 成本 | **极低**：link.ts 加一个分支——attr 以 "gameObject." 开头且成员 ∈ 既有 frameworkIo.gameObject 清单（SetActive/GetComponent/transform/layer/tag/name/AddComponent）→ io；白名单外（RefreshSelf 类）仍 `?`。零新知识，复用现有表 |
| 风险 | 低：成员白名单限死；项目自定义 `gameObject` 属性遮蔽极罕见（Unity 惯例）。**不可做全前缀 io**（会误吞项目扩展方法） |

### 1.4 GetType — 361 站点 / 132 chunks（bucket 48 = GetType+`<unresolved>`）

| 项 | 值 |
|---|---|
| 站点数 | 361（attr 裸 GetType 304 + `Reflection.IntrospectionExtensions.GetTypeInfo` 47 + GetTypeInfo 6 + GetTypes 2 + GetTypeByID 2） |
| 子形态 | `value.GetType()`（API.g.cs:508 `System.Enum.GetName(value.GetType(), value)`）、`condition.GetType().Name`（测试）、`interactiveUi.GetType().Name`、`type.GetTypeInfo().IsEnum`（EnumControl.CanBind）。**GetType 从不单独致 UNKNOWN**：mono-cause 仅 5 chunks；84/126 伴生反射链（GetMethod/GetTypeInfo/GetValue/Activator…） |
| 可建模性 | 中低。attr=="GetType" → pure（System.Object.GetType 非虚、无副作用，名字级规则极安全，304 站点受益）；但链收益小：`.GetType().Name` 后续需 receiverTypeOf 返回 "Type" + Type/TypeInfo 纯成员表（GetName/IsEnum/GetDeclaredField 等，iter23 已裁定反射元数据读纯，方案 A 待标注确证），且 `condition.GetType()` 的 condition 是参数——还是要 A1 才知道 condition:QuestCondition |
| 预期收益 | 低：5 mono 翻 PURE + 304 站点降噪（chunk 判定大多不变） |
| 成本 | 低（名字级 pure 规则一行）；链建模中（Type 表 + A1 前置） |
| 风险 | 名字级极低（GetType 无 override 语义）；表级 = 纯读确证义务（iter23 方向已定） |

### 1.5 `<unresolved>` — 3195 站点 / 1678 chunks（bucket 744 = 410 单 + 334 双）——最大桶

| 项 | 值 |
|---|---|
| 站点数 | 3195，root 全 bare（obj=null、receiver=null；extractor.ts L568/L581 两处 `attr=UNRESOLVED_TARGET` 出口：无 fn 子节点 / flatten 失败且 receiverTypeOf 也 null） |
| 子形态 | 20 样本手工分类 + **542 mono chunks（915 站点）全量特征分类**（每 chunk 文本特征，多特征重叠）：
  - **构造器 383/542（69%），675 站点**——构造类型 top：List 128 / Dictionary 78 / Vector2 51 / JsonSerializerSettings 47 / Color 44 / Vector3 41 / GUIContent 39 / 异常族（Exception/Argument*/InvalidOperation/NotImplemented）~75 / HashSet 16 / Rect 16 / UnityEvent 10 / WaitForSeconds 9 / Random 8 / byte、string（数组创建）+ 项目类型（InteractiveSemanticInfo 14 / TaskSegmentPlayModeDefinition 12 / ValueRange 9）。典型：QuestProgression.CreateQuestCondition 37 站全 `new XxxCondition()`；API.g.cs 生成客户端 Compress/CreateSerializerSettings 等
  - **方法调用结果 receiver 116**：`RecordHp(false).Forget()`、`GetDefaultGameObject(x).SetActive(...)`、`tra.GetChild(0).gameObject.SetActive`（SkillCommandPanel 27 站）
  - **下标 receiver 55**（"other" 类主体）：`actions[i].SetActive(true)`、`deque[center-1].SetAsLastSibling()`、`eventData.PayloadNames[i].Equals(...)`
  - **base.X() 54**：`base.OnDestroy()`/`base.Enable()`——flattenCallTarget 认 this/this_expression 但不认 base_expression（extractor.ts L757-766），而 selfNames=["this","base"]（csharp.ts L469）——**记账缺口**：base 在 selfNames 却进不了 branch 1
  - 泛型方法 147（与构造器重叠）、null-cond `?.` 31、LINQ 20、await/Task 26 |
| 可建模性 | 分三档：① 构造器（**最大、可建模**，规则见下）；② base.X() 只改善站点命名（需继承模型才能解析，翻不了判定——低价值）；③ 方法结果/下标 receiver = 返回类型推断/集合元素类型，全类型分析，不可做 |
| 预期收益 | 构造器：542 mono 中 383 chunks（675 站点）+ 混合 chunk 的构造站点降噪（65% 的 `<unresolved>` 站点在含 `new` 的 chunk 文本中）→ **本轮最大单一桶** |
| 成本 | 中：extractor new_expression 字段修正（tree-sitter-c-sharp 用 `type` 字段非 `constructor`，且 generic_name 剥类型实参）+ link.ts 新"构造"分支 + 纯/效应构造类型清单 |
| 风险 | **中，假纯红线**：`new FileStream(...)` 构造即 io——构造-效应清单（impureGlobals 复用 + FileStream/StreamWriter 族补齐）必须先于"框架类型默认 PURE"落地，否则 S3 级假纯洞。项目类构造边会引入真实 IMPURE 传导（正确但改基率）。未列框架类型默认 `?` 诚实（不给"未知皆纯"默认） |

**构造器建模规则（建议形态）**：`new X(...)`
1. X ∈ impureGlobals（作类型键）→ 对应效应（fs/net/io…）
2. X 为项目类（globalClasses 单命中）→ 边到 constructor_declaration chunk（chunkNodes 已含）；无显式构造（隐式默认构造，无 chunk）→ 按纯（分配无副作用）
3. X ∈ 语料确证纯构造清单（List/Dictionary/HashSet/Vector*/Color/Rect/GUIContent/JsonSerializerSettings/异常族/UnityEvent/WaitForSeconds/Random…）→ PURE
4. 其余框架类型 → `?` 诚实（补表候选，漏条方向 ? 非假纯）
5. `new T()`（泛型变量）/ targetless `new()` → 保持 `<unresolved>`

## 2. Top 3 候选（按收益×成本）

### C1. 构造器建模（`<unresolved>` 最大子桶）—— 最高收益
- 站点：383 mono chunks / 675+ 站点（另有混合 chunk 中 ~1400 站同源）；翻向以 PURE 为主（框架纯构造占构造类型绝大多数，top20 里仅 InteractiveSemanticInfo/TaskSegmentPlayModeDefinition 两个项目类型需构造边）
- 预期收益：UNKNOWN 5102 的 mono 542 中 383 chunks 直接翻 PURE；QuestProgression（37 站）、API.g.cs 生成客户端等工厂/配置密集代码判别力质变
- 成本：中（extractor 1 处 + link 1 分支 + 2 张清单，估 2-3 日含测试）
- 风险：中——**假纯红线**（构造即 io 清单）；未列类型默认 `?` 兜底
- 前置依赖：无（独立于 A1；与 iter31 的 monad 路线正交）
- 改动文件：`src/lang/extractor.ts`（new_expression）、`src/engine/link.ts`（构造分支）、`src/lang/packs/csharp.ts`（构造清单 + impureGlobals 补 FileStream 族）

### C2. Unity 组件链前缀 `X.gameObject.*` 白名单 → io —— 最高性价比
- 站点：98 chunks（34 mono）/ 115 站（精确 gameObject.SetActive 82 chunks / 33 mono）；同类 transform.* 29 chunks（3 mono）
- 预期收益：34 mono 翻 IMPURE(io)，115+ 站从 `?` 变确定效应；与既有 frameworkIo 判定一致性（`gameObject.SetActive` 直呼已 io）→ 判别力确定性提升、标注面缩小
- 成本：极低（link.ts 一个前缀分支 + 复用 csharp.ts L375 已有成员清单，估 0.5-1 日）
- 风险：低（白名单限死，RefreshSelf 类项目扩展仍 `?`；不做全前缀 io）
- 改动文件：`src/engine/link.ts`、`src/lang/packs/csharp.ts`（可不动）

### C3. A1 声明点类型绑定——参数显式类型 + `var x = new Dict/List<>()` 子集（集合实例方法）—— 高收益、需重新定价
- 站点：TryGetValue 107 mono + Contains 27 + Add 39 + Clear 26 + ContainsKey + LINQ 20 等 mono 合计 ~250 chunks；激活已建但**对变量全死**的 builtinTypeEffects（IEnumerable/List/Dictionary monad 表，csharp.ts L251-269）与 builtinMethodReturns（S1 链表）——当前它们只在字面量/`class:` receiver 生效（link.ts L483-516）
- 预期收益：~250 mono 翻 PURE + 链式解析二次激活（S1 的 invocation_expression receiverTypeOf 与 builtinMethodReturns 配合才有完整链）
- 成本：中高（extractor 声明跟踪：参数类型 + 字段/局部 var 初始化器；link.ts 绑定查询；流不敏感单赋值保守约束）
- 风险：中（错绑 → 假纯；需测试网覆盖）
- 备注：iter31 裁定"A1 monad 主体收益不支撑本轮"是按 LINQ 变量链 359 站算的；**集合实例方法把同源站数抬到 600+，建议重新定价**。若本轮只做参数显式类型子集，成本可降为低-中，覆盖 ① 层（GetLong/ContentIsGzipEncoded/GetOriginalUrl/GetTimeline 等参数化字典）

## 3. 明确不可做（设计边界）与理由

| 形态 | 不可做理由 |
|---|---|
| UnityEvent `.Invoke()`/AddListener/RemoveListener 全量 | 监听者主体为 **inspector 接线**（代码内 AddListener 只是少数），无跨站点注册+时序分析不可解析；误解析 = 假纯通道。mono 106 chunks 保持 `?`（正确）。唯一例外：`InvokeRepeating/CancelInvoke(nameof(X))` 小站点可加边（≈10 站，可选） |
| 反射 `MethodInfo.Invoke`/`Assembly.LoadFrom`/`GetTypeInfo().GetDeclaredField` | 真动态分派（EditorAccessor 模式）；iter23 已裁定反射仅元数据读纯、Invoke/LoadFrom UNKNOWN 诚实。GetType 名字级 pure 可做但链收益仅 5 mono，低优先 |
| 方法调用结果 receiver（`RecordHp(false).Forget()`、`GetDefaultGameObject(x).SetActive`、`GetChild(0).gameObject`） | 需要项目方法返回类型推断 = 全类型分析（超范围）；S1 已覆盖 builtinMethodReturns 内建返回链，项目级属于 A1+ 深水区 |
| 下标 receiver（`actions[i].SetActive`、`deque[k].SetAsLastSibling`） | 集合元素类型推断 = 全类型分析 |
| `base.X()` 继承解析 | 需类层级模型（工具无继承追踪）；即便认 base_expression 也只能改善站点命名（attr 从 `<unresolved>` 变 "OnDestroy"），branch 1 查当前类同名方法必然 miss → 判定不变。54 chunks 低价值。可顺手把 base_expression 加进 flattenCallTarget（1 行，命名收益）但**非本轮必做** |
| 741 direct-空 IMPURE / 199 传播型 no-sites UNKNOWN | 非新形态：效应/`?` 源在调用链上游（正是 C1-C3 的站点）；上游站点收敛后自动缓解，无需单独机制 |

## 4. 附：关键机制定位（后续实施者入口）

- `src/lang/extractor.ts` L562-586 `callOf`（`<unresolved>` 两出口 L568/L581）、L755-799 `flattenCallTarget`（缺 base_expression L757-766）、L592-614 `receiverTypeOf`（invocation 链 L600-612）
- `src/engine/link.ts` L467-690 `resolveCall`：分支 0 字面量/`class:` receiver（L483-516，builtinTypeEffects 仅此处活）、2.5 frameworkIo/frameworkPure（L558-605，obj 文本键）、4 效应表（L608-675）、5 兜底 markUnknown/markDynamic（L677-690）
- `src/lang/packs/csharp.ts`：frameworkIo L367-393（gameObject L375）、frameworkPure L409-437、builtinTypeEffects L206-270（IEnumerable/List/Dictionary L251-269）、chunkNodes L440-447（含 constructor_declaration）、selfNames L469（含 base）
- 语料源码：`J:/旧宇宙/代码仓库/InitDeity/Assets`（基线 root 字段可复现）；分析脚本 `scripts/analyze-id-report.cjs` / `diag-id.cjs` / `diag-id2.cjs` / `diag-id3.cjs`

## 5. 复现命令（本轮验证用）

```
node scripts/analyze-id-report.cjs docs/iter33/id-baseline.json   # 形态分布（bucket 口径 744/77/90/109/48 出处）
node scripts/diag-id2.cjs docs/iter33/id-baseline.json            # chain 分布 / no-sites 形态
node scripts/diag-id3.cjs docs/iter33/id-baseline.json            # 效应源 / 741 传递型 / 411 记账可疑
```
