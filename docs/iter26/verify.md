APPROVED

# 迭代 26 复审（minor 已修复并复验）

> 三项主查全部实证通过（① 声明名抑制精确无误伤、② 容器位置语义合理写读对偶、③ 269/269 全量复跑）；
> 3 个 minor 由主会话修复后复验（无 blocker）。

## minor 修复闭环

| # | 发现 | 处置 |
| --- | --- | --- |
| 1 | T3 类名断言瞄错 chunk（Service 在类 chunk 非方法 chunk，修复前也通过 → 无回归防护） | 断言移到类 chunk `S.cs::Service`（`.not.toContain("Service")`），方法 chunk 保留 `Read` 断言——两者修复前均含裸读，防回归有效 |
| 2 | impl.md/state.ts 声称 `f().x=` 记待办，但 ②b 的 subscriptRoot 兜底已实现（`getObj().x=5` → `"getObj.⊤"` 实证）——文档过时 | state.ts 头注释更新（盲区列表移除 f().x=，注明迭代26 起降级为 f.⊤）；impl.md 残余风险校正 |
| 3 | ②b 局部 subscript 根（`dd[k].x=5` 的 dd 局部）过近似为 `dd.⊤`，impl.md 未明示 | impl.md 明示（有界：仅 ⊤ 键 + 同名根碰撞时假耦合，只影响 stateDeps 元数据不进判定，与读侧对称） |

## 复验

- tsc 0 错误；269/269 全量复跑（26 文件）；README 门禁 OK 269。
- 防回归：T1-T4 git stash 回退实证恰好 4 失败（修复前）；T3 修正后类/方法 chunk 双断言均验证抑制生效。

## 残余（audit 记录，非本轮缺陷）

- 读侧不对称（裸 items[j] 读不映射 self.items，需类型解析）。
- C# variable_declarator 声明名裸读抑制待办（本轮只做 name 字段）。
- InitDeity 数字（+672 写方、951 ⊤ 降级）impl.md 自报，内部一致（T1 回退实证 stateWrites 空即证下标写此前不可见）。
