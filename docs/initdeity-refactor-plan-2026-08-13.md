# InitDeity 详细重构报告（2026-08-13，最终引擎数据）

> 数据源：docs/initdeity-final-analysis-2026-08-13.md（痛点 2 修复后重跑）+ generator-dedup-initdeity.md + 状态耦合/效应源实测。
> 原则：**先机器后人工、先生成器后业务、先高影响后长尾**——重构优先级由最终引擎的真实结构驱动（环/自环/深链/状态面首次完整可见）。

---

## R1（P0）API.g.cs 生成器去重——最大单点杠杆

**证据**：

- 效应源 top 全部是它：`ReadObjectResponseAsync` ×52 调用/份 × 60+ 客户端
- 自环 856 的主体：`ConvertToString` 等 ×47-94 复制
- `ObjectResponseResult` 构造器 94 状态写（全库最高）
- 2503 chunks（全库最大单文件）；IMPURE 967 / UNKNOWN 141

**方案**（docs/generator-dedup-initdeity.md）：抽 `ApiClientBase` 基类（47 个 helper × 60+ 客户端 → 1 份）或组合转发。

**影响面**：自环 856→~100、效应源 top 消除、构造器 94 写→1、unknown -100+、chunks -2000+（扫描与判定面同步收缩）。

**风险**：方法签名/可见性必须保持（项目代码零改动——继承后调用不变）；静态成员需转发。验证 = 重新生成后 codeaudit 重扫（分布核对 + 自环归零）。

**验收**：自环 856→0；`ReadObjectResponseAsync` 效应源 60+→1；unknown -10%；项目编译 + 测试全绿。

---

## R2（P0）外部 SDK 枚举——PlayerCharacterManager 解锁

**证据**：55 chunks 全 parseError（`case EquipmentType.武器:`——外部 SDK 枚举中文成员，16 文件 90 处引用）；未提交重构（27 文件）在其中不可见。

**方案**（无法改 SDK——外部编译单元）：

- 项目内建英文枚举 `EquipSlotType` + 转换函数（SDK EquipmentType ↔ 项目枚举）——90 处引用迁移
- 或包一层访问器（仅 switch 点转换）——迁移面小

**影响面**：55 chunks 恢复可解析（重构获得回归网）；parseErrors 77→22；标注从"只能 IMPURE"变正常裁决。

**风险**：枚举值映射必须逐项核对（武器=0 等）；序列化/配置引用（字符串名）需双份兼容。

**验收**：PlayerCharacterManager parseError 0；未提交重构可审；90 处引用编译通过。

---

## R3（P1）环 83 的初始化/销毁顺序治理

**证据**：机器恢复后首次可见的 83 个 SCC（旧引擎被降级压扁为 3）；深度 22 的传染链。

**方案**：

- 输出环清单（`--topology` + 环内 chunk 枚举）→ 按初始化/销毁依赖排序 → 逐环裁决（真循环依赖 vs 事件回调环）
- 事件订阅环（HandleLevel→Raise→HandleLevel 型）是运行时语义，非重构目标——区分声明

**影响面**：初始化顺序 bug 的高风险区（Unity 场景加载/登录流）。

**风险**：低（只读分析先行）。

**验收**：环清单 + 每环裁决记录（真依赖/事件环分类）。

---

## R4（P1）状态热点治理——重构前必查

**证据**（状态写 top）：

- `ObjectResponseResult` 构造 94 写（随 R1 消除）
- `Player.SetupPlayer` 25 / `SkillEntity.Init` 23（22 字段单例初始化）/ `RuntimeMainlineAutopilot.StartAutopilot` 19 / `QuestProgression` 构造 18

**方案**：重构这些写方前跑 `--state` 查读者面；单例初始化（SkillEntity 22 字段）考虑对象池/不可变配置分离。

**影响面**：任务/技能/主角系统的每次重构都触及这些写方。

**验收**：写方重构前后 `--state` 读者面对比（不应意外扩大）。

---

## R5（P1）RuntimeMainlineAutopilot 分解——最大单文件

**证据**：344 chunks / 98 UNKNOWN / 122 IMPURE——全库最大业务文件；未提交重构（DestroyAutopilotObject 等 EditMode 防御）在其中。

**方案**：按职责拆（决策/UI 操作/状态机/快照）——每个子系统独立文件；分解后判定面独立可审。

**影响面**：自动化主链（E2E 测试 84 行改动）——拆分需测试网同步。

**风险**：中（行为不变性——拆文件不改逻辑，但 partial/内部状态引用需谨慎）。

**验收**：拆分后 chunk 分布合理（无单文件 >100 chunks）；E2E 全绿。

---

## R6（P2）插件层隔离

**证据**：SRF/SRDebugger 的传染链（MiniJSON state 链）、环 83 的插件部分、Behavior Designer 共享变量模式（277+256+168 写）。

**方案**：依赖倒置（行为树不直接操作 GameObject）；插件层升级时评估。

**影响面**：主代码耦合面收敛。

**风险**：低（隔离性重构，行为不变）。

---

## R7（P2）效应表数据债

**证据**：top-100 missSlots 剩余 ~20-30 条（System/UnityEngine/ICommonUI 等）；第三方枚举（DOTween Ease 已修）。

**方案**：top-miss.cjs 数据 → 按「语料频次 + 世界知识」双注记审查 → 入表（B1 合并）；`heritageSkipNodes` 与 `propertyReadSkipParents` 两表漂移风险（iter45 C5/C6 审计项）。

---

## R8 标注运营维护（持续）

- 代码变化 → chunk id 变化 → 标注失效（unmatched 回显揭示）——**重构后重跑标注**（语料先验复用：同形态自动带建议）
- 工具修复 → 标注被机器取代（正向）——语料 seen 双锚定防重复计数
- iter45 正在审计「标注生命周期数学解」（半衰期/先验转移）——落地后运营成本可核算

---

## 顺序矩阵

| 序 | 项 | 依赖 | 收益 | 风险 |
| --- | --- | --- | --- | --- |
| 1 | R1 生成器去重 | 生成器可改 | 最大（自环/效应源/chunks） | 中（签名保持） |
| 2 | R2 SDK 枚举包层 | 无 | 大（55 chunks 解锁） | 中（值映射） |
| 3 | R3 环清单 | R1 后（生成代码环消） | 中（初始化风险） | 低 |
| 4 | R4 状态热点 | 无 | 中（重构安全） | 低 |
| 5 | R5 RMA 分解 | R2 后 | 中（可审性） | 中 |
| 6 | R6/R7 | 低 | 低-中 | 低 |

**第一步推荐**：R1（生成器侧改一次，全库受益）——需要 InitDeity 侧生成器仓库（generate_locust_sdk）配合，工具侧已给方案。
