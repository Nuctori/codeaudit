# 迭代 32 审计：frameworkPure 命名空间级前缀 → 成员级白名单（compromise-audit top-1 / C1 结构性收紧）

> 只读审计（HEAD 0c35349，293/293 测试绿——本次复跑确认；csharp-lang 套件 31/31 单独确认）。
> 范围：`frameworkPure` 定义（csharp.ts）→ 消费（link.ts 分支 2.5）→ 枚举（effectUsage.ts classifyUsage）→ 测试（csharp-lang.test.ts T1/T2/T3 + S3/HIGH-1/MEDIUM-2）。
> 目标：核实「Record<namespace, Record<member, "pure"|"hof">>，未列落 ?」演进的改动影响面，并给出方案、测试点、风险与优先级。

---

## 0. 现状核实（影响面 = 恰好 4 个 src 文件 + 1 个测试文件）

| 文件 | 位置（HEAD 0c35349） | 角色 |
| --- | --- | --- |
| `src/lang/packs/csharp.ts` | **L401-403** frameworkPure 定义；L444-450 linqHof；L456-459 hofCallsArgs；L460-466 hofAlwaysArgs；L508-542 csharpPack 导出 | 唯一定义 frameworkPure/linqHof 的 pack（TS/Python 无此键） |
| `src/engine/link.ts` | **L575-595** 分支 2.5 frameworkPure 消费；L244-281 addArgEdges（含 L275 未解析回调门）；L194-233 effectFromModule | 纯判定唯一消费点 |
| `src/core/effectUsage.ts` | L74-76 frameworkPure 枚举；L84-85 槽位名 `pure:${key}` | classifyUsage 使用率报告 |
| `src/lang/pack.ts` | L124 frameworkPure 类型声明；L127 linqHof 声明 | 接口（可选字段） |
| `test/audit/csharp-lang.test.ts` | T1 L456-475、T2 L477-491、T3 L493-510、S3 L512-527、HIGH-1 L546-562、MEDIUM-2 L564-597 | 行为守卫（全部依赖 frameworkPure 通道或 linqHof 门） |

> 行号漂移注记：任务引用的 csharp.ts L379-386 / link.ts L565-581 是 iter31 快照（d4d52d9）行号；HEAD 0c35349 因 iter31 S3/HIGH-1 补丁（linqHof、记账修复、builtinTypeEffects monad 表 A1）行号 +16~22。实施请按符号定位，勿按行号。

### 调用形态（关键事实，决定表键粒度）

- `System.Linq.Enumerable.Select(xs, cb)` → flattenCallTarget = "System.Linq.Enumerable.Select" → `call.obj="System"`、`call.attr="Linq.Enumerable.Select"`（extractor.ts L583-585 首点切分；L774-779 generic_name 剥泛型）。
- `System.Collections.Generic.List<int>.Add(l, 1)` → attr="Collections.Generic.List.Add"。
- `System.Math.Max(a, b)` → attr="Math.Max"；**裸 `Math.Max(a,b)` → obj="Math"、attr="Max"** → 走分支 4 pureGlobals（csharp.ts L156-168 含 Math/String/Convert/Guid/Enum/TimeSpan）——**不进 frameworkPure**（MEDIUM-2 用例路径）。
- `System.Console.WriteLine` → obj="System" attr="Console.WriteLine" → frameworkIo.System 含 "Console" → io（T2 边界）。
- 无前缀 `Enumerable.Range(...)` → obj="Enumerable" → 不在 frameworkPure 键集 → UNKNOWN（iter31 S2 缺口 21 站点，**本轮不覆盖**，待办）。

### 漏条落 ? 的现行路径（必须保持）

frameworkPure 键命中但前缀不匹配 → 不 return → 分支 4：`globalClasses.get("System")` miss → `impureGlobals["System"]` 无 → **`pureGlobals.has("System")` 无**（csharp.ts L156-168 无 System）→ `missTable("global:System")` → 分支 5 `markDynamic` → UNKNOWN=1。✓ 未列成员天然落 ?，成员级收紧零新增兜底代码。

