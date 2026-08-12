# Iter-29 审计：CLI `--effect-table <json>`（F16 补全）

> 只读审计产物（HEAD 8ed835d，282/282）。设计可直接落为 `docs/iter29/audit.md`（docs/iter29 目录尚不存在，需新建）。

## 0. 结论先行

**本轮做**。iter28 推后 CLI 的两条理由均已失效（详见 §3）。剩余工作量 = cli.ts ~15 行 + printHelp 1 行 + README 2 处 + robustness.test.ts ~35 行 + 本文档 ≈ 0.5–1h，与 iter28 record.md:32 预估一致。`loadEffectOverrides` 已就绪（8ed835d 已补读文件/JSON parse 的 try/catch，错误消息含路径）。

**关键事实修正**：iter28 record.md:32 "需新建 spawn 测试基础设施（现无先例）" **已过时**——`test/audit/robustness.test.ts` 维度 28 "CLI 对抗"（L81-172）已有 `run()` helper（L82-89，`execFileSync("node", [dist/cli.js, ...args])`）与 8 个 CLI spawn 测试先例（--help/未知 flag/--top/--strict/--gate×3/--topology/布尔旗标矩阵）。**零新基础设施**，CLI 测试直接加进维度 28 describe 块。

## 1. 关键代码定位

| 文件 | 行 | 作用 |
|---|---|---|
| `src/cli.ts` | 12-33 | `CliArgs` 接口（annotations 字段在 L17） |
| `src/cli.ts` | 35-73 | `parseArgs`（--annotations 分支 L51） |
| `src/cli.ts` | 75-95 | `printHelp`（--annotations 帮助行 L84） |
| `src/cli.ts` | 149-167 | **--annotations 同款先例**：读文件 + JSON.parse + 过滤 + 失败 `console.error` + `process.exit(2)`（L164-166） |
| `src/cli.ts` | 169-173 | `scanProject(root, { useCache, cacheDir, annotations })` 调用点 |
| `src/cli.ts` | 478-482 | `main().catch` → `console.error("codeaudit: "+msg)` + `process.exitCode = 2` |
| `src/lang/effectOverride.ts` | 56-143 | `validateEffectOverride(overrides, packs): string[]`（空数组=合法；未知语言/提取侧表/非法 Effect 串全部拒绝） |
| `src/lang/effectOverride.ts` | 197-215 | `applyEffectOverrides(pack, override)`（空 override 短路返回原引用 L201） |
| `src/lang/effectOverride.ts` | 221-238 | `loadEffectOverrides(path): Readonly<Record<string, unknown>>`（读文件/JSON parse 抛错含路径；顶层必须是对象 L234-236） |
| `src/index.ts` | 22-43 | `scanProject` opts：`effectOverrides` 字段 L28，透传 L40 |
| `src/engine/scan.ts` | 30 | `ScanOptions.effectOverrides` |
| `src/engine/scan.ts` | 229-239 | 校验 + 合并：`validateEffectOverride` 失败 → `throw new Error("effectOverrides 非法：\n ...")`（L233-234）→ 冒泡到 `main().catch` → **exitCode 2 天然达成** |
| `test/audit/robustness.test.ts` | 82-89 | `run()` helper（CLI spawn 现成基础设施） |
| `test/audit/robustness.test.ts` | 81-172 | 维度 28 CLI 对抗 describe（新测试加这里） |
| `test/e2e/effecttable.test.ts` | 19-44 | 注入生效 fixture 形态（netcall.cs `MySdk.Send()` → 无 override UNKNOWN / 注入后 IMPURE+direct net）——CLI 测试直接复用 |
| `test/unit/effectOverride.test.ts` | 52-55 | 空 override 短路返回原引用（零行为变化，已覆盖） |
| `README.md` | 19-36 | CLI 用法块（L27-35） |
| `README.md` | 56-64 | 效应表注入节（库 API 示例） |

