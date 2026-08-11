# 迭代 28 audit：效应表注入（F16）设计

> 只读审计产出（scouting，未改库代码）。目标仓库落地位置：`docs/iter28/audit.md`（本文件为审计上下文副本）。
> 基线 HEAD efc4e6d（273/273）。

## 1. 注入面（消费点全图）

效应表全部为 **link 期消费**（link.ts 只读 pack，不缓存）；提取期（extractor）不消费任何效应表——这是注入不失效缓存的根基：

| 表 | 消费点 | 消费方式 |
| --- | --- | --- |
| `impureBuiltins` | link.ts:571 | `Object.hasOwn(pack.impureBuiltins, call.attr)` → 效应类 |
| `pureBuiltins` | link.ts:581 | `.has(call.attr)` → 丢弃 |
| `impureModules` | link.ts:197（effectFromModule） | 整模块效应类 / 成员前缀回退（含 `:类`/`:p` 后缀） |
| `pureModules` | link.ts:229 | `.has(module)` → 丢弃 |
| `impureGlobals` | link.ts:606 | 整体效应类 / 成员数组 / tagged 后缀 |
| `pureGlobals` | link.ts:630 | `.has(call.obj)` → 丢弃 |
| `frameworkIo` | link.ts:191（rootOf 分类）、link.ts:556（2.5 分支，`hasOwn` 守卫） | 对象名 → 成员前缀列表，命中 → io |
| `builtinTypeEffects` | link.ts:503 | `pack.builtinTypeEffects[receiver]?.[attr]` → "pure"/"hof" |
| （关联 link 侧表）`hofCallsArgs`/`hofAlwaysArgs` | link.ts:270,372,396,446,504,576,583,631 | HOF 回调实参边 |

**明确排除（提取侧表，参与缓存）**：`literalReceivers`（extractor.ts:742）、`builtinMethodReturns`（extractor.ts:607）、`chunkNodes`/`callNodes`/`assignmentTargets`/`nestingNodes`/`selfNames` 等——它们改变 RawFileFacts（进 cache.json）。注入它们会在缓存命中时静默不生效（不一致），**v1 白名单直接拒绝**并报错而非静默忽略。

关键缓存事实（scan.ts:37-38 注释）：*"link 期效应表（impureModules 等）不缓存、每次扫描重跑，故不参与指纹（加表不应失效缓存）"* —— 注入链接侧表零缓存失效，无需 bump CACHE_VERSION（scan.ts:28）。

## 2. 注入形态

**采用：按语言名索引的 override 映射**（任务 a 的第二种）：

```ts
// src/lang/pack.ts（新增类型）
/** 链接侧效应表集合（注入面白名单；提取侧表不在内——它们参与缓存，注入会静默失效）。 */
export interface EffectTables {
  readonly impureBuiltins: Readonly<Record<string, Effect>>;
  readonly pureBuiltins: ReadonlySet<string>;
  readonly impureModules: Readonly<Record<string, Effect | readonly string[]>>;
  readonly pureModules: ReadonlySet<string>;
  readonly impureGlobals: Readonly<Record<string, Effect | readonly string[]>>;
  readonly pureGlobals: ReadonlySet<string>;
  readonly frameworkIo: Readonly<Record<string, readonly string[]>>;
  readonly builtinTypeEffects: Readonly<Record<string, Readonly<Record<string, "pure" | "hof">>>>;
  readonly hofCallsArgs: ReadonlySet<string>;
  readonly hofAlwaysArgs: ReadonlySet<string>;
}
```

不选全局 `Partial<LangPack>` 的原因：
1. **跨语言键语义不同**（`Debug`/`System` 是 C#、`self`/`client` 是 Python）——全局 override 会把条目塞进所有语言，同一键跨语言含义不同是方向错误源（例如用户给 C# 加 `Debug`，Python 同名误中）。
2. InitDeity 是 C# 为主的 Unity 项目——注入必须只落在 csharp pack，否则 Python/TS 同名键被污染。
3. 语言隔离纪律已有先例（link.ts:594 全局类名解析的 `lang === pack.name` 守卫）。

**扫描入口**（scanProject → ScanOptions）：

```ts
// src/engine/scan.ts（ScanOptions 增字段）
readonly effectOverrides?: Readonly<Record<string, Partial<EffectTables>>>;
// src/index.ts scanProject opts 同步增同名可选字段（默认 undefined = 零行为变化）
```

无 override / override 为 `{}` 时，link 收到的仍是原 pack 引用（短路，无克隆）——向后兼容的静态保证。

## 3. merge 语义（b：追加/替换；防误删内置表）