### 现行 hof 回调门（L275 语义，演进的锚点）

`addArgEdges(names, hof)`：先解析（成员形 this.log → 本类；bySimple 本地；importMap），**未解析时门** = `hofAlwaysArgs.has(hof) || linqHof.has(hof)` → 记 UNKNOWN（L276-278 走完整记账，HEAD 已含 iter31 记账修复）。2.5 分支传 `last`（attr 末段）作 hof（L587-588）。linqHof 只被 frameworkPure 路径使用（link.ts L275/L588）——它是前缀通道的修补补丁，非独立通道。

---

## 1. 方案对比（任务 a）

### 案 1：成员级白名单（任务提议，推荐）

```ts
frameworkPure: Record<ns, Record<member, "pure" | "hof">>
```

- member 键 = attr 去掉 obj 段后（rest）的**第一段**（类型或子命名空间名），匹配沿用段前缀：`rest === key || rest.startsWith(key + ".")`（与现状 L581 同构，**天然段边界安全**，无 "String" 误配 "StringBuilder" 问题）。
- 语义：`"pure"` = 该类型/子域无副作用成员、无委托形参；`"hof"` = 该类型成员可能接收委托且无条件调用（回调义务必须保留）。未列键 → ?（诚实）。
- 表体：语料驱动 ~22 条（见 §2），远小于 compromise-audit 悲观的 30-60（那是整 BCL 成员枚举，此处是**语料命中类型** + .NET 事实确证）。

### 案 2：保持前缀级 + 成员级例外表（最小 diff，不推荐）

- 结构：`frameworkPure` 原样（前缀命中即纯）+ 新例外表 `frameworkPureHof: Record<ns, Set<string>>`（或同构 Record）——前缀命中且第二段 ∈ 例外 → 走 hof 回调义务；否则纯。
- diff 最小（link.ts +10 行）；但 **C1 的指控未结构性解决**：前缀内未列例外的副作用成员仍被放纯——假纯通道依旧存在，只是从"整前缀"缩到"整前缀减例外"。这是 iter30→iter31 修补（hof 表补丁）的线性延续，不是收紧。
- 若选它必须叠加 compromise-audit §2#1 方案 2（机检不变量断言"纯命中 ⇒ argFns 空 ∨ 已解析 ∨ ?"）——等于案 1 的部分收益 + 两套机制并存。

### 结论

**选案 1**，并内建机检不变量（见 §3 消费逻辑：纯标记成员 argFns 非空 → 记 ?）。理由：① 结构性堵死该通道（历史两活洞 iter30 ForEach / iter31 Select + HIGH-1 Last 均源于"前缀命中吞回调"）；② 表体可控（~22 类型键，语料驱动）；③ 漏条方向恒 ?（现有 fall-through 已验证）；④ 案 2 方向不安全，机检不变量单独做则与案 1 收益重叠且机制更绕。案 2 仅在「本轮资源不够做表体」时作为止血替代（与机检不变量同做）。

---

## 2. System 10 命名空间逐成员拆分（任务 b）

### 拆分原则

1. **同质子树整类 1 键**：该类型/子域无 io 成员、无委托形参成员 → 整键 `"pure"`（1 条覆盖全部成员，与现状前缀行为等价——判别力零回退）。
2. **异质子树逐成员**：含委托形参成员（回调义务）→ 拆分；含副作用成员 → 拆出或直接不列（落 ?）。
3. **hof 标记对无回调调用是 no-op**（argFns 空 → addArgEdges 空操作 → 仍纯）——所以"整类 hof"与"逐成员 hof"正确性等价；差异只在槽位粒度（--table-usage 可见性）与纯标记成员被传函数实参时的保守 ?。

### 逐命名空间表（推荐键集，~22 条）

