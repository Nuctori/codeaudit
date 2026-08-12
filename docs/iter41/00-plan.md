# 迭代41 方案：三颗果实（表一致性断言 / 分派完备性证明 / 签名半自动生成）

> 来源：会话讨论「LangPack 设计评估」——架构是最佳实践（Σ 表=库签名文件、条件健全性 A6/A7 为真形式化、
> 类型层否决为数据驱动正确决定、91% `?` 为信息下界），但有三处可升级：
> **互斥性靠约定、完备性靠测试、表内容靠人工**。本迭代逐一处理，按项目惯例先数学家 + Jeff Dean 评审。
>
> 基线（待评审实测确认）：vitest 全量绿 + `analyze.invariantViolations = 0`（A6 内层机检证书）。

## 果实 1：表级一致性断言（互斥性从约定变机器校验）

**问题**：通道序「impure 先于 pure」（P1）、ctor 决策「impureGlobals 类型键优先」（iter33 C1）都是
语义要求，但同键重叠目前只是文档约定——重叠 = 死条目（永不达）或语义歧义，静默存在。

**断言清单**（`validatePackConsistency(pack): string[]`，违反返回错误消息）：

| # | 断言 | 语义依据 | 违反后果 |
| --- | --- | --- | --- |
| M1 | `impureBuiltins ∩ pureBuiltins = ∅` | 裸名通道 impure 先查（link L1591-1611） | 同键 pure 条目永不可达 = 死数据 |
| M2 | `impureModules ∩ pureModules = ∅` | 模块通道（iter37 §2.1 最长点分回退） | 同上 |
| M3 | `impureGlobals ∩ pureGlobals = ∅` | 对象通道 impure 先于 pure（P1，effectUsage L37-41 依赖不可达性做 provably-dead 判定） | 同上 + 破坏 effectUsage 死代码判定前提 |
| M4 | `frameworkIo ∩ frameworkPure = ∅`（键级） | 2.5 通道 Io 先查（link L1524-1573），同键重叠时 Pure 永不达 | 死数据 |
| M5 | `pureCtor ∩ impureGlobals = ∅`（键级） | ctor 决策 impureGlobals 先于 pureCtor（link L926+ 规则①） | 死条目；`FileStream:fs` 同时列 pureCtor = 数据错误信号 |
| M6 | `hofAlwaysArgs ⊆ hofCallsArgs` | 文档契约「无条件调用子集」（pack.ts L171-172；link L1599 双查） | 违反 = 数据形态与文档不符（行为上仍生效，仅卫生） |

**实现**：`src/lang/pack.ts` 尾部新导出纯函数（~40 行，零依赖）；生产路径**不调用**（零开销），
由 `test/unit/packConsistency.test.ts` 对 4 个内置 pack + effectOverride 合并后 pack 调用。
无框架、无新依赖。

**范围外（不做断言）**：

- importMap 与效应表重叠——importMap 是用户代码动态构造，import 优先是通道序语义（C1），非数据卫生。
- `builtinTypeEffects` 内部 `"pure"|"hof"` 单值域，无重叠可能。
- 字面量接收者 vs 裸名——receiver 分支位次是语义（防字面量劫持，link L1326-1327），非表对。

## 果实 2：分派完备性证明（S4 从声称变引理）

**问题**：S4（解析闭包——每条调用点 → 边/效应/⊥，无静默丢弃分支）目前是断言 + 回归测试兜底。

**证明结构**（写入 `docs/iter41/01-proof.md`，零代码）：

1. **调用点形态有限枚举**：RawCall 判别字段 = {ctor?, receiver?, obj(null/非null/selfNames/assigned), attr(含"."?)}。
   `resolveCall`（link L1273-1649）按这些判别分派，全部截获通道：0.5 ctor → 0 receiver → 1 self →
   2 bare → 2.25 attrPrefix → 2.5 framework → 3 import → 4 效应表 → 5 wildcard/unknown 总兜底。
2. **完备性 = 结构归纳**：函数体为返回式分派（每通道命中即 return），穿透路径（2→2.25→2.5→3→4→5）
   为显式 fallthrough，末端 5 是总 sink（裸名 unknown / 对象 markDynamic+unknown）⟹ 每条调用点
   恰落一通道或 ?。**关键验证点：逐 if 检查无「静默穿出」路径**。
3. **互斥性 = 判别互斥**：ctor vs 非 ctor（extractor 保证构造标记互斥）；receiver≠null 分支先于一切
   （obj/attr 判别不再可达）；self（attr 无"."）vs attrPrefix（attr 有"."）由 attr 判别互斥；
   bare（obj=null）vs framework/objDispatch（obj≠null）由 obj 判别互斥。表对重叠由果实 1 断言兜底。
4. **S4 推论**：`?` 参与传播（sink.markUnknown 与 addUnknownCall 成对出现），无静默丢弃分支。

**交付形态**：证明文档 + 上述验证点逐条标注代码行号。可附带一个**调用点形态穷举测试**
（构造覆盖全部判别组合的合成调用点，断言无未处理路径）——视评审裁决是否值得（可能是过度工程）。

## 果实 3：效应表半自动生成（设计 + 建议延后）

**问题**：Σ 表人工维护（外层保真度不可证，axioms.md §五），新语言接入成本 = 全人工。

**设计要点**：

- TS：`@types/node` 的 .d.ts 经 TypeScript compiler API 解析 → 纯函数/纯模块识别。
- Python：typeshed .pyi 存根经标准库 `ast` 解析（零新依赖）。
- **方向安全铁律**：生成器只做保守识别（签名中无副作用信息 → 只生成纯判定；io 类靠类型启发式
  ——返回句柄/参数回调——**且必须人工审核后才入库**）。任何启发式 = 新假纯向量，必须过 A6 纪律。
- 产物形态：生成 JSON → 人工审核 → 并入语言包（或作为 override 文件加载，复用 effectOverride 通道）。

**风险**：签名文件无效应标注，io 识别本质是启发式；生成器本身需要测试维护 = 新债。
**现值**：4 语言表已稳定（多轮语料校准），无新语言接入计划 → 生成器边际收益为负。

**建议裁决：延后（等疼再做）**——保留本设计段为决策记录。

## 评审问题清单

1. 果实 1 断言清单是否完备/过强？（M5 是否真互斥？M6 子集契约是否值得断言？）
2. 果实 2 证明结构是否有洞？（穿透路径枚举是否完整？形态判别是否真的有限？）
3. 果实 3 是否本轮做？（建议延后，请独立裁决）
4. 是否有第 4 颗果实被我漏掉？
