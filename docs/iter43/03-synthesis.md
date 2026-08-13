# 迭代43 合成（03-synthesis）：评审裁决 → 实施范围

> 流程：00-plan → 01-math-review → 02-jeff-review → 本合成。
> 双评审无 blocker、无分歧（工程 E1-E5 全部复核数学证据）。

## 裁决

| 项 | 裁决 | 轮次 | 规模 |
| --- | --- | --- | --- |
| 候选 B 事件订阅（数学修正版） | **do-now** | iter43-r1（本轮） | ~200-250 行封顶 |
| 候选 C static-init side table + L1 跨语言测试 | do-now | iter43-r2 | ~150-200 + 40-60 行 |
| 候选 A1 真实感 C# 合成大库 | do-later | iter43-r3/iter44 | ~200 行 + 校准（必须在 B/C 后） |
| A2 InitDeity 入库 / --state 输出 | defer | — | license/体积/无消费者 |

## B 轮实施契约（数学修正 1-3 + 工程陷阱 1-4 全部写入）

1. **`+=` 双重语义**：订阅边**不得取代** state 写——extractor 只增订阅提取，不动 augmented_assignment 写判定；fixture.test.ts:92（Wire purity=2）为回归锚。
2. **事件字段初始化器意外 prop 边**：propertyReadSkipParents 加 `event_field_declaration`（1 行）；调用形态初始化器（OnX = Factory()）保留调用边（与方法组引用区分）。
3. **触发形态六类全枚举**：`evt(...)` 裸名 / `evt.Invoke` / `evt?.Invoke` / `this.evt(...)` / `C.evt(...)`（静态）/ `x.evt(...)`（跨实例）。
4. **可见性守卫**：private（含 static）→ 完备集合（语言保证）；非 private → 触发端附加 `?`。
5. **跨实例订阅接收者不可证** → 订阅不可归属 → 「集合不完整」→ **触发端 `?` 传导**（验收必须断言触发端带 `?`）。
6. **lambda / new Action<T>(H) RHS**：显式分类「订阅集合不完整 → 触发端 `?`」（C# lambda 在订阅位非 chunk，P2 实证）。
7. **事件环**：cycles +1~2（Raise↔HandleLevel SCC + HandleQuest 自环），不断言精确 cycles。
8. **事件不可标注**（无 chunk/公理4 id）——scope 声明入 M_out。
9. **新数据表**（P0-3 纪律）：eventFieldNodes 等走 pack 表，引擎零语言常量；EXTRACT_SIDE_TABLES 同步。
10. **partial 类**：v1 只查声明文件 → 集合不完整 → 触发端 `?`（安全）。

## 验收口径（B 轮门禁）

- 测试：private 判别力 / 跨实例传导 `?` / 初始化器双计防回归（+3 it）+ fixture 扩展（Raise 的 chunk.calls 含 HandleLevel key、purity 保持）
- 回归：357/357（Wire purity=2 原样）+ tsc 0 + essence 8/8 + 自扫描 invariantViolations=0 + README 门禁同步
- 不断言精确 cycles / chain 差值（SCC 分量级量）
