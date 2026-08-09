# codeaudit

跨语言代码纯度审计工具：把代码库解析为 chunk 调用图，在 SCC 凝聚后的 DAG 上传播"效应传染链"，按字典序输出治理优先级。

**它不告诉你"代码有多差"，它告诉你"副作用藏得多深、先治理哪里"。**

## 设计公理

工具的全部正确性归结为五条可检验的不变式：

1. **边的守恒**：每个调用点恰好归属一个 chunk（含文件级伪 chunk `<module>`）。
2. **先凝聚，后计算**：一切传播都在 Tarjan SCC 凝聚后的 DAG 上进行。终止性由构造保证——相互递归、回调环不会让分析发散。
3. **纯度三值，未知不猜**：`PURE / UNKNOWN / IMPURE`。未解析符号标记 `UNKNOWN`，`audit` 模式将其视为不纯（可靠、不漏报），`dev` 模式视为纯（低噪音）。两遍结果之差即"链长区间"，区间非零的 chunk 占比即 **unknown-rate**——工具自我报告的"无知程度"。
4. **身份即内容**：`chunk.id = hash(规范化源码)`。函数搬家、改注释、调缩进，id 不变；AI 标注与缓存按 id 寻址，不漂移。
5. **排序不混合量纲**：输出排序只用字典序（纯度 → 链长 → 嵌套），不存在拍脑袋的加权求和。

## 安装与使用

```bash
npm install
npm run build        # node node_modules/typescript/bin/tsc
npm test             # 73 个测试：单元 + 多语言 E2E + 合成大库 + 自扫描 + 32 维交叉审计

# 扫描
node dist/cli.js scan ./src
node dist/cli.js scan ./src --format json
node dist/cli.js scan ./src --top 20
node dist/cli.js scan ./src --unknowns unknowns.json   # 导出未知符号供 AI 标注
node dist/cli.js scan ./src --strict                   # 存在 IMPURE 时退出码 1（CI 门禁）
```

编程式 API：

```ts
import { scanProject } from "codeaudit";

const report = await scanProject("./src", { useCache: true });
for (const v of report.verdicts) {
  if (v.purity !== 0) console.log(v.chunk.name, v.chain, v.effects);
}
```

## 输出解读

```
codeaudit 0.1.0 — 20 chunks, 7 files, unknown-rate 5.0%, cycles 1

IMPURE
  chain=   4  {io}       handle_request               api.py:5
  chain=   3  {io}       batch_create                 service.py:13
  ...
UNKNOWN (audit 假设为不纯)
  chain=   0?  {?}        engage                       worker.py:5
```

- **chain = 0**：直接效应源（调了 `sqlite3`、`fs.writeFileSync`、`console.log`……）。
- **chain = N**：距离最近的效应源隔了 N 层调用。数值越大，副作用越隐蔽、越难 mock、重构越危险——排序越靠前。
- **chain 带 `?`**：结论依赖未解析符号（audit 悲观值），标注后可能翻案。
- **effects**：传播后的真实效应集；`{?}` 表示只有未知来源。

## 架构

```
src/
  core/
    types.ts      Chunk / Verdict / Purity —— 公理的载体
    tarjan.ts     迭代式 Tarjan SCC（50k 深链不爆栈），逆拓扑序输出
    analyze.ts    唯一的分析函数：凝聚 DAG 上的效应并集 + 最短链，audit/dev 双跑
    hash.ts       规范化 + 内容寻址（公理4）
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
| Python | 函数/类/方法 | 绝对/相对导入、星号导入回退 | `global`/`nonlocal` 状态写暂未建模 |
| TypeScript | 函数/方法/类/箭头函数常量 | 相对路径、桶文件再导出、默认导出 | tsconfig paths 别名暂不支持 |
| TSX | 同上 | 同上 | 独立 tsx 语法 |
| JavaScript | 同上 | ESM + `require()` | |

新语言 = 实现一个 `LangPack`（数据表 + 两个行为函数），核心引擎零改动。

## AI 标注闭环

工具不内置 LLM（零密钥、零网络）。`--unknowns out.json` 导出带 `suggested_prompt` 的未知符号清单，批量喂给任意 AI 后人工确认，回填到你的知识库；后续扫描未知率下降、链长区间收窄。

## 已知限制（有意为之）

- **动态分派不追踪**：`obj.method()` 中 `obj` 是局部变量时，边不可知——记为 `?`（未知），audit 模式下降级为 UNKNOWN，不伪造边（诚实承认看不见）；不可拍平的调用形态（`super().m()`、`factory()()`、`d[k]()`）同样记 `?`。
- **实例状态写未建模**：`self.x = ...` 暂不产生效应；Python 的 `global`/`nonlocal` 在同版本亦未开启。
- **第三方库无源码递归**：npm 包内部不展开，靠效应表 + AI 标注覆盖。
- **链长语义**：SCC 内部视为同一距离（环上所有节点同 chain）。
- **Python 超深缩进**：tree-sitter-python 缩进栈上限约 62 层；更深的文件降级为 parseError 占位，不影响其余文件。

## 测试

73 个测试，五层验证（32 维交叉审计见 [AUDIT.md](AUDIT.md)）：

- **单元**：tarjan 环/自环/逆拓扑契约/5 万深链；analyze 种子传播/环终止/区间/字典序；hash 稳定性。
- **多语言 E2E**：pyshop（Python 传染链 + 跨文件环 + 未知库）、tsapp（桶文件再导出 + this 方法 + console 效应）、jsapp（CommonJS require）。
- **边界 E2E**：空目录、语法损毁文件、重复 chunk、包内相对导入、默认导出、再导出环、TSX。
- **合成大库 E2E**：300 文件 / 2400+ chunks / 含环，冷扫约 1.3s，两次扫描结果逐字节一致（确定性）。
- **32 维交叉审计**：随机图性质对照朴素参考实现、对抗性输入（畸形/极端/遮蔽/千结环）、四语言特性矩阵、缓存与 CLI 鲁棒性、输出契约（45 个用例）。
