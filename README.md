# codeaudit

跨语言代码纯度审计工具：把代码库解析为 chunk 调用图，在 SCC 凝聚后的 DAG 上传播"效应传染链"，按字典序输出治理优先级。`--sources` 直接定位效应源头（"背锅者"——谁把 io/net/random/state 引入代码库），`--unknowns` 按影响面给出标注优先级。

**它不告诉你"代码有多差"，它告诉你"副作用藏得多深、先治理哪里、源头是谁"。**

## 设计公理

工具的全部正确性归结为五条可检验的不变式：

1. **边的守恒**：每个调用点恰好归属一个 chunk（含文件级伪 chunk `<module>`）。
2. **先凝聚，后计算**：一切传播都在 Tarjan SCC 凝聚后的 DAG 上进行。终止性由构造保证——相互递归、回调环不会让分析发散。
3. **纯度三值 + 健全性契约（A6/A7）**：判定格 `PURE < UNKNOWN < IMPURE`（A7 效应格：效应原子集有限、传播单调并集、`?` 是知识标记非效应）。健全性（A6）：audit 输出是声明模型的过近似——**S1 永不假纯**（PURE ⟹ 模型效应闭包空）、**S2 效应过近似**（报告 ⊇ 模型）、**S3 链是悲观下界**（audit 链 ≤ 模型距离）、**S4 解析闭包**（每条调用点 → 边/效应/`?`，无静默丢弃）；对偶 dev 乐观上界合取得**区间定理**（真值 ∈ [audit 链, dev 链]）。「宁 UNKNOWN 不 PURE」= A6 的口号形态；unknown-rate = 区间宽度度量。
4. **身份即内容**：`chunk.id = hash(规范化源码)`。函数搬家、改注释、调缩进，id 不变；AI 标注与缓存按 id 寻址，不漂移。（文件级伪 chunk `<module>` 无源码，id 用文件限定 `module@<file>`，防标注跨文件泄漏。）
5. **排序不混合量纲**：输出排序只用字典序（纯度 → 链长 → 嵌套），不存在拍脑袋的加权求和。（输出契约——不约束计算语义，仅约束渲染。）

公理系统的充分性审计与 A6/A7 形式化见 [docs/axioms.md](docs/axioms.md)。

## 安装与使用

```bash
npm install
npm run build        # node node_modules/typescript/bin/tsc
npm test             # 300 个测试：单元 + 多语言 E2E + 合成大库 + 自扫描 + 交叉审计 + 数学层回归（开发需 Node ≥20，vitest 4）

# 扫描
node dist/cli.js scan ./src
node dist/cli.js scan ./src --format json
node dist/cli.js scan ./src --top 20
node dist/cli.js scan ./src --topology          # 拓扑健康度（密度/环/深度/自环 + 人类解读）
node dist/cli.js scan ./src --sources           # 效应源清单（chain=0 IMPURE——直接调 io/net/random/state 的"背锅者"）
node dist/cli.js scan ./src --state             # 状态耦合图（写方按读者数排序——谁写、谁读、扩散面最大的共享状态）
node dist/cli.js scan ./src --unknowns unknowns.json   # 导出未知符号供 AI 标注
node dist/cli.js scan ./src --strict                   # 存在 IMPURE 时退出码 1（CI 门禁）
node dist/cli.js scan ./src --changed a.ts --gate      # 合入门禁：回归风险 grade ≥ high 时退出码 1
node dist/cli.js scan ./src --effect-table overrides.json   # 效应表注入（不改库代码；{ 语言: { 表: 值 } }，读文件/校验失败 exit 2）
```

编程式 API：

