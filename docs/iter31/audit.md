# 迭代 31 审计：LINQ 变量 receiver 链 HOF 建模（monad 建模）方案

> 只读审计（HEAD dbf7171，288/288 测试绿基线）。未改任何代码。
> 基线数据：`X:\Temp\iter30-after.json`（迭代 30 复扫，HEAD 行为一致：23799 chunks / PURE 8045 / IMPURE 10652 / UNKNOWN 5102，21.4%）。
> 探针实证：`dist/cli.js scan` 对 6 个合成 C# 工程 + InitDeity 源侧正则统计（3004 cs 文件、461,504 行）。

---

## 1. 机制核实（断链机制完整链路）

**调用切分**（`src/lang/extractor.ts`）：
- `flattenCallTarget`（L754-797）：标识符/成员链拍平点连文本；调用/字面量/new/数组 → null。
- `callOf`（L563-586）：flat 非 null → obj/attr/target 三元组（**receiver=null**）；flat 为 null → `receiverTypeOf` 事实（receiver=字面量/class:/链式返回）或 UNRESOLVED 哨兵。
- `receiverTypeOf`（L592-612）：三类来源——`literalReceiverType`（字面量表 L735-751）、`new_expression` → `class:X`、链式调用（L600 **只认 `obj.type === "call" || "call_expression"`**——Python/TS 节点名，C# 是 `invocation_expression` → **永远不命中**）。

**变量 receiver 判定链**（`xs.Select(f)`）：
1. `flattenCallTarget(xs.Select)` 成功 → `{target:"xs.Select", obj:"xs", attr:"Select", receiver:null}`（**裸标识符变量根本进不了 receiverTypeOf**——receiver 事实只在 flatten 失败时产生，这是 C1 设计边界）。
2. `resolveCall`（`src/engine/link.ts`）分支 0（L475-508）`receiver !== null` 守卫跳过 → 分支 1 self/2 裸名/2.5 frameworkIo+frameworkPure/3 import/4 全局类+效应表全 miss → **分支 5 兜底 L665-666 `markDynamic` → `?` 入 calls**。
3. `analyze.ts` L121-127：real 效应空 + 含 `?` → **UNKNOWN**（`?` 是知识标记非效应，公理 3）。

**链式（`xs.Select(a).Where(b)`）**：外层 receiver 是 invocation_expression → flatten null → receiverTypeOf L600 类型检查不含 C# 节点名 → null → UNRESOLVED → root=`bare`（`link.ts` L186-192 rootOf）→ markUnknown → `?`。

**分支 0 builtinTypeEffects 消费**（L502-507）：`rule === "hof"` → `addArgEdges(call.argFns, attr)` 后 return；`"pure"` → return；**表外 → addUnknownCall + markUnknown（落 `?`，永不静默丢）**——方向安全 ✓。

**addArgEdges 兜底**（L244-271）：标识符→bySimple 真边；self./this. 成员→类内方法；其余成员（`Console.WriteLine`）→ importMap miss → **L269 `hofAlwaysArgs.has(hof)` 才记 UNKNOWN**——而 `csharp.ts` L337 `hofAlwaysArgs = new Set()` **为空**。

---

## 2. InitDeity 实测（变量 receiver 链形态占比）

### 报告侧（iter30-after.json，当前行为）
| 指标 | 值 |
|---|---|
| unknownCalls 总站点 | 58,897（12,012 chunks） |
| **variable-root**（obj=变量） | **33,908（57.6%）** / 9,391 chunks，**全部 .cs** |
| bare `<unresolved>`（断链桶） | 21,488（36.5%） |
| **LINQ 算子 × variable-root**（extended：含 Contains/Count/Any/All/First 等） | **2,553（4.3%）** / 1,192 chunks |
| LINQ **CORE** 纯 monad 算子（Select/Where/SelectMany/ToDict/ToList/ToArray…） | **359（1.1%）** / 287 chunks |
| 287 个 CORE-LINQ chunk 纯度 | 110 UNKNOWN / 177 IMPURE（链精度受损） |
| 唯一 `?` 源全是 CORE-LINQ 的 chunk（转 PURE 下界） | **15** |

top variable-root attr：`SetActive` 1162、`Add` 1144、`Append` 1101、`Invoke` 981、`GetComponent` 916、`Dispose` 832、`ToString` 770、`Contains` 765、`Content.ReadAsStringAsync` 735、`PrepareRequest` 732——**Unity/集合 API 主导，LINQ 不在前列**。