| ns 键 | 成员键 | tag | 依据（.NET 事实 + iter30 语料分解） |
| --- | --- | --- | --- |
| Uri | `Uri` | pure | 语料 882 站全 EscapeDataString；BCL Uri 全静态方法无委托形参（EscapeDataString/UnescapeDataString/IsWellFormedUriString/TryCreate） |
| Linq | `Enumerable` | **hof** | 语料 461 站；**整类 hof 不分成员**——LINQ 委托重载（Select/Where/OrderBy/Count/Any/First/Last/Sum/Min/Max/ForEach…）无条件调用回调，无委托成员（Range/Skip/Take/Repeat/Empty）无回调不触发门，整类 hof 与逐成员等价且更小（1 键取代 linqHof 29 算子表） |
| Convert | `Convert` | pure | 语料 238 站；全部 ToXxx/ChangeType/IsDBNull 纯计算，无委托形参 |
| Enum | `Enum` | pure | 语料 97 站；Parse/TryParse/GetName/GetNames/IsDefined/GetValues/Format 静态元数据读，无委托 |
| Text | `StringBuilder` | pure | StringBuilder.Append/AppendLine/ToString 纯计算（对象内缓冲，无 io/state 效应） |
| Text | `Encoding` | pure | UTF8/ASCII/GetBytes/GetString 纯计算 |
| Text | `RegularExpressions` | pure | Regex.IsMatch/Match/Replace 纯计算（子命名空间键，段前缀覆盖 "Text.RegularExpressions.Regex.*"） |
| Array | `Find`/`FindAll`/`Exists`/`TrueForAll`/`ForEach`/`ConvertAll` | **hof** | 6 个委托形参成员（Predicate<T>/Action<T>/Converter<T,TOutput>），无条件调用 |
| Array | `Sort`/`Reverse`/`Copy`/`Clear`/`Resize`/`IndexOf`/`LastIndexOf`/`Contains`/`BinarySearch`/`Empty`/`Clone` | pure | 无委托或委托为 IComparer 对象（非函数；argFnsOf 不提取对象实参——见风险 §6.4）。语料 14 站成员分布实施前用 --table-usage 核实，未列纯成员 → ? 方向安全 |
| Math | `Math` | pure | 语料 5 站；Max/Min/Abs/Sqrt/Pow/Floor/Ceiling/Round/Truncate/Sign/Log/Exp 全纯，无委托 |
| TimeSpan | `TimeSpan` | pure | 语料 3 站；FromSeconds/Parse/TryParse/Compare 纯 |
| Guid | `Guid` | pure | 语料 3 站；Parse/TryParse/NewGuid（NewGuid=随机源，iter30 已接受先例，与 pureGlobals.Guid 一致）/ToString 纯 |
| Collections | `Generic` | pure | 语料对称形态 System.Collections.Generic.List<int>.Add（静态式）；List/Dictionary/HashSet 静态式成员无委托（List<T>.ForEach 是实例方法，不在此通道） |

不列（落 ?）：Reflection（Assembly.LoadFrom=fs、MethodInfo.Invoke=动态——iter23 裁定）、Runtime、Activator、DateTimeOffset（UtcNow=clock）、IO/Net/Threading/Diagnostics（frameworkIo 侧 io）、System.Runtime.CompilerServices（新测试点）。**与 iter30 白名单的 10 首段完全同构**——成员级只是把"整前缀纯"改为"前缀下逐类型确证"，未列类型落 ?。

### 与现状的行为差异清单（唯一实质回归面）

- 现状前缀命中但新表未列的**类型**：`Text` 下非 StringBuilder/Encoding/RegularExpressions 的成员（如 Text.Decoder 若语料有）→ 纯 → ?。语料 Text 55 站需核实分布（§6.6）。
- `Array` 未列纯成员（若语料含 Sort/Copy 而未列）→ ?。需核实 14 站。
- `Linq` 其余子类型（Linq.Expressions.* 若语料有）→ ?（现状前缀级会放纯——**这正是假纯风险点，Linq.Expressions 含编译执行**）。
- Uri/Convert/Enum/Math/TimeSpan/Guid/Collections 整类键 → 行为零变化。

