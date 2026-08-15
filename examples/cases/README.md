# 真实项目用例矩阵

用真实开源项目验证 codeaudit 的语言支持充分性——「真实项目驱动语言支持」是迭代 19（C#/InitDeity）确立的模式：合成 fixture 只能覆盖语法形态，真实项目暴露效应表盲区、解析边界与性能量级。

## 矩阵

| 用例 | 语言 | 扫描规模 | chunks | unknown-rate | parse-errors | 用时 | 上游 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [opencode](opencode/) | TS/TSX | 3257 文件（32 包 monorepo） | 18490 | 65.3% | 28（0.86%） | ~34s | anomalyco/opencode（MIT） |
| [express](express/) | JS | 50 文件（产品代码） | 113 | 28.3% | 0 | ~2s | expressjs/express（MIT） |
| [hugo](hugo/) | Go | 521 文件（纯 Go） | 5981 | 72.5% | 0 | ~5s | gohugoio/hugo（Apache-2.0） |
| [flask](flask/) | Python | 24 文件 | 466 | 52.1% | 0 | ~1s | pallets/flask（BSD-3） |
| [ocelot](ocelot/) | C# | 378 文件 | 2369 | 26.2% | 8（2.1%） | ~1s | ThreeMammals/Ocelot（MIT） |

每个用例的产物（入 git，合计 <250KB/用例）：`report.txt`（全视图文本快照）、`report.html`（自包含技术债报告）、`manifest.json`（repo/pinned ref/统计/扫描时间）。完整 JSON（可达 68MB）不入库，本地生成：`node dist/cli.js scan <clone> --no-cache --json out.json`。

## 复现

```bash
npm run build
node scripts/fetch-case.cjs            # 全部用例：clone（manifest 记录的 pinned ref）→ 扫描 → 快照
node scripts/fetch-case.cjs hugo       # 单用例
node scripts/fetch-case.cjs --update   # 全部刷新到上游默认分支最新 HEAD
```

- **确定性**：默认用 manifest 的 pinned commit 复现——产物与入库快照逐字节一致（除耗时行）；CI 用 `git diff --exit-code` 检测工具行为漂移。
- **刷新**：`--update` 漂移到上游 HEAD 并更新 manifest 的 ref/stats——先 diff 审阅再提交。
- **prune**：hugo 排除嵌入 JS 资源与 `_test.go`（`go:embed` 静态扫描无需文件存在）；express 排除 mocha 测试。静态扫描不编译，prune 不影响扫描语义。

## 数字解读（诚实呈现）

**unknown-rate 的组成**（方向安全，非缺陷——标注工作流覆盖）：
- **跨包/跨文件边**：opencode 65.3% 与 hugo 72.5% 的主体是**方法调用**（`obj.method()` 动态分派，TS/Python/Go 一致语义）与**第三方库**（npm 包内部不展开，效应表未列成员落 `?`）。
- **hugo 的 Go 盲区**：receiver 方法调用（`s.save()`，Go 无 this）与第三方库（goldmark 等）——Go pack 已知限制，见 `src/lang/packs/go.ts` 文件头。
- express 28.3% 最低（纯 JS 框架，效应表覆盖好）；opencode 28 个 parse-errors 来自极端语法文件（0.86%，方向安全降级）。
- **ocelot 的 8 个 parse-errors = C# 12 集合表达式盲区**（`Routes = []`，tree-sitter-c_sharp.wasm 未支持）——方向安全降级（parseError 标记 → PURE 标注被拒），仅 8 文件受影响，其余 370 文件正常。这是真实项目暴露语法盲区的实例——C# 12 支持是后续迭代项（升级 wasm）。

**真实发现示例**（详见各 report.txt 治理榜）：
- hugo：`CopyDir`（{fs} 文件复制枢纽）、`watcher.New`（{clock}）、`hugofs.NewWalkway`（{fs,io}）——Go 标准库效应表命中驱动的真实治理清单。
- opencode：`spawn`（{fs,io,net,state}，30 调用者，LSP 服务器副作用枢纽）——TS 效应表在真实大型 monorepo 上的判别力。
- 效应表咨询未中数（补表候选）是各用例的副产品：如 opencode TS 表 113972 站点、hugo Go 表见报告尾部——AI 标注闭环的输入。

## 维护

- 工具行为变更（判定/输出/效应表）→ 快照漂移 → CI 失败 → 审阅 diff 后 `--update` 刷新并提交。
- 上游 dev 漂移监控（自动 PR 刷新）未启用——手动 `--update` 即可。
