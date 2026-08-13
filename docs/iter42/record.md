# 迭代42 记录（record）

> 议题：工程妥协的形式化解决——与范畴论数学家（formula-convergence）+ Jeff Dean（reviewer）双评审后落地。
> 流程：00-plan → 01-math-review → 02-jeff-review → 03-synthesis → 实施 → 验证。

## 评审核心发现（超出原 plan）

1. **新活假纯洞（候选7，双评审独立实证）**：静态成员访问路径（`C.Get()`/`C.X`）不含 class chunk 边 → 类型加载（静态初始化器）io 漏报——`P.Get()` 判 PURE 而运行时执行 `File.ReadAllText`（S1 现实违反）。B14 分类内部不一致。
2. **B4/M1 现状已意外闭合（数学评审 F2）**：`+=` 是 state 写（订阅方恒非 PURE）+ 触发端全落 `?`（诚实）→「假纯可能」不可实例化，方向分类改标为「安全-未知 ∪ 安全-过近似」。事件订阅 = 精度特性非健全性修复。
3. **候选 2「行为零变化」过度声称**：effects 可证不变，chain 至多 +1（模型准确），标注 id 迁移需发布动作。
4. **候选 5（效应细分）零判定影响**：Λ 不变 → 无消费者区分 = 死数据（边界原则否决）。
5. **候选 6（Σ_ext）无挂接点**：与现状行为等价，纯文档化。

## 实施（按合成裁决）

| 变更 | 文件 | 内容 |
| --- | --- | --- |
| 候选7 类型加载闭合 | link.ts 全局类分支 | `ancestorClosureOf(call.obj)` 闭包内 class chunk 原始调用并集（与 L5 同构）；`any | | loadEdges > 0` return；纯静态工具类零变化 |
| 候选3 enum | csharp.ts | enum_declaration 入 chunkNodes + classNodes 双表（数学评审 §3 修正：只加 classNodes 不产 chunk） |
| 文档修正 | technical-debt.md | B4/M1 方向改标、B14 双路径、M7 已修、迭代42 清空段、头部基线 |
| 文档同步 | README/CHANGELOG | 测试数 343→355 两处（C4 门禁绿）；迭代 41 + 42 CHANGELOG 条目 |
| 回归测试 | csharp-lang.test.ts | +3 it：enum 判纯 / 候选7 三态（io→IMPURE、裸名→UNKNOWN、对照→PURE）/ 对照零变化 |

## 验证

- `npx vitest run`：**355/355 passed（32 files）**（基线 352 → +3 全绿，零回归；含 fixture.test.ts:92 Wire purity=2 原样保持）
- `npx tsc --noEmit`：exit 0
- `node examples/essence.mjs`：8/8
- `node scripts/check-readme-tests.cjs`：OK 355（README 漂移 343/337 同步闭合）
- 自扫描：invariantViolations=0 / staleEdges=0

## 残余（诚实）

- 候选1 事件订阅（iter43-r1）：修正版设计已锁定（private 可见性守卫 + 订阅/触发形态守卫 + `+=` 双语义保留）；工程评审 P2 实证：C# lambda 在订阅位不是 chunk（lambdaNodes/lambdaAssignNodes 未填）——若实现须显式分类「订阅集合不完整 → 触发端 ?」
- 候选2 static-init 独立 chunk（iter43-r2）：side table 方案（staticInitChunks 映射，非合成 chunk——避免 bySimple/byQualified 索引污染）；标注 id 迁移作发布动作
- 嵌套 enum 仍 `?`（globalClasses 裸名索引）；跨文件 enum 未测
- 迭代 41 dirty 工作树未提交（validatePackConsistency/阴影守卫/M5/M6）——与本迭代改动同批待提交

## 决策链

见 decision chain（D-0xx：iter42 三果裁决——候选 7/3 do-now、1/2 延后、4/5/6 defer）。
