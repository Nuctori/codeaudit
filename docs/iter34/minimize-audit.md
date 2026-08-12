# 迭代 33 最小化审计（minimize-audit，独立 reviewer，只读）

> 结论首行：**CHANGES（轻微，非阻塞）**——无假纯/无回归/方向安全，全部 303 测试绿；
> 但有 2 处"注释-行为不符"（C1 提取缺口、C2 落点偏差）被当作正式行为、未记录为妥协，
> 以及文档同步欠账（CHANGELOG/--help/README 计数）。见 §b/§c。
> 基线：HEAD f940f78（`git log f940f78~10..HEAD` = 迭代 31-33 共 10 提交，33 文件 +2320/−146）。
> 审计对象：`src/lang/extractor.ts`（ctorTypeName/receiverTypeOf/callOf 构造分支）、`src/engine/link.ts`
> （构造分支/0.5 分支/记账）、`src/core/effectUsage.ts`（TP4 分桶）、`src/lang/packs/csharp.ts`
> （pureCtor/frameworkPure/NUnit）+ iter30-32 的 frameworkPure/linqHof 演进。
> 实证手段：`npx vitest list`=303；`npx vitest run`=303 全绿；dist 直扫临时语料验证行为（命令见 §e）。

---

## a) 每个改动的最小性评估

| 改动（提交） | 最小性 | 证据与说明 |
| --- | --- | --- |
| **C1 构造器建模**（0601c71） | **最小（机制）+ 2 处可再缩** | 机制层（RawCall.ctor 可选字段 + callOf 构造标记 + link 0.5 专用分支 + pureCtor 清单）无夹带、无冗余抽象。陷阱 1/2/3（fix-audit §1）全部按设计规避：literalReceivers 移除 object_creation_expression（csharp.ts L205-207）、项目类边走 `byQualified["Type.Type"]` ctor chunk 防假纯、未列类型落 ?。**可再缩**：① ctorTypeName 的 qualified_name 分支只支持全标识符段，泛型末段 → null 全丢名（§b-1）；② pureCtor 有 ~12 个不可达/死键（§b-2）。未见夹带。 |
| **C2 gameObject 前缀**（ffadf38） | **diff 最小（8 行）但落点偏离设计** | 改动本身 8 行、白名单复用 frameworkIo.gameObject、hitTable 复用既有槽位——最小。但实现把分支**嵌套在 assigned 守卫内**（link.ts L596-608），而 fix-audit §3.1 设计与代码注释均要求"在 assigned 守卫**之前**"（L597）——注释-行为不符（§b-3）。实证：参数/foreach 变量覆盖（C# `parameter_list`/foreach identifier 节点类型不匹配 assignedNames 的 `"parameters"`/`variable_declarator`，属语法意外），真局部变量不覆盖。 |
| **TP4 分语言记账**（ffadf38） | **最小 ✓** | link.ts L238-245 前缀键（`\u0000` 分隔）+ classifyUsage L92-93 按 pack 前缀取数 + L164-177 按前缀过滤 missSlots——零语义变化（各语言 missSites 求和口径不变），单测覆盖（effectUsage.test.ts 构造 csharp/python 分桶断言）。遗留：missSlots 过滤里的 `!keySets.some(...)`（`module:... === ""` 恒假 → 恒 true）是迭代前死逻辑，本轮重写时未清理（非本轮引入，见 §b-9）。 |
| **--state 崩溃修复**（ffadf38） | **最小 ✓（文档欠账）** | cli.ts L309：全量 `stateCouplingOf(report.verdicts)` 计算（避免 --top 预滤失真）后 `.slice(0, args.top ?? 50)` 截断输出——崩溃根因（6591 写方 × readerKeys 跨积超 V8 字符串上限）修在序列化侧而非分析侧，正确。**欠账**：fix-audit §3.3 明确承诺"输出截断文档化（help 文本补一句）"未兑现（--help L96 `--state` 行无截断说明）；CHANGELOG 无迭代 33 条目（提交信息声称"README/CHANGELOG 同步"但只改了 README）；消费端契约变化（全量 → 默认 top 50）仅存于代码注释。另：json 默认 50 vs text 默认 15（cli.ts L309 vs L339）不一致，可接受但未注明。 |
| **TP5 NUnit**（ffadf38） | **最小 ✓** | csharp.ts L190-193 仅加 `"StringAssert"`/`"Does"` 两键；"不动 Assert（撞 UnityEngine.Assertions，impureGlobals 优先）"有记录且有测试。675 站恢复方向安全（抛异常≠副作用）。 |
| **frameworkPure 成员级白名单**（34848a8，iter32） | **结构收紧合理 ✓** | 前缀级 → 两级结构（Record<ns, Record<type, pure\|hof\|嵌套成员表>>）是 compromise-audit C1 的裁定方案；linqHof 29 算子表删除由 `Linq: "hof"` 1 键 + `addArgEdges(unconditional)` 承担——表尺寸反缩。Text 嵌套死键经 iter32 复审 Blocking 修复并有 T4 测试。已知近似（Linq 整类 hof 对非委托成员的 arity 盲区）**已记录**（iter32 待办① + iter31 待办②，§b-4）。 |
| **iter31 S1/S3/HIGH-1/MEDIUM-2/记账不变量**（79097e4） | **最小 ✓** | receiverTypeOf 补 invocation_expression（extractor.ts L618-630）；S3/HIGH-1 门改 + 记账不变量修复（link.ts L276-280 走完整 markUnknown 通道，恢复 `calls.has("?") === unknownSites>0`）——每个修复都有专属测试（S1 链/S3/HIGH-1/MEDIUM-2/撞名守卫）。 |
| **iter31 monad 判定表**（0c35349） | **前置配置（YAGNI 边界）** | builtinTypeEffects 补 IEnumerable/List/Dictionary + builtinMethodReturns 扩展。注释声明"A1 待办启用后分支 0 判定表必须覆盖"——已记录为前置对齐。**但实证当前不可达**：`new List<int>().Add(1)` 仍 ?（class: receiver 分支未按 fix-audit §3.5 协同点 consult builtinTypeEffects）；变量 receiver 从不 consult 分支 0。表暂为死配置，§b-6。 |
| scripts/probe-annotate 等（dbf7171） | 纯 tab 规范化，零功能变化 ✓ | probe-hof.cjs 删除（30 行）、probe-annotate/override 系列仅缩进。 |

