# codeaudit

跨语言代码纯度审计工具。把代码库解析为 chunk 调用图，在 SCC 凝聚后的 DAG 上传播效应（io / net / db / random / clock / state），回答三个问题：**副作用藏得多深、源头是谁、先治理哪里**。

它不告诉你代码有多差，它告诉你副作用从哪进来、传染到哪里、从哪个点开始治理收益最大。

## 特性

- **效应传染链**：每个函数标注 `chain` = 距最近副作用源的最短调用距离。`chain=0` 是直接效应源；`chain=N` 的副作用更隐蔽、更难 mock、重构更危险。
- **治理优先级排序**：非纯 chunk 按直接调用者数降序——先修被最多人依赖的。
- **效应源定位**（`--sources`）：找出 chain=0 的 IMPURE chunk——直接调用 io/net/random/state 原语的函数，即副作用传播链的源头（源头不必然是代码问题：日志、DB 封装本就该做 io）。
- **AI 标注闭环**：导出未解析符号 → 人工/AI 标注 → 回读消解未知。工具零 LLM 依赖、零密钥、零网络。
- **回归风险门禁**（`--gate`）：对改动文件评估内生回归风险，HIGH/CRITICAL 时 exit 1，可接入 CI。
- **内容寻址**：`chunk.id = hash(规范化源码)`——函数搬家、改注释、调缩进 id 不变；标注与缓存永不漂移。
- **确定性**：同一输入两次扫描输出逐字节一致；增量缓存 + `recheck` 秒级重算。

## 安装

```bash
# 从源码
npm install
npm run build
node dist/cli.js --version

# 或全局安装（使用 bin: codeaudit）
npm install -g .
codeaudit --version
```

运行时要求 Node ≥ 18；开发（跑测试）需 Node ≥ 20。`--html` 报告的内嵌脚本需 ES2022 浏览器（Chrome 93+/Firefox 92+/Safari 15.4+，2021 年后版本）。

## 快速开始

```bash
codeaudit scan ./src                          # 扫描：非纯 chunk 治理清单（按调用者数排序）
codeaudit scan ./src --top 20                 # 只看前 20 条
codeaudit scan ./src --sources                # 效应源清单（chain=0 的直接副作用源头）
codeaudit scan ./src --topology               # 拓扑健康度（密度/环/深度/桥/割点 + 人类解读）
codeaudit scan ./src --state                  # 状态耦合图（写方按读者数排序）
codeaudit scan ./src --strict                 # 存在 IMPURE 时 exit 1（CI 门禁）
codeaudit scan ./src --changed lib/db.ts --gate   # 改动回归风险 + 合入门禁
codeaudit scan ./src --html report.html       # 技术债 HTML 可视化（自包含单文件）
codeaudit scan ./src --json out.json          # 导出完整 JSON（供 recheck/compare 复用）
codeaudit recheck out.json --topology --html r.html  # 秒级重算，免重扫
```

## CLI 参考

```
codeaudit scan [目录] [选项]
codeaudit recheck <json> [选项]     # 加载 --json 输出，重算全部视图（改工具后免重扫）
```

| 选项 | 说明 |
| --- | --- |
| `--format text\|json` | 输出格式（默认 text） |
| `--json [file]` | JSON 输出；带 file 写文件，无参输出 stdout |
| `--top N` | 治理清单只显示前 N 条 |
| `--topology` | 拓扑健康度：密度/环/深度/自环/纠缠环/桥/割点 + 解读 |
| `--sources` | 效应源清单：chain=0 IMPURE，按调用点数排序 |
| `--state` | 状态耦合图：写方按读者数排序 |
| `--dups` | 重复代码：同内容哈希多实例（复制粘贴） |
| `--test-coverage` | 测试盲区：未被 Tests/ 引用的生产 chunk，按调用者数排序 |
| `--dead` | 疑似死代码：零调用者（排除 Unity 生命周期/反射入口误报） |
| `--first-party` | 以上治理视图仅看第一方代码（排除 LocalPackages/Plugins/生成代码） |
| `--complexity` | 圈复杂度 top（重构复杂函数识别） |
| `--modules` | 模块级视图 |
| `--deps <file>` | 文件依赖：入/出边文件清单（拆分决策） |
| `--compare <before.json>` | 重构前后报告对比 |
| `--table-usage` | 效应表补表候选（missSlots top 15） |
| `--unknowns <file>` | 导出未解析符号清单（按影响面排序，含 id 锚点，供 AI 标注） |
| `--annotations <file>` | 回读标注 `[{id, verdict:"PURE" | "IMPURE"}]` |
| `--effect-table <json>` | 效应表注入 `{ 语言: { 表名: 值 } }`（不改库代码；读/校验失败 exit 2） |
| `--corpus <file>` | 标注语料（默认 `.codeaudit/corpus.json`），累积先验供 `suggested_prompt` |
| `--changed <files>` | 回归风险分析：改动文件（逗号分隔） |
| `--gate` | 与 `--changed` 联用：grade ≥ HIGH → exit 1（无效路径也不放行） |
| `--strict` | 存在 IMPURE chunk → exit 1 |
| `--html <file>` | 技术债 HTML 报告（健康度/拓扑/模块图与纠缠环/治理/复杂度/未知/效应源/证明完整度/测试盲区/重复/死代码/状态耦合） |
| `--no-cache` | 禁用增量缓存 |
| `-h, --help` / `-v, --version` | 帮助 / 版本 |

