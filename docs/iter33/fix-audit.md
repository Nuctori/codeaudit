# 迭代 33 修复审计（fix-audit）— 候选机制核实 + 本轮清单裁定

> 目标落盘：`docs/iter33/fix-audit.md`（本文件为 scouting 产出，由父会话转存）。
> 基线：HEAD 34848a8（dist 已重建，tsc exit 0；297/297 测试通过）；工作树只读，未改任何文件。
> 语料：`J:/旧宇宙/代码仓库/InitDeity/Assets`（3004 文件 / 23799 chunks / UNKNOWN 5102）。

## 0. 核实方法（实测证据一览）

| 项 | 证据 |
|---|---|
| C# 构造节点字段 | web-tree-sitter wasm 实测：`object_creation_expression` 有 field `type`（identifier/generic_name）；`constructor`/`function`/`name` 均 null；`implicit_object_creation_expression`（`new()`）无 type |
| C# 构造 chunk 名 | wasm 实测：`constructor_declaration` 有 field `name`（= 类名），chunk 名 = 类名、ownerClass = 类名 → byQualified 键 `Foo.Foo`；重载/static ctor 同名 → ambiguous |
| --state json 崩溃 | 复现：`node dist/cli.js scan "J:/旧宇宙/代码仓库/InitDeity/Assets" --state --format json` → exit 2 `Invalid string length`；同参数 text 模式 `--state --top 5` 正常 |
| TP4 误导行 | 复现：`--table-usage` 五行输出 python/typescript/tsx/javascript/csharp **全部** "咨询未中 37292 站点"（csharp 命中 80、python 0），纯 C# 语料下非 csharp 行纯属误导 |
| C2 语料形态 | 实测：`item.gameObject.SetActive` ×20、`parent` ×16、`replaceBtn` ×12、`each` ×12、`titleText` ×11、`nameText` ×11、`upgradeBtn` ×10、`root` ×9…（全是变量 receiver） |
| C3 语料形态 | 实测：`name2MusicConfigDic.TryGetValue`（AudioManager.cs:743）、`sfxName2PoolIndexDic`、`bullets` 等（全是变量 receiver，变量名非字面量） |
| R1 脏文件 | 实测：`git status --short` 全库 158 条，`Assets/InitDeity/Framework/Module/Automation/` 输出为空（生产文件非脏）✓ |
| 基线形态分布 | `node scripts/analyze-id-report.cjs docs/iter33/id-baseline.json`：744 bucket = `<unresolved>` 410 + 334（与 pain-a 一致） |

---

## 1. 候选机制核实结论

### C1 构造器建模（`<unresolved>` 最大子桶）— **可行，需前置修正，成本/风险按文档口径但实现有 3 个陷阱**

