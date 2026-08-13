# 迭代43 方案：剩余工作三候选（C2 回归网 / 事件订阅 / static-init 精确化）

> 来源：迭代42 评审裁决的延后项 + 台账未偿债。用户要求继续做 + 方案过双评审。
> 基线（实测）：6336d78，357/357（32 文件）+ tsc 0 + essence 8/8 + README 门禁绿 + 工作树干净。
> 流程：00-plan → 01-math-review → 02-jeff-review → 03-synthesis → 实施 → 验证。

## 候选 A：C2 真实项目回归网（台账 2-3h）

**问题**：iter40-42 一串 C# 修复（B5 属性访问器 / 候选7 类型加载 / H1 静态构造器 / M1 成员 miss）只有摘录级 fixture（8 个 InitDeity 摘录文件 + 逐文件断言），无**真实项目整体**防回归网。合成大库（300 文件）是 TS 形态，覆盖不了 C# 分布。

**候选形态**（请评审裁决）：

- A1：**真实感 C# 合成大库**——模拟 Unity 项目结构（MonoBehaviour 组件树 + 静态工具类 + 事件订阅 + 属性访问器 + 字段初始化器 + 多态），固定种子生成，断言**分布快照**（unknown-rate / IMPURE 数 / 特定痛点 chunk 判定）。成本 ~2-3h。优点：无外部依赖、确定性；缺点：非真实代码。
- A2：**InitDeity 完整快照入库**——需要用户提供项目代码（外部依赖，license/体积问题），评审裁决是否可行。
- A3：**维持摘录级 + 扩展**——把 H1/M1/候选7 形态补进现有 fixture（小），承认 C2 不闭环。

## 候选 B：事件订阅建模（iter43-r1，设计已在 iter42 评审锁定）

**设计要点**（iter42/01-math-review.md §1 + 02-jeff-review.md 修正版）：

- 事件声明 = 间接层节点（不独立 chunk）；订阅边（`evt += h`，类内跨方法关联）+ 触发边（`evt.Invoke()` / `evt?.Invoke()` / `evt(...)` 直接调用）
- **private 可见性守卫**：触发端展开 = sub_static(e) ∪ (e 非 private ? {?} : ∅)——非 private 事件触发点附加 `?`（外部订阅不可见，对称诚实）
- **形态守卫**：订阅点形态 5 类（identifier 方法组 / member_access 方法组 / lambda / new Action<T>(H) / 其他 → 订阅集合不完整 → 触发端 `?`）；工程评审 P2 实证：**C# lambda 在订阅位不是 chunk**（lambdaNodes/lambdaAssignNodes 未填）——必须显式处理
- **`+=` 双重语义**：订阅边不得取代 state 写（fixture.test.ts:92 Wire purity=2 是回归锚）
- **事件环**：HandleLevel→Raise→HandleLevel 成 SCC（stats.cycles +1，无精确断言冲突）
- UnityEvent：模型外派发（与 M3 同族），M_out 声明

**验收锚**（iter42 评审已锁定）：EventSubscribe fixture 断言扩展（Raise 的 chunk.calls 含 HandleLevel key、purity 保持）+ in-memory private 事件判别力用例。

## 候选 C：static-init 独立 chunk 精确化（iter43-r2，side table 方案）

**问题**：6336d78 的 H1 是 lumped 版——类型加载闭包并集**全部** ctor chunk（静态 + 实例构造器），实例构造器并入是 S2 过近似（静态访问不执行实例构造器）。

**方案**（iter42 工程评审 §1 候选 2 + 陷阱 5）：

- **side table 优于合成 chunk**：`staticInitChunks: Record<class, chunkKey>`（RawFileFacts 新字段，同 virtualMembers 先例）——合成 chunk 会污染 bySimple/byQualified 索引
- 提取：static 修饰符检测（field_declaration modifier === "static" 的初始化器调用 + constructor_declaration modifier 含 static）→ 归入 static-init 单元
- link 消费点改指：候选7 闭包（6336d78 位置）+ L5 new C() 闭包——从"全部 ctor chunk 并集"精确为"仅 static-init"
- **标注 id 迁移**：class chunk normText 变化 → id 变化 → 标注/语料重扫作发布动作
- 行为变化（工程评审 P4 实证）：class chunk 裸名 `?` 消失 → new C() 从 UNKNOWN 翻确定判定（判别力收益，分布变化需核对）

## 评审问题

1. 范围裁决：本轮做哪几个？（A1+B 同轮 ~300 行是否超规模？C 是否独立轮？）
2. 候选 A 形态裁决（A1/A2/A3）——分布快照断言的可靠性（确定性、敏感性：修复引入应红、无关改动应绿）？
3. 候选 B 设计复核：iter42 修正版是否有新洞？（订阅集合完备性引理、`evt(...)` 直接调用形态、事件字段初始化器订阅 `public event Action OnX = HandleX;`）
4. 候选 C：side table 与 6336d78 H1 的衔接（lumped → 精确的迁移路径）；static-init 单元是否只含 static 初始化器调用还是含静态字段初始化器+静态构造器体合并？
5. 是否有第 4 个候选被漏掉（如跨语言静态访问路径测试——reviewer L1）？
