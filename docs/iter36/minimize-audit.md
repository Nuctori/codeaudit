# 迭代 34-35 最小化审计（minimize-audit，独立 reviewer，只读）

> 结论首行：**CHANGES（非阻塞）**——无回归、304/304 全绿、Iter-34 七项修复方向正确；
> 但 Iter-35 A1 有 1 处**假纯方向**守卫缺口（参数类型撞 builtinTypeEffects 键的项目类无"项目类优先"
> 守卫，与 Iter-34 ctor 修复自立的红线不一致）、1 处冗余夹带（paramNames C# 补丁经实证无行为变化、
> 前提注释错误）、多处"注释-行为不符"（paramTypesOf 收集范围、A1 分支位置、ctor 优先级一致性声称、
> ctorTypeName 旧行为描述），以及文档欠账（CHANGELOG 缺迭代 35 条目、A1 无记录文档）。
> 基线：HEAD 1275424；审计范围 `git diff 53f3e2f..HEAD`（Iter-35 A1）+ `git show 53f3e2f`（Iter-34 七项修复）。
> 实证手段：`npx vitest run` = 304/304 全绿；tree-sitter-c_sharp.wasm 直解析 8 种 C# 声明形态验证
> `parameters` 字段；dist Extractor 直扫 C# 语料验证 paramNames/paramTypesOf 实际输出；命令见 §e。

---

## a) 每个改动最小性评估

### Iter-34（53f3e2f，独立审计 7 项修复）

| 改动 | 最小性 | 证据与说明 |
| --- | --- | --- |
| **TP4 module 命中键带 pack 前缀**（link.ts L197-237） | **最小 ✓ 彻底 ✓** | effectFromModule 内 5 处 bump 全部改 `mk`（`${fi.pack.name}\u0000module:${module}`），与 sink.hitTable/missTable 的 `${pk}\u0000` 前缀（L248-249）同构。全库 grep 复核：`module:` 键的生成点仅 effectFromModule（已前缀）+ `sink.missTable(\`module:...\`)`（L390/413，走 sink 已前缀）+ effectUsage.ts L88 查询侧对称拼前缀——**无遗漏的无前缀 bump**。单测 +1（effectUsage.test.ts 断言 csharp/python 分桶）。 |
| **C2 守卫前移**（link.ts L599-611） | **最小 ✓** | 8 行整体搬移到 assigned 守卫之前，白名单复用 frameworkIo.gameObject、hitTable 复用既有槽位。测试 +1（`var item = src; item.gameObject.SetActive(false)` → io，防回归）。遮蔽场景（`item = other` 后 `.gameObject.SetActive`）→ io：**方向安全**——Unity 语义下该形态必然 io，且白名单只含 SetActive/GetComponent/transform/layer/tag/name/AddComponent（csharp.ts L399），白名单外落回 ?（RefreshSelf 用例实证）。io 过报方向、无假纯。 |
| **ctor 项目类优先 + moduleAssigned 守卫**（link.ts L494-518） | **最小 ✓（注释不符 1 处）** | 顺序修正为 impureGlobals → 项目类 → pureCtor → ?，防项目类撞 pureCtor 名单假纯（红线方向）。测试 +1（项目类 List 带 io 构造 → io 传导）。moduleAssigned 守卫与常规 obj 分支（L699）对称。**不符**：注释"与常规路径'项目类优先于效应表'一致"不成立——常规 obj 分支 globalClasses（L697）在 impureGlobals（L710）**之前**；ctor 分支 impureGlobals（L496）在项目类（L504）**之前**。项目自建类撞 impureGlobals 键（Debug/FileStream 等，TP5 注释确证 Assert 撞 UnityEngine.Assertions 现实存在）时：`new Debug()` 走效应表 io，`Debug.Log()` 走项目类边——两种形态优先级不同。§b-4。 |
| **ctorTypeName 泛型末段递归 + predefined_type**（extractor.ts L819-833） | **最小 ✓（注释描述旧行为不准确）** | 修复正确：`System.Collections.Generic.Dictionary<K,V>` → "Dictionary"（实证），predefined_type string → "string"。测试 +1（gen/pre 用例）。**不符**：注释称旧行为"空 → null（连 miss 记账都无）"——实际旧代码 `parts.filter(identifier | type_identifier)` 对全限定名返回**末 identifier "Generic"**（非 null），且有 `ctor:Generic` miss 记账。修复后行为正确，旧行为描述失真。 |
| **--state 硬上限 500**（cli.ts L307-310 + L94 help） | **最小 ✓（数学残余未记录）** | `Math.min(args.top ?? 50, 500)` 一行 + help 补截断说明 ✓（上轮欠账已兑现）。**残余**：500 写方 × 巨大 readerKeys 跨积**仍可**超 V8 字符串上限（2^29-24 ≈ 536M 字符）——500 × 平均 readerKeys × ~80 字符，平均读者 >1.3 万即超限。InitDeity 实测 exit 0 ✓，但"硬上限"无数学保证、序列化侧无长度防御。§b-2。 |
| **effectUsage missSlots 死逻辑删除**（effectUsage.ts L165-171） | **最小 ✓** | 删除恒假 filter（`module:${k} === ""` 恒 false），保留 `miss > 0`；keySets 仍被枚举表键使用（L63-91）无死变量。注释记录删除理由 ✓。 |
| **ctor Array.isArray 注释修正**（link.ts L498-502） | **最小 ✓** | 注释注明防御分支不可达（csharp impureGlobals 全 string 值），行为不变。 |