**机制链路现状**（全部实证）：
- C# 构造节点是 `object_creation_expression`（csharp.ts L454 `callNodes`），**不是** `new_expression`。extractor.ts L565-567 `callOf` 的 `new_expression` 分支对 C# 无效：`childForFieldName("function")` 为 null → `fn = children[0]` = `new` 关键字 → `flattenCallTarget` 返回 null → L581 出口 `UNRESOLVED_TARGET`（obj=null, receiver=null）。与 pain-a §1.5"两出口 L568/L581"完全一致 ✓
- 文档主张"tree-sitter-c_sharp 用 type 非 constructor"**属实**（wasm 实测）。修正点：callOf 对 `object_creation_expression` 取 `childForFieldName("type")`，并对 generic_name 剥 `type_argument_list`（取 identifier 子节点——flattenCallTarget L775-781 已有 generic_name 剥壳先例，但需补**顶层** generic_name/qualified_name 的 flatten 路径）
- **陷阱 1（receiverTypeOf 短路）**：csharp.ts L201 `literalReceivers.object_creation_expression: "object"` 使 `new X().m()` 链在 receiverTypeOf L593-594 被短路为 `"object"` → `builtinTypeEffects["object"]` 无键 → `?`。C1 必须删/前置该映射，改走 L595 的 class: 分支（并补 object_creation_expression 类型）——否则"构造 receiver 链"永远到不了新分支
- **陷阱 2（假纯洞：边到 class chunk 而非 ctor chunk）**：若构造调用以裸名形式（target/attr=类型名）进入 branch 2（link.ts L536-556），`bySimple[类型名]` 命中后按 `ownerClass === null` 过滤 → 边到 **class chunk**（字段初始化器效应），**丢失构造体效应**（constructor_declaration 是独立 chunk，无自动聚合）→ 项目类构造带 io 也判纯 = S3 级假纯。必须给 RawCall 加显式构造标记（`ctor: true`）走专用分支，项目类边查 `byQualified["Type.Type"]`（ctor chunk），重载/static ctor 同名 → ambiguous → 诚实 `?`
- **陷阱 3（清单大部分已就位，少量需补）**：impureGlobals 已含 FileStream/StreamWriter/StreamReader/BinaryReader/BinaryWriter/FileInfo/DirectoryInfo/HttpClient/Socket/TcpClient/WebRequest（csharp.ts L122-146）→ 构造即 io 清单主体免费；Random:"random"、WaitForSeconds:"clock"（L109-112）→ 构造即时钟源，现条目直接可用。pureGlobals 已含 List/Dictionary/Vector2/3/4/Quaternion/Color/Rect/StringBuilder（L156-190）→ 纯构造主体免费；**缺** JsonSerializerSettings/GUIContent/HashSet/UnityEvent/异常族（Exception/Argument*/InvalidOperation/NotImplemented）→ 需新增纯构造清单（或复用 pureGlobals + 补条目）
- **协同**：C1 的 class: 构造 receiver 分支可顺手 consult `builtinTypeEffects[className]`（List/Dictionary/IEnumerable monad 表，L206-270）→ `new List<int>().Add(x)` 链零成本激活——提前兑现 C3 的表价值的一部分

**结论**：可行。extractor 1 处（callOf + receiverTypeOf + flatten）+ link 1 分支 + csharp 1 清单，估 2-3 日含测试。前置：impureGlobals 补齐 FileStream 族（已确认基本齐）与纯构造清单必须先于"框架类型默认 PURE"落地；未列类型默认 `?`（规则 4）是红线。

### C2 `X.gameObject.*` 前缀白名单 → io — **可行，极低成本，低风险**（本轮首选）

**机制链路现状**（实证）：
- `sourceSign.gameObject.SetActive(false)` → callOf 拍平为 obj="sourceSign"、attr="gameObject.SetActive"（L583-585）。当前：branch 1 跳过（非 self）→ branch 2.5（L560-605）`frameworkIo["sourceSign"]` 无键；**且局部变量 receiver 会被 L560 的 assigned 守卫整块跳过** → branch 4 globalClasses/impureGlobals/pureGlobals 全 miss → `missTable(global:sourceSign)` → branch 5 `markDynamic` → `?` ✓（文档"obj 键查不到全漏"属实）
- `this.gameObject.SetActive`（obj="this"）走 frameworkIo["this"] 前缀命中（已 io）；裸 `gameObject.SetActive`（obj="gameObject"）走 frameworkIo["gameObject"]（csharp.ts L375）精确命中（已 io）——**两者已有判定就是新分支的语义参照**
- **落点**：link.ts branch 2.5 顶部、**assigned 守卫之前**（L560 之前）加前缀分支：`call.attr.startsWith("gameObject.")` 且第二段 ∈ `frameworkIo.gameObject` 白名单（SetActive/GetComponent/transform/layer/tag/name/AddComponent）→ `addEffect("io")` + hitTable。守卫前置是必须的：`item.gameObject.SetActive` 的 item 是局部变量，放守卫内会被跳过
- **边界**：`root.gameObject.RefreshSelf(true)`（项目扩展方法）→ "RefreshSelf" ∉ 白名单 → 落回 `?` ✓；**不做全前缀 io**（防误吞项目扩展）
- 白名单复用 csharp.ts L375，csharp.ts 可不改；hitTable 槽位 `frame:gameObject` 已存在（统计自然合并）

