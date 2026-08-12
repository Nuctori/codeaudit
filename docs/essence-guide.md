# essence 导读：30 分钟看懂 codeaudit

> `examples/essence.mjs`（90 行）是整个项目的蒸馏副本。本导读回答三个问题：
> 唯一分析函数在哪 / 两个结构 trick 是什么 / 被砍项回原文件的映射表。

## 一、项目五层结构

```text
┌─ 完整项目 src/（~9500 行）─────────────────────────────────────────┐
│                                                                     │
│  ① 提取层  lang/packs/*     源码 → chunk/调用/直接效应    【数据】    │
│  ② 链接层  engine/link.ts   目标解析 → 边 / "?"           【数据】    │
│  ③ 算法层  core/analyze.ts  凝聚DAG扫描 + audit/dev 双跑  【算法】◄───┐
│  ④ 派生层  influence/risk/  同一批 verdicts 的不同读法    【派生】    │
│     proof/corpus/topology                                         │
│  ⑤ 管道层  scan.ts + cli.ts 增量缓存 / 输出 / 门禁         【工程】    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
                     │ 提炼 = 只取 ③，其余不进副本
                     ▼
┌─ examples/essence.mjs（90 行，新增文件，src/ 零改动）────────────────┐
│                                                                     │
│  tarjan    递归版        ← 迭代版留在⑤（防 5 万深链爆栈，工程细节）   │
│  runOnce   一次扫描      = ③ 本体（去掉异常传播 / chainPath 重构）    │
│  analyze   双跑成区间    = ③ 的出口（真值 ∈ [audit, dev]）           │
│  测试      8 断言        = 行为契约（传染/环/未知/排序）              │
│  示例      handle_request→batch_create→sqlite3                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 二、唯一分析函数

`core/analyze.ts` 的 `runOnce`——全项目只有一个分析函数，其余都是它的输入（①）或输出（④）。

```js
// essence 第 2 节 = runOnce 本体（约 40 行）
function runOnce(chunks, audit) {
  // 1. 建图：chunk key → 直接效应 / 调用边
  // 2. tarjan 凝聚 SCC → DAG（逆拓扑序：callee 分量下标更小）
  // 3. 单趟扫描：效应并集 + 最短链
  //    audit=true 时 "?" 构成效应源（公理3 悲观）
}
```

## 三、两个结构 trick

1. **先凝聚后计算**（公理2）：Tarjan SCC 把调用环压成单点，DAG 上单趟即不动点——
   终止性由构造保证，相互递归不会让分析发散。`tarjan.ts` 的迭代版防 50k 深链爆栈。
2. **双跑成区间**（公理3）：audit（悲观，`?` 当效应源）与 dev（乐观，`?` 当纯）各跑一遍——
   真值 ∈ [audit 链, dev 链]；两遍一致 ⟹ `chainCertain`（可下结论），不一致 ⟹ 需要标注。

## 四、被砍项 → 原文件映射表

| 蒸馏副本砍掉的 | 在原项目的位置 | 为什么砍 |
| --- | --- | --- |
| 异常传播（catch 减法 / throws 保守传播） | `core/analyze.ts` | 元数据级，不影响纯度判定 |
| chainPath（源分量路径重构） | `core/analyze.ts` | 可解释性需求，非算法本体 |
| 状态耦合（stateDeps） | `core/state.ts` | 图调用边外的耦合通道（元数据） |
| 增量缓存（内容哈希） | `engine/scan.ts` | 工程加固（⑤） |
| 迭代 Tarjan（栈安全） | `core/tarjan.ts` | 防 5 万深链爆栈（⑤） |
| 影响面 / 回归风险 / 证明完整度 | `core/influence.ts` / `risk.ts` / `proof.ts` | verdicts 的不同读法（④） |
| 符号解析（self/import/效应表/类成员） | `engine/link.ts` | 名字解析是行为不是数据（②） |
| 语言数据（节点表/效应表） | `lang/packs/*` | 新语言 = 加一个文件（①） |

## 五、怎么用

```bash
node examples/essence.mjs        # 8 断言 + 工作示例（CI 已接入：算法层变更时同步失败）
```

- **看语义**：读 essence 的 `runOnce` 就懂了项目在算什么
- **看细节**：按映射表回原文件
- **改算法**：改 `core/analyze.ts` 后跑 `node examples/essence.mjs`——断言拦住"灵魂漂移"

## 六、被砍项全部留在原位

竖着看是"项目 = 数据 + 算法 + 管道"；横着看 essence 只带走了算法层。
提炼 ≠ 删功能——原功能一个不少，减的是理解成本（9321 行 → 90 行可读）。
