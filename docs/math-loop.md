# 数学层精度循环日志（自主循环，用户入睡期间执行）

目标：非标注、数学层精度提升，减少 `--unknowns` 标注负担。循环：独立数学家会议 → 共识特性落地 → 实测效果 → 按痛点再开会 → 直到边际效益不再明显。

基线（循环开始前，commit a964576）：

- swagger-ui/src/core：798 chunks，304 PURE / 440 UNKNOWN / 54 IMPURE，unknown-rate 57.5%，421 个 `?` 源（344 个单哨兵）
- egg controller：22 chunks，7/9/6，9 个 UNKNOWN 全来自 ctx.service/ctx.model 框架注入
- 测试：84 tests，81 passed（3 个既有 Windows 路径分隔符失败）

## 迭代 1：会议 #1（4 独立数学家，选题）

- 会议问题：从候选清单 A-G（字面量接收者 / objlit 方法容器 / .then Promise 来源证明 / 模块导出签名 / 返回溯源摘要 / 元素类型域 / 其他）选一个最高价值、健全、~100 行内、非标注的特性
- 会议结论（分歧→综合）：
  - **阻断级发现（图论）**：`influence.ts` 的 I(u) 方向反了——实现是前向闭包（u 的后代），标注语义需反向闭包（u 的调用方）。实证：a 调 b、b 含 `?`，标注 b 释放 a → I(b)=2。`--unknowns` 排序整体错向（top8 全为 inDeg=0 叶子）
  - **活假纯洞（类型论）**：`Array.from(xs, this.log)`——HOF 成员形回调被丢（argFnsOf 只收标识符），UI.build 报 PURE 但 this.log 有 io
  - **选型**：抽象解释/图论选 A（字面量，但实测仅 4 源 0.5pp）；类型论选 D（模块导出面，修 3 个已确认 bug + 默认导入噪音）；概率选 G（纯库表 + from-import 成员，实测 13 源）
  - **综合**：先修两个正确性问题，再落地 D 四件套 + G2 纯库表（D 是唯一同时修 bug、含 G2 机制、为 .then 级联铺路的选项）
- 落地（commit 5a14521）：影响面方向修复（含回归测试 a→b）；HOF 成员形回调（this./self. 前缀解析）；模块导出面解析（from-import 类成员真边、别名再导出跟随、export * as ns 命名空间链、Python 点连模块前缀剥离、assigned 遮蔽守卫防重绑假纯）；G2 纯库表（immutable/reselect/classnames/prop-types）；缓存 v3（顺带修 1fd2d22 的 latent warm/cold 缺口）
- 实测效果（swagger 798 chunks）：
  - UNKNOWN **440→428（−12）**，PURE 304→316，`?` 源 **421→408（−13）**，unknown-rate **57.5%→56.0%**
  - 影响面方向修复后 top 源：`isOAS3`(18)、`Store.getType`(11)——调用方枢纽（修复前是 inDeg=0 叶子）
  - egg controller：7/9/6 不变（框架注入，D 不触——符合会议预测）
  - 新增 8 个回归测试，92/95（3 个既有 Windows 失败）
- 痛点分析（迭代 2 的输入）：剩余 428 UNKNOWN 中，头部源（isOAS3 等）是 ident.*/参数方法调用（类型层已否决，只有标注能救）；egg 9 个 UNKNOWN 全为 ctx.service/ctx.model 框架注入；字面量接收者（A）尚未落地（会议实测仅 4 源）

## 迭代 2：会议 #2

- 会议问题：待填充
- 会议结论：待填充
- 落地：待填充
- 实测效果：待填充