**统一规则：键只增不删；标量值覆盖；数组值并集去重；嵌套 Record 两层深合并。** 全部方向安全（无自动删除路径 → 内置表不可能被 override 误删）。

| 表类型 | 规则 | 实现 |
| --- | --- | --- |
| `impureBuiltins`/`impureModules`/`impureGlobals`（Record） | 键级浅合并 | `{...base, ...override}`；同键标量（`"fs"`）→ 覆盖；同键数组（成员列表）→ `[...base, ...override]` 去重 |
| `pureBuiltins`/`pureModules`/`pureGlobals`（Set） | 并集 | `new Set([...base, ...override])` |
| `frameworkIo`（Record<string, string[]>） | 键级合并 + 数组并集 | 与上同：扩展现有键（csharp `this` 的 ~20 组件）不必重列全部前缀——重列 = 抄写漂移 = 漏前缀 = 假纯（方向不安全）的根源，并集根除它 |
| `builtinTypeEffects`（嵌套 Record） | **两层深合并** | 外层 `{...base, ...override}` + 内层 `{...base[t], ...override[t]}`——用户给 `str` 加一个方法不丢内置 8 个 |

**删除不支持（v1）**：override 无删除内置条目能力（天然防误删）。用户想纠正误标的内置条目 → 键级覆盖（`fs: "io"` 覆盖 `fs: "fs"`）；彻底移除留待需求出现（未来语法：值 `null` 标记删除——本轮不做）。

**校验（信任边界，JSON 文件/用户 API 输入必须验）**：
- 语言名必须存在于实际 packs（`packsByName`）；
- 表名白名单 = EffectTables 10 键；**拒绝提取侧表名**（`literalReceivers`/`builtinMethodReturns`/`chunkNodes`…）→ 显式报错（防用户以为注入生效）；
- 值形状：Effect 字符串 ∈ 7 类（types.ts:28 `"io"|"net"|"fs"|"db"|"random"|"clock"|"state"`，挡 `"IO"`/`"network"` 错别字）；数组为 string[]；builtinTypeEffects 内层 ∈ `"pure"|"hof"`。

## 4. 生效路径（c：scan 时克隆 pack vs link 时查 override）

**scan 时合并，link 零改动**。link.ts:224-225 现状：

```ts
const packsByName = new Map(opts.packs.map((p) => [p.name, p]));
const { chunks, effectTableUsage } = link(facts, packsByName);
```

改法（scan.ts 内 ~5 行）：

```ts
const packsByName = new Map(opts.packs.map((p) => [p.name, p]));
if (opts.effectOverrides) applyOverrides(packsByName, opts.effectOverrides, opts.packs); // 校验 + 合并克隆
const { chunks, effectTableUsage } = link(facts, packsByName);
```

理由：
- **link.ts 一个字节不改**——link 是纯函数消费 `ReadonlyMap<string, LangPack>`，注入 = 换入合并克隆后的 pack；`effectTableUsage`（link.ts:312 classifyUsage(packs, …)）自动反映合并后条目（P1 provably-dead 判定跨 merged 表仍正确，读的是合并后 pack）。
- 合并只发生在 link 前 → 提取/缓存/指纹完全不受影响（第 1 节缓存红利）。
- 代价：每语言一次浅合并，O(表条目)，link 期表本来每次扫描重跑，可忽略。
- 不选 link 内查 override：link 已 651 行且深度调用 Sink 架构，往里塞 override 查找 = 侵入 8+ 处消费点，diff 大且易漏（hofCallsArgs 6 处）。

**另有一条现成旁路**：`scan()` 本身接受 `packs`（scan.ts:21），高级用户可传自定义 LangPack——但完整 pack 需实现行为侧（`extractImports`/`resolveModule`，pack.ts:127-139），门槛高。override 机制的价值正是免去整包重建。

## 5. CLI（d）

**本轮仅库 API；CLI 记录待办**（见第 7 节优先级）。设计预留（照 cli.ts:150-167 annotations 先例）：

- `--effect-table <json>`；JSON 格式 `{ "csharp": { "frameworkIo": { "this": ["AddComponent"] } }, "python": { "impureGlobals": {...} } }`；
- 读文件 + 校验失败 → `console.error` + `process.exit(2)`（与 --annotations 同款，cli.ts:164-166）；
- 复用第 3 节同一个 `validateEffectOverride`（从 cli.ts 传参给 scanProject，无需新增公开 API）；
- parseArgs 加一 flag（cli.ts:35-73），main() 中 `const report = await scanProject(root, { ..., effectOverrides })`。
- 测试需 spawn 基础设施（现 test/e2e 无 CLI spawn 先例）——待办原因之一。

## 6. 测试点（e）3 个

