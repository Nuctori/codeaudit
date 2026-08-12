# 迭代 33 重构候选 — InitDeity 痛点挖掘 B（scout 只读侦察）

> 本文件为 docs/iter33/refactor-candidates.md 的完整内容。仓库严格只读，未写入任何仓库文件；此文档交付给有写权限方落盘。
> 数据来源：`git status --short`（158 脏文件全量）、codeaudit v0.3.1（D:/node/codeaudit，34848a8）扫描 `Assets`（23799 chunks / 3004 文件，缓存命中）、CODEAUDIT-TECH-DEBT.md。

---

## 0. 口径

- **脏文件集合（158，严格排除）**：73 M / 72 D / 13 ??。72 个 D 全部为 `_mimo_correctness_reports/**` 与 `Assets/InitDeity/Tests/Editor/CombatSafety.meta`（删除，对审计面无影响）；13 个 ?? 含 `.codeaudit/` 缓存、4 个新 Editor 测试（SdkCapabilityDegradationTests / UIEventListenerTests / LocalSkillControllerBindingTests，**未跟踪**——收敛后可能改变脏集合）。
- **非脏判定**：git status 全量清单（/tmp/dirty_paths.txt，158 条）与 codeaudit 输出文件路径逐一 diff；候选文件均单独 `git status --short -- <path>` 复核为空。
- 严格只读：本轮未触碰任何文件。

---

## a) 安全重构候选清单

### 候选 1 ★主推：Automation ForTest 隔离（技术债 P0，生产侧文件当前非脏）

- **文件**（均已确认非脏，`git status --short -- Assets/InitDeity/Framework/Module/Automation/` 为空输出）：
  - `Assets/InitDeity/Framework/Module/Automation/RuntimeMainlineAutopilot.cs`（6300+ 行）
  - `Assets/InitDeity/Framework/Module/Automation/RuntimeCommandBridge.cs`
- **效应源数据**（--sources，均为非脏文件）：`RuntimeCommandBridge.Execute` 30 调用点（全库第 1）；`RuntimeMainlineAutopilot` 11 个方法进入全库效应源 top：TickOnceAsync 22 / ApplyDecision 18 / HasVisibleInteractiveButton 17 / TryClickVisibleInteractiveButton 17 / TryHandleVisibleDrawDoorUi 12 / TryHandleQuest17CraftEquipUi 12 / TryInteract 11 / FindNearestTransportInteractiveForAnchor 8 / TryResumeLoginScene 8 / TryKillResourceAtContact 7 / TryStartSingleNpcBootstrap 7 / TryStartQuest9014TeamLoad 7；`RuntimeMainlineAutopilot.OnEnable` chain 0 且带 `state+io+fs+clock`。`*ForTest` 公共静态钩子分布：ShouldHandleQuest9014TeamLoadForTest、ShouldCloseQuest15DrawDoorAfterRewardForTest、ShouldCloseQuest15EmptyDrawDoorPanelForTest、ShouldCloseStaleDrawDoorPanelForTest、GetQuest12RepairMaterialStatusForTest、GetQuest17IronMaterialStatusForTest、ShouldKillQuest7ResourceAtContactForTest、ShouldKillQuest17IronResourceAtContactForTest、IsStrictPlayerMainlineForTest、ShouldInstallHeadlessQuestCompleterForTest、GetQuest16InteractivePriorityForTest、RuntimeCommandBridge.GetPortForTest / ResolvePortForTest / GetPendingQueueDepthForTest 等约 20 处。
- **改动描述**：将上述 `*ForTest` 公共静态方法整体包 `#if UNITY_EDITOR`（或迁移至 Editor 程序集）；生产路径方法不动。
- **预期效应变化**：RuntimeMainlineAutopilot / RuntimeCommandBridge 的 fs/io/clock 效应源从生产编译面消失；`--sources` 中该模块条目（30+22+18+17+17+…≈150 调用点）应大幅减少/清零；生产构建体积与方法面收缩。
- **风险评级**：**低-中**。低：这些是测试钩子，生产侧调用点预计不存在（落地第一步须先 grep 生产侧引用核实）；中：PlayMode 测试（StarterMainlineFlowTests 等，当前非脏）经 RuntimeBridge 驱动，`#if UNITY_EDITOR` 在编辑器/PlayMode 编译面内不破坏测试；`Tools/*.ps1`（RunAIIteration 等 6 个）当前为脏文件——自动化管线在迭代中，改动前需与管线收敛对齐。
- **验证方式**（可自动化）：codeaudit `--sources` 隔离前后对比（Automation 模块 fs/io 源数下降）+ Tests/Editor、PlayMode 编译/测试通过 + `--changed` 回归风险分析。
- **备注**：技术债报告 P0 行标注"（脏文件等待收敛）"——经核验 **Automation 生产文件当前非脏**，该标注可能指向驱动的测试文件或历史状态；本候选可先行，与报告口径存在出入（已记录为发现）。

### 候选 2：EnemySpawner.SetId 副作用分离（技术债报告四、残余链）