数据流（已通，无需改动）：`cli.ts` → `scanProject(opts.effectOverrides)` → `index.ts` L40 透传 → `scan.ts` L232-239 `validateEffectOverride` + `applyEffectOverrides`（link 前合并克隆，零缓存失效）→ `link()`。**唯一缺口是 cli.ts 没有接线**。

## 2. 精确改动点（a）

### 2.1 `src/cli.ts` — 5 处

1. **CliArgs（L17 后）**：`effectTable: string | null;`（含 doc 注释，与 annotations 同风格）
2. **parseArgs（L51 后）**：`else if (a === "--effect-table") args.effectTable = rest[++i]!;`
3. **import**：`import { loadEffectOverrides, type EffectTables } from "./lang/effectOverride";`（cli.ts 现无此 import；index.ts L70 虽已 re-export，直接引模块本体更清晰——cli.ts 已 import `scanProject` from "./index"，不混用）
4. **main()（annotations 块 L167 之后、scanProject 调用 L169 之前）**，照 L150-167 同款：

```ts
let effectOverrides: Readonly<Record<string, Partial<EffectTables>>> | undefined;
if (args.effectTable) {
  try {
    effectOverrides = loadEffectOverrides(args.effectTable) as Readonly<Record<string, Partial<EffectTables>>>;
    console.error(`effect table -> ${args.effectTable}`);
  } catch {
    console.error("codeaudit: 无法读取效应表文件 " + args.effectTable);
    process.exit(2);
  }
}
```

5. **scanProject 调用（L169-173）**：opts 加 `effectOverrides,`。

**校验分工**（不用在 cli.ts 重复校验）：
- 读文件/JSON 语法/顶层非对象 → `loadEffectOverrides` 抛（消息含路径）→ catch → exit 2（与 --annotations L164-166 完全同款）
- 形状校验（未知语言/提取侧表/非法效应类/数组元素类型）→ `scan.ts` L233 `validateEffectOverride` → throw → `main().catch` L478-482 → `exitCode 2` + `"codeaudit: effectOverrides 非法：…"`。**exit 2 天然达成，零额外代码**
- cast 必要性：`loadEffectOverrides` 返回 `Record<string, unknown>`，scanProject 期望 `Record<string, Partial<EffectTables>>`——cast 不做真实校验（信任边界在 scan.ts 兜底，无静默路径）。签名放宽不可取（保持入口严格类型）
- 注：cli.ts L481 注释警告 `process.exit` 与 wasm 句柄关闭竞态（退出码变 127）——effect-table 加载发生在 scanProject 前，wasm 未初始化，与 --annotations 同场景，`process.exit(2)` 安全

### 2.2 printHelp（L84 --annotations 行后）

```
  --effect-table <json> 回读效应表注入（{ 语言: { 表名: 值 } }；键只增不删、数组并集；读文件/校验失败 exit 2）
```

### 2.3 README.md — 2 处

- **L35 用法块**追加一行：`node dist/cli.js scan ./src --effect-table overrides.json   # 效应表注入（不改库代码；{ 语言: { 表: 值 } }，校验失败 exit 2）`
- **L56-64 注入节**末补一句：`CLI 同构：--effect-table overrides.json（JSON 形状同上；读文件/校验失败 exit 2，与 --annotations 同款）。`

### 2.4 CHANGELOG.md

按迭代惯例加一行（iter28 audit.md 已声明 CLI 待办 → 本次落地）。

## 3. 测试策略（b）

**基础设施判定**：`robustness.test.ts` L82-89 `run()` helper 即现成 spawn 基础设施（execFileSync 同步执行 `node dist/cli.js`，`e.status` 天然验证退出码，`out` 合并 stdout+stderr）。**test/e2e/synthetic.test.ts 无任何 spawn/child_process（grep 零命中），不可复用也不需复用**（它是纯库 API 合成大库测试）。CLI 测试全部加进 robustness.test.ts 维度 28 describe（L81-172），沿用 `project()` fixture helper（L20-28）+ `run()`。