**结论**：可行。估 0.5-1 日。风险低（白名单限死；自定义 `gameObject` 属性遮蔽在 Unity 惯例下极罕见，文档化即可）。

### C3 A1 变量绑定重定价 — **可行但需前置设计；本轮只建议"参数显式类型"子集或推迟**

**机制链路现状**（实证）：
- `builtinTypeEffects` 只在 `call.receiver !== null` 时 consult（link.ts L483 分支 0 入口，L510 查表）——**变量 receiver（obj≠null）从不 consult，表对实例方法确实全死** ✓ 文档属实
- 表已就位：Dictionary.TryGetValue:"pure"（L266-269）、List/IEnumerable monad 表（L251-269）、builtinMethodReturns S1 链（L272-363）
- 语料实证：`name2MusicConfigDic.TryGetValue(clipName, out var config)` 等，全部变量 receiver，未命中任何机制 → `?`
- 绑定机制 = extractor 声明跟踪（参数显式类型 + `var x = new Dictionary<...>()` 初始化器 + 字段声明）→ RawCall 携带绑定类型 → link 新分支查 builtinTypeEffects。参数显式类型子集（pain-a §1.2 ① 层：GetLong/ContentIsGzipEncoded/GetOriginalUrl/GetTimeline 等参数化字典）成本低-中；②③④ 层（字段/var 初始化器/成员链续接）需流不敏感单赋值保守约束，中高成本
- 风险：错绑 → 假纯（需测试网覆盖 + 单赋值保守）

**结论**：全量可行但中高成本/中风险；本轮建议仅做参数子集（若有容量）或推迟。与 C1 的构造 receiver 协同点（见 C1）可先吃下 `new List<T>().Add(x)` 形态。

### TP4 `--table-usage` 全语言共享记账 — **可行，低成本，纯报告侧**（本轮必做）

- link.ts L172-173 `tableHit`/`tableMiss` **单全局 Map** ✓ 文档属实；sink 的 hitTable/missTable（L241-242）无语言维度；classifyUsage（effectUsage.ts L48）对每个 pack 用同一 Map 枚举 → 五行同数据 ✓
- 实测复现：五行全部 "咨询未中 37292 站点"（csharp 命中 80 / python 0），纯 C# 语料下 python 行 37292 是纯误导 ✓
- **落点**：link.ts 第二遍循环（L178）内 sink 构造处已知 `fi.pack.name` → hitTable/missTable 键加 pack 前缀（`pack + "\u0000" + slot`）或改双层 Map；classifyUsage 签名改为按 pack 过滤（effectUsage.ts L42-46 的 `hit`/`miss` 参数形态调整，L83-93 查表处按当前 pack 前缀取）
- 无现有测试断言 table-usage 内部数据（仅 robustness.test.ts L163 旗标冒烟）→ 加 classifyUsage 分桶单测

**结论**：可行。估 0.5 日。零审计判定影响（只改报告）。

### TP5 NUnit 断言白名单 — **可行，极低成本，顺手做**（本轮必做）

- 机制：`StringAssert.Contains(...)`（obj="StringAssert"）、`Does.Contain(...)`（obj="Does"）→ 全表 miss → `?` → 测试方法 UNKNOWN→impure ✓
- **落点**：csharp.ts pureGlobals（L156-190）加 `"StringAssert"`、`"Does"` 两键 → 675 站翻纯
- **关键约束**：NUnit 的 `Assert` 与 UnityEngine.Assertions 撞键——impureGlobals.Assert:"io"（L97）在 branch 4 优先命中（字符串规则 L646-650），pureGlobals.Assert 会被 classifyUsage P1 判死。**只加 StringAssert/Does，不动 Assert**（UnityEngine.Assertions 的 io 判定是既有裁决）