```ts
import { scanProject, analyzeChange } from "@nuctori/codeaudit";

// 扫描（纯度判定 + 传染链）
const report = await scanProject("./src", { useCache: true });
for (const v of report.verdicts) {
  if (v.purity !== 0) console.log(v.chunk.name, v.chain, v.effects);
}

// diff 影响面：改动哪些文件，直接/传递影响哪些调用者（AI/CI 变更分析用；文件级粒度——改动文件的所有 chunk 为种子）
const impact = await analyzeChange("./src", ["lib/db.ts", "api/route.ts"]);
console.log(impact.summary); // { changedFiles, unmatchedFiles, changedChunks, affectedChunks, maxDepth }
for (const a of impact.affected) {
  console.log(`${"  ".repeat(a.depth)}${a.file}::${a.name}  ← 调 ${a.viaName ?? "-"}`);
}

// 效应表注入（迭代28 F16）：扩展效应表不改库代码——按语言名索引的链接侧表 override
// （键只增不删、数组并集；提取侧表如 literalReceivers 会被校验拒绝——参与缓存会静默失效）
const injected = await scanProject("./src", {
  effectOverrides: {
    csharp: { impureGlobals: { MySdk: "net" } },              // 外部 SDK 类 → net 效应
    python: { frameworkIo: { client: ["post", "get"] } },      // 扩展现有键不重列内置前缀
  },
});
// CLI 同构（迭代29）：--effect-table overrides.json（JSON 形状同上；读文件/校验失败 exit 2，与 --annotations 同款）
```

导出的库函数：`scanProject` / `analyzeChange` / `changedImpact` / `riskOfChange` / `forwardClosure` / `gradeOf` / `gateExit` / `fitBaseRate` / `priorFor` / `emptyCorpus` / `updateCorpus` / `mergeCorpus` / `summarize` / `siteShapeInfo` / `isCorpus` / `graphMetrics` / `proofCompleteness` / `annotationBudget` / `annotationCurve` / `influenceAnalysis` / `compareReports` / `applyEffectOverrides` / `validateEffectOverride` / `loadEffectOverrides` + `defaultPacks` + 类型（`BaseRateModel`/`CorpusFile`/`CorpusSite`/`Prior`/`ChangeImpact`/`ImpactedChunk`/`ChangeRisk`/`ProofCompleteness`/`GraphMetrics`/`VerdictDelta`/`Verdict`/`Chunk`/`ScanReport`/`ScanStats`/`LangPack`/`Purity`/`EffectTables`）。

## 回归风险控制（`--changed`）

基于现有关注点（纯度/链长/SCC/影响面/未知迷雾）的内生回归风险——零外部数据：

```bash
codeaudit scan src --changed src/engine/scan.ts
# 回归风险 4.0/100 [LOW]  （影响 0.08 纯度 1.00 环 0.00 深度 0.00 迷雾 0.16 状态 0.00）
#   改动 6 chunk / 受影响调用者 10 / L=1.00 C=0.04
#   ➜ 低风险（<15）可合入——非零风险，留意影响面内调用者
#   ⚠ 未知率过高——判定覆盖面不足，建议先标注再作结论
codeaudit scan src --changed src/engine/scan.ts --gate   # 合入门禁：HIGH/CRITICAL → exit 1；LOW/MEDIUM → 0；invalid → 1（不静默放行）
```

完整库 API 示例见 [examples/api-demo.js](examples/api-demo.js)（扫描 + 影响面 + 回归风险 + 证明完整度 + 拓扑）。变更记录见 [CHANGELOG.md](CHANGELOG.md)。

- **六因子**（全部从扫描推导）：`impact`（反向可达闭包 ∪ 状态读者占比）、`purity`（纯度退化——key 稳定用退化矩阵、编辑/新增用现状纯度映射）、`cycle`（SCC 环内修改，平凡排除+对数压缩）、`depth`（效应链深，PURE/∞→0 饱和）、`fog`（正向影响面内 UNKNOWN 计数占比）、`state`（stateDeps 命中的读者占比——图调用边外耦合通道，迭代14）。
- **聚合**：L×C 风险矩阵——`L = 1-(1-purity)(1-fog)(1-state)`（正相关下可证明的保守上界；state 与 fog/purity 无结构性相关，全静态解析的库可状态耦合极密）、`C = 0.5·impact+0.3·cycle+0.2·depth`（凸组合）、`Risk = 100·L·C`。阈值：<15 LOW / <35 MEDIUM / <60 HIGH / ≥60 CRITICAL（按实测分布重标，迭代13——真实语料 1233 模拟改动集 0 high/critical，30/60/85 两个死区；迭代15 复测含 R_state 后阈值保持有效）。路径不匹配 → `invalid`（不可评估，不静默放行）。
- **库 API**：`riskOfChange(verdicts, changedFiles, {oldVerdicts?})` / `forwardClosure` / `proofCompleteness(verdicts, {weighted?, targetTheta?})`（证明完整度 Θ + 标注预算序——annotationCurve 派生报告层，非新数学）
- **合入门禁（--gate，F5）**：与 `--changed` 联用，`grade ≥ HIGH`（风险≥35）时退出码 1——CI 阻止高危改动合入；`LOW/MEDIUM` → 0；`invalid`（文件未匹配）→ 1（与现状一致，不静默放行）。比 `--strict` 语义精确：门禁对准新引入的 IMPURE 影响半径而非存量。