4 个新测试（fixture 形态复用 effecttable.test.ts L19-44 的 `MySdk.Send()` 模式）：

1. **注入生效（CLI spawn 正例）**：tmp 项目 `netcall.cs` = `public class Consumer { public void Run() { MySdk.Send(); } }`；写 override JSON `{ "csharp": { "impureGlobals": { "MySdk": "net" } } }`；`run(["scan", root, "--no-cache", "--effect-table", jf])` → code 0 且输出含 IMPURE 与 `{net}`；对照组（无 --effect-table）→ 输出含 UNKNOWN。断言注入方向：标 net 不落 io/state
2. **读文件失败 → exit 2**：`--effect-table` 指向不存在路径 → code 2、out 含"无法读取效应表"；再一例 JSON 非法（`{ not json`）→ code 2（可合并为参数化 it）
3. **校验失败 → exit 2**：`{ "csharp": { "impureGlobals": { "X": "IO" } } }`（非法效应类）→ code 2、out 含"effectOverrides 非法"；补未知语言 / 提取侧表（`literalReceivers`）两例之一即可（同一条 throw 路径，验证器单测已全覆盖形状，见 effectOverride.test.ts L57-60）
4. **无 override 零变化**：现有 282 测试全走无 override 路径天然兜底 + 单元层短路测试已存在（effectOverride.test.ts L52-55）；CLI 层可省（避免冗余）。可选加强：`{}` 空对象 override 与无 flag 输出一致——短路已在单元层证明，跳过

注意：CLI 测试依赖 `dist/cli.js` 已 build（维度 28 现有 8 测试同依赖，非新增约束）。测试计数 282/282 → 286。

## 4. 优先级判断（c）：**本轮做**

iter28 audit.md L129-137 推后 CLI 的判据逐条复核：

| iter28 判据 | 现状 | 结论 |
|---|---|---|
| "CLI 测试需新建 spawn 基础设施（现无先例）" | **事实已变**：robustness.test.ts 维度 28 有 run() helper（L82-89）+ 8 个 spawn 先例 | 失效 |
| "无明确用户（InitDeity 是库消费者）" | 任务背景：**InitDeity 命令行用户可用** | 失效 |
| "薄封装 ~25 行可后续 1h 内补齐" | 实测 ~15 行（不含测试） | 成立 |

F16 连续 2 迭代挂待办（iter27 record.md:36 → iter28 record.md:32）后，核心已落地（effectOverride.ts + scanProject opts + 2 测试文件 + README 库 API 节）；CLI 是唯一剩余缺口，触发条件已满足，0.5–1h 内闭环。

## 5. 残余风险 / 开放问题

- **无删除能力**（既有 F16 设计限制，iter28 audit.md L127）：CLI 继承——用户无法移除误标内置条目，README "键只增不删"已声明。不阻塞
- **cast 逃逸类型校验**：`as Record<string, Partial<EffectTables>>` 后的形状由 scan.ts L233 全量兜底（throw → exit 2），无静默不一致路径。安全
- **空对象 override**：`{}` → scan.ts L232 短路（`if (opts.effectOverrides)` 空对象为 truthy → validate 过 → applyEffectOverrides 短路原引用）→ 零行为变化，与"无 override"等价。无需特殊处理
- **大文件 OOM**：effect table JSON 无大小上限（annotations 亦无；仅 corpus 有 64MB 上限 cli.ts L221）。用户本地文件，可接受，不预加
- **唯一需留意的实现细节**：新 import 放 cli.ts 顶部（`loadEffectOverrides` + `type EffectTables`）；勿从 "./index" 引（循环风险无，但直接引模块本体与 scanProject 的来源区分清晰）

## 6. 落地顺序

1. cli.ts 5 处改动 → 2. printHelp 1 行 → 3. robustness.test.ts +4 测试 → 4. README 2 处 + CHANGELOG → 5. 本文移入 `docs/iter29/audit.md`（另建 impl/record/verify 惯例三件）→ 6. 全量 `npm test` 复核 286/286 + tsc 0 错误
