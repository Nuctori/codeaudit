# iter22 分层基率实现规格（fitBaseRate / priorFor baseRate）— 只读审计产出

可直接落盘为 `docs/iter22/base-rate-design.md`（目录不存在，需创建）。
审计基线：HEAD 9ac6b4c，236/236 测试。全部引用行号为当前磁盘真实行号。

---

## 0. 现状核查（grep/读码证实）

- `fitBaseRate` / `exportUnknowns` / `loadCorpus` / `saveCorpus` 在 src/ 全部不存在（grep 无结果）。
- `src/core/corpus.ts` L60 硬编码 `GLOBAL_THETA0 = 0.25`，L61-62 注释自认"单项目标签分布泄漏为全局常数（跨项目污染通道）"——正是本迭代要消除的。
- `priorFor` 唯一消费者是 `priorFor` 内部公式 + `cli.ts:121`（2 参调用）+ `siteShapeInfo`（corpus.ts:217，内部 2 参调用）。加可选第三参零破坏。
- `src/index.ts`（83 行）目前 **零 corpus 导出**——`emptyCorpus/updateCorpus/priorFor/...` 全都不在公共 API。pipeline.md 二契约与三工作流示例要求补全。
- 真实数据就绪：`J:/旧宇宙/代码仓库/InitDeity/Assets/.codeaudit/corpus.json`（v2，实测见第 5 节）。

## 1. fitBaseRate 签名与矩估计

```ts
// src/core/corpus.ts 新增（或独立 baseRate.ts，随实现者；corpus.ts 更贴现有结构）
export interface BaseRateModel {
  /** 全局纯率均值 μ（替代 GLOBAL_THETA0 常量）。 */
  readonly mu: number;
  /** 项目间收缩强度 κ（越大项目间差异越小）。 */
  readonly kappa: number;
  /** 参与拟合的有计数项目数。 */
  readonly projects: number;
}

export function fitBaseRate(corpora: readonly CorpusFile[]): BaseRateModel;
```

数学（pipeline.md 四，标准分层 Beta 矩估计，无 MCMC 闭合解）：

- 项目 j 观测纯率：`θ̂_j = pure_j / (pure_j + impure_j)`，取自 **method 表边际**（Σ 该语料 method 全部条目，pipeline.md 四明示；勿用 cell 表——口径一致 + 现有 summarize 同源）。
- 权重：`w_j = n_j / Σ_j n_j`，`n_j` = method 表 pure+impure 总和（大样本项目主导）。
- 均值：`μ = Σ_j w_j · θ̂_j`。
- 加权方差：`Var(θ) = Σ_j w_j (θ̂_j − μ)²`（w 归一化后的总体式 = pipeline「样本加权方差」口径；不加 Bessel 校正——矩估计传统，文档注明即可）。
- κ 反解：`κ = μ(1−μ) / Var(θ) − 1`。

守卫与角情况（规格必须实现）：

| 情况 | 处理 |
| --- | --- |
| 有计数项目数 < 2 | 冷启动：返回 `{mu: 0.25, kappa: 12, projects: 0}`（与现状等价、向后兼容；`projects: 0` 暴露"未拟合"态） |
| `Var(θ) = 0`（全项目同率） | κ 数学上 +∞（完全 pooling）→ 钳到上限 `KAPPA_MAX = 1e6`（仅保可序列化；JS Infinity 无法 JSON） |
| `μ = 0` 或 `1`（全部项目同向） | `μ(1−μ) = 0` → κ 为 0/0 → 先把 μ 钳到 `[1e-3, 1−1e-3]` 再反解（Beta 先验保持 proper）；若仍 Var=0 走上行 |
| `κ < 0` | 钳到 0 = 无收缩（项目间差异大于 Beta 可表达，回退完全独立，pipeline.md 四） |
| 输入含畸形语料 | `corpora.filter(isCorpus)` 后统计（isCorpus 已存在，L40-58）；空 total 的项目跳过不计入 projects |
| 输入 `[]` | 冷启动返回（同上） |