## 输出解读

```
codeaudit 0.2.0 — 20 chunks, 7 files, unknown-rate 5.0%, cycles 1

IMPURE
  chain=   4  {io}       handle_request               api.py:5
  chain=   3  {io}       batch_create                 service.py:13
  ...
UNKNOWN (audit 假设为不纯)
  chain=   0?→-  {?}        engage                       worker.py:5
```

- **chain = 0**：直接效应源（调了 `sqlite3`、`fs.writeFileSync`、`console.log`……）。
- **chain = N**：距离最近的效应源隔了 N 层调用。数值越大，副作用越隐蔽、越难 mock、重构越危险——排序越靠前。
- **chain 带 `?`**：结论依赖未解析符号（audit 悲观值），标注后可能翻案；`?→N` 显示 dev 乐观链（区间上界），如 `0?→4` 表示该链标注后最坏藏 4 层，`-` 表示 dev 视为纯。JSON 输出对应字段为 `chain`（audit）与 `chainDev`（dev）。
- **effects**：传播后的真实效应集；`{?}` 表示只有未知来源。

## 架构

```
src/
  core/
    types.ts      Chunk / Verdict / Purity —— 公理的载体
    tarjan.ts     迭代式 Tarjan SCC（50k 深链不爆栈），逆拓扑序输出
    analyze.ts    唯一的分析函数：凝聚 DAG 上的效应并集 + 最短链，audit/dev 双跑
    hash.ts       规范化 + 内容寻址（公理4）
    influence.ts  影响面分析 + 标注曲线（标注预算数学）
    corpus.ts     标注语料 + EVSI 先验（suggested_prompt 的概率建议）
  lang/
    pack.ts       LangPack 接口：数据侧（节点表/效应表）+ 行为侧（import 提取/模块解析）
    extractor.ts  通用 AST 遍历器，由语言包数据驱动
    packs/        python.ts / typescript.ts / tsx / javascript.ts —— 一种语言一个文件
  engine/
    link.ts       符号解析：self/this → 同文件 → import 映射（含再导出跟随）→ 效应表 → "?"
    scan.ts       文件发现、内容哈希增量缓存、单文件失败隔离
  cli.ts          命令行
```

## 支持的语言与解析能力

| 语言 | chunk | import 解析 | 备注 |
| ------ | ------- | ------------ | ------ |
| Python | 函数/类/方法 | 绝对/相对导入、星号导入回退 | `global`/`nonlocal` 状态写已建模（→ state 效应） |
| TypeScript | 函数/方法/类/箭头函数常量 | 相对路径、桶文件再导出、默认导出 | tsconfig paths 别名暂不支持 |
| TSX | 同上 | 同上 | 独立 tsx 语法 |
| JavaScript | 同上 | ESM + `require()` | |
| C# | 类/方法/构造/局部函数（Unity 支持） | using 别名 | Unity/.NET 类名效应表（Debug/PlayerPrefs/File/GameObject 等）；隐式 this（类内裸名=方法）；中文标识符部分文件解析失败 → 方向安全 UNKNOWN |

新语言 = 实现一个 `LangPack`（数据表 + 两个行为函数），核心引擎零改动。

## AI 标注闭环

工具不内置 LLM（零密钥、零网络）。闭环三环：