### 源侧形态（guarded 正则，排除 Enumerable 尾缀误捕）
LINQ 调用点 2,693：**变量接收者 1,180（43.8%）** + 全限定 `System.Linq.Enumerable.X` 静态 432（16.0%，iter30 已建）+ 大写限定 724（26.9%，Math./string. 重叠算子噪声）+ 多段成员 354（13.1%，如 `_httpClient.DefaultRequestHeaders.Contains`，语义上也是 variable-root）+ `this.字段` 3。

### 绑定可见性（单标识符接收者 997 站点，方案 A 的射程）
局部 var 47.1%（但初值多为调用/属性如 `var url = GetUrlKey(...)`、`var queue` 来自 `TryRemove(out var queue)`——**声明点不可绑定**，可绑定子集小）；局部显式序列类型 18.2%（`List<TKey> nullKeys = ...`）；参数/字段序列或数组 20.6%（`this Dictionary<TKey,TValue> mainDic`、`List<int> xs` 参数、`T[]` 字段）；无绑定 14.1%（多为 string 变量 `url.Contains`、lambda 参数 `x.First()`）。

### 探针实证（dist 当前行为，6 合成工程）
| 探针 | 当前 | 说明 |
|---|---|---|
| `xs.Select(x=>x*2).Sum()`（List<int> 参数） | **UNKNOWN**（Select/variable + Sum/bare） | 方案 A 后应 PURE |
| `xs.Select(x => Console.WriteLine(x)).ToList()` | IMPURE(io) | **lambda 回调 io 已被 enclosing-chunk 直接提取捕获**——addArgEdges 只对命名回调必要 |
| `var ys = new List<int>{...}; ys.Select().Where().ToList()` | UNKNOWN 源（Select/variable + 3 bare） | `new List<int>` 构造器调用本身也落 bare |
| `Enumerable.Range(0,10).Select(...)`（无前缀） | UNKNOWN 源（Range/variable） | **S2**：frameworkPure 键 obj="System"，无前缀 obj="Enumerable" 不命中（语料 21 站点） |
| `GetData().Select(...)` | 2 bare | 跨方法返回不建（边界 B 一致） |
| `"  hello  ".Trim().ToUpper().TrimEnd()` | 2 bare | **S1**：C# 字面量链第二环起全断（receiverTypeOf 缺 invocation_expression） |
| `System.Linq.Enumerable.Select(Range(0,3), Console.WriteLine)` 语句式 | **PURITY=0 PURE（假纯！）** | **S3 实证**：frameworkPure 命中 + addArgEdges 无法解析 `Console.WriteLine` + hofAlwaysArgs 空 → 回调 io 被吞，公理 3 违规 |
| `System.Linq.Enumerable.ForEach(Range(0,3), Log)`（命名项目函数） | IMPURE(io) ✓ | iter30 命名函数路径正确（bySimple 解析 Log） |

### 三个关键旁证发现
- **S1（机制缺陷）**：`receiverTypeOf` L600 只认 `"call"/"call_expression"`，C# `invocation_expression` 缺失 → **所有 C# 链（含字面量链）在第二环断裂**，贡献 21,488 bare `<unresolved>` 中的大块。1 行修复，独立于变量追踪。
- **S2（iter30 覆盖缺口）**：无前缀 `Enumerable.X`（obj="Enumerable"）不进 `frameworkPure["System"]` → 语料 21 站点仍 UNKNOWN。
- **S3（iter30 假纯洞，当前 HEAD 活洞）**：静态 LINQ + 命名框架成员回调（`Console.WriteLine`）→ 假纯。加 hofAlwaysArgs 可堵（语料以 lambda 回调为主，实际暴露面小，但公理 3 违规必须修）。

---

## 3. 方案对比

### A. 有界单变量类型追踪（推荐）
声明点绑定（参数/局部显式序列类型 + `var x = new List/[]{...}`）→ 归一 `IEnumerable` 接收者事实 → 走既有分支 0 builtinTypeEffects/builtinMethodReturns（monad 操作表）。

### B. 完整类型推断（拒绝）
泛型 T 替换、跨方法返回类型传播：需要类型变量/统一算法，与既有 `assigned`/`declared` 流不敏感保守模型冲突；语料收益（<300 站点）不支撑复杂度。**过度**。

