# LLM 标注管线设计（库形态）

2026-08-11。目标：跨项目标注语料 → 分层基率 → 更准的先验建议；AI 通过库 API 全程驱动。
前置：6 轮收敛审计完成、有解工程项做尽、`analyzeChange` 库 API 就绪（HEAD 4d962c3，154/154）。

## 一、管线阶段（五步，全走库 API）

```
collect → label → accumulate → fit → apply
 采集     标注     累积       拟合     应用
```

| 阶段 | 库函数（新增） | 输入 → 输出 | 说明 |
| --- | --- | --- | --- |
| 采集 | `exportUnknowns(report)` | ScanReport → UnknownEntry[] | 从现有 `--unknowns` 导出逻辑提取为库函数（含 id/file/line/influence/unknownSites/calls/shape/prior/batchable/suggested_prompt/parseError） |
| 标注 | —（AI 侧） | UnknownEntry[] → {id, verdict}[] | LLM 按 suggested_prompt + prior 提示判 PURE/IMPURE；`parseError` 条目只标 IMPURE |
| 累积 | `updateCorpus(corpus, chunks, annotations)`（已有） | 语料 v2 幂等累积 | 标注回读走 `scanProject({annotations})`；语料按项目分开存（分层模型需要项目维度） |
| 拟合 | `fitBaseRate(corpora: CorpusFile[])` | 项目语料集 → BaseRateModel{mu, kappa, projects} | 分层贝叶斯矩估计（见四） |
| 应用 | `priorFor(corpus, site, baseRate?)`（改签名） | 语料+站点+基率 → Prior | 第三参可选；缺省回退内置 0.25（向后兼容） |

语料按项目组织：`corpora/{project}/corpus.json`——分层模型需要"每个项目的观测纯率"，
单一合并语料丢项目维度（v2 的 `projects` 字段恒 1 即为此预留）。

## 二、库 API 契约（新增导出，index.ts）

```ts
// —— 采集与标注候选 ——
export interface UnknownEntry {           // 与 --unknowns 导出逐字段同构
  id: string; symbol: string; file: string; line: number;
  parseError: boolean;
  influence: number; unknownSites: number;
  calls: Array<{ attr: string; obj: string | null; root: string }>;
  shape: string; prior: { pPure: number; n: number } | null;
  batchable: boolean; suggested_prompt: string;
}
export function exportUnknowns(report: ScanReport): UnknownEntry[];

// —— 语料 I/O（isCorpus 守卫 + 原子写）——
export function loadCorpus(path: string): CorpusFile;          // 不存在/畸形 → emptyCorpus
export function saveCorpus(corpus: CorpusFile, path: string): void;

// —— 分层基率 ——
export interface BaseRateModel {
  /** 全局纯率均值 μ（替代 GLOBAL_THETA0 常量）。 */
  readonly mu: number;
  /** 项目间收缩强度 κ（越大项目间差异越小）。 */
  readonly kappa: number;
  /** 参与拟合的项目数。 */
  readonly projects: number;
}
export function fitBaseRate(corpora: readonly CorpusFile[]): BaseRateModel;
export function priorFor(corpus: CorpusFile, site: CorpusSite, baseRate?: BaseRateModel): Prior | null;

// —— 已有（AI 分析面）——
export async function scanProject(root, opts?): Promise<ScanReport>;
export async function analyzeChange(root, changedFiles, opts?): Promise<ChangeImpact>;
export function annotationBudget / annotationCurve / influenceAnalysis;
```

## 三、AI 工作流（库消费示例）