### Iter-35（1275424，A1 参数显式类型绑定）

| 改动 | 最小性 | 证据与说明 |
| --- | --- | --- |
| **paramNames C# parameter_list 补丁**（extractor.ts L309-331） | **✗ 冗余夹带（无行为变化）** | 实证：tree-sitter-c_sharp.wasm 解析 8 种声明形态——method_declaration / constructor_declaration / local_function_statement / lambda_expression / anonymous_method_expression / operator_declaration / indexer_declaration / record_declaration **全部有 `parameters` 命名字段**。原 `root.childForFieldName("parameters")` 一直对 C# 生效，参数收集从未失效（dist 直扫实证 params=["d","key","n","t"]）。fallback 分支对 C# 不可达；对 TS/Python 节点类型不匹配同样不触发。补丁注释"审计确认参数收集对 C# 失效"**前提错误**。§b-3。 |
| **paramTypesOf**（extractor.ts L335-354） | **机制有效 ✓ / 注释-行为不符** | 实证输出 `{"d":"Dictionary","key":"string","n":"int","t":"Thing"}`——**收集全部显式类型**（string/int/项目类）。注释声称"仅收集集合/数组类型；非集合类型返回 null"——**代码与注释不符**，测试还断言 `s.Trim()` → PURE（依赖该行为，测试与注释矛盾）。方向安全（见 §b-1 分析）但注释需修正。同样带不可达 fallback。 |
| **link A1 分支**（link.ts L683-692） | **最小 diff（10 行）✓ / 语义缺口 1 处** | 守卫 `!caller.assigned.includes(call.obj)` 完整（参数重绑跳过；C# CS0136 禁局部遮蔽参数）。hof 分支 addArgEdges 保留回调 ✓。**缺口**：注释"放 globalClasses 之后（项目类优先）"与代码位置（L686 在 globalClasses L697 之前）不符；且**语义上查的是 ptype（类型名），globalClasses 查的是 obj（变量名）——"项目类优先"从未实现**：参数类型为项目自建 List/Dictionary 类（Iter-34 测试确证此类撞名现实存在）时，`xs.Add(...)` 走 `type:List.Add → pure`，与 Iter-34 ctor 修复防的假纯同类。§b-1。 |
| **pack.ts paramTypes 字段 + 测试 + README** | **最小 ✓** | 可选字段带注释；测试 +1（304/304）；README 304 同步 ✓。**欠账**：CHANGELOG 无迭代 35 条目（Iter-34 提交有 33-34 条目，A1 只改 README 计数）；docs/iter35 目录为空且未跟踪。§b-6。 |

**夹带检查**：Iter-34 无夹带（7 项修复全对应审计发现，测试/文档配套）；Iter-35 的 paramNames 补丁是唯一无行为变化的代码（§b-3）。

---

