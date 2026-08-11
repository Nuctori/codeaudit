# Changelog

## [Unreleased] — 迭代 22-23（真实校准 + 门禁 + 状态耦合图 + 效应表收紧）

### 新增

- `--gate` 合入门禁（F5，Debtmap 借鉴）：与 `--changed` 联用，`grade ≥ HIGH`（风险≥35）时退出码 1——CI 阻止高危改动合入；`LOW/MEDIUM` → 0；`invalid` → 1（不静默放行）；无 `--changed` 时报错 exit 2（不静默失效）
- `fitBaseRate(corpora)` 分层贝叶斯基率（pipeline.md 四落地）：跨项目语料 → `BaseRateModel{mu, kappa, projects}`——μ 替代硬编码 `GLOBAL_THETA0`；矩估计闭合解（加权均值 + 方差反解 κ），`projects < 2` 冷启动回退现状
- `priorFor(corpus, site, baseRate?)` 第三参：缺省路径逐位兼容（`baseRate?.mu ?? 0.25`）
- corpus 面库 API 补齐导出：`emptyCorpus`/`updateCorpus`/`mergeCorpus`/`summarize`/`siteShapeInfo`/`isCorpus`/`fitBaseRate`/`priorFor` + 类型（pipeline.md 三工作流示例消费面）
- `--state` 状态耦合图（D-127）：写方 stateWrites → 读方 stateDeps 映射——text 摘要 top 15 按读者数降序，json 顶层 `stateCoupling` additive（零 schema 破坏）；`stateCouplingOf(verdicts)` 纯函数反查 verdict.stateDeps（零重复传播）

### 修复

- `--topology` 解析分支回归（`--gate` 分支曾顶掉兄弟分支——迭代 22 复审发现，已恢复 + 补 CLI 回归测试）
- README 示例重复行清理
- frameworkIo.System 前缀表收紧（迭代 22 盲区处置）：删 Reflection/Text/Globalization/Runtime/RuntimeTypeHandle 5 条目——纯反射元数据读不再假 io（InitDeity ConvertToString ×47 direct-io 47→0，全库 IMPURE −100 / UNKNOWN +99 守恒零误伤）；移除后落 UNKNOWN 非 PURE（MethodInfo.Invoke 不假纯）
- `--state` 解析分支回归（`--state` 曾顶掉 `--table-usage`——迭代 22 `--gate` 顶 `--topology` 同款 bug 二次再现）：恢复 + 根因护栏「全部布尔旗标可解析」CLI 回归测试（5 旗标逐一冒烟）防三次复发

## [0.2.0] — 2026-08-11（生产就绪轮）

### 新增

- `--sources`：效应源清单（chain=0 IMPURE——直接调 io/net/random/state 的"背锅者"，按调用点排序）
- `--topology`：拓扑健康度（graphMetrics：密度/环/深度/自环/层/链直方图 + 人类解读）
- `graphMetrics` 库 API（拓扑派生层纯函数）
- `R_state` 因子：回归风险六因子（状态写改动 → stateDeps 读者耦合）
- `ChangeRisk.evidence`：证据质量（unknownRate/parseErrorRate/missingSiteRate——证明系统最小方案）
- CLI 可解释性层：grade action 行 + 证据置信度警告 + 拓扑人类解读
- GitHub Actions CI（build + 测试 + 自扫描健康检查）

### 修复

- 定时器异步边真实生效（D-092：hofAlwaysArgs 触发门死配置修正）——回调进反向闭包
- CJS 解构 require 盲区（exports.x=fn 建命名 chunk）——解构回调可解析
- F2 参数重绑不再判外部状态写（纯局部）
- 解构绑定 declaredNames（`const {a}=obj; a=5` 不再假 IMPURE）
- 阈值重标 15/35/60（实测分布驱动，30/60/85 两个死区）

### 内部

- 最简性清扫：S1-S3 消重（changedImpact 复用/annotationCurve 加权/共享比较器）+ D1-D5 死代码删
- 标注曲线分母统一 |U|（对齐 proof Θ）
- 发布面：exports/types/bin/files/repository 齐备；npm pack 消费者验证通过

## [0.1.0] — 2026-08-09

- 初始发布：跨语言纯度审计（Python/TS/JS/TSX）
- 核心：chunk 调用图 + SCC 凝聚 + 效应传染链 + 三值判定（A6/A7 健全性契约）
- 回归风险（`--changed`）：L×C 五因子 + 阈值分级
- 证明完整度（proofCompleteness Θ）+ 标注闭环（unknowns/annotations/corpus）
- AI 标注闭环：影响面排序导出 + 标注回读 + 语料先验