```ts
import { scanProject, exportUnknowns, updateCorpus, emptyCorpus, fitBaseRate, priorFor } from "codeaudit";

// 1. 采集（对 N 个开源项目）
const report = await scanProject("/repo/swagger", { useCache: true });
const candidates = exportUnknowns(report);          // 只含自身触发未知的源

// 2. 标注（LLM 判）——AI 侧按 suggested_prompt 输出 {id, verdict}[]，
//    parseError 条目提示只标 IMPURE；标注文件 = exportUnknowns 的 id/file 回填

// 3. 累积（每项目一个 corpus 文件）
const corpus = loadCorpus("/corpora/swagger/corpus.json");
const next = updateCorpus(corpus, report.verdicts.map(v => v.chunk), annotations);
saveCorpus(next, "/corpora/swagger/corpus.json");

// 4. 拟合（全部项目语料）
const model = fitBaseRate(loadAll("/corpora/*/corpus.json"));
// model = { mu: 0.78, kappa: 24, projects: 5 }  ← 替代硬编码 0.25

// 5. 应用（新项目扫描时的先验提示）
const prior = priorFor(newProjectCorpus, { attr: "execute", obj: "db", root: "variable" }, model);
```

## 四、分层基率数学

**模型**（标准分层贝叶斯，partial pooling）：

- 项目 j 的观测不纯率：`θ̂_j = impure_j / (pure_j + impure_j)`（项目语料 method 表边际）
- 先验结构：`θ_j ~ Beta(μκ, (1−μ)κ)`——μ = 全局均值（跨项目），κ = 收缩强度
- 矩估计（无 MCMC，闭合解）：
  - `μ = mean_j(θ̂_j)`（加权：大样本项目权重更高——`w_j = n_j / Σn`）
  - `κ` 由方差反解：`Var(θ) = μ(1−μ)/(1+κ) ⟹ κ = μ(1−μ)/Var(θ) − 1`（Var 用样本加权方差，κ<0 时钳到 0 = 无收缩，即项目间差异大于 Beta 可表达的——回退完全独立）
- **接点**：`priorFor` 中 `GLOBAL_THETA0`（0.25）→ `baseRate?.mu ?? 0.25`；`KAPPA1`（项目内收缩 12）保持不变（层内收缩与层间收缩正交）

**冷启动**：`fitBaseRate` 输入 < 2 个有计数的项目语料 → 返回 `{mu: 0.25, kappa: 12, projects: 0}`（与现状等价，向后兼容）；`projects` 字段让调用方可观测"未拟合"状态。

**置信声明**：分层基率只进 `suggested_prompt` 建议（A7：先验不进判定通道）——模型再准也不改变 purity/chain/effects 判定。

## 五、CI 采集形态（管线自动化的可选外壳）

`.github/workflows/collect-corpus.yml`（不阻塞库发布，独立仓库或本仓库均可）：

1. `projects.json`：开源项目清单（Python/TS 各若干，含 clone URL + 目录）
2. 定时（cron）或手动触发：clone → `scanProject` → `exportUnknowns` → LLM 标注（GitHub Secrets 配 key）→ `updateCorpus` → 提交 `corpora/{project}/corpus.json`
3. 提交后重跑 `fitBaseRate` → 结果（μ/κ/projects）写入 `corpora/base-rate.json`
4. 发布物：`corpora/` 目录随包发布（`files` 加 `corpora`），消费方 `loadCorpus` + `fitBaseRate` 或直接读 `base-rate.json`

## 六、实现顺序与验证

1. `exportUnknowns`：从 cli.ts 提取（行为同构，现有 unknowns 导出测试兜底）
2. `loadCorpus/saveCorpus`：isCorpus 守卫 + tmp+rename（复用 cli 原子写）
3. `fitBaseRate` + `priorFor` 第三参：矩估计实现 + 单调性/值域测试（沿用迭代 5/6 的数学对拍风格）
4. 模拟验证：构造 3 个"项目"语料（不同真实纯率），拟合后断言 μ 接近加权均值、priorFor 冷单元格提示随 μ 而非 0.25
5. 文档：README API 段 + docs/pipeline.md（本文件）

**验证门**：154/154 全绿 + 数学对拍（分层拟合 vs 手算矩估计）+ swagger 无回归（缺省 baseRate 路径不变）。