## b) 工程妥协清单（位置 / 本质 / 是否记录 / 需数学最小化？）

| # | 位置 | 本质 | 是否记录 | 需数学最小化？ |
| --- | --- | --- | --- | --- |
| 1 | link.ts L686-692 A1 分支 + extractor.ts paramTypesOf | **参数类型→builtinTypeEffects 键绑定无项目类守卫**：项目自建类撞 List/Dictionary/IEnumerable 等表键且作为参数类型 → `xs.Add` 判 PURE（项目 Add 若 io → **假纯，红线方向**，与 Iter-34 ctor 修复自立的"项目类撞名单"红线直接冲突）。注释"放 globalClasses 之后（项目类优先）"与代码位置不符且语义从未实现（查的是 ptype 非 obj）。**非集合类型误收**（string/int/项目类全收）本身方向安全（string/number/boolean 表条目全纯、Go/C 等语言 inert），但注释声称"仅收集合类型"失真 | **否**（A1 注释只描述意图，未记录守卫缺口与收集范围） | 是——项目类守卫见 §c-1（4 行，与 ctor 分支对称） |
| 2 | cli.ts L310 --state 硬上限 500 | 500 写方 × 巨大 readerKeys 跨积仍可超 V8 字符串上限（536M 字符，数学上平均读者 >1.3 万即超）；"硬上限"是实测调参值非数学上界，序列化侧无长度防御（仅截断写方数） | **部分**（注释记"截断必须封顶"动机与实测；未记数学残余） | 是——序列化前长度估算/渐进截断，或至少注释注明残余 |
| 3 | extractor.ts L309-331 paramNames 补丁 | 冗余夹带：C# 所有带参数形态实证均有 `parameters` 字段，fallback 不可达、无行为变化；注释"参数收集对 C# 失效"前提错误（误导后续维护者） | **否**（错误前提被当事实记录） | 是——删除 fallback（或修正注释），参数收集契约不变 |
| 4 | link.ts L496 vs L697/L710 ctor 优先级 | 注释"与常规路径'项目类优先于效应表'一致"不成立：ctor 分支 impureGlobals 优先于项目类，常规 obj 分支项目类优先于 impureGlobals。项目类撞 impureGlobals 键（Debug/FileStream/Assert 撞名现实存在）时两形态判定不同 | **否**（声称一致性但实现不一致） | 否（行为影响有界：impureGlobals 键有限且构造即效应语义可辩；改注释即可） |
| 5 | extractor.ts L822-825 ctorTypeName 注释 | 注释称旧行为"空 → null（连 miss 记账都无）"；实际旧行为返回末 identifier（"Generic"）且有 miss 记账。修复本身正确 | **否**（旧行为描述失真） | 否（注释修正） |
| 6 | CHANGELOG / docs/iter35 | A1（970 站修复、新机制 paramTypes/paramTypesOf/A1 分支）无 CHANGELOG 条目、无记录文档；CHANGELOG 停在迭代 33-34 | **否** | 否（文档补记） |
| 7 | extractor.ts L486 vs A1 判纯 | 语义不自洽：参数**下标**容器变异（`d[0]=1`）记 stateWrites（"影响调用方 → 外部"，L486）；参数**方法**容器变异（`d.Add`）A1 判 PURE。同一"参数共享对象内容变异"两种判定。A1 前 `d.Add` 是 ?（诚实未知），A1 后 PURE——判定从保守侧移向欠报侧 | **否**（A1 只记"集合操作无 io"，未记录与下标写语义的分叉） | 是——需明确模型裁决：方法变异是否建模为 state（若建模，A1 收益消失，需按"方法变异集合 = 不判纯但也不 io"另行设计；当前至少应记录该边界） |

**方向安全总评**：#1/#7 是**假纯/欠报方向**（红线，需收紧）；#2 是崩溃残余（理论）；#3/#4/#5 是注释-行为不符（无判定影响）；#6 是文档欠账。Iter-34 修复集自身无假纯回归。

---

## c) top 3 可收紧点 + 具体方案

### c-1（最高收益，红线方向）A1 参数绑定加项目类守卫 —— link.ts L686-692

