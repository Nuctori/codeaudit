# 迭代 23 impl-state：--state 状态耦合图（D-127）

> 实现节点 A（run-msp5r0bf）：按 docs/iter23/state-design.md 规格，纯新增 + CLI 接线。
> 基线 HEAD b0f1006（247/247）→ 完成后 255/255（+8：unit/state 5 + audit/state 2 + 迭代22 已有 robustness 1 未动）。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/core/state.ts` | +`StateCouplingEntry` 接口 + `stateCouplingOf(verdicts)`（纯新增 ~70 行；import 加 `Verdict`）——反查 verdict.stateDeps（不重复调 stateDepsOf，避免双真值源） |
| `src/cli.ts` | +`state` 字段（CliArgs:22-23）、parseArgs `--state`（:56）、printHelp 一行（:87）、json `payload3`（:290-295 additive）、text 输出块（:327-351） |
| `test/unit/state.test.ts` | 新文件 T1（5 用例：多读者计数/readerKeys 字典序、两写者同位置、自写自读不虚增、空图、排序、⊤ 暴露） |
| `test/audit/state.test.ts` | 新文件 T2（2 用例：json 顶层 stateCoupling 形状/排序/additive 隔离 + text 模式输出） |
| `README.md` | 测试数 247→255（两处）、--state 示例行（:32） |

**未改**：extractor.ts / analyze.ts / types.ts / risk.ts / index.ts / stateDepsOf（规格 §7 明确不做——数据已够）。

## 关键裁决

1. **反查 vs 独立构建**：反查 verdict.stateDeps（analyze 已算并 stamp），零重复传播、无双真值源。
2. **零读者写方不输出**：耦合图语义 = 有传播的写方（规格 §6.3 空图 ↔ 全无读者一致）；全图无读者 → 空数组。
3. **⊤ 降级暴露**：writes 含 ⊤ 的写方正常输出；text 尾部追加注记行；json 原样（规格 §6.1）。
4. **截断**：text top N（args.top ?? 15）+ 超限注记；json 全量（--sources 同款先例）。

## --state 输出样例（text）

```
状态耦合（写方按读者数降序；top 15）：
    2 读者  Store.write                          self.v                       a.py:3  ← 示例读者 a.py:6（等 2 个）
```

## 测试

- tsc 0 错误；全量 255/255（26 文件）；README 门禁 OK 255。
- T1 fixture 直接构造 Verdict（risk.test.ts 同款构造器模式）。
- T2 用真实 scanProject + dist/cli.js execFileSync（sources.test.ts 同款链路）。

## 残余风险

- stateDeps 盲区（下标写 d[k]= / 调用结果写 / 项目外写者）→ 耦合图是**下界**，README 已知限制已文档化（规格 §8）。
- 位置被多写者写 → 读者重复计入各写者 entry（按写者列读者的自然语义，规格 §8）。
- ⊤ 同名异对象过近似 → 仅影响耦合元数据可见性，不进判定（公理3）。