**结论**：可行。估 <0.5 日。零风险（无键冲突）。

### --state Invalid string length 崩溃 — **确认，工具侧修复**（本轮必做，解锁 P1 复核）

- 实测复现：`scan "J:/旧宇宙/代码仓库/InitDeity/Assets" --state --format json` → exit 2 `Invalid string length`；text 模式 `--state --top 5` 正常 ✓
- 机制：cli.ts L304-310 json 模式 `stateCoupling: stateCouplingOf(report.verdicts)` **全量**（6591 写方 × readerKeys 跨积）进 `JSON.stringify`（L309）→ 超出 V8 字符串长度上限；text 模式 L352 `args.top ?? 15` 截断所以不炸；--sources 199MB 能过是因为无 readerKeys 跨积 ✓
- **落点**：cli.ts json 分支——stateCoupling 从**全量 verdicts** 计算后按 `args.top ?? 50` 截断再入 payload。注意 **不能** 复用 `args.top` 的既判语义直接截 verdicts：L287-288 的 `--top` 会在 payload 构造前滤 verdicts，此时 stateCoupling 会基于已滤集计算（失真）——必须全量算、输出截断
- 附带：文本模式已安全；`--state` 的输出 schema 变化（全量 → 截断）需在 help/文档注明（迭代23 注释 L304-305 本就写"消费端自己 slice"）

**结论**：确认崩溃。估 0.5 日。风险低（schema 变化文档化即可）。

### TP2 C# 方法重载歧义 — **机制确认，方向安全，本轮不做**

- link.ts L632-643：globalClasses 命中项目类后 `if (!tf.ambiguous.has(q))` → 重载（byQualified 同限定名冲突，L91-94 登记 ambiguous）→ 无边 → 落 `?` ✓ 文档属实
- 732 站断链属实；但两重载均 IMPURE chain=0 → 审计结论不变（方向安全）。签名消歧需实参个数/类型——argFns（RawCall L28）只收集函数名实参，无参型 → 需新提取。收益低（结论不变，仅图完整度），成本中。**不做**，记录为工具盲区。

### R1 Automation ForTest 隔离 — **仓库侧候选，验证通过，独立轨道**

- 实测：`git status --short` 全库 158 脏（与文档一致）；Automation 目录输出为空 ✓；效应源 top 里 RuntimeCommandBridge.Execute(30)/RuntimeMainlineAutopilot×11（pain-a b 节）均在生产侧
- 这是 InitDeity 语料侧重构（`#if UNITY_EDITOR` 包裹 ~20 处 `*ForTest` 钩子），不是 codeaudit 工具改动；验证手段（--sources 前后对比 + 编译/测试）已齐备
- 结论：可行，与本轮工具修复并行推进，由仓库侧工作流承担

---

## 2. 排序与裁定（收益 × 成本 × 风险）

