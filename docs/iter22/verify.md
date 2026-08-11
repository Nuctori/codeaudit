APPROVED

# iter22 复审结论（verify 节点，BLOCKER 已修复并复验）

## 复审发现与修复闭环

| # | 发现 | 严重度 | 处置 |
| --- | --- | --- | --- |
| 1 | `src/cli.ts:52` — `--gate` 分支**替换**了 `--topology` 分支（实跑 `--topology` → 未知选项 exit 2） | **BLOCKER** | 主会话已恢复 `--topology` 分支（与 `--gate` 并存，未误伤 `--table-usage`）；补 CLI 回归测试「--topology 旗标仍可用」 |
| 2 | README.md:65 示例行「低风险（<15）可合入」重复 | minor | 已删重复行 |
| 3 | impl.md L31 vs L39 样本数 4264 vs 4266 | note | method/cell 表差 2 样本（设计文档 §5 解释），非错误 |
| 4 | CHANGELOG「本轮纯新增」不准确（含 --topology 回归） | note | 已改修复条目 |

## 通过项（复审独立对拍 + 实跑）

1. **fitBaseRate 数学正确性** ✓ — 手算 T1（A/B/C 三项目）：μ=0.6、Var=0.05875、κ=3.0851 与实现逐位一致；InitDeity+swaggerSim 双项目对拍 μ=0.56156、κ≈133.8 可复现；冷启动 `projects<2 → {mu:0.25,kappa:12,projects:0}`（含 []、单项目、空项目）✓；κ 角情况钳制（Var=0→1e6、κ<0→0）✓
2. **priorFor 兼容** ✓ — `baseRate?.mu ?? GLOBAL_THETA0`，第三参可选，缺省路径 T4 `toBe` 逐位断言 ✓
3. **--gate 语义** ✓ — high/critical/invalid→1、low/medium→0、无 --changed→exit 2、与 --strict 共存 `Math.max` 保序；gateExit 纯函数 risk.ts:114-118 可单测 ✓
4. **全量测试** ✓ — 修复后独立复跑 **247/247 全绿**（24 文件，+11：corpus+5/risk+1/robustness+5）；`check-readme-tests.cjs` OK 247；tsc 0 错误
5. **CLI 实跑（dist，非 src）** ✓ — `node dist/cli.js scan test/fixtures/jsapp --no-cache --topology` → 拓扑输出（6 nodes / 2 edges）+ exit 0；`--table-usage` 同参 exit 0；`--gate` 无 `--changed` → 报错 exit 2（dist 与 src 均含修复分支，非仅源码层）

## 独立复验轮（2026-08-12 复审子代理再跑）

- `node node_modules/vitest/vitest.mjs run` → **247/247 passed（24 files）**，与上轮结论一致
- `node scripts/check-readme-tests.cjs` → README test count OK: 247
- `tsc --noEmit` → 0 错误
- `--topology` / `--table-usage` / `--gate`（无 changed）三命令实跑 exit 码 0 / 0 / 2，全部符合预期

## 第三次独立复验（2026-08-12，复审子代理）

- `node node_modules/vitest/vitest.mjs run` → **247/247 passed（24 files）**，复跑结果与前两轮一致
- `tsc --noEmit` → exit 0；`node scripts/check-readme-tests.cjs` → README test count OK: 247
- dist（非 src）实跑：`--topology` → 拓扑 6 nodes/2 edges + exit 0；`--table-usage` → exit 0；`--gate` 无 `--changed` → 报错 exit 2；`--changed store.js --gate`（MEDIUM）→ `[gate] MEDIUM → 放行` + exit 0
- fitBaseRate 对 dist 独立手算对拍：T1 μ=0.6（1e-16 浮点噪声）/κ=3.085106382978722 与手算一致；`[]`/单项目 → 冷启动 `{mu:0.25,kappa:12,projects:0}`；Var=0 → κ=1e6；κ<0 → 0
- impl.md 真实语料数字交叉复核（按 base-rate-design.md §5 表：InitDeity method 4264 样本 1847P/2417I + swaggerSim 65 条 51P/14I）：μ=(2417+14)/4329=0.56156、κ=μ(1−μ)/Var−1≈133.8——与 impl.md 报告值逐位吻合，可复现
- 结论：无新发现，维持 APPROVED

## 第四次独立复验（2026-08-12，复审子代理本轮）

- `node node_modules/vitest/vitest.mjs run` → **247/247 passed（24 files）**，与前几轮一致
- `npx tsc --noEmit` → exit 0；重建 dist 后 `node scripts/check-readme-tests.cjs` → README test count OK: 247
- fitBaseRate 纯手算对拍（node -e 独立公式，不引用库代码）：T1 A/B/C 三项目 μ=0.6、Var=0.05875、κ=3.085106382978722；InitDeity(4264, 2417I)+swaggerSim(65, 14I) μ=2431/4329=0.56156、κ≈133.78——与实现/测试/impl.md 报告值逐位吻合
- CLI dist 实跑（绝对路径，非测试替身）：`--gate` 无 `--changed` → 报错 exit 2；MEDIUM → `[gate] MEDIUM → 放行` exit 0；HIGH → `[gate] HIGH → 拒绝合入` exit 1；invalid（未匹配文件）→ 「回归风险不可评估」exit 1；`--topology` → 拓扑输出 exit 0（回归护栏确认）
- 复核 gateExit 五档映射与 risk.ts:114-118 实现一致；priorFor 第三参缺省路径 `baseRate?.mu ?? GLOBAL_THETA0` 与 T4 逐位断言相符；`--strict` 共存经 `Math.max` 保序（实跑 --strict → exit 1）
- 结论：无新发现，维持 APPROVED

## 残余风险（已文档化，非阻塞）

- --topology 已有 CLI 回归测试防再回归（新增）
- medium/critical 档无 CLI 矩阵测试（gradeOf 阈值单测覆盖 15/35/60 边界；0/1 分界由 low/high/invalid 三点卡住）
- fitBaseRate 的 fitted κ 未接入 priorFor（显式设计决定，impl.md 记录，留作后续迭代）
- impl.md L3「246/246」为实现时点记录（fix 后 +1 为 --topology 回归测试），最终 247 以本 verify.md 为准