### C. 只加表不追踪（无效）
builtinTypeEffects 按 `call.receiver` 键查（link.ts L502），变量 receiver 恒为 null（C1）→ 表永远不命中。**不解决变量**。

---

## 4. 方案 A 精确改动点

1. **extractor 新 pass 触发节点**：`visit()` L42-61 chunk 创建处，`mc.bindings = this.bindingsOf(node)`（新 helper，Sibling of `declaredNames` L324，~30 行）。遍历 chunk 根：C# `parameter.type` 字段（序列泛型/数组）→ 绑定；`variable_declaration.type`（显式序列类型）→ 绑定；`variable_declarator`（`var x`）且 initializer 是 `object_creation_expression`（`new List<...>`）或数组创建 → 绑定。全部归一键 `"IEnumerable"`。
2. **绑定表生命周期**：`MutableChunk`（L680-702）新增 `bindings: Record<string,string>`；`fresh()`（L723-732）初始化。流不敏感（chunk 内任意位置声明即全 chunk 可见，与 assigned 保守性一致）；**重赋值守卫**：chunk 内存在对该名的非序列赋值（`xs = 5`）→ 弃绑（一行检查，防误判纯）。
3. **receiverTypeOf 分支**（L592-612）：① obj 是 identifier 且 bindings 命中 → 返回 `"IEnumerable"`；② L600 call 类型检查加 `"invocation_expression"`（**S1 修复**）。
4. **builtinTypeEffects**（csharp.ts L206-244）新增 `IEnumerable` 条目（array 键合并同款，用共享 const spread 防漂移）：
   - **hof**（回调算子，命名回调走 addArgEdges）：`Select/Where/SelectMany/OrderBy/OrderByDescending/ThenBy/ThenByDescending/GroupBy/Aggregate/SkipWhile/TakeWhile/ToDictionary/ToLookup/Zip/Join/GroupJoin/Any/All/First/FirstOrDefault/Last/LastOrDefault/Single/SingleOrDefault/Sum/Min/Max/Average/Count/Contains`
   - **pure**（终结/纯）：`ToList/ToArray/ToHashSet/Skip/Take/Distinct/Reverse/Concat/Union/Intersect/Except/Cast/OfType/ElementAt/ElementAtOrDefault/SequenceEqual/DefaultIfEmpty/Append/Prepend/Length`
   - **ForEach 必须 hof 非 pure**（命名回调不可吞）。
5. **builtinMethodReturns**（L246-253）新增：`IEnumerable: { Select:"IEnumerable", Where:"IEnumerable", SelectMany:"IEnumerable", OrderBy:"IEnumerable", GroupBy:"IEnumerable", Skip:"IEnumerable", Take:"IEnumerable", Distinct:"IEnumerable", Reverse:"IEnumerable", Concat:"IEnumerable", ToList:"List", ToArray:"array", ToDictionary:"Dictionary", Count:"number", Sum:"number", ... }`（链式返回不断链；元素类型粒度不需要）。
6. **hofAlwaysArgs**（L337）加入全部 LINQ hof 算子——**S3 修复**（命名成员回调不可解析 → UNKNOWN 非假纯；lambda 回调不产 argFns，不受影响）。
7. **link.ts 零改动**（分支 0 已消费 receiver 事实）；`rootOf` 的 `literal:IEnumerable` 自动出现。

**测试改动**：`test/audit/fixture.test.ts` L61-66（LinqChain `Compute(List<int> xs)` → `xs.Where().Select().Sum()`）期望 **1 → 0**——这是方案 A 的验收性行为变更；`test/audit/csharp-lang.test.ts` L93-110 加纯度断言。

---

## 5. monad 语义正确性论证

- **Select/Where/SelectMany/OrderBy/GroupBy = fmap/filter/join 纯算子**：LINQ 惰性延迟执行，算子本身只构造查询对象，无副作用——标记 hof/pure 不引入假纯，前提是回调效应不丢：
  - **命名回调**：`addArgEdges` 建真边（bySimple 项目函数 ✓ 探针实证）；框架成员回调（`Console.WriteLine`）经 **hofAlwaysArgs 兜底记 UNKNOWN**（S3 教训——缺了它就是活假纯）。
  - **lambda 回调**：argFnsOf（L615-640）只收标识符/成员，lambda 不产 argFns → 无需边；其体调用已被 enclosing-chunk 提取（探针 IoSelect：`x => Console.WriteLine(x)` → 方法 chunk 直接 IMPURE ✓）。