**夹带检查**：CROSS-AUDIT/CHANGELOG/README 文档同步属于正常配套；无与本轮主题无关的 src 改动（git diff 复核：src 6 文件全部对应 C1/C2/TP4/--state/TP5/S1/S3）。

---

## b) 工程妥协清单（位置 / 本质 / 是否记录 / 是否需数学最小化）

| # | 位置 | 本质 | 是否记录 | 需数学最小化？ |
| --- | --- | --- | --- | --- |
| 1 | extractor.ts L829-834 `ctorTypeName` qualified_name 分支 | 泛型末段被 filter 丢弃：`new System.Collections.Generic.Dictionary<string,int>()` 的 type 树末子是 `generic_name`（非 identifier）→ parts 为空 → **null → 全 UNRESOLVED 丢名**（连 miss 记账都没有，实证 missSlots 只有 `global:d` 无 `ctor:*`）。代码注释却声称"new System.Collections.Generic.List\<T\>() → List"——**注释-行为不符**，妥协被当作正式行为 | **否**（fix-audit §3.5 只写"取末段或全名——先全名，由表键决定"，含糊带过） | 是——5 行修复见 §c-1，且是纯提取层收紧（数学上就是把"末段"定义为**末段节点递归剥壳**而非"末段 identifier"） |
| 2 | csharp.ts L375-387 `pureCtor` | ~12 个不可达/死键：`byte[]`（array_creation_expression 非 call node，永不产 ctor 标记）、`byte/char/int/long/float/double/bool/object/string/String`（`new string('x',2)`/`new int()` 的 type 是 `predefined_type`，ctorTypeName 不处理 → null）、`Mathf`/`SystemInfo`（静态类不可 new）、`Object`/`Texture2D`（impureGlobals 优先 `state` 遮蔽——行为正确但键是死的误导）。清单注释声称"语料确证 top 20"——只对非限定形式成立 | **否**（清单注释只记了入选理由，未记不可达键） | 部分——predefined_type 支持（§c-1）可激活 string/int 等；死键删除是配置最小化 |
| 3 | link.ts L596-608 C2 分支落点 | 设计（fix-audit §3.1）要求分支在 assigned 守卫**之前**；实现嵌套在守卫**之内**（L595 之后），注释 L597 却写"必须在 assigned 守卫**之前**的独立分支"。实证：`var item = obj; item.gameObject.SetActive(false)`（真局部）→ UNKNOWN=1；参数/foreach → io（C# `parameter_list`/foreach identifier 不入 assignedNames，属语法意外）。提交信息声称"98 chunks/115 站翻确定效应"——对真局部 receiver 不成立，收益被高估 | **否**（pain-a/fix-audit 记录了语料形态与设计意图，但实现偏差及其覆盖边界未记录；测试只覆盖参数形态，无局部变量用例） | 是——按设计把分支移到守卫前即可恢复对局部的覆盖（方向安全：白名单限死 + io 过近似），见 §c-2 |
| 4 | csharp.ts L445 `Linq: "hof"` 整类标记 + link.ts L647 unconditional 门 | 非委托成员（ToList/Concat/Skip/Take 等）带标识符实参 → 假 UNKNOWN（实证 `Enumerable.ToList(xs)` → UNKNOWN=1）。整类与逐成员**不**等价，是 arity 盲区近似 | **是**（iter32 待办①"Linq 非委托成员带标识符实参 → ?（arity 感知 argFnsOf）"；iter31 待办②同源） | 是（待办已在列）——arity/委托形参感知后 Linq 可拆回成员级，当前方向安全（UNKNOWN 非假纯） |
| 5 | cli.ts L309 --state 输出截断（默认 top 50） | 分析全量、输出截断——正确取舍；但消费端契约从"全量"变"top 50 默认截断" | **部分**（代码注释记录；--help/CHANGELOG 未记录，§a--state 行） | 否（崩溃修复的必然形态；数学上输出应保持分析全量，截断只是序列化侧上限——已是最小） |
| 6 | csharp.ts builtinMethodReturns IEnumerable 表 `First/Last/Single/ElementAt/Aggregate: "number"` | 泛型元素返回类型无法静态推知，近似为 number——若 A1 启用后 `xs.First().Trim()`（string 元素）会断链落 ?（精度损失非假纯） | **否**（iter31 只记录"A1 前置对齐"意图，未记录返回类型近似本身） | 是（A1 落地时需元素类型参数化；当前表不可达，latent） |
| 7 | csharp.ts L503-513 `hofCallsArgs` == `hofAlwaysArgs`（13 项完全相同） | C# 侧"无条件调用子集"已退化为例外集（两集合内容一致），注释"与 hofCallsArgs 同源（无条件调用子集）"失真（Python 侧仍是真子集） | **否** | 是——合并为一集或注明 C# 侧等价（去冗余是形式化收紧） |
| 8 | link.ts L493-496 ctor 分支 `Array.isArray(rule)` → 硬编码 addEffect("io") | 注释写"取数组首效应"，代码是固定 io（不读数组）；当前 csharp impureGlobals 无数组形态 → 死分支（防御） | **否** | 否（防御性，成本 0；改注释即可） |
| 9 | effectUsage.ts L171-176 missSlots 过滤 `!keySets.some(...)` | `module:${k.replace(/^node:/,"")}` === "" 恒假 → some 恒 false → 过滤恒通过（死逻辑）。疑似原意是"排除已枚举表键"，从未生效 | **否**（迭代前遗留，本轮 TP4 重写时原样保留） | 是——删除或实现原意（排除 `module:`/`global:`/`builtin:` 已枚举槽位，避免 missSlots 与 entries 重复展示） |
| 10 | link.ts L510/573 unknownCalls 对 ctor 站点 attr=`<unresolved>` | 未列构造类型名只进 missTable 槽位（`ctor:X`），不进 --unknowns 标注工作流（attr 全为 `<unresolved>`，无法区分站点形态） | **否** | 否（报告侧；可把 `new ${t}` 写入 attr 提示，一行） |