退出码：`0` 成功；`1` 门禁触发（`--strict`/`--gate`）；`2` 参数或文件错误。

## 库 API

```ts
import { scanProject, analyzeChange } from "codeaudit";

// 扫描（纯度判定 + 传染链）
const report = await scanProject("./src", { useCache: true });
for (const v of report.verdicts) {
  if (v.purity !== 0) console.log(v.chunk.name, v.chain, v.effects);
}

// diff 影响面：改动哪些文件，直接/传递影响哪些调用者
const impact = await analyzeChange("./src", ["lib/db.ts", "api/route.ts"]);
console.log(impact.summary); // { changedFiles, unmatchedFiles, changedChunks, affectedChunks, maxDepth }

// 效应表注入：扩展效应表不改库代码（键只增不删、数组并集）
const injected = await scanProject("./src", {
  effectOverrides: {
    csharp: { impureGlobals: { MySdk: "net" } },
    python: { frameworkIo: { client: ["post", "get"] } },
  },
});
```

导出函数：`scanProject` / `analyzeChange` / `changedImpact` / `riskOfChange` / `forwardClosure` / `gradeOf` / `gateExit` / `fitBaseRate` / `priorFor` / `emptyCorpus` / `updateCorpus` / `mergeCorpus` / `summarize` / `siteShapeInfo` / `isCorpus` / `graphMetrics` / `dependencySkeleton` / `bridgesOf` / `renderTechdebtHtml` / `proofCompleteness` / `annotationBudget` / `annotationCurve` / `influenceAnalysis` / `compareReports` / `applyEffectOverrides` / `validateEffectOverride` / `loadEffectOverrides` + `defaultPacks`，以及类型 `Verdict` / `Chunk` / `ScanReport` / `ScanStats` / `LangPack` / `Purity` / `EffectTables` / `CorpusFile` / `ChangeImpact` / `ChangeRisk` 等。

完整示例见 [examples/api-demo.js](examples/api-demo.js)（扫描 + 影响面 + 回归风险 + 证明完整度 + 拓扑）。

## 工作原理

工具的正确性归结为五条可检验的不变式（形式化与审计见 [docs/axioms.md](docs/axioms.md)）：

1. **边的守恒**：每个调用点恰好归属一个 chunk（含文件级伪 chunk `<module>`）。
2. **先凝聚，后计算**：一切传播都在 Tarjan SCC 凝聚后的 DAG 上进行，终止性由构造保证——相互递归、回调环不会让分析发散。
3. **纯度三值 + 健全性契约**：判定格 `PURE < UNKNOWN < IMPURE`；audit 输出是声明模型的过近似——S1 永不假纯、S2 效应过近似、S3 链为悲观下界、S4 解析闭包（每条调用点都有落点，无静默丢弃）。「宁 UNKNOWN 不 PURE」；unknown-rate 衡量判定覆盖面。
4. **身份即内容**：`chunk.id = hash(规范化源码)`，标注与缓存按 id 寻址，不漂移。
5. **排序不混合量纲**：每个输出视图用单一量纲排序（治理=直接调用者数、复杂度=圈复杂度、效应源=调用点、未知=影响面），平手才用确定性 tiebreak。

### 输出解读

```
codeaudit 0.3.1 — 20 chunks, 7 files, unknown-rate 5.0%, cycles 1

IMPURE
  chain=   4  {io}       handle_request               api.py:5
  chain=   3  {io}       batch_create                 service.py:13
  ...
UNKNOWN (audit 假设为不纯)
  chain=   0?→-  {?}        engage                       worker.py:5
```

- **chain = 0**：直接效应源（调了 `sqlite3`、`fs.writeFileSync`、`console.log`……）。
- **chain = N**：距最近的效应源隔了 N 层调用。数值越大，副作用越隐蔽、越难 mock、重构越危险——排序越靠前。
- **chain 带 `?`**：结论依赖未解析符号，标注后可能翻案；`0?→4` 表示标注后最坏藏 4 层（audit 悲观值 → dev 乐观值区间），`-` 表示 dev 视为纯。JSON 对应字段 `chain` / `chainDev`。
- **effects**：传播后的真实效应集；`{?}` 表示只有未知来源。

### 回归风险（`--changed`）

基于现有关注点（纯度/链长/SCC/影响面/未知迷雾）的内生风险模型，零外部数据：

```
codeaudit scan src --changed src/engine/scan.ts
# 回归风险 4.0/100 [LOW]  （影响 0.08 纯度 1.00 环 0.00 深度 0.00 迷雾 0.16 状态 0.00）
#   改动 6 chunk / 受影响调用者 10 / L=1.00 C=0.04
#   ➜ 低风险（<15）可合入——非零风险，留意影响面内调用者
```