## 2. priorFor 第三参接入点

```ts
// src/core/corpus.ts L161 签名改：
export function priorFor(corpus: CorpusFile, site: CorpusSite, baseRate?: BaseRateModel): Prior | null
```

- L180 公式替换：`const theta0 = baseRate?.mu ?? GLOBAL_THETA0;` 然后 `thetaM = (mImpureLOO + theta0 * KAPPA1) / (mTotalLOO + KAPPA1)`。
- `KAPPA1 = 12`（L63）、`KAPPA2 = 8`（L64）**保持不变**——pipeline.md 四显式决定："KAPPA1（项目内收缩 12）保持不变（层内收缩与层间收缩正交）"。
- **`baseRate.kappa` 在 priorFor 内不使用**（仅随模型对象可观测）。理由：fitted κ 描述项目间离散，priorFor 在单项目语料内做 method→cell 两层收缩，无项目层可接。如需将来接：`thetaM = (mImpureLOO + mu·kappa)/(mTotalLOO + kappa)` 即把 fitted κ 当 method 层收缩强度——留作后续迭代决策，本次不实现（ponytail：不建未用接线）。
- 向后兼容：第三参可选，`cli.ts:121`、`siteShapeInfo`（corpus.ts:217）不改一行；缺省路径结果与现状逐位相同（0.25 常量路径不动）。
- 冷启动双闸保持独立：priorFor 自身 `total < MIN_TOTAL → null`（L162，项目内样本闸）不变；fitBaseRate `projects < 2 → 冷启动模型`（跨项目闸）。两者不互相影响。
- 置信声明（pipeline.md 四）不变：分层基率只进 `suggested_prompt`，不进 purity/chain/effects 判定通道。

## 3. 导出清单（src/index.ts 追加）

```ts
// 在现有 export 块后追加（corpus 面当前完全未导出）：
export {
  fitBaseRate, priorFor, emptyCorpus, updateCorpus, mergeCorpus,
  summarize, siteShapeInfo, isCorpus,
} from "./core/corpus";
export type { BaseRateModel, CorpusFile, CorpusSite, Prior } from "./core/corpus";
```

- 依据：pipeline.md 二契约（fitBaseRate/priorFor）+ 三工作流示例（`import { scanProject, exportUnknowns, updateCorpus, emptyCorpus, fitBaseRate, priorFor } from "codeaudit"`）——emptyCorpus/updateCorpus 已是示例消费面，一并补齐。
- `exportUnknowns` / `loadCorpus` / `saveCorpus` 是管线另两个阶段（采集/IO），**不在本次规格内**（grep 证实 cli.ts L354-403 的 `--unknowns` 导出逻辑仍在 CLI 侧，提取为库函数是独立任务，后续迭代）。

## 4. 测试点（追加到 test/unit/corpus.test.ts，沿用现有 vitest + 手算对拍风格）

**T1 对拍手算（矩估计公式正确性）**——3 项目，method 计数 (pure, impure)：
- A=(30,10) n=40 θ̂=0.25；B=(40,40) n=80 θ̂=0.5；C=(10,70) n=80 θ̂=0.875
- 手算：Σn=200，μ=(10+40+70)/200=0.6
- Var = 0.2·(0.25−0.6)² + 0.4·(0.5−0.6)² + 0.4·(0.875−0.6)² = 0.0245+0.004+0.03025 = 0.05875
- κ = 0.6·0.4/0.05875 − 1 ≈ 3.0851
- 断言：fitBaseRate 返回 μ、κ 与手算 |Δ| < 1e-9（toBeCloseTo）；projects === 3。
- 构造方式：`updateCorpus(emptyCorpus(), chunks, ann)` 各项目独立语料（复用 corpus.test.ts L8-14 的 chunk 工厂）。

**T2 单调性 / 加权主导**：
- 大样本项目主导：两项目 A=(990,10) θ̂=0.99 n=1000、B=(1,1) θ̂=0.5 n=2 → μ ≈ (990+1)/1002 ≈ 0.9889，显著 > 简单均值 0.745。
- 向 A 追加 impure（如 A'=(990,50)）→ μ 单调下降。
- 不变量：μ ∈ [min_j θ̂_j, max_j θ̂_j] 恒成立（随机多组计数抽查）。

