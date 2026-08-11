# 迭代 22 设计：`--gate` 回归风险合入门禁（F5，Debtmap 建议落地）

> 只读审计产出（HEAD 9ac6b4c，236/236）。本文件即设计稿；落地时请把内容复制/移植到 `docs/iter22/gate-design.md`（docs/ 目录当前无 iter22 文件）。

## 0. 现状锚点（审计确认）

| 位置 | 内容 |
| --- | --- |
| `src/cli.ts:30-62` | `parseArgs`：布尔旗标模式（`--strict`/`--topology`/`--sources`/`--table-usage` 均为 `else if (a === "...") args.x = true`）；未知旗标 `throw new Error("未知选项 " + a)` → `main().catch` → exitCode 2 |
| `src/cli.ts:11-28` | `CliArgs` 接口：`strict: boolean`（:19）、`changed: string[] | null`（:21） |
| `src/cli.ts:163-194` | `--changed` 块：`args.changed !== null && args.changed.length > 0` 才进；`r.grade === "invalid"` → stderr 报错 + `process.exitCode = 1`（:169-171，终裁 A1「不静默放行」）；其余输出经 `out()`（json 模式走 stderr，:168） |
| `src/cli.ts:427` | `--strict`：`if (args.strict && report.stats.impure > 0) process.exitCode = 1` |
| `src/core/risk.ts:104-112` | `gradeOf(risk)`：`<0→invalid`、`<15→low`、`<35→medium`、`<60→high`、`≥60→critical` |
| `src/core/risk.ts:127-289` | `riskOfChange(verdicts, changedFiles, {oldVerdicts?})` → `ChangeRisk`（含 `grade`，:39） |
| `src/cli.ts:186` | critical 提示文案明说「无门禁，需流水线/人工执行」——**现状 high/critical 不设退出码**，F5 即补此缺口 |

## 1. `--gate` 旗标解析

- `CliArgs` 增加 `gate: boolean`（:11-28 区，放 `strict` 旁）。
- `parseArgs` 增加分支（:49 `--strict` 附近）：`else if (a === "--gate") args.gate = true;`
- **无参数、无新依赖**：布尔旗标，与 `--strict` 同型。不新增任何依赖。

## 2. 与 `--changed` 的依赖关系：**报错，不忽略**

裁决：`--gate` 单独出现（`--changed` 缺失或解析后为空列表）→ `throw new Error` → exitCode 2。

- 理由：CI 里静默失效的门禁 = 安全剧场（以为在门禁，实际 no-op）。与既有错误路径同构（parseArgs 抛错 → `main().catch` → exitCode 2，`cli.ts:430-433`）；文案用中文与现有一致。
- 校验位置：`parseArgs` 末尾（rest 循环后）最简：
  ```ts
  if (args.gate && (args.changed === null || args.changed.length === 0)) {
    throw new Error("--gate 需要 --changed <files>（门禁依赖改动文件集评估回归风险）");
  }
  ```
- 边界：`--changed ""` → `filter(Boolean)` 得 `[]` → 同样报错（`.length === 0` 已覆盖）。
- `--gate` + `--strict` 可共存：互不干扰，各自按语义置 exitCode 1（见 §3 交互）。

## 3. 语义：grade ≥ high → exit 1；medium/low → 0；invalid → 1

- 门禁映射（grade → 退出码）：
  - `high`（35 ≤ risk < 60）、`critical`（risk ≥ 60）→ exitCode 1（**门禁拒绝合入**）
  - `low`/`medium` → 0（不改变 exitCode）
  - `invalid`（`riskOfChange` unmatchedFiles>0）→ 1 —— **现状已是 1**（`cli.ts:171`，无条件置位），门禁沿用，无新逻辑。
- 落地形态（可测性）：`cli.ts` 是脚本不可 import，映射抽纯函数放 `src/core/risk.ts`（`gradeOf` 旁）：
  ```ts
  /** --gate 门禁：high/critical 拒绝合入；invalid 与现状一致不放行；low/medium 放行。 */
  export function gateExit(grade: ChangeRisk["grade"]): 0 | 1 {
    return grade === "high" || grade === "critical" || grade === "invalid" ? 1 : 0;
  }
  ```