- **六因子**（全部从扫描推导）：`impact`（反向可达闭包 ∪ 状态读者占比）、`purity`（纯度退化）、`cycle`（SCC 环内修改）、`depth`（效应链深）、`fog`（影响面内 UNKNOWN 占比）、`state`（状态耦合读者占比）。
- **聚合**：`L = 1-(1-purity)(1-fog)(1-state)`，`C = 0.5·impact+0.3·cycle+0.2·depth`，`Risk = 100·L·C`。阈值按真实语料分布重标定：<15 LOW / <35 MEDIUM / <60 HIGH / ≥60 CRITICAL。路径不匹配 → `invalid`（不可评估，不静默放行）。
- **门禁**：`--gate` 下 `grade ≥ HIGH`（≥35）→ exit 1，CI 阻止高危改动合入；LOW/MEDIUM → 0；`invalid` → 1。

## 支持的语言

| 语言 | chunk | import 解析 | 备注 |
| --- | --- | --- | --- |
| Python | 函数/类/方法 | 绝对/相对导入、星号导入回退 | `global`/`nonlocal` 状态写已建模（→ state 效应） |
| TypeScript | 函数/方法/类/箭头函数常量 | 相对路径、桶文件再导出、默认导出 | tsconfig paths 别名暂不支持 |
| TSX | 同上 | 同上 | 独立 tsx 语法 |
| JavaScript | 同上 | ESM + `require()` | |
| C# | 类/方法/构造/局部函数（Unity） | using 别名 | Unity/.NET 类名效应表；属性访问器与事件订阅建模；中文标识符部分文件解析失败 → 方向安全 UNKNOWN |

新语言 = 实现一个 `LangPack`（数据表 + 两个行为函数），核心引擎零改动。架构与扩展点见 [docs/pipeline.md](docs/pipeline.md)。

## AI 标注闭环

工具不内置 LLM（零密钥、零网络）。闭环三环：

1. **导出**：`--unknowns out.json` 按影响面排序导出未知符号清单——每条含内容寻址 `id`、`symbol`、`file/line`、影响面、调用点明细、形态与语料先验 `suggested_prompt`（「形态历史 ≈8 成被标 PURE (n=37)」——建议置信度，非判定）。
2. **回读**：`--annotations ann.json`（`[{id, verdict}]`，按 chunk.id 匹配；可选 `file` 字段做 `(file, id)` 实例锚定，防同内容跨文件误放行）——PURE 移除该 chunk 的 `?`（下游随之翻案），IMPURE 加直接 io 效应。`--corpus` 把标注幂等累积为语料先验。
3. **预算**：CLI 输出标注曲线——「标 0 条→428 (53.6%) | 标 102 条→306 | 标 204 条→204 (25.6%) | 标 408 条→0」，直接回答「标多少个到 X%」。

## 已知限制（有意为之）

- **动态分派不追踪**：`obj.method()` 中 `obj` 是局部变量时边不可知，记为 `?`——audit 模式下降级为 UNKNOWN，不伪造边。`super().m()`、`factory()()`、`d[k]()` 等同理。
- **第三方库无源码递归**：npm 包内部不展开，靠效应表 + AI 标注覆盖。
- **属性/事件残余盲区**：C# 条件访问 `obj?.Prop` 读取、TS/JS/Python 属性读取（部分已修）、项目外子类/写者——见 [docs/technical-debt.md](docs/technical-debt.md) 完整清单（假纯可能通道逐条声明触发条件）。
- **强制转换内建协议残余**：`len(x)`/`str(x)` 等判纯，但用户对象会分派 `__len__`/`__str__`（可带 io）——有意接受，移除则 unknown-rate 爆炸。
- **混合模块成员**：效应表只列 io 成员 + `:p` 显式纯标记；未标记成员（如 `time.strftime`）落 UNKNOWN——方向安全（假未知非假纯）。
- **SCC 链长语义**：环内所有节点同 chain（视为同一距离）。
- **Python 超深缩进**：tree-sitter 缩进栈上限约 62 层，更深的文件降级为 parseError 占位，不影响其余文件。

## 开发

```bash
npm install
npm run build
npm test    # 541 个测试：单元 + 多语言 E2E + 合成大库 + 自扫描 + 交叉审计 + 范畴律对抗（五轮）
```

测试分五层：单元（tarjan/analyze/hash 契约）、多语言 E2E（pyshop/tsapp/jsapp）、边界 E2E（空目录/损毁文件/再导出环）、合成大库（300 文件 2400+ chunks，确定性验证）、交叉审计（随机图对照朴素参考实现 + 对抗性输入，32 维，见 [AUDIT.md](AUDIT.md)）。

## 文档

- [docs/axioms.md](docs/axioms.md) — 公理系统的充分性审计与健全性契约形式化
- [AUDIT.md](AUDIT.md) — 交叉审计报告
- [CHANGELOG.md](CHANGELOG.md) — 变更记录

## License

MIT