---

## 3. link.ts 消费改动（任务 c）

### 替换 L577-595 的框架（方案 1 + 内建回调不变量）

```ts
// 迭代32：frameworkPure 成员级白名单（Record<ns, Record<member, "pure"|"hof">>，未列落 ?）。
// 匹配 = attr 剩余段段前缀（与迭代30 同构）；回调不变量内建：纯命中且 argFns 非空 →
// 无法证明回调无罪 → addArgEdges(unconditional) → 未解析记 UNKNOWN（防假纯结构性保证）。
const pureNs = pack.frameworkPure && Object.hasOwn(pack.frameworkPure, call.obj)
  ? pack.frameworkPure[call.obj] : undefined;
if (pureNs) {
  for (const [member, tag] of Object.entries(pureNs)) {
    if (call.attr === member || call.attr.startsWith(member + ".")) {
      const last = call.attr.slice(call.attr.lastIndexOf(".") + 1);
      if (call.argFns.length > 0) sink.addArgEdges(call.argFns, last, true); // unconditional=true
      sink.hitTable(`pure:${call.obj}.${member}`); // 槽位名沿用（Uri→pure:System.Uri）
      return;
    }
  }
}
```

要点：
- tag 在此规则下运行行为统一（argFns 空 → 纯；非空 → 解析回调，未解析记 ?）——tag 是**文档化的 .NET 语言事实 + 槽位语义**（pure 成员被传函数实参属异常用法 → ?；hof 成员收回调是常态）。误标方向的假纯已被不变量排除（§6.4）。
- `linqHof` 的替代关系：**成员级 hof 标记取代 linqHof 在 frameworkPure 路径的全部作用**——2.5 分支不再查 `linqHof.has(last)`（L587-588 删除）。`linqHof` 表本身（csharp.ts L444-450 + pack.ts L127 + link.ts L275 门中 `|| linqHof.has(hof)`）建议删除，其"无条件调用 → 未解析记 ?"语义由 `addArgEdges` 的 `unconditional` 参数承担。回答任务 c 的疑问：**是，成员级 hof 取代 linqHof**。
- `addArgEdges` 签名 +1 可选参数 `unconditional = false`（link.ts L244）：false = 现行门（hofAlwaysArgs/linqHof），true = 无条件记 ?。其他调用方（L606/L613/L661 branch 4、resolveImport L381/L405/L455）默认 false，零行为变化。改动 ~6 行。
- 兜底分支 `(!pack.linqHof && pack.hofCallsArgs.has(last))`（L588）随 linqHof 删除而删除（C# 恒有 linqHof 时代才存在，现 C# 用 unconditional 门，不再需要）。

### 不变量机检（可选附加，compromise-audit §2#1 方案 2 落法）

在 analyze 不变量机检（countInvariantViolations 同层）或测试断言："frameworkPure 命中 ⇒ argFns 空 ∨ 回调全部解析 ∨ calls 含 ?"。本轮表结构已内建该语义，机检作为防回归断言（+1 测试见 §5）。

---

## 4. classifyUsage 枚举适配（任务 d）

`src/core/effectUsage.ts` L74-76 现为数组遍历：

```ts
for (const [obj, memberMap] of Object.entries(pack.frameworkPure ?? {}))
  for (const [member] of Object.entries(memberMap))
    keySets.push(["frameworkPure", `${obj}.${member}`]);
```