- `cli.ts:163-194` 块内挂接：invalid 分支已置 1 不动；else 分支末尾加
  `if (args.gate) process.exitCode = Math.max(process.exitCode ?? 0, gateExit(r.grade));`
  （`Math.max` 保序：`--gate` 与 `--strict` 同跑时任一拒绝即 1。）
- 不加输出行会留下「exit 1 但无解释」的 CI 断点，所以 else 分支 grade 已知处追加门禁结论行（`out()` 复用，见 §4）。

## 4. json 模式行为

- **门禁契约 = 退出码 + stderr**，绝不碰 stdout：stdout 必须是纯净 JSON（契约测试守卫 `test/audit/contract.test.ts:30-34`，20b07ca 混合流回归）。
- 风险报告行已全部经 `out()`（json → `console.error`，`cli.ts:168`）——门禁结论行同样走 `out()`：
  `out(`[gate] ${r.grade.toUpperCase()} → ${gateExit(r.grade) === 1 ? "拒绝合入 (exit 1)" : "放行"}`);`
- invalid 分支的报错已是 `console.error`（:170），天然 json 安全。

## 5. 帮助文本 / README 同步点

| 文件 | 位置 | 改动 |
| --- | --- | --- |
| `src/cli.ts` | `printHelp` :78（`--strict` 行后） | 加 `--gate               与 --changed 联用：grade ≥ high（风险≥35）时退出码 1（合入门禁；invalid 不放行）` |
| `README.md` | 「回归风险控制（--changed）」:57-73（示例块后 :67 附近） | 加 gate 示例：`codeaudit scan src --changed src/engine/scan.ts --gate` + 一句语义（high/critical→1、low/medium→0、invalid→1）；:72 阈值句可顺带注明门禁口径 = risk ≥ 35 |
| `CHANGELOG.md` | 顶部（0.2.0 之后新条目） | 新增条目：`--gate` 回归风险门禁（F5） |
| `AUDIT.md` | :54（CLI 矩阵 #29：--strict 退出码 0/1） | 可选：补 `--gate 退出码矩阵` 行（测试补齐后计数同步） |

## 6. 测试点（2 个）

- **T1 单元**（`test/unit/risk.test.ts`，`gradeOf` describe :151-161 旁新增）：
  `gateExit` 五档映射——`low/medium → 0`，`high/critical/invalid → 1`。纯函数直测，零 fixture。
- **T2 CLI 端到端**（`test/audit/robustness.test.ts`，`--strict 退出码矩阵` :117-122 旁；复用 `run()` helper :82-86，spawn `dist/cli.js`）：
  1. `--gate` 无 `--changed` → exit 2（依赖校验报错）；
  2. 低危 fixture `{ "a.py": "def f():\n    return 1\n" }` + `--changed a.py --gate` → 0（文件匹配到 chunk，risk=0 → low）；
  3. 高危 fixture `{ "a.ts": "export function f() { console.log('x'); }\n", "b.ts": "import { f } from './a';\nexport function g() { f(); }\n" }` + `--changed a.ts --gate` → 1（推导：backSeen={a,b}，impact=1.0，purity=IMPURE→1.0 → L=1，C=0.5·1=0.5 → risk=50 → **high**，恰好落在 35-60 档）；
  4. invalid：`--changed nope.ts --gate` → 1（unmatched，现状路径）。
  - 注：robustness 测试跑 dist 产物，需先 `npm run build`（tsc）；critical 档（≥60）需 SCC+链深 fixture，边界矩阵 low/high/invalid 已覆盖 0/1 分界，critical 可省。

## 残余风险

- medium 档（15-35）与 critical 档无 CLI 层测试——0/1 分界由 low/high/invalid 三点卡住，gradeOf 阈值本身已有单测（risk.test.ts:151-161）；若需 full 矩阵再加 fixture。
- `--changed` 已存在的行为（invalid 无条件 exit 1，:171）会在无 `--gate` 时依旧置 1——F5 不改此现状（终裁 A1 文档化裁决）。
- 版本号 bump（0.2.0 → ?）与 README 测试计数（`scripts/check-readme-tests.cjs` 校验 README 声称的测试数）留给实施轮；新增测试后需同步。
