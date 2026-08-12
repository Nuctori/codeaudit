APPROVED

# 迭代 29 复审（只读，cwd=D:/node/codeaudit）

复审对象：docs/iter29/impl.md + git diff（CHANGELOG.md / README.md / src/cli.ts / test/audit/robustness.test.ts），基线 8ed835d。

## 1. --effect-table 接线正确

- parseArgs：`--effect-table` → `args.effectTable`（src/cli.ts L55），默认 `null`（L40）。
- 读文件失败：main() L173-182 `loadEffectOverrides`（src/lang/effectOverride.ts L221-238，读文件/JSON 解析/顶层非对象三态抛错含路径）→ catch → `console.error("无法读取效应表文件 …")` + `process.exit(2)`，与 --annotations（L154-172）同款。
- 形状校验失败：scan.ts L232-234 `validateEffectOverride` 抛 `"effectOverrides 非法：…"` → `main().catch`（cli.ts L494-498）`process.exitCode = 2` —— 零额外代码路径成立。
- 生效路径：`scanProject` opts.effectOverrides（index.ts L28/L40）→ scan.ts L235 `applyEffectOverrides` 按语言合并 → link.ts L606 impureGlobals 命中 `MySdk` → `sink.addEffect("net")` → IMPURE。真实链路，非假接线。
- 未知 flag 校验：`else if (a.startsWith("-"))` throw → main().catch exit 2（既有分支，--effect-table 已并入链，未顶掉兄弟分支——"全部布尔旗标"回归护栏仍绿）。

## 2. CLI 测试有效（真实 CLI，非假接线）

- robustness.test.ts `run` 用 `execFileSync("node", [dist/cli.js, …])`（L30/L82-89）——真实进程级断言。
- 注入正例有判别力：同 fixture 无 override 断言 `UNKNOWN`（MySdk 不可解析）、注入后断言 `IMPURE` + `net`；"net" 只可能来自判定输出（stderr 仅打印文件路径，不含 "net"）。若注入未生效该用例必失败。
- 复跑前重建：`tsc`（TSC_OK）→ dist 与 src 同源，排除陈旧 dist 假绿。

## 3. 向后兼容（无 flag 零变化）

- 无 `--effect-table` → `args.effectTable = null` → `effectOverrides` 保持 `undefined` → scan.ts `if (opts.effectOverrides)` 短路，不调 validate/apply → 零行为变化。
- 282 个既有测试全绿（见下），无回归。

## 4. 全量测试独立复跑

- `node node_modules/typescript/bin/tsc` → 0 错误。
- `node node_modules/vitest/vitest.mjs run` → **28 文件 / 285 测试全通过**（6.51s），与 impl.md 声明一致（282+3，读文件失败两断言并入一个 it 故 +3）。
- README 门禁：`node scripts/check-readme-tests.cjs` → "README test count OK: 285"。

## 残余风险（均与 impl.md §5 一致，非本轮缺陷）

- `--effect-table` 置于参数末尾无值 → `rest[++i]` undefined → 静默 no-op（与 --annotations/--unknowns 既有行为一致，非新回归）。
- 注入键只增不删、cast 逃逸由 scan.ts 兜底（throw → exit 2）；JSON 无大小上限（与 --annotations 同款）。
- 测试覆盖缺：提取侧表白名单拒绝（EXTRACT_SIDE_TABLES）与未知语言错误路径未在 CLI 层断言（库层已有校验实现）。

## 结论

四项验收点全部通过，无 blocker，无 CHANGES。