- 槽位名（L84-85 `pure:${key}`）不变 → `pure:System.Uri`、`pure:System.Enumerable`、`pure:System.Array.Find` 等。**纯成员键沿用类型名 → 与 iter30 槽位（pure:System.Uri 等）连续**；Array/Linq 槽位变细（pure:System.Linq → pure:System.Enumerable）是改进不是回归。
- 表值严格 `"pure"|"hof"` 字符串 → **无嵌套递归**（§2 表已拍平为一级 member 键）——classifyUsage 无需递归逻辑，改动 ~5 行。
- hof 标记成员若想独立可见性，可槽位区分 `hof:${key}`——不建议（命中仍是纯路径，拆槽位徒增报告噪声；保持 pure: 统一）。
- `--table-usage` 附带收益：成员级条目使 corpus 命中分布可见（Uri 882 站 → 确认 EscapeDataString 单条目覆盖），未命中条目显示 corpus-inactive（表维护信号）。

---

## 5. 测试点 3 个（任务 e，落 test/audit/csharp-lang.test.ts）

| # | 用例 | 期望 | 对应现有用例 |
| --- | --- | --- | --- |
| 1 | `System.Uri.EscapeDataString(s)` | **PURE=0**（Uri 成员级 pure；argFns 空） | T1（L456-475）**保持绿，零改动** |
| 2 | `System.Linq.Enumerable.Select(xs, System.Console.WriteLine)` | **UNKNOWN=1**（Enumerable hof → 回调未解析 → unconditional 门 → ?；非 PURE） | S3（L512-527）+ HIGH-1（L546-562，Last 变体）**保持绿**——linqHof 删除后靠 unconditional 门，行为不变 |
| 3 | `System.Runtime.CompilerServices.RuntimeHelpers.EnsureSufficientExecutionStack()`（或 UriBuilder）——**未列成员** | **UNKNOWN=1 诚实**（非 PURE 非 io） | **新增**；替换/强化 iter30"白名单严格性探针"（MathF/UriBuilder 落 ?） |

附带保持：T2（Net 仍 io）、T3（ForEach(xs, Save) → IMPURE=2，Save 经 bySimple 解析成边）、MEDIUM-2（Math.Max obj="Math" → pureGlobals 路径，不受影响）。
建议第 4 个（可选）：`System.Array.Find(xs, Cb)`（Cb 未解析框架成员）→ UNKNOWN + `System.Array.Sort(xs)` → PURE——守卫 Array 逐成员拆分。
可选第 5 个（机检不变量断言）：`System.Uri.EscapeDataString(SomeFunc)`（纯标记成员收到函数实参）→ UNKNOWN（内建不变量兜底）。

---

## 6. 风险（任务 f）

1. **成员级表膨胀/维护义务**：~22 类型键（语料驱动，一次性）；漏列真纯成员 → ?（方向安全，判别力损）。缓解：iter30 语料影响面分解作准入（Uri 882/Linq 461/Convert 238/Enum 97/Text 55/Array 14/Math 5/TimeSpan 3/Guid 3）+ --table-usage corpus-inactive 信号 + 注释准入标准（同 pureModules 惯例）。
2. **漏条方向安全**：✓ 结构保证（现有 fall-through：pureGlobals 无 System → 分支 5 UNKNOWN）。内建不变量（纯命中 + argFns 非空 → ?）把"漏条"从仅表层面扩展到回调层面。
3. **iter30 兼容**：槽位名连续性（§4）；global:System miss 保持 0（表键不变）；TS/Python 零影响（可选字段 no-op 语义不变）。唯一行为回归 = Text/Array 未列成员纯 → ?（§2 差异清单），语料核实后确定。
4. **误标方向的假纯已被排除**：hof 标记误用到无委托成员 → 无行为差异（argFns 空不触发门）；委托成员误标 pure → argFns 非空 → ?（不变量兜底）。剩余假纯面仅"argFnsOf 提取不到的回调"（lambda 内联——已由 enclosing-chunk 直接捕获，iter31/audit L54 旁证）与"非函数对象实参（IComparer 实例）"（argFnsOf 只提 identifier/member-access，对象形态不提取 → 不误收；变量形态 cmp 会误收为回调 → 保守 ?，方向安全）。
5. **linqHof 删除连带**：3 个 iter31 测试断言的是行为不是表（S3/HIGH-1/T3 断言 purity，LINQ 语义不变）——删除安全；MEDIUM-2 的"Math.Max 不在全局 hof 表"已由全局表现状保证（不动 hofCallsArgs/hofAlwaysArgs 的 Math.Max 排除）。删除顺序建议：先改 2.5 分支 + addArgEdges(unconditional) → 测试绿 → 再删 linqHof（两提交，防混淆回归源）。
6. **语料核实缺口（实施前置）**：Array 14 站、Text 55 站的成员分布未在本轮 read-only 审计取数（无语料库环境）。实施前用 `node dist/cli.js scan <InitDeity> --table-usage` 复核，或直接按 .NET 事实保守列入（§2 表已给全集）。若语料含 Text 未列类型 → 需补键。
7. **S2 缺口不阻塞**：无前缀 Enumerable.X（21 站）不进本通道（obj="Enumerable"）——独立待办，本轮不动（新增键 "Enumerable" 会误伤项目类同名——需遮蔽守卫，成本高收益低）。

