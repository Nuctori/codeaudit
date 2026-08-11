# D-127 状态耦合图 --state：实现规格（scout 产出）

## 1. 现状盘点（写方→读方→影响面已全链路存在，只差输出）

| 环节 | 位置 | 说明 |
|---|---|---|
| 写方提取 | `src/lang/extractor.ts:69-73`（`stateWritePos` 调用） | chunk.stateWrites: string[]（"self.x"/"user.status"/全局名） |
| 读方提取 | `src/lang/extractor.ts:75-79`（`stateReadPos` 调用） | chunk.stateReads: string[]（含 "⊤" 全局读） |
| 传播匹配 | `src/core/state.ts:19-64` `stateDepsOf(chunks)` | 精确/子树/⊤ 三规则；自写自读排除；返回 `Map<readerKey, deps: string[]>`（deps 是**位置**非写者 key） |
| 注入 verdict | `src/core/analyze.ts:159,173` | `stateDeps: stateDeps.get(c.key) ?? []` → `Verdict.stateDeps`（types.ts:79） |
| 消费 | `src/core/risk.ts:217-234` | R_state：改动集视角的读者占比（仅 --changed 路径） |

**结论**：`Verdict.stateDeps` 已含全图读方→写位置映射，`--state` 只需一个纯聚合函数 + cli 输出，零提取层改动。

## 2. 聚合函数：`stateCouplingOf(verdicts)`（放 src/core/state.ts）

**签名**（与 stateDepsOf 同文件，纯函数无副作用）：

```ts
export interface StateCouplingEntry {
  readonly key: string;        // 写方 chunk key
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly writes: readonly string[];   // 写位置列表（chunk.stateWrites 原样，含 "⊤"）
  readonly readers: number;             // 读者数（排序主键，降序）
  readonly readerKeys: readonly string[]; // 读者 chunk key 列表（字典序）
}
export function stateCouplingOf(verdicts: readonly Verdict[]): StateCouplingEntry[]
```

**算法：反查 verdict.stateDeps（复用 analyze 已算结果，不重复调 stateDepsOf）**

1. 写者索引：遍历 `v.chunk.stateWrites.length > 0` 的 chunk，建 `posIndex: Map<position, writerKey[]>` + `writerMeta: Map<writerKey, {name,file,line,writes}>`。
2. 读方反查：对每个 `v.stateDeps` 非空的 verdict，对每个位置 `d`，对 `posIndex.get(d)` 的每个写者 key `wk` → `readersOf.get(wk).add(v.chunk.key)`。
3. 自排除已由 stateDepsOf 保证（stateDeps 内位置必非本 chunk 自写），反查无需再查。
4. 输出排序：`readers` 降序，平手按 key 字典序（公理5）。`readerKeys` 排序后展开。

**复杂度**：O(Σ|stateDeps| × 每位置写者数)——每位置写者通常 1，近线性。无需改 analyze.ts 或 state.ts 既有代码，纯新增函数。

**反查 vs 独立构建的取舍**：独立调用 `stateDepsOf(verdicts.map(v=>v.chunk))` 会重复 O(N) 传播且与 analyze 已 stamp 的 stateDeps 有分叉风险（两处各算一遍 = 双真值源）。反查唯一的代价是"位置→写者"需要写者索引，而 stateDeps 里位置可能被多个写者写（如两个 chunk 都写 `user.status`）——反查天然把读者同时计入两个写者，语义正确。

## 3. CLI 输出形态（参照 --topology / --sources，cli.ts:264-317）

**旗标**：`--state`，加入 `CliArgs`（cli.ts:11-30）布尔字段 + parseArgs（cli.ts:38-68）+ printHelp（cli.ts:71-90，一行：`--state 状态耦合图：写方按读者数排序（json 顶层加 stateCoupling）`）。

**text 模式**（放在 --topology/--sources 同区块，cli.ts:287-317 之后）：

```
状态耦合（写方按读者数降序；top 15）：
    42 读者  setUserStatus        user.status          src/a.py:12  ← 示例路径 a.py:12 → b.py:30
    17 读者  Store.set           self.v               src/b.ts:88
  … 共 8 个写方（--top N 查看更多）
```

每行：读者数（padStart）、写方 name、写位置、`file:line`；"示例路径"= 该写方→首个读者的 `readerKey`（format 为 `file:line`），读者多时以 `…` 收尾。空图（无写方或全无读者）打一行 `状态耦合：无（无项目内写方或读者）`。

**json 模式**（--sources 同款 additive，cli.ts:274-282 之后加第三层 payload）：

```ts
const payload3 = args.state
  ? { ...payload2, stateCoupling: stateCouplingOf(report.verdicts) }
  : payload2;
```

`stateCoupling` = StateCouplingEntry[]（全量不过滤——与 sources json 全量先例一致；消费端自己 slice）。现有 schema 消费者不受影响（additive）。

