# iter22 实现报告（impl 节点）

> HEAD 基线 9ac6b4c（236/236）→ 实现后 246/246（+10）。设计文档：`docs/iter22/base-rate-design.md`、`docs/iter22/gate-design.md`。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/core/corpus.ts` | +`BaseRateModel` 接口、+`fitBaseRate(corpora)`（分层矩估计）、`priorFor` 第三参 `baseRate?`（L180 一处替换）、+`KAPPA_MAX`/`MU_CLAMP` 常量 |
| `src/index.ts` | corpus 面 API 补齐导出（pipeline.md 三工作流消费面）：`fitBaseRate`/`priorFor`/`emptyCorpus`/`updateCorpus`/`mergeCorpus`/`summarize`/`siteShapeInfo`/`isCorpus` + 类型；`risk` 导出加 `gateExit` |
| `src/core/risk.ts` | +`gateExit(grade): 0\|1`（high/critical/invalid → 1，low/medium → 0） |
| `src/cli.ts` | `CliArgs.gate`、`--gate` 解析、无 `--changed` 时报错 exit 2、`--changed` 块末尾挂接（`Math.max` 保序与 `--strict` 共存）、help 行 |
| `test/unit/corpus.test.ts` | +T1 对拍手算、T2 单调性/加权主导、T3 冷启动、T3b 角情况、T4 接入生效（+5） |
| `test/unit/risk.test.ts` | +gateExit 五档映射（+1） |
| `test/audit/robustness.test.ts` | +`--gate` CLI 矩阵：无 --changed→2、low→0、high→1、invalid→1（+4） |
| `README.md` | --gate 示例/说明、库函数清单、246 测试数（check-readme-tests 通过） |
| `CHANGELOG.md` | Unreleased 条目（--gate + fitBaseRate + corpus API） |

## 关键裁决

1. **μ 语义 = 不纯率**（设计文档 T1 手算与 T2 内部矛盾：T1 μ=(10+40+70)/200=0.6 是不纯率、T2 θ̂=0.99 是纯率）。裁定依据（数学为准）：
   - `priorFor` 替换点 `theta0 = baseRate?.mu ?? GLOBAL_THETA0`——GLOBAL_THETA0=0.25 是**不纯率**（注释明证：65 条中 51 PURE → impure≈0.22 取 0.25）；
   - 冷启动 `{mu:0.25}` 必须 ≡ GLOBAL_THETA0=0.25（向后兼容约束）；
   - pipeline.md 四原文："项目 j 的观测不纯率 θ̂_j = impure_j/(pure_j+impure_j)"。
   → `fitBaseRate` 用 `(n-pure)/n`，T1 手算 μ=0.6/κ=3.0851 精确复现；T2 测试改写为不纯率方向（追加 impure → μ 上升）。
2. **kappa 拟合但不接入 priorFor**（设计文档显式决定：fitted κ 描述项目间离散，priorFor 在单项目内做 method→cell 两层收缩，无项目层可接；KAPPA1/KAPPA2 不动）。
3. **T4 测试的 μ=0.95 改 0.6**：0.95 使 pPure 落入 (0.35,0.65) 分歧带 → null；0.6 保持非空且方向正确（高不纯率 → pPure 下降）。

## fitBaseRate 实测（InitDeity 真实语料）

`J:/旧宇宙/代码仓库/InitDeity/Assets/.codeaudit/corpus.json`（v2，method 表 1272 键 / 4264 样本）：

```
fitBaseRate([initDeity]) → {"mu":0.25,"kappa":12,"projects":0}     ← 单项目冷启动（projects=1<2，判定正确）
fitBaseRate([initDeity, swaggerSim(65条51PURE)]) → {"mu":0.5616,"kappa":133.8,"projects":2}
  （μ 被 InitDeity 4264 样本的不纯率 0.567 主导——加权均值按设计工作）
```

- **InitDeity 是第一个合格项目**（v2 结构、4266 样本、通过 isCorpus），但单项目不能拟合（κ 需要项目间方差）——冷启动保证现状行为不变，第二项目接入即自动拟合。

## 验证

- `tsc`：0 错误
- 全量 vitest：**246/246**（24 文件，+10：corpus +5、risk +1、robustness +4）
- `scripts/check-readme-tests.cjs`：README test count OK（246）
- 向后兼容：`priorFor` 缺省路径逐位不变（T4 显式 `{mu:0.25}` 与缺省断言相等）；`--changed` 无 `--gate` 行为零改动

## 残余风险

- `--gate` 的 medium/critical 档无 CLI 层测试（low/high/invalid 卡住 0/1 分界，gradeOf 阈值已有单测——设计文档记录的设计边界）
- R_state 测试的 writer/reader helper 缺 effects/chainDev 等字段（tsc 容忍，LSP 噪音——**既有**，非本轮引入）
- fitBaseRate 的 `kappa` 未接 priorFor（显式设计决定，留作后续迭代）