**T3 冷启动**：
- `fitBaseRate([])` → `{mu:0.25, kappa:12, projects:0}`。
- 仅 1 个有计数项目（计数任意大，如 1000 样本）→ 同上（projects<2 判定，与样本量无关）。
- 1 有计数 + 1 空项目（`emptyCorpus()`）→ 仍冷启动（空项目不计入 projects）。

**建议 T4（pipeline 六.4 验证门，接入点生效证明）**：构造 3 个不同纯率的项目语料 → fitBaseRate → 用返回模型调 `priorFor(corpus, site, model)`：一个 method 表有 ≥MIN_CELL 证据的冷单元格，其 pPure 随 `model.mu` 移动而非 0.25（对比 `priorFor(c, site)` 缺省路径）；缺省路径与现状结果逐位一致（回归断言）。

验证门：236/236 全绿 + 上述新增 + 手算对拍 + cli `--corpus` 流程（缺省 baseRate）无回归。

## 5. InitDeity 单项目拟合判定

实测 `J:/旧宇宙/代码仓库/InitDeity/Assets/.codeaudit/corpus.json`：

| 表 | 键数 | 样本 | 纯率 |
| --- | --- | --- | --- |
| method | 1272 | 4264（pure 1847 / impure 2417） | 0.43316 |
| cell | 1311 | 4266（pure 1848 / impure 2418） | 0.43319 |
| root | 7 | 2469 | 0.4536 |

（seen 去重 1882 键；method 与 cell 差 2 样本，疑似跨版本合并残留，量级无影响。）

**判定：不能拟合。** `fitBaseRate([initDeityCorpus])` → 有计数项目 = 1 < 2 → 返回冷启动 `{mu:0.25, kappa:12, projects:0}`；InitDeity 的 0.433 观测不进入模型（κ 需要项目间方差，μ 需要 ≥2 项目才有跨项目均值意义——单项目时加权均值退化为该项目自身率，无收缩信息）。

结论与路径：InitDeity 语料是第一个合格项目（4266 样本、v2 结构、通过 isCorpus）；要真正拟合需再采集 ≥1 个项目（如 swagger-ui 旧 65 条标注模拟重建，或新项目走 exportUnknowns→标注→updateCorpus 管线）。冷启动语义保证现状行为不变，可随时接入第二项目无需迁移。

**数据质量备注（归档观察，不阻塞）**：root 表边际（2469）与 cell-by-root 边际（4266）严重不一致（bare：908 vs 1048；variable：1526 vs 3181）——疑似 v1→v2 迁移时 cell 重建而 root 桶保留旧计数。v2 `priorFor` 不读 root 表（只读 method+cell），不影响先验计算；仅 root 桶虚高问题已在 v2 修复注释（corpus.ts L31）中覆盖。

## 6. 实现顺序（最小 diff 排序）

1. corpus.ts：`BaseRateModel` + `fitBaseRate`（纯函数，~40 行）+ `priorFor` 第三参与 L180 一处替换。
2. test/unit/corpus.test.ts：T1/T2/T3（+建议 T4）。
3. index.ts：追加导出（3 行）。
4. 跑全量测试确认 236+ 新增全绿。

## 约束与开放问题

- 定案：`kappa` 拟合但不接入 priorFor（pipeline.md 四显式决定）；`KAPPA1/KAPPA2` 不动。
- 定案：θ̂_j 用 method 表边际（pipeline 明示）。
- 开放（实现时一句话决策即可，不阻塞）：`KAPPA_MAX` 取值（建议 1e6）；μ 钳制区间（建议 [1e-3, 1−1e-3]）；方差是否加 Bessel（建议不加，矩估计口径，文档注明）。
- 风险：无。缺省路径逐位兼容由 T4 回归断言兜底；fitBaseRate 纯函数无 IO 无状态。