问题：参数类型名（ptype）撞 builtinTypeEffects 键（List/Dictionary/IEnumerable/string 等）时直接查表判纯；项目自建同名类（Iter-34 测试已确证 List 撞名现实存在）的实例方法被误判纯。与 Iter-34 ctor 修复"项目类优先于 pureCtor 名单"（L503-513）同类，但 ctor 有守卫、A1 没有。

方案（4 行，与 ctor 分支对称）：

```ts
const ptype = caller.paramTypes?.[call.obj ?? ""];
if (ptype !== undefined && !caller.assigned.includes(call.obj ?? "")) {
  // 项目类优先（与 ctor 分支 L504 同守卫）：参数类型是项目类 → 不走表绑定（落回全局类/未知路径）
  const pcls = globalClasses.get(ptype);
  if (!(pcls && pcls.length === 1 && pcls[0]!.lang === pack.name)) {
    const rule = pack.builtinTypeEffects[ptype]?.[call.attr];
    if (rule === "hof") { sink.addArgEdges(call.argFns, call.attr); sink.hitTable(`type:${ptype}.${call.attr}`); return; }
    if (rule === "pure") { sink.hitTable(`type:${ptype}.${call.attr}`); return; }
  }
}
```

同时修正注释：删"放 globalClasses 之后（项目类优先）"（代码在之前且查的是 ptype），改"项目类名撞表键 → 跳过绑定（与 ctor 分支对称）"。

### c-2（次高）paramNames/paramTypesOf 冗余 fallback 删除 + 注释修正 —— extractor.ts L309-354

实证 C# 所有带参数形态均有 `parameters` 字段（method/ctor/local function/lambda/anonymous/operator/indexer/record）——fallback（`?? root.children.find(c => c.type === "parameter_list")`）不可达，删除（paramNames 与 paramTypesOf 各一处）。paramTypesOf 注释改为如实描述："收集参数显式类型名（剥壳后全部类型；string/number/boolean 表条目全纯方向安全；项目类撞表键由 link 守卫排除）"。无行为变化、纯代码收缩 + 纠错。

### c-3（Low）--state 硬上限 500 加序列化侧防御 —— cli.ts L309-313

现状：`slice(0, Math.min(top ?? 50, 500))` 只截写方数；500 × 巨大 readerKeys 数学上仍可超 V8 上限（平均读者 >1.3 万）。方案（一行级）：JSON.stringify 前估算——若 `JSON.stringify(stateCouplingOf(...).slice(0,500))` 长度预估超阈值（如 4 亿字符）再按比例收缩 top（二分），或把 readerKeys 在输出侧截断（如每写方最多 2000 读者，消费端契约注明）。最小版本：注释补记"500 为 InitDeity 实测调参值，非数学上界；更大语料需序列化侧防御"。

---

## d) 结论

**CHANGES（非阻塞）**：Iter-34 七项修复全部正确、最小、有测试——TP4 前缀彻底（无遗漏）、C2 前移方向安全、ctor 项目类优先防住假纯、--state 封顶、死逻辑删除。Iter-35 A1 机制有效（970 站痛点、304/304 绿），但存在 1 处**假纯方向守卫缺口**（§b-1，需收紧）+ 1 处冗余夹带（§b-3）+ 3 处注释-行为不符（§b-1/4/5）+ 文档欠账（§b-6）+ 语义分叉未记录（§b-7）。均不阻塞合入，但 §b-1 与 Iter-34 自立的红线直接冲突，建议随迭代 36 一并收紧。

## e) 实证命令

```
npx vitest run                      # 304/304 全绿（29 files）
npx vitest run test/audit/csharp-lang.test.ts   # 40/40
tree-sitter-c_sharp.wasm 直解析（method/ctor/local function/lambda/
  anonymous method/operator/indexer/record）→ 全部有 parameters 字段
dist/lang/extractor.js + csharpPack 直扫 →
  chunk Read: params=["d","key","n","t"], paramTypes={"d":"Dictionary","key":"string","n":"int","t":"Thing"}
git show 53f3e2f / 1275424 全量 diff 复核
git grep 复核 `module:` 键生成点（link.ts 5+2 处全前缀；effectUsage 查询侧对称）
```