**总评**：8 项妥协同方向安全（全部落 ?/UNKNOWN 或 io 过近似，无假纯方向）；其中 #4 已记录；#5 部分记录；#1/#2/#3/#6/#7/#8/#9/#10 未记录——**本轮审计的最大缺口就是"未记录"本身**（迭代 33 无专属 impl/record 文档，CHANGELOG 停在迭代 32）。

---

## c) top 3 可收紧点 + 具体方案

### c-1（最高收益）ctorTypeName 末段递归 + predefined_type —— extractor.ts L821-834

问题：qualified_name 分支 filter 只留 identifier/type_identifier 子节点，泛型末段（`generic_name`）和嵌套 `qualified_name` 首段被丢；predefined_type 完全未处理。
实证：`new System.Collections.Generic.Dictionary<string,int>()` → 全 UNRESOLVED（连 miss 记账都无）；`new List<int>()`（非限定）正常 → "List"。

方案（5 行内，保留诚实红线）：

```ts
function ctorTypeName(node: SyntaxNode): string | null {
  if (node.type === "identifier" || node.type === "type_identifier" || node.type === "predefined_type") return node.text;
  if (node.type === "generic_name") {
    const name = node.childForFieldName("name") ?? node.children[0];
    if (name && (name.type === "identifier" || name.type === "type_identifier")) return name.text;
    return null;
  }
  if (node.type === "qualified_name") {
    // 末段节点递归剥壳：System.Collections.Generic.Dictionary<K,V> 的末子是 generic_name，
    // 非 identifier——"取末段"必须是节点级递归而非 identifier 过滤
    const last = node.children[node.children.length - 1];
    if (last) return ctorTypeName(last); // generic_name/qualified_name/identifier/predefined_type
    return null;
  }
  return null;
}
```