| 序 | 候选 | 收益 | 成本 | 风险 | 裁定 |
|---|---|---|---|---|---|
| 1 | **C2** X.gameObject.* 白名单 | 中（98 chunks/34 mono 翻 IMPURE(io)，115+ 站确定化） | 极低（0.5-1 日） | 低 | **本轮做** |
| 2 | **TP4** table-usage 分语言记账 | 中（报告语义正确，补表决策不被误导） | 低（0.5 日） | 低 | **本轮做** |
| 3 | **--state 崩溃修复** | 中（解锁 P1 transform.position 1100+ 读者静态复核） | 低（0.5 日） | 低 | **本轮做** |
| 4 | **TP5** NUnit 白名单 | 中低（675 站翻纯） | 极低（<0.5 日） | 低 | **本轮做**（与 2/3 同批） |
| 5 | **C1** 构造器建模 | **最大**（383 mono chunks/675 站 + 混合 chunk ~1400 站；UNKNOWN 5102 最大单项） | 中（2-3 日含测试） | 中（假纯红线；3 陷阱见 §1） | **本轮主体或下轮首项**——若本轮容量 ≥ 1 周则排入；否则独立下轮 |
| 6 | C3 参数显式类型子集 | 中（~250 mono 中 ① 层） | 低-中 | 中（错绑假纯） | 推迟（C1 的 ctor-receiver 协同先吃部分收益） |
| 7 | TP2 重载消歧 | 低（结论不变） | 中 | 中 | **不做** |
| 8 | R1 Automation 隔离 | 高（P0 债，~150 调用点出生产面） | 中（语料侧） | 低-中 | **并行轨道**（仓库侧，不占工具修复额度） |

**推荐组合**：`C2 + TP4 + --state 崩溃 + TP5`（约 2 日，全部低风险机制已验证）为本轮确定性交付；若容量允许再排 **C1 主体**（3 陷阱按 §1 规避）。C3 全量/TP2 明确不做，理由见 §4。

---

## 3. 选定候选的精确改动点 / 测试点 / 风险缓解

### 3.1 C2（link.ts）
- **改动**：`src/engine/link.ts` resolveCall branch 2.5 顶部（L560 `if` 之前）插入：
  ```
  // C2（iter33）：X.gameObject.* 前缀白名单（Unity 组件属性，变量 receiver）
  // 必须在 assigned 守卫之前：局部变量 receiver（item.gameObject.SetActive）是本形态主体
  if (call.obj !== null && call.attr.startsWith("gameObject.")) {
    const rest = call.attr.slice("gameObject.".length);
    const member = rest.indexOf(".") === -1 ? rest : rest.slice(0, rest.indexOf("."));
    if (pack.frameworkIo.gameObject?.includes(member)) {
      sink.addEffect("io");
      sink.hitTable("frame:gameObject"); // 复用既有槽位
      return;
    }
  }
  ```
  与既有路径不冲突：obj="gameObject" 的精确命中（attr="SetActive" 无前缀）走原逻辑；obj="this" 前缀命中结果同为 io。
- **测试**：test/audit/csharp-lang.test.ts 或新单测——① `void M(){ item.gameObject.SetActive(true); }`（item 局部变量）→ direct 含 io；② `root.gameObject.RefreshSelf(true)` → 仍 `?`；③ `this.gameObject.SetActive` 回归不变。
- **风险缓解**：白名单限死；不做全前缀 io；`gameObject` 属性遮蔽场景记录为已知限制。

### 3.2 TP4（link.ts + effectUsage.ts）
- **改动**：`src/engine/link.ts` L172-173 双层结构 `Map<packName, Map<slot, number>>`（或键前缀 `pack+"\u0000"+slot`）；L236-243 sink 构造处用 `fi.pack.name` 落桶；`src/core/effectUsage.ts` classifyUsage 签名 `(packs, hitByPack, missByPack)`，L83-93 按当前 pack 取桶。**零语义变化**：hit/miss 计数与总站点数不变，只分语言。
- **测试**：effectUsage 单测——python 包行 miss 数据不再等于 csharp 行（构造一个 csharp-only 语料）；robustness L163 旗标冒烟回归。
- **风险缓解**：纯报告侧；`missSites` 汇总口径不变（各语言求和仍 = 37292）。

### 3.3 --state 崩溃（cli.ts）
- **改动**：`src/cli.ts` L304-310 json 分支：
  ```
  const couplings = args.state ? stateCouplingOf(report.verdicts) : null; // 全量 verdicts 计算
  const payload3 = args.state ? { ...payload2, stateCoupling: couplings!.slice(0, args.top ?? 50) } : payload2;
  ```
  不动 text 模式（已有 top 15）。