**导入**：cli.ts 加 `import { stateCouplingOf } from "./core/state"`。

## 4. 与 R_state 的差异（文档化，放规格 + printHelp 语义区分）

| 维度 | R_state（risk.ts:217-234，--changed） | --state（本规格） |
|---|---|---|
| 视角 | 改动集（Δ 是输入） | 全图（无 Δ，结构报告） |
| 输出 | 标量因子 0..1（L×C 的 likelihood 一项） | 写方→读者耦合链清单 |
| 问题 | "改这批文件，读者群体里多少被波及"（broken/readers，排除改动者自身） | "谁写、谁读、哪个写方扩散面最大"（架构热点） |
| 依赖 | changedKeys + writeSet 交集判定 | stateDeps 反查全图 |
| 语义 | 概率/风险 | 元数据/可见性 |

两者共用 stateDeps 数据但互不依赖：R_state 照旧，--state 是纯 additive 输出。

## 5. 测试点（2 个，模式参照现有）

**T1（单元，纯函数）**：`test/unit/state.test.ts`（新文件）——fixture 仿 `test/unit/risk.test.ts:174-177`（writer/reader 构造器）或 `test/audit/lang-features.test.ts:915-928`（scanProject 真实项目，`user.status`/`self.v` 已证可提取）。断言：
- 写方 `setUserStatus`（写 `user.status`）+ 3 读者（stateDeps=["user.status"]）→ entry.readers === 3、readerKeys 含全部、排序首位；
- 两写者同位置（都写 `user.status`）→ 读者同时计入两写者；
- 自写自读 chunk（stateWrites 含 d 且 stateDeps 也含 d——正常 stateDepsOf 已排除，fixture 直接构造空 stateDeps 验证不虚增）；
- 无写方/无读者 → 空数组。

**T2（CLI json schema）**：`test/audit/state.test.ts` 或并入 `test/audit/sources.test.ts` 同款模式（execFileSync node dist/cli.js scan root --no-cache --state --json，仿 sources.test.ts:53-69）。断言：
- 顶层 `stateCoupling` 数组存在；
- 元素形状 `{key,name,file,line,writes,readers,readerKeys}`；
- readers 降序、readerKeys 字典序；
- 不加 --state 时顶层无 stateCoupling（additive 隔离）。
- 需要 `npm run build`（dist/cli.js 先存在；sources.test.ts 已依赖此链路）。

## 6. 边界决策

1. **⊤ 降级条目**：**暴露**，不隐藏（项目一贯"防静默欠报"纪律：README 已知限制 17-18 行已文档化 ⊤ 近似）。位置串 "⊤" 自描述；text 摘要尾部若存在 ⊤ 写方/读者，追加一行注记：`（注：N 条为 ⊤ 降级匹配——近似耦合，见 README 已知限制）`。json 原样含 "⊤"，不加额外字段（最小 diff；调用方已知位置文法）。
2. **截断**：text 只列 top N（`args.top ?? 15`，与 --sources cli.ts:311-316 完全同款），超限打 `… 共 M 个（--top N 查看更多）`。json 全量（先例：sources json 不过滤）。读者数多时 readerKeys 不截断（本就是 key 字符串，量级小）。
3. **空图**：零写方或全无读者 → text 一行说明、json `stateCoupling: []`（不省略字段——schema 稳定优于省字节）。
4. **--top 语义**：--top 只截 text 展示；json 不受影响（与 sources/topology 现有语义一致，cli.ts:266-268 只作用于 verdicts）。

## 7. 需改动文件清单

| 文件 | 改动 |
|---|---|
| `src/core/state.ts` | +`StateCouplingEntry` 接口 + `stateCouplingOf(verdicts)`（纯新增 ~40 行） |
| `src/cli.ts` | +`state` 字段（11-30）、parseArgs（55 附近）、printHelp 一行、text 输出块、json payload3 |
| `test/unit/state.test.ts` | 新文件，T1 |
| `test/audit/state.test.ts`（或并入 sources.test.ts） | T2（需 dist 构建） |
| `docs/iter23/state-design.md` | 本文档落盘（内容即本文件 §2-§6） |

**不做**：不改 extractor.ts / analyze.ts / types.ts / risk.ts / stateDepsOf（数据已够）；不加新依赖；不加缓存（全量图上 O(N) 反查，与 sources 同量级）。

## 8. 残余风险

- stateDeps 的盲区（下标写 `d[k]=`、调用结果写 `f().x=`、项目外写者——state.ts:13-17 文档化）会漏报读者 → 耦合图是**下界**，text 注记可提一句"仅静态可见写者"。
- 反查把"位置被多写者写"的读者计入全部写者——语义正确但读者数会重复计数（读者 A 因 `user.status` 同时挂 2 个写者，两 entry 都算它）。这是"按写者列读者"的自然语义，文档注明即可。