1. **库 API 注入生效**：`test/e2e/effecttable.test.ts`（或并入 edge.test.ts）——tmp fixture `netcall.cs` 含 `new NetCall().Send()`；无 override → 该调用 `?`（UNKNOWN）；`effectOverrides: { csharp: { impureGlobals: { NetCall: "net" } } }` → chunk 判 IMPURE 且 `direct` 含 `net`、chain=0。断言注入方向正确（标 net 不落 io/state）。
2. **合并语义 + JSON CLI 形状**：`test/unit/effectOverride.test.ts`——直接测 `applyEffectOverrides`：Record 键合并、数组并集（含内置键扩展不丢内置项）、Set 并集、builtinTypeEffects 两层深合并、校验拒绝（未知语言/提取侧表/非法 Effect 串）。JSON 文件解析函数（`loadEffectOverrides(path)`，CLI 待办时一并出）单测。
3. **无 override 零行为变化**：a) `applyEffectOverrides(base, {})` 返回原引用（短路）；b) 同 fixture 有/无 `effectOverrides: {}` → `scanProject` 两次输出 `verdicts` deepEqual；c) 全量回归网兜底（现有 273/273——现测试全走无 override 路径，天然覆盖）。

## 7. 风险（f）

- **语言事实义务转移**（pack.ts:119 已明文 builtinMethodReturns 是"语言事实义务"，效应表同）：用户误标方向 → 漏标（把 io 标纯/不标）= 假纯（方向不安全，最重）；多标（纯标 io）= 假 IMPURE（方向安全、噪音）。缓解：校验挡形状错别字；README 文档义务（第 8 节）；`--table-usage` 的 corpus-inactive 统计让用户看到自己注入条目没命中。
- **缓存幻觉**：提取侧表被注入而不处理缓存 → 缓存命中时静默不一致。缓解：白名单硬拒绝提取侧表（校验层），注释写明原因。
- **合并语义误读**：数组并集 vs 标量覆盖的差异需要文档一句话说清；框架 Io 键扩展免重列是本设计对"误删内置表"风险的正面回答。
- **effectTableUsage 噪音**：注入条目未命中显示 corpus-inactive——属预期（提示用户补表未生效，反是收益）。
- **无删除能力**：用户无法移除误标内置条目（v1 接受；覆盖可改方向，删除留待 null-marker）。

## 8. 优先级判断：本轮做最小版

**结论：本轮做最小版 = 库 API（scanProject `effectOverrides`）+ 合并工具 + 校验 + 2 个测试文件；CLI 记录待办。**

依据：
- **成本低、闭环快**：改动面 = pack.ts 加 ~50 行类型+合并+校验、scan.ts ~5 行、index.ts ~3 行、测试 ~120 行；不碰 link.ts；零缓存失效。约 2h 工作量。
- **用户项目在等**：背景明确 InitDeity 需扩展效应表不改库代码（D3 债：Unity 效应表人工维护，technical-debt.md:43）；Unity 效应表是 C# 场景——库 API 即满足。
- **F16 已连续 2 迭代挂待办**（iter27 record.md:36 "F16 效应表注入"），本轮落地最小闭环符合"平台化长期待办"的推进节奏。
- **CLI 推后理由**：无明确用户（InitDeity 是库消费者）；CLI 测试需新建 spawn 基础设施（现无先例）；薄封装 ~25 行可后续 1h 内补齐。判据：出现"不改代码的 CI/脚本用户"需求或 InitDeity 走命令行时再做。

**文件变更清单（最小版）**：
- `src/lang/pack.ts`（或新 `src/lang/effectOverride.ts`）：`EffectTables` 类型 + `applyEffectOverrides` + `validateEffectOverride` + `loadEffectOverrides`（JSON 解析，为 CLI 预留）
- `src/engine/scan.ts`：ScanOptions + `effectOverrides` 字段；link 前合并（第 4 节）
- `src/index.ts`：scanProject opts 透传 + 导出类型
- `test/unit/effectOverride.test.ts` + `test/e2e/effecttable.test.ts`
- `docs/iter28/audit.md`（本文）+ README 注入说明 + CHANGELOG

## 9. 其他值得记录

- 注入生效后 `stats.effectTableUsage` 自动含注入条目——可作为验收信号（注入的 NetCall 条目从 corpus-inactive → hit）。
- 版本兼容：新增可选字段，旧调用方（cli.ts:169 scanProject 调用）无改动即零行为变化。
- 现有"补表候选"流程（--table-usage missSlots，cli.ts:391-397）与注入是互补闭环：miss 提示 → 用户写进 override JSON → 命中。文档可把两者串成工作流。