- **文件**：`Assets/InitDeity/Framework/NonModule/Combat/EnemySpawner.cs:180-184`（SetId）——不在 158 清单，已读全文确认非脏。
- **现状**：`SetId` → `this.id = id; RefreshConfig(id);` → `TryResolveConfig` 读 ConfigTable（state）+ `Debugger.LogError`（io），链 2。
- **改动描述**：SetId 改为纯赋值（config 过期标记），配置刷新由 Awake/显式调用持有；或先产出调用方清单再决定拆分粒度。
- **预期效应变化**：SetId 从 chain-2（io+state）降为纯 state/chain-0；ConfigTable 读与 LogError 不再由 setter 隐式触发。
- **风险评级**：**中（暂不满足"低风险"门槛）**——必须预先核对所有 SetId 调用方是否依赖隐式刷新；未做调用方影响面分析前不动手。列为候选，前置任务=调用方核对。
- **验证方式**：codeaudit 改后 SetId 判定变化 + Tests/Editor 全量。

### 候选 3：API.g.cs ConvertToString 自递归（P0 债——仓库侧无落地面，明确记录）

- **文件**：`Assets/ChillyRoomSdkClient/InitDeity/API.g.cs`（gitignore `*.g.cs` → 不在脏清单，但**非 git 跟踪**）。
- **现状**：60+ 客户端类各自复制 ConvertToString 递归（`calls.has(self.key)` 自环），全判 UNKNOWN（迭代 23 后 direct-io 假阳已消除）。
- **结论**：生成物——仓库内改动会被重新生成覆盖；修复点在外部生成器 generate_locust_sdk（本仓库 find 无结果，不在仓库内）→ **本仓库侧无可自动化验证的落地面**。不进迭代 33 任务板；保留为工具验证素材（UNKNOWN 自环形态）。

### 候选 4（排除项）：OnEnable 副作用（P1 债——脏文件，明确排除）

- `PlayerCharacterSprite.OnEnable`（`Assets/InitDeity/Framework/Module/Player/Character/PlayerCharacterSprite.cs`）、`PlayerStShadow.SetUp`（`Assets/InitDeity/Framework/Module/World/Atmosphere/PlayerStShadow.cs`）均在 158 清单内 → 严格排除，待用户收敛后单独处理。

---

## b) 工具盲区候选（重构中发现的工具无法分析的形态）

1. **`--state` 崩溃（本次实测，重要）**：`codeaudit scan Assets --state --format json` → `codeaudit: Invalid string length`，exit 2。同参数 `--sources` 成功（输出 199MB JSON）。根因推测：stateCoupling 全量序列化触发 Node/V8 字符串长度上限。**影响**：迭代 33 无法用 `--state` 复核 transform.position（1100+ 读者）等状态写扩散面——P1 债不可静态复核。建议：`--state` 增加 `--top`/分目录/流式输出；临时 workaround：分目录扫描（如 `Assets/InitDeity` 单目录）或 text 模式。
2. **chain≥1 chunk 的文件路径不可逐条定位**：CLI 输出的 sources 仅覆盖 chain-0（9380 条）；chain≥1 的 chunk（如各类 OnEnable io/state 链）在 verdict 层无法稳定取到文件路径（提取时 file 字段为空），CLI text 长行截断 500 字符丢路径 → **脏/净交叉核对只能靠 chain-0 清单**。后果：本次普查发现的 20+ 带 io/state 的 OnEnable chunk（UnlockAchievement.OnEnable、Dissolve.OnEnable、SRSingleton.OnEnable、StyleComponent.OnEnable、FrameAnimationPlayer.OnEnable、QuadtreeManager.OnEnable、CritHealExecutor.OnEnable、DeathPanel.OnEnable 等，chain 0-1）因路径无法核验，**未纳入候选清单**（防止误把脏文件当干净文件）。工具改进方向：verdict 输出补文件路径字段。
3. **gitignored 生成物与手写代码同面审计**：API.g.cs（`*.g.cs` ignore）计入全库扫描的 unknown/自环，但 git 视角不可见——生成物重构无法用 git 脏/净判定（候选 3 即此形态）。
4. **中文标识符（既有债）**：77 文件 parseErrors，`QuestProgressionManager`（2688 行，任务系统）等核心文件 UNKNOWN 化——这些文件内的重构无法用 codeaudit 验证（外部债 D1，等 wasm 修复或重命名）。

---

## c) 结论

- **有安全项**：候选 1（Automation ForTest 隔离）主推——方向明确（技术债 P0 规定"迁出/#if 隔离"）、文件非脏、效应变化可量化、验证可自动化；候选 2（EnemySpawner.SetId）方向明确但需先做调用方核对，风险评级为中，未达"低风险"门槛前仅作前置任务。
- 候选 3 仓库侧无落地面；候选 4 为脏文件排除项。
- 附加发现：技术债报告 P0 的 Automation 行"脏文件等待收敛"与实际 git 状态不符（生产文件非脏），可先行。