- **测试**：e2e 小语料 `--state --format json` 冒烟（schema 含 stateCoupling 数组且长度 ≤ top）；大语料（InitDeity）回归确认 exit 0。可用现有 test/e2e fixtures 构造多写多读样例。
- **风险缓解**：输出截断文档化（help 文本补一句）；消费端既有 slice 契约不变；默认 50 覆盖 top 热点，避免回落到 15 丢全貌。

### 3.4 TP5（csharp.ts）
- **改动**：`src/lang/packs/csharp.ts` pureGlobals（L156-190）加 `"StringAssert"`、`"Does"`。**不动 "Assert"**（撞 UnityEngine.Assertions，L97 io 优先）。
- **测试**：csharp-lang 测试——`StringAssert.Contains(a, b)` / `Does.Contain(x)` → PURE 判定。
- **风险缓解**：无键冲突；NUnit 断言抛异常≠副作用语义与既有 `Assert` 裁决一致。

### 3.5 C1（若本轮纳入；否则下轮按此执行）
- **改动**：
  1. `src/lang/pack.ts` RawCall 加 `readonly ctor?: string`（构造类型名；undefined = 非构造）——仅 extractor 生产，测试 fixture 无破坏（可选字段）
  2. `src/lang/extractor.ts` callOf L565-567：`object_creation_expression` → `childForFieldName("type")` 剥壳（identifier 直取；generic_name 取 name/identifier 子节点剥 type_argument_list；qualified_name 取末段或全名——先全名，由表键决定）；`implicit_object_creation_expression` → 维持 UNRESOLVED（规则 5）；产出 `{ target: typeName, obj: null, attr: UNRESOLVED_TARGET, receiver: null, ctor: typeName }`（**obj 置 null 防 branch 2.5/4 误入**，靠 ctor 标记走专用分支）
  3. `src/lang/extractor.ts` receiverTypeOf L592-598：**删/前置** csharp.ts L201 `object_creation_expression: "object"` 字面量映射；补 `object_creation_expression` → `class:TypeName`（与 new_expression 对称）
  4. `src/lang/extractor.ts` flattenCallTarget：补顶层 `generic_name`/`qualified_name` 剥壳（L775-781 已有嵌套先例）
  5. `src/engine/link.ts` resolveCall 新增构造分支（置于 branch 1 之前）：`call.ctor` 命中时——① `impureGlobals[type]` string/array/tagged → addEffect（FileStream:fs/Random:random/WaitForSeconds:clock 免费复用）；② 纯构造清单（新增 `pureCtor: Set<string>` 于 csharp.ts，含 JsonSerializerSettings/GUIContent/HashSet/UnityEvent/异常族 + 复用 pureGlobals 中 List/Dictionary/Vector*/Color/Rect/StringBuilder）→ 纯；③ `globalClasses[type]` 单命中且 `!ambiguous` → **边到 ctor chunk** `tf.byQualified.get(\`${type}.${type}\`)`（bySimple 裸名路径会错边到 class chunk——**禁止**走 branch 2）；④ 其余 → `?` 诚实（未列框架类型默认不纯）。`class:` receiver 分支（L485-509）补：resolveSymbol 未命中时 consult `builtinTypeEffects[className]`（激活 List/Dictionary monad 表）
  6. `src/lang/packs/csharp.ts`：新增 `pureCtor` 清单 + impureGlobals 补 FileStream 族（已基本齐，核对 BinaryReader/BinaryWriter 等）