- **ToList/ToArray/ToDictionary/ToHashSet = 终结纯**：物化仅分配，无回调无副作用。
- **严格性**：只收 .NET 语言事实级方法；漏条落 `?`（分支 0 表外路径，不假纯）。

---

## 6. 边界（明确不做）

- 跨方法返回类型传播（`GetData().Select` 保持 `?`——探针实证现状）。
- 泛型 T / 元素类型（只需要"是序列"这一性质）。
- 同 chunk 声明点可见性：类字段/属性、`out var`（`TryRemove(out var queue)` 签名在框架侧）、`var x = <调用>()` 不做（后续迭代）。
- 无前缀 `Enumerable.X`（S2）、string 变量（`url.Contains`）不属本方案（另立问题）。

---

## 7. 测试点（3 个 + 2 个回归）

1. **`List<int> xs.Select(f)` 回调含 io → IMPURE**：`xs.Select(x => Console.WriteLine(x)).ToList()` → purity=2 且 effects 含 io（验证 hof 不吞 lambda 回调）。
2. **无 io → PURE + 链不断**：`xs.Select(x => x*2).Where(x => x>0).Sum()` → 0；`var ys = new List<int>{1,2}; ys.Select(x=>x+1).Where(x=>x>2).ToList()` → 0 且无 unknownCalls（var+new 绑定 + 三段链）。
3. **数组形态**：`int[] arr; arr.Where(x=>x>0).Sum()` → 0。
4. **回归（S3）**：`System.Linq.Enumerable.Select(Range(0,3), Console.WriteLine)` 语句式 → **UNKNOWN(1) 非 PURE**（当前是假纯 0）。
5. **回归**：fixture.test.ts LinqChain 期望翻转为 0（行为变更显式化）。

---

## 8. 风险

1. **假纯方向（最高）**：monad 表必须严格（S3 实证教训）——hof/pure 分类错误 + 缺 hofAlwaysArgs = 假纯。缓解：hofAlwaysArgs 兜底、ForEach 类回调算子绝不列 pure、漏条落 `?`。
2. **绑定误判**：流不敏感下 `xs = 5` 后 `xs.Select()` 会误绑定——重赋值弃绑守卫（§4.2）。
3. **与 iter30 frameworkPure 交互**：变量 receiver 走分支 0（builtinTypeEffects），静态走 2.5（frameworkPure）——两路不交叠；但**同一回调洞（S3）两路共享**，一次 hofAlwaysArgs 修复同时覆盖。
4. **行为变更**：fixture LinqChain 期望翻转 + 已有「LINQ 动态链诚实 ?」用例语义变化（csharp-lang.test.ts L93）——需同步注释与断言。
5. **S1 修复的连锁**：`invocation_expression` 加入 receiverTypeOf 后，C# 链第二环起开始查 builtinMethodReturns——表未覆盖的方法落 `?`（诚实），不引入假纯。

---

## 9. 优先级判断

**本轮做（立即，独立小修）**：
- **S3 假纯洞**：公理 3 违规，当前 HEAD 活洞。改动 = hofAlwaysArgs 加 LINQ 算子（1 行）+ 1 回归测试。
- **S1 链断裂**：receiverTypeOf 加 `invocation_expression`（1 行）——C# 所有链的第二环起恢复解析（受益面含 21,488 bare 站点大块），与变量追踪解耦。

**记录待办（方案 A 主体，建议下轮做最小版 A1 = 参数/局部显式类型绑定 + IEnumerable 表 + S1/S3）**：
| 维度 | 证据 |
|---|---|
| 价值 | LINQ 变量链仅 359 站点（unknownCalls 0.6%）/ 287 chunks；110 UNKNOWN chunks 上界（实际受链断与混源影响更小）；top 变量形态是 Unity API（SetActive/Add/Invoke/GetComponent），monad 表不触达 |
| 成本 | 新 bindings pass（~30 行）+ 2 张表条目 + receiverTypeOf 2 分支 + fixture 期望翻转（行为变更需评审） |
| 机制收益 | 泛化：同表/同 pass 可续接字段绑定、`var x = <链>` 推断（builtinMethodReturns 已具备）——但本轮语料收益有限 |
| 不做代价 | 359 站点继续落 `?`（诚实方向，无假纯）——正确性无亏，仅判别力 |

结论：monad 建模语义正确、机制干净（用户提出的建模视角成立），但**语料收益不支持本轮做主体**；S1/S3 是正确性/机制缺陷，本轮修。
