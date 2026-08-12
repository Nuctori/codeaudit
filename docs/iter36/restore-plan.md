# InitDeity 重构 × codeaudit 生产就绪化 工作流规划（迭代 36）

> 目标：通过持续重构真实项目 InitDeity（弱联网/Basebase 环境），推进 codeaudit 生产就绪化；
> 同时恢复游戏主流程（用户路径基础测试驱动），治理测试性能失控债务。
> 原则：真实重构驱动工具进化（非纸上谈兵）；测试金字塔重建先行（否则 E2E 永远失控）；
> 每步可验证（用户路径测试 + 结构化证据 + 独立审计）。

---

## 0. 环境基线（已勘察）

| 项 | 状态 | 待办 |
| --- | --- | --- |
| Unity | 2022.3.62f3c1 在 C:/Program Files/Unity Hub/Editor/ | **FindUnityEditor.ps1 版本写死 62f2 不匹配**——需修 |
| Basebase | 预构建 dll 可跑，healthz OK，SQLite 就绪 | 构建失败（VS18 NuGet 路径缺失）——用预构建 + 记录构建修复待办 |
| FullFlow-Core | 可列能力清单（27 capability） | backend 验证因 dotnet build 失败——需跳过 build 直接用预构建 |
| codeaudit | 304/304 测试，v0.3.1 | InitDeity 最新扫描基线待刷新 |
| InitDeity 测试 | 189 文件 37045 行——**金字塔倒置** | 见阶段 1 |

## 1. 工作流阶段（每阶段有验证门 + 产物）

### 阶段 0：环境修复 + 基线（0.5-1 天）

- **修 Unity 版本不匹配**：FindUnityEditor.ps1 `62f2` → `62f3c1`（测试跑不起来的根因之一）
- **Basebase 运行路径**：跳过 dotnet build（VS NuGet 坏），直接用预构建 dll 起服；记录构建修复为独立待办
- **跑 FullFlow-Core 全量**：记录当前 capability 红绿基线（含 Unity 子集）
- **codeaudit InitDeity 扫描基线**：当前 unknown 4563（22.6%）作为重构前的对照
- **验证门**：healthz OK + FullFlow-Core 报告可生成 + codeaudit 扫描完成

### 阶段 1：测试债务治理（2-3 天）——最大杠杆

目标：测试金字塔重建，E2E 成本可控，codeaudit 借此暴露工具盲区。

- **1a. 巨型文件拆分**：RuntimeMainlineAutopilotRuntimeTests（4864 行/216 方法）按领域拆（Quest 判定/交互决策/状态管理）；StarterMainlineFlowTests（4407 行）按主线段拆
- **1b. 单元层下沉**：识别无 Unity 依赖的纯逻辑（Quest 判定/autopilot 决策纯函数——53 处直接调生产 API 中可静态测试的）→ 下沉为 codeaudit 可分析的独立单元测试
- **1c. E2E 精简**：只保留关键用户路径（每个 quest 一个真实路径），重复驱动方法（EnsureStarterMainlineAtQuest9 等 7 个）去重
- **1d. codeaudit 工具验证**：拆分/下沉过程暴露的盲区（如巨型文件重复逻辑检测）→ 记录为 codeaudit 改进候选
- **验证门**：单元测试层建立（>N 个纯逻辑用例）+ E2E 文件瘦身（巨型文件 <2000 行）+ 全量测试通过 + codeaudit 无新回归

### 阶段 2：主流程恢复（3-5 天）——用户路径驱动

主线顺序（历史已验证）：quest 6 沿指引 → 7 撞罐 → 8 恢复修为 → 9008 拾剑 → 9 沿指引 → 10 灭魔物。

- **2a. 每 quest 一循环**：codeaudit 分析（效应/耦合/盲区）→ 找阻断 → 最小修复 → 用户路径 PlayMode 测试（真实玩家操作序列）→ 结构化证据
- **2b. 已知卡点优先**：
  - quest 6 真门链（初始之地门 + 交互 + 大门_打开——区分 quest 14 BOSS 门口旁路）
  - quest 8 升级门槛（灵气罐 expValue 已 10→20 修复，但需端到端验证）
  - quest 7 撞罐信号宿主绑定
- **2c. 弱联网约束**：所有验证走 Basebase localhost；MQTT/TCP 降级模式确认不阻断
- **验证门**：每个 quest 用户路径测试通过 + 结构化 stage marker + 全量回归

### 阶段 3：codeaudit 生产就绪化（贯穿 + 收尾）

- **3a. 真实重构盲区回流**：每个重构暴露的工具盲区 → 修 codeaudit（如巨型文件检测/测试债务指标/重构收益量化）
- **3b. 复杂度债**：resolveCall cognitive 207 / resolveImport 190 拆分（独立审计已记录）
- **3c. 生产就绪清单**：文档/API 契约/性能（大项目扫描）/发布（v1.0 候选）
- **验证门**：codeaudit 304+ 测试全绿 + InitDeity 重构驱动的新增盲区全部闭环 + 复杂度债下降

## 2. 不偷懒纪律

1. **每步可验证**：不做"我觉得修好了"——必须跑通真实测试/扫描，结构化证据（XML/JSON marker）
2. **独立审计**：每阶段收尾跑独立 reviewer（fresh context）审 codeaudit 改动是否最小化非工程妥协
3. **决策链记录**：关键取舍入 D 链（重构范围/测试策略/盲区修复）
4. **基线对照**：阶段 0 基线 vs 阶段 2 结束的对比（unknown 率/测试成本/主流程通过数）作为收敛证据
5. **弱联网纪律**：不依赖内网/外网——Basebase localhost 是唯一后端；npm/包管理仅本地

## 3. 依赖关系

```
阶段 0（环境基线）→ 阶段 1（测试债治理）
                       ↓
阶段 2（主流程恢复）→ 阶段 3（codeaudit 生产就绪）
     ↑____________重构盲区回流____________↓
```

阶段 1 与阶段 2 有依赖（先治测试债，主流程测试才可信）；阶段 3 贯穿全程（每阶段收尾的盲区回流）。