验证点（对照实证）：`System.Uri`→"Uri"、`System.ArgumentException`→"ArgumentException"、
`System.Collections.Generic.Dictionary<string,int>`→"Dictionary"（进 pureCtor → PURE）、`new string('x',2)`→"string"。
连带激活 §b-2 的 string/int 等 pureCtor 键；恢复 ctor miss 记账（`ctor:Dictionary` 进补表候选，闭环标注）。

### c-2 C2 分支移回 assigned 守卫之前 + 修正注释 —— link.ts L595-608

按 fix-audit §3.1 设计落点（守卫前独立分支，`call.obj !== null && call.attr.startsWith("gameObject.")`），
恢复对**真局部变量** receiver 的 io 覆盖（实证当前 UNKNOWN），并修正 L597 注释的落点描述；
补一条局部变量用例测试（`var item = obj; item.gameObject.SetActive(false)` → io）。
方向安全论证（设计已接受）：白名单限死 7 成员；自定义 `gameObject` 属性遮蔽在 Unity 惯例下罕见，且 io 为过近似非假纯。

### c-3 pureCtor 死键清理 + ctor 命中纳入使用率枚举 + 文档同步

1. csharp.ts pureCtor：删除/标注不可达键（`byte[]`、`Mathf`、`SystemInfo`、被 impureGlobals 遮蔽的 `Object`/`Texture2D`）——
   或先做 c-1 再按可达性复核（`string`/`int` 等经 predefined_type 可达后保留）。
2. effectUsage.ts keySets：补 `ctor:*` 槽位枚举（与 missTable 对称，闭合"miss 可见、纯命中不可见"不对称，§a-TP4 旁注）。
3. 文档同步（本轮欠账）：CHANGELOG 补迭代 33 条目（C1/TP4/--state/TP5/C2 + 截断契约变化）；
   --help `--state` 行补"json 输出 top 50 截断（--top 可调）"；README 测试数 301 → 实际 303；
   并把 §b-1/2/3/6 的妥协逐条记录进本审计（或 iter33 record）。

---

## d) 测试与验证状态

- `npx vitest run`：30 文件 **303/303 全绿**（README 标 301，差 2——计数漂移，见 §c-3.3）。
- 迭代 33 新增测试 13 个：csharp-lang +12（S1 链/S3/HIGH-1/MEDIUM-2/撞名守卫/T1-T4/C2/TP5/C1 四边界）、effectUsage +1（TP4 分桶）。
- **测试盲区**：C2 无真局部变量用例（只测参数形态）；--state 截断无 e2e 回归（fix-audit §3.3 建议的冒烟未落地，崩溃可能静默回归）；C1 无全限定泛型构造用例（§b-1 缺口未被任何测试覆盖）；monad 表不可达性无断言。
- InitDeity 语料侧数字（unknown 5102→4644、csharp 命中 80→82、37292→36041、--state json exit 0）仅在提交信息中，J: 语料本机不可用，未复核。

## e) 实证命令摘要

- `npx vitest list | wc -l` → 303；`npx vitest run` → 303 passed。
- dist 直扫（node + scanProject）：
  - C2：`Param(GameObject item)`→IMPURE io / `Foreach(var item…)`→IMPURE io / **`Local(var item = obj…)`→UNKNOWN=1** / `this.gameObject`→IMPURE io。
  - C1：`new List<int>()`→PURE；`new FileStream`→IMPURE fs；`new UnknownThing()`→UNKNOWN；`new Proj()`→构造体 fs 传导 IMPURE；
    **`new System.Collections.Generic.Dictionary<string,int>()`→UNKNOWN（无 ctor miss 槽位）**；`new string('x',3)`→UNKNOWN；
    `new List<int>().Add(1)`（链）→UNKNOWN（receiver class:List 落 ?）。
  - LINQ：`Enumerable.ToList(xs)`→UNKNOWN=1（§b-4 已记录妥协实证）。
- wasm AST dump：object_creation_expression type 字段形态确证（qualified_name 末子为 generic_name / predefined_type）。
