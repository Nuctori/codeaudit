# 迭代41 合成裁决（03-synthesis）

> 两评审（01-math: formal-convergence / 02-jeff: reviewer）结论一致方向：断言与证明做、生成器延后。
> 数学家额外发现**第 4 颗果实（活假纯 blocker）**——已纳入本轮必须做。

## 评审结论汇总

| 议题 | 数学家 | Jeff Dean | 合成 |
| --- | --- | --- | --- |
| 果实1 断言 | modify（M3/M4/M6 重定义 + M5 带数据修复） | do-now | **modify 版落地** |
| 果实2 证明 | modify（边界声明 + 三处表述修正 + 行号锚定） | do-now | **modify 版落地** |
| 果实3 生成器 | defer（补保守方向约束） | defer | **defer + 约束写入文档** |
| 第4果实 阴影守卫 | blocker（活假纯,探针实证） | 未覆盖 | **必须做** |

## 裁决明细

### 果实1（断言）— 按数学家精化版落地

| 断言 | 最终形态 | 现数据状态 |
| --- | --- | --- |
| M1 | `impureBuiltins ∩ pureBuiltins = ∅` | 4 包全过 |
| M2s | **string 值键** `impureModules ∩ pureModules = ∅`（array 值键是合法互补分区） | 全过 |
| M3s | **string 值键** `impureGlobals ∩ pureGlobals = ∅`（对齐 effectUsage P1 的 string-only 判定；TS Math/Date 是成员级互补分区,合法） | 精化后全过 |
| M4s | **段级**：∀ns 共有，`frameworkIo[ns] 前缀 ∩ frameworkPure[ns] 类型键 = ∅`（C# System 双键合法分区） | 精化后全过 |
| M5 | `pureCtor ∩ impureGlobals = ∅`（键级） | **现数据 3 死条目 → 数据修复** |
| M6 | `hofAlwaysArgs ⊆ hofCallsArgs` | **现数据 TS/JS 12 名违反 → 数据修复** |

**数据修复（入交付物）**：

- csharp pureCtor 删 3 死条目：GUILayout（:io）/ Texture2D（:state）/ SystemInfo（:state）——ctor 分支 impureGlobals 先命中,删除零行为变化。
- TS/JS 12 名（map/filter/forEach/reduce/reduceRight/some/…/setTimeout 等 hofAlwaysArgs 全量）并入 hofCallsArgs——union 双查点行为不变；单查点新增命中方向恒保守（addArgEdges 内部仍以 hofAlwaysArgs 判 unconditional → 记 UNKNOWN）。**验收：全量测试零回归**。

**执行位置**：`validatePackConsistency(pack): string[]` 放 pack.ts（纯函数,零依赖）；生产路径不调用；测试对内置 4 pack（5 注册：ts/tsx 共用 + js spread 复用）+ override 合并 + `examples/initdeity-effect-override.json` 夹具断言。
**可做①纳入**：scan.ts 合并点（L353 后）加合并后 M1/M3s/M5 warn（~10 行,与 validateEffectOverride 同级信任边界,探针证实 override 可制造 M5 违反）。

### 果实2（证明）— 按数学家修正落地

- **边界声明**：全总性 ≠ 判定健全性；S4 引理范围 = 无静默丢弃,不含判纯正确性（探针证实边界外存在活假纯,由守卫修复闭合）。
- S4 推论修正：markUnknown/**markDynamic** 配对（2 处）。
- 判别字段补 **prop/argFns**（5 个分支内 miss→纯精化）。
- 互斥性改述**控制流排他**（ctor 分支无条件 return）,不依赖 extractor 保证。
- 行号锚定提交哈希（dirty tree 漂移 2-4 行）。
- 不做形态穷举测试（重复实现,极小性违反）。

### 果实3（生成器）— defer 确认

- 保守方向约束写入文档：io 启发式只允许判 io（过近似方向）；判纯必须人工 + 版本锚定（@types/node vs node 漂移）；「返回原始类型 → 纯」是假纯向量（randomUUID 反例）——**禁止**。

### 第 4 颗果实（阴影守卫）— 必须做

- link L1272 `pureGlobals.has(call.obj)` 前加 `!caller.assigned.includes(call.obj)` 守卫（TS `const Math=evil()` → 现 PURE 假纯）。
- link L1614 `pureBuiltins.has(call.attr)` 前加 `!caller.assigned.includes(call.attr)` 守卫（python `max=print` → 现 PURE 假纯）。
- impure 侧不加（方向安全,过近似可接受）。
- 回归：python `def f(): max = print; return max(1,2)` → UNKNOWN；TS `const Math = evil(); Math.floor(1)` → UNKNOWN。

## 不做（维持）

- 调用点形态穷举测试（重复实现）。
- M7 gameObject 双源单源化（延后,iter37 已标注;断言级候选仅记录）。
- 果实3 本轮实施。