- **测试**：extractor 单测——`new List<int>()` → ctor:"List"；`new()` → UNRESOLVED；`new X().m()` → receiver class:X；`new System.Collections.Generic.Dictionary<K,V>()` → ctor 名剥壳。link 单测——`new FileStream(p, m)` → fs；`new List<int>()` → PURE；项目类 `new XxxCondition()` → 边到 ctor chunk（构造体 io 传导）；重载构造 → `?`；`new 未列表类型()` → `?`。语料回归——UNKNOWN 5102 下降（预期 mono 542 中 383 翻纯）。
- **风险缓解**：红线 = 未列类型默认 `?`（绝不给"未知皆纯"）；构造即 io 清单先行落地；项目类构造边只指 ctor chunk，ambiguous/重载 → `?`；基率变化（项目构造边引入真实 IMPURE 传导）在发布说明中预告。

---

## 4. 不做的候选与理由（明确记录）

| 候选 | 理由 |
|---|---|
| C3 全量（字段/var 初始化器/成员链绑定） | 中高成本 + 错绑假纯风险；C1 的 ctor-receiver 协同已可先激活 List/Dictionary/IEnumerable 表；参数显式类型子集若本轮无容量则下轮 |
| TP2 重载消歧 | 结论不变（重载皆 IMPURE），仅图完整度收益；argFns 无参型信息，需新提取，ROI 不足 |
| base.X() 解析（pain-a §1.5 ②） | 需继承模型；即便认 base_expression 也只改善站点命名，branch 1 查当前类同名方法必 miss → 判定不变；54 chunks 低价值 |
| UnityEvent Invoke/反射 Invoke 全量 | inspector 接线不可静态解析；误解析 = 假纯通道；iter23 已裁定（mono 106 chunks 保持 `?` 诚实） |
| 方法结果/下标 receiver 链 | 需返回类型/集合元素类型推断 = 全类型分析，超范围 |
| TP3 API.g.cs 局部变量推断 | 生成代码 18076 站，需解析器能力（局部类型推断），不可表修、不可逐条标注（pain-a d 节曲线证明）；与 C3 同源，随 C3 子集部分缓解 |
| R1（本轮工具侧） | 非工具修复；作为语料侧并行轨道，由仓库侧工作流执行 |

---

## 5. 优先级判断（汇总）

1. **本轮必做（确定性交付，~2 日，全部机制已验证、低风险）**：C2 → TP4 → --state 崩溃 → TP5（顺序即实现难度序）
2. **本轮可选主体（容量 ≥ 1 周时排入，~2-3 日）**：C1——unknown-rate 最大单项；3 陷阱（receiverTypeOf 短路 / ctor 边指向 / 清单补齐）已在本审计给出规避方案
3. **下轮候选**：C3 参数显式类型子集（与 C1 ctor-receiver 协同叠加后再定价）；R1 语料侧并行执行
4. **明确不做**：TP2、base.X()、Invoke/反射全量、方法结果/下标 receiver、TP3 解析器缺口（均为范围外或 ROI 不足）

## 6. 关键文件索引（实施者入口）

- `src/lang/extractor.ts`：L565-567 callOf 构造分支、L592-598 receiverTypeOf（C1）；L583-585 obj/attr 切分（C2 形态基础）
- `src/engine/link.ts`：L172-173 记账 Map（TP4）；L236-243 sink 构造（TP4 落桶）；L483-516 分支 0 receiver（C1 class: 表 consult）；L558-605 branch 2.5（C2 前缀分支插入点）；L632-643 globalClasses/ambiguous（C1 项目类边、TP2）
- `src/lang/packs/csharp.ts`：L97 Assert（TP5 不动的键）；L156-190 pureGlobals（TP5 落点）；L201 literalReceivers（C1 陷阱 1）；L206-270 builtinTypeEffects（C1 协同）；L367-393 frameworkIo（C2 白名单源）；L440-447 chunkNodes（ctor chunk 存在性）
- `src/core/effectUsage.ts`：L42-46 classifyUsage 签名、L83-93 查表（TP4）
- `src/cli.ts`：L287-288 --top 预滤、L304-310 --state json 装配（--state 修复）
- `src/core/state.ts`：L100-154 stateCouplingOf（全量产出源）
