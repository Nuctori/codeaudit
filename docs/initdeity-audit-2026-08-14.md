# InitDeity 代码审计报告（2026-08-14，codeaudit 0.3.1）

审计工具：codeaudit（G1 修复后 `--json <file>` 产物链路已通）。扫描 2026-08-14 20:34，产物 `initdeity-audit.json`（317MB / 42758 chunks）。

## 一、总体健康度

| 指标 | 值 | 说明 |
| --- | --- | --- |
| 文件 / chunks | 3772 / 42758 | 含 LocalPackages 第三方包 |
| 第一方 chunks | 19131 | 过滤 LocalPackages/Plugins/Packages/生成代码后 |
| 第一方纯度 | PURE 6846 (35.8%) / IMPURE 8971 (46.9%) / UNKNOWN 3314 (17.3%) | |
| 全局 unknown-rate | 25.6% | 判定覆盖面，标注预算序见下 |
| 图完整度 | 49.5%（91927 未知站点） | 调用点解析率——C# 动态/反射/Unity 魔法调用为主因 |
| 解析错误 | 85 文件 | 中文标识符等（H1 行级降级已覆盖） |
| 循环依赖 SCC | 144 | 初始化/销毁顺序风险点 |
| 自递归函数 | 890 | 需注意终止性 |

## 二、深层传染链 top（副作用藏得最深，重构最危险）

- `Quest12/14/16/17/18PortalTaskSegmentDefinition.Create` chain=3（state）——任务段定义连写 state，测试代码耦合深层状态
- `LocalStateStorage.GetOrNew` chain=2（state）——本地状态存储双写路径
- `CIScript.Build*` chain=2（io,clock,fs,state）——构建脚本五效应集
- `AudioManager.isMasterMute` chain=2（state）——属性访问器带状态副作用
- `DevAPI.Call/CallAsync/CalcDrawDoor` chain=2（io）——开发 API 网络调用

## 三、治理清单 top（非纯 + 高扇入，优先治理）

| 调用者数 | 符号 | 位置 |
| --- | --- | --- |
| 290 | `NetCall.<static-init>` | Framework/Module/Online/NetCall.cs:139 |
| 254 | `ChillyRoomService.GetSdk` | ChillyRoomSdkClient/ChillyRoomService.cs:154 |
| 240×3 | `Debugger.Log` | Bootstrap/Utils/Debugger.cs:42/70/77 |
| 229×2 | `Debugger.LogError` | Bootstrap/Utils/Debugger.cs:30/24 |
| 224 | `QuestProgressionManager.<static-init>` | Framework/NonModule/Story/Quest/QuestProgressionManager.cs:37 |
| 186 | `PlayerCharacterManager.<static-init>` | Framework/NonModule/CharacterGrow/PlayerCharacterManager.cs:61 |
| 158×2 | `UI.Destroy` | Framework/Module/UI/UI.cs:62/82 |
| 144×4 | `UIEventListener.Get` | Framework/Module/UI/UIEventListener.cs:132/119/112/84 |

**解读**：静态初始化器（`<static-init>`）是治理头号目标——NetCall/QuestProgressionManager/PlayerCharacterManager 的静态构造各自被 186-290 处调用，静态初始化即 io/state 效应，任何改动波及全库。Debugger 统一日志门面（240+229 调用者）是合理的间接层，属"应当存在"的汇聚点，但说明全库日志都经它。

## 四、上帝文件 top（拆分候选）

1. `RuntimeMainlineAutopilot.cs` — **354 chunks**（主线程自动机，最大单体）
2. `HttpRequestTimelineRecorder.cs` — 141 chunks（SDK 诊断）
3. `RuntimeMainlineAutopilotRuntimeTests.cs` — 128 chunks（测试）
4. `StarterMainlineFlowTests.cs` — 126 chunks（测试）
5. `RuntimeCommandBridge.cs` — 108 chunks
6. `CombatFlow.link.cs` — 91 chunks（Headless 验证）
7. `QuestProgressionManager.cs` — 90 chunks
8. `GMPanel.cs` — 89 chunks
9. `ChillyRoomService.cs` — 82 chunks
10. `BagManager.cs` — 79 chunks

## 五、自递归 top（终止性审查）

`GenerateCharacterManager.Refresh`（88/95 双行）、`LocalStateStorage.GetOrNew`、`DevAPI.Call/Async`、`EnemyLoader.InstantiateBossDeathEffect`、`SimplePooledGameObject.Release`、`AudioManager.PlayBgm` —— 890 个自递归中前 10 建议优先人工确认终止条件。

## 六、建议优先级

1. **静态初始化器治理**（NetCall/QuestProgressionManager/PlayerCharacterManager）：改静态构造为显式 Init 调用，控制效应时机
2. **RuntimeMainlineAutopilot.cs 拆分**（354 chunks 是第二名的 2.5 倍）
3. **unknown-rate 25.6% 标注**：标注曲线见 CLI 输出，按影响面贪心序标注可降判定迷雾
4. **85 个解析错误文件**（中文标识符）：H1 行级降级已保证方向安全，但建议修标识符或加 effectOverride

## 七、治理三视图（迭代56 新增：--dups / --test-coverage / --dead，全部复用现有 verdicts）

真实实验（InitDeity 317MB 产物，`recheck --first-party`）：

| 视图 | 结果 | 治理价值 |
|---|---|---|
| **重复代码** | 648 组第一方（×24 `BaseIndexPlayCombatAnimation.OnUpdate`、×20 `BootAssetUpdatePlan.Reason`、×18 `PreCheckEquipLevel.IsComplete`、×16 `CheckAncientEnergy.OnQuestStart` 居首） | 复制粘贴热点——OnUpdate/OnAwake/OnExecute 模式暗示行为脚本模板化 |
| **测试盲区** | 568/16925 生产 chunk 被 Tests/ 引用（覆盖仅 **3.4%**）；`Debugger.LogError`(229 调用者)、`UI.Destroy`(158)、`NetCall.WithRetry`(140) 高危但零测试引用 | 测试投入与风险倒挂——最高频基础设施无任何测试覆盖 |
| **疑似死代码** | 8046 个第一方零调用者（902 高置信：`<static-init>`、私有方法）；`ApiClientHelper` 全类无引用 | 静态图盲区（反射/事件/Unity 回调）已排除生命周期方法；高置信项可直接删或补引用 |

用法：`codeaudit recheck initdeity-audit.json --dups --test-coverage --dead --first-party`（`--first-party` 排除 LocalPackages/Plugins/生成代码——否则 top 被 UniRx ×105/API.g.cs ×47 噪音主导）。

## 八、审计方法备注

- 本报告全部视图由 `recheck` 秒级重算（G1 修复后产物链路：`scan --json` 落地 → `recheck` 消费）
- 第三方代码（UniTask/UniRx/SDK）效应源占 top 主要位置，已过滤后聚焦第一方
- `--changed --gate` 在 recheck 模式路径形态不匹配（invalid 不放行，语义正确）——首次扫描时用 `--changed` 原路径
