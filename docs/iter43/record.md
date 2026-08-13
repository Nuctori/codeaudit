# 迭代43 记录（record）

> 议题：剩余工作三候选（C2 回归网 / 事件订阅 B4/M1 / static-init 精确化）——双评审裁决后落地候选 B。
> 流程：00-plan → 01-math-review → 02-jeff-review → 03-synthesis → 实施 → 验证。

## 评审裁决（双评审无 blocker、无分歧）

| 项 | 裁决 | 轮次 |
| --- | --- | --- |
| B 事件订阅（数学修正版） | do-now | iter43-r1（本轮） |
| C static-init side table + L1 跨语言测试 | do-now | iter43-r2 |
| A1 真实感 C# 合成大库回归网 | do-later | iter43-r3/iter44（必须 B/C 后校准——分布未稳快照落地即红） |
| A2 InitDeity 入库 / --state 输出 | defer | license/体积/无消费者 |

数学评审关键修正：事件初始化器订阅引理成立（构造序早期注册）；`evt(...)` 直接调用无歧义（F4 同命名空间语言保证）；`+=` 双语义 = state ⊕ 订阅边直和；新洞 2 枚（事件不可标注、初始化器 RHS 意外 prop 边）。

## 实施（候选 B，探针驱动）

| 变更 | 文件 | 内容 |
| --- | --- | --- |
| 类事件表 | pack.ts | FileEventInfo（private/handlers/incomplete）+ RawFileFacts.events + LangPack.eventFieldNodes/eventSubscribeOps |
| 事件提取 | extractor.ts | eventsOf：事件声明（variable_declarator 嵌套两层——探针实证）+ 订阅点（assignment_expression + assignment_operator "+="——探针实证非 augmented_assignment）+ 初始化器订阅（equals_value_clause）+ partial/跨实例/非标识符 RHS → incomplete |
| 意外 prop 边修复 | csharp.ts | propertyReadSkipParents 加 event_field_declaration（数学修正 1） |
| 事件通道 | link.ts | FileIndex.events + resolveCall 尾部 fireEvent（裸名 + Invoke 两入口，markUnknown/markDynamic 之前）：handler 展开（resolveClassMember）+ 可见性守卫（非 private → ?）+ 完整性守卫（incomplete → ?） |
| 表白名单 | effectOverride.ts | EXTRACT_SIDE_TABLES 加 eventFieldNodes/eventSubscribeOps（C02 纪律） |
| 测试 | csharp-lang +5 / fixture +1 | private 判别力（Fire PURE）/ 跨实例传导 ? / 初始化器订阅 / public+io 效应归因（IMPURE）/ 守卫防假 PURE；fixture Raise calls 含 HandleLevel key |

## 验证

- `npx vitest run`：**362/362 passed（32 files）**（基线 357 → +5 全绿；含 fixture Wire purity=2 锚原样保持）
- `npx tsc --noEmit`：exit 0；essence 8/8；自扫描 invariantViolations=0 / staleEdges=0
- README 门禁 OK 362（355→362 同步）

## 实施教训

- **探针驱动是必须的**：初版 eventsOf 基于推断（augmented_assignment / 直接 name 字段）全错——C# 实际形态是 assignment_expression + variable_declarator 嵌套两层 + equals_value_clause。AST 探针一次定位。
- 多轮 edit 括号事故（eventsOf 结构 5 次修复）——大块插入用整段重写 + 括号计数验证，避免小步替换。

## 残余（诚实）

- 跨实例触发（x.evt(...)）保持 `?`（接收者类型不可证——数学 §2b 裁决）；`this.evt(...)`/`C.evt(...)` 同族
- 事件本身不可标注（无 chunk → 无公理4 id）——触发方法承载判别力
- UnityEvent（AddListener）不在本轮（模型外派发，M_out 声明）
- static-init（iter43-r2）：6336d78 H1 的 ctor 并集仍 lumped（静态+实例构造器）——精确化排下轮
- A1 回归网排 B/C 后（分布未稳）
