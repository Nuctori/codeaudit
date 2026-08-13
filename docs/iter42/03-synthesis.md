# 迭代42 合成（03-synthesis）：评审裁决 → 实施范围

> 流程：00-plan → 01-math-review（formula-convergence）→ 02-jeff-review（reviewer）→ 本合成。
> 两份评审互相印证 + 独立实证，无分歧遗留（唯一分歧：lambda 订阅形态——工程评审 P2 实证推翻数学假设，采纳工程侧）。

## 核心发现（评审价值 > 原 plan）

1. **新活假纯洞（候选 7，P1 实证）**：`C.Get()` / `C.X` 静态访问路径不含 class chunk 边 → 类型加载（静态初始化器）io 漏报。探针：`Use() { P.Get(); }` PURE=0 而运行时执行 `File.ReadAllText`——**S1 现实违反**。B14 分类内部不一致（new C() 路径过近似、静态访问路径漏报）。
2. **B4/M1 现状已意外闭合**（F2）：`+=` 是 state 写（订阅方恒非 PURE）、触发端全落 `?`（诚实）——真实残余是判别力损失非假纯，方向分类应改标。事件订阅 = 精度特性非健全性修复。
3. **候选 2 的「行为零变化」是过度声称**：effects 可证不变，chain 至多 +1，标注 id 迁移需发布动作。

## 实施范围裁决

| 项 | 裁决 | 规模 |
| --- | --- | --- |
| 候选 7 静态访问类型加载闭合（最小版） | **本轮 DO-NOW** | ~60 行 + 1-2 it |
| 候选 3 enum 判纯 | **本轮 DO-NOW** | ~30 行 + 1 it |
| technical-debt.md 分类修正（B14 双路径 / M7 已修 / M1 措辞） | **本轮 DO-NOW** | ~15 行 |
| README 测试数同步 + 全量回归 | **本轮收尾** | 门禁绿 |
| 候选 1 事件订阅（修正版：可见性守卫 + 形态守卫 + `+=` 双语义） | iter43-r1 | ~200-250 行 |
| 候选 2 static-init 独立 chunk（side table，非合成 chunk） | iter43-r2/iter44 | ~150-200 行 |
| 候选 4 接口清单 / 5 效应细分 / 6 Σ_ext | defer | — |

**顺序原则**：先闭活洞（7）→ 再判别力（3）→ 再特性（1）→ 再粒度（2）。

## 本轮验收口径（工程评审 §4）

- 新增 ≤3 个 it（in-memory csharp-lang.test.ts，不动 fixture）：
  - enum 读取 → PURE=0（修复前 UNKNOWN）
  - 候选 7 三态：表解析 io → IMPURE=2 fs；裸名调用 → UNKNOWN=1；无初始化器对照 → PURE=0
- 全量 352/352（含 fixture.test.ts:92 Wire purity=2 原样保持）+ tsc 0 + 自扫描 invariantViolations=0 + essence 8/8
- README 测试数同步（C4 门禁绿）
- technical-debt.md：B14 双路径改标、M7 移出 M_out、M1 触发条件措辞补全
