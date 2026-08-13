# 迭代44 合成（03-synthesis）：工具不完备/数据债收口——实施裁决

> 流程：00-plan → 01-math-review → 02-jeff-review → 本合成。双评审无 blocker、无分歧。

## 裁决

| 项 | 裁决 | 规模 |
| --- | --- | --- |
| 候选 1 局部变量 prop 读判纯 | **do-now**：link.ts 分支 2 顶部早期短路（bySimple 之前，防顶层同名假边） | ~4 行 |
| 候选 2 System 枚举判纯 | **do-now**：pureGlobals 加 4 键（StringComparison/TaskStatus/BindingFlags/AttributeTargets）——A 方案，B 否决（无类型系统泛化 = 插件 getter 假纯） | ~6 行 |
| 候选 3 `<unresolved>` 漏网 | **do-now**：flattenCallTarget 加 generic_name（name 子节点）+ alias_qualified_name（剥 global:: 递归内层）分支；前置份额探针（<5% 降级） | ~8 行 |
| 候选 4 top-N 补表 | **本轮数据收集**：top-miss.cjs 脚本出 per-pack top-100 missSlots；条目落地视规模分轮 | 脚本 ~40 行 |
| 候选 5 类型流 | defer 维持（29.7% 设计边界） | — |
| 候选 6 声明位类型绑定 | 探针（grep 声明形态计数） | ~30 行 |
| propertyReadSkipParents 与 grammar 对拍 | 末尾 10 分钟检查（global_keyword 同类死条目排查） | 0 行 |

## 关键实现锚点（评审已锁定）

1. **候选 1 短路点**（link.ts 分支 2 顶部）：

```ts
if (call.obj === null && call.prop && caller.assigned.includes(call.attr)) return;
```
1. **候选 2**：pureGlobals 4 键 + 注释「System 枚举——成员是编译期常量」；键冲突核查已过（无 TaskStatus/BindingFlags/AttributeTargets/StringComparison 既有键）
2. **候选 3**：generic_name → name 子节点；alias_qualified_name → children[1]（跳过 global identifier）递归 flatten

## 验收口径

- 测试 368 → ~372（+1 tmp-field 断言升级 +1 C# 阴影对照 +1 候选 3 回归 +1 候选 2 断言）
- InitDeity 重扫：unknown chunks 7063 → <6900（chunk 级口径）；(null)|global 维持 0；<unresolved> 下降
- 禁止 `expect(true).toBe(true)` 占位
- iter44 若降幅 <1pp 正式评估停止准则（转标注工作流）