---

## 7. 优先级判断（任务 3）

**本轮做（方案 1）**。

- 依据：compromise-audit top-1（C1，§2#1 排第 2 优先级，§4 结论 3 明确"需修"）；该通道历史上贡献 3 个假纯活洞（iter30 ForEach、iter31 Select、HIGH-1 Last），当前仅靠 hof 表修补（iter30 修补 1 次、iter31 又修 2 次——每次都是打补丁，结构性收紧才能收敛）。
- 成本：csharp.ts 表体 ~30 行（一次性）+ link.ts 2.5 分支 ~15 行 + addArgEdges +6 行 + effectUsage ~5 行 + 测试 +2~3 用例（现有 5 用例全保持绿）。≈ 60 行级改动。
- 安全：漏条方向恒 ?；语料驱动枚举保住判别力（§2 差异清单 = 零或极小回归面）；TS/Python no-op 不变。
- 前置：无阻塞（iter31 记账修复已在 HEAD；C2 string.Join 残留独立于本表，可同轮或下轮——若同轮，注意别把 Join/GroupJoin 移出全局表的改动与本表混在一起）。
- 若本轮资源不足的降级：先做 compromise-audit §2#1 方案 2（机检不变量断言 ~20 行 + 3 用例）止血，成员级表下轮——但注意方案 2 是断言不是机制，只能防回归不能治"前缀内未列例外成员"的现行假纯面（机制上仍是前缀级）。

---

## 8. 关键文件索引（实施用）

- `src/lang/packs/csharp.ts` L401-403（frameworkPure 表体替换）、L444-450（linqHof 删除候选）、L156-168（pureGlobals——确认无 "System"，漏条落 ? 依赖此）
- `src/engine/link.ts` L575-595（2.5 分支替换）、L244-281（addArgEdges 加 unconditional 参数）、L275（门删除 linqHof 分支）
- `src/lang/pack.ts` L124（frameworkPure 类型改 Record<ns, Record<member, "pure"|"hof">>）、L127（linqHof 删除候选）
- `src/core/effectUsage.ts` L74-76（枚举适配）
- `test/audit/csharp-lang.test.ts` L456-527、L546-562（现有守卫）+ 新增 3 用例
- 背景：`docs/iter31/compromise-audit.md` §1 C1、§2#1（方案 1/2 原始定义）；`docs/iter30/audit.md` §e/f（白名单准入标准）；`docs/iter23/frameworkio-design.md` §2-B（方法级例外预埋设计）
- 形态证据：`src/lang/extractor.ts` L583-585（obj/attr 切分）、L774-779（generic_name 剥泛型）、L617-636（argFnsOf C# argument_list）、L244-281 消费

## 9. 验证证据（本轮）

- 全量 `npm test`：293/293 通过（28 文件，36.4s）
- `test/audit/csharp-lang.test.ts` 单独复跑：31/31 通过
- HEAD 0c35349 确认；工作树干净（无未提交改动）