1. **导出**：`--unknowns out.json` 按**UNKNOWN 影响面**排序（反向可达闭包内 UNKNOWN chunk 数，总影响面作平手——解除未知优先）的未知符号清单——每条含 `id`（内容寻址锚点，可与可选 `file` 字段组合成 `file\0id` 实例锚定）、`symbol`、`file/line`、`influence`（反向可达闭包内 chunk 数）、`unknownSites`（需全部确证的调用点数）、`calls`（站点明细）、`shape`（代表性形态 `方法名·根类别`）、`prior`（语料先验建议 `{pPure, n}`，证据不足为 null）与 `batchable`（形态证据足够时的人工批量分组提示）、`suggested_prompt`；只含自身触发未知的源符号。
2. **回读**：`--annotations ann.json`（`[{id, verdict:"PURE"|"IMPURE"}]`，按 chunk.id 匹配；可选 `file` 字段做 `(file, id)` 实例锚定，防同内容跨文件误放行）——PURE 移除该 chunk 自身的 `?`（下游随之翻案），IMPURE 加直接 io 效应。`--corpus`（默认 `.codeaudit/corpus.json`）把标注结果**幂等累积**为语料（方法名 × 接收者根类别的纯/不纯计数），随后 `suggested_prompt` 携带语料先验提示（「形态历史 ≈8 成被标 PURE（n=37）」——建议置信度，非纯度判定，以函数体为准）。
3. **预算**：CLI 输出**标注曲线**（按影响面贪心序的精确剩余 UNKNOWN）——「标 0 条→428 (53.6%) | 标 102 条→306 | 标 204 条→204 (25.6%) | 标 408 条→0」，直接回答「标多少个到 X%」。

## 已知限制（有意为之）

- **动态分派不追踪**：`obj.method()` 中 `obj` 是局部变量时，边不可知——记为 `?`（未知），audit 模式下降级为 UNKNOWN，不伪造边（诚实承认看不见）；不可拍平的调用形态（`super().m()`、`factory()()`、`d[k]()`）同样记 `?`。
- **状态写与读方传播（2026-08-11）**：`self.x =`/`this.x =`/Python `global`/`nonlocal`/外部对象属性写（`user.status = …`）→ `state` 效应（函数只改实例/全局状态不再判 PURE）；`verdict.stateDeps` 输出读方耦合（谁读了被项目内其他 chunk 写的位置）——纯元数据不进判定（公理3：读不是副作用）。残余：项目外写者（测试夹具/框架注入）不可见 → 漏报；写侧盲区（下标写 `d[k]=`、调用结果写 `f().x=`）不检测；`self.x` 无类限定（跨类同名超近似）。
- **强制转换内建的协议残余**：`len(x)`/`str(x)`/`int(x)` 等判纯，但 x 是用户对象时会分派 `__len__`/`__str__`/`__int__`（可带 io）——接受为有意范围（移除则 unknown-rate 爆炸）；`hash/repr/format/getattr/setattr/iter/next/vars/dir` 已移出判未知。
- **混合模块非 impure 成员 → UNKNOWN**：拆表 schema 的成员表只列 io 成员 + `:p` 显式纯标记（已实现 json.dumps/crypto.createHash 等）；未标记成员（如 `time.strftime`）仍落 UNKNOWN——方向安全（假未知非假纯），继续标记按需扩展。
- **Python lambda 归属**：赋值 RHS 的 lambda 提为命名 chunk（`handler = lambda: io` → handler 独立判定，module 不误报）；实参 lambda（`map(lambda: …)`）体调用归外层——模块级执行路径正确判 io。残余：实参 lambda 的体 io 无独立判定单元（方向安全）。
- **第三方库无源码递归**：npm 包内部不展开，靠效应表 + AI 标注覆盖。
- **链长语义**：SCC 内部视为同一距离（环上所有节点同 chain）。
- **Python 超深缩进**：tree-sitter-python 缩进栈上限约 62 层；更深的文件降级为 parseError 占位，不影响其余文件。

## 测试

300 个测试，五层验证（32 维交叉审计见 [AUDIT.md](AUDIT.md)，另有数学层回归组）：

- **单元**：tarjan 环/自环/逆拓扑契约/5 万深链；analyze 种子传播/环终止/区间/字典序；hash 稳定性。
- **多语言 E2E**：pyshop（Python 传染链 + 跨文件环 + 未知库）、tsapp（桶文件再导出 + this 方法 + console 效应）、jsapp（CommonJS require）。
- **边界 E2E**：空目录、语法损毁文件、重复 chunk、包内相对导入、默认导出、再导出环、TSX。
- **合成大库 E2E**：300 文件 / 2400+ chunks / 含环，冷扫约 1.3s，两次扫描分析负载逐字节一致（确定性；`stats.cachedFiles` 为缓存状态指示器例外）。
- **32 维交叉审计**：随机图性质对照朴素参考实现、对抗性输入（畸形/极端/遮蔽/千结环）、四语言特性矩阵、缓存与 CLI 鲁棒性、输出契约（45 个用例）。
