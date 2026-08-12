# InitDeity 阶段 2 前置飞行检查（stage2-preflight）— 侦察结果

> 侦察范围：J:/旧宇宙/代码仓库/InitDeity（只读）+ 3 次 batchmode 运行观测 + 1 次并发运行观测
> 时间：2026-08-12 23:44 ~ 00:05（UTC+8）。Unity 2022.3.62f3c1 @ J:\UnityHub\Editor\2022.3.62f3c1\Editor\Unity.exe
> 结论速览：**batchmode 无法跑完主流程——卡在 ChillyRoom SDK TcpProtobufClient 初始化连接循环（10060 超时重试），发生在 executeMethod 触发之前；AtmosphereTcpManager 短路逻辑存在且正确，不是卡点。**

---

## 1. batchmode 运行结果

| 运行 | 命令要点 | 结果 |
|---|---|---|
| A（父会话 iter36-core-main，PID 45008，23:47:35 起） | `-executeMethod Editor.OfflineValidation.LocalOnlineValidationRunner.RunCommandLine`（无 -quit） | 编译 OK → 域重载 OK → 5× `TcpProtobufClient - Transport error errorcode: 10060` → 日志静默 → 约 23:51:5x 外部终止（无报告、无 exit code） |
| B（父会话 q6，PID 65792，23:52:17 起，**观测中）** | `-executeMethod InitDeity.Editor.OfflineValidation.LocalOnlineValidationRunner.RunCommandLine`（无 -quit） | 编译 OK → 域重载 OK → 6+ 次 TcpProtobuf 10060（23:53~23:59+ 持续增长，CPU 438s≈63s/min 空转）→ 日志止于 TCP 重试、无 runner 输出 → **8+ 分钟仍卡，进程不退出** |
| C（本侦察 run1，PID 57144，23:47:30 起） | 任务给定命令 + `-quit` | 立即退出（与 A 竞争项目锁；日志文件短暂出现后消失，无报告） |
| D（本侦察 run2，PID 89628，23:54:17 起） | 修正命令 + 无 -quit + `INITDEITY_SERVICE_ENDPOINT` 环境变量 | 立即退出（项目锁被 B 持有：`HandleProjectAlreadyOpenInAnotherInstance` 崩溃栈） |

**exit code：无法取得**——所有有效运行均未自然退出（被终止或仍在 TCP 循环中）；runner 自带的 10 分钟看门（`LocalOnlineValidationRunner.PumpCommandLineRun`，LocalOnlineValidationRunner.cs:169-178）从未触发，因为 `RunCommandLine` 根本没执行到。

**日志关键行（运行 B，C:\Users\Nuctori\AppData\Local\Temp\unity-q6.log）：**
```
235: *** Tundra build success (0.29 seconds), 1 items updated, 1333 evaluated
240: Begin MonoManager ReloadAssembly
241: - Loaded All Assemblies, in  0.994 seconds
249+: TcpProtobufSession - connection error
249+: TcpProtobufClient - Transport error errorcode: 10060, details: 由于连接方在一段时间后没有正确答复或连接的主机没有反应，连接尝试失败。
     （该错误对持续重复，间隔约 30-60s，期间无任何 runner/playmode/场景输出）
```

## 2. TCP 卡点根因（精确卡点）

**卡点位置：`-executeMethod` 调度之前。** 编译后域重载完成（`Loaded All Assemblies`）→ ChillyRoom SDK 的 TcpProtobuf 连接循环接管主线程（或长时间独占），10060 超时重试 6+ 次、>8 分钟，`RunCommandLine` 从未执行（证据：`Logs/iter36-core-main-report.json` 与 runner 报告从未生成；日志无 `LocalOnlineValidationRunner started.` / `runner_started=true`）。

**卡点主体：ChillyRoom SDK 预编译程序集的 `TcpProtobufClient`**（非 AtmosphereTcpManager）：
- Assets 源码中无 TcpProtobuf 定义；类型不在 `Library/ScriptAssemblies/*.dll` 中
- 实体在 HybridCLR 热更 dll：`Assets/InitDeity/Generated/HotUpdate/HotUpdateDlls/ChillyRoomSdkClient.dll.bytes`、`MetadataDlls/com.chillyroom.service.core.Runtime.dll.bytes`、`ChillyRoom.IM.dll.bytes`
- 无源码、无禁用开关（对 dll 字符串扫描：仅有 CONFIG_PATH/ConfigManager 等通用配置机制，未见 CHILLYROOM/INITDEITY 环境变量键）
- 10060（WSAETIMEDOUT）说明目标为内网/无响应地址（非 127.0.0.1:8080——Basebase 在跑且该端口会立即连上/拒绝，不会超时）；与 q6-preflight.md 的"连内网服务器"结论一致

**三个叠加因素：**
1. SDK TCP 循环卡住编辑器启动（根因，见上）
2. **executeMethod 名称存疑**：编译产物元数据证明类型全名为 `Editor.OfflineValidation.LocalOnlineValidationRunner`（Editor.dll 中 TypeDef 命名空间为 "Editor.OfflineValidation"；"InitDeity.Editor.OfflineValidation" 只以相对引用形式出现 1 次）。任务给定命令 `InitDeity.Editor.OfflineValidation.LocalOnlineValidationRunner.RunCommandLine` 与 canonical 脚本（Tools/RunLocalOnlineValidation.ps1:210）的 `Editor.OfflineValidation...` 两种写法本轮观测行为相同（都未进 runner），无法从本观测区分；**建议以 canonical 脚本写法为准**
3. **并发锁冲突**：项目单实例锁（Temp/UnityLockfile）+ 父会话与本侦察同时在跑 → 3 次崩溃（X:/Temp/Unity/Editor/Crashes/Crash_2026-08-12_155227022 / 155344350 / 155500337，栈顶 `HandleProjectAlreadyOpenInAnotherInstance`）→ 无效运行

## 3. AtmosphereTcpManager 离线短路现状（用户提交后）

**结论：短路存在且完整，不是卡点。用户提交（5c8e56421b）未新增短路，但把 Atmosphere 地址硬编码为本地。**

- `Assets/InitDeity/Framework/Module/Online/AtmosphereService/AtmosphereTcpLoginPlanner.cs:26-44`：endpoint 含 `127.0.0.1` 或 `localhost` → `ShouldSkipConnect=true`（reason=local_endpoint）
- `AtmosphereTcpManager.cs:119-129`：`loginPlan.ShouldSkipConnect` → `Debug.LogWarning("[Degradation] mode=tcp-offline-degraded ...")` 后 return，不发起连接
- 短路来源：commit 09e671f74d（2026-06-25 "feat(atmosphere): extract local login planner"，含 AtmosphereTcpLoginPlannerTests）
- 用户提交 5c8e56421b 仅改 `AtmosphereTcpManager.GetAddress()`（废弃 SDK config 读取，直接返回 localIp "127.0.0.1:5120"）与 `isHost` 判定（AtmosphereTcpManager.cs:77-81, 138）——属"把 Atmosphere 锁定到本地"的加固，与短路正交
- runner（LocalOnlineValidationRunner.cs:716）在 playmode 前会 `SetServiceEndpointOverride("http://127.0.0.1:8080")` → 一旦进入 playmode，AtmosphereTcpManager.Login 必短路 → 卡点与 Atmosphere 无关

**注册表（EditorPrefs/PlayerPrefs）现状：**
- `InitDeity.LocalOnlineValidation.Pending = 0`（干净，无残留 pending）
- `LocalDevelopmentKitConfig` 残留（q16 task-segment 的 JSON，endpoint=127.0.0.1:8080）——启动时可能被 LocalDevelopmentKit 读取
- `InitDeity.LiveMainlinePlayRunner.PersistentActive = 1`（陈旧标志，父会话 mainline-unlock 相关工作）
- `InitDeity.LocalOnlineValidation.Stage` 残留 marker（player_state_wait_for_loaded_after_loaded_gate，非传输边界，无害）

## 4. 修复建议（非脏文件侧）

1. **立即**：终止 PID 65792（已证卡死 >8min、CPU 空转；batchmode 无 -quit 且 executeMethod 未触发 → 无自我退出路径）
2. **短路触发（任务建议的 env 路线，代码已支持）**：
   - `INITDEITY_SERVICE_ENDPOINT=http://127.0.0.1:8080`（RuntimeServiceEndpoints.cs:14,75-81 环境变量优先于 PlayerPrefs）
   - `INITDEITY_NO_PUSH_MODE=1`（NoPushRuntimeGuard.cs:13-14，现有 guard，使 ServerMsgManager/BagManager/ChillyRoomService 推送路径快速失败）
   - 注：这两者不直接阻止 SDK TcpProtobuf 编辑期连接循环——根治需在 SDK 层（见 4）
3. **命令修正**：executeMethod 用 canonical 写法 `Editor.OfflineValidation.LocalOnlineValidationRunner.RunCommandLine`（与 Tools/RunLocalOnlineValidation.ps1:210 一致；本侦察已验证该类型名存在于 Editor.dll 元数据）；**去掉 `-quit`**（runner 通过 `EditorApplication.Exit` 自退出，LocalOnlineValidationRunner.cs:926-936；-quit 会在 pump 挂上前退出编辑器）
4. **SDK 卡点根治方向**（无源码，需封装层处理）：在 `Assets/ChillyRoomSdkClient/ChillyRoomService.cs` 的编辑期初始化路径加 `NoPushRuntimeGuard` 式短路（该文件已有 ThrowIfEnabled 模式可循，ChillyRoomService.cs:90,105）；或排查 com.chillyroom.service.core.Runtime 的 CONFIG_PATH 初始化，在批处理模式注入空配置
5. **串行化**：batchmode 运行前先 `taskkill /IM Unity.exe`（或等待持有锁的进程结束），避免锁碰撞崩溃（Tools/UnityBatchModeGuard.ps1 只报错不杀进程）

## 5. 证据文件

- 运行 B 日志：`C:\Users\Nuctori\AppData\Local\Temp\unity-q6.log`（卡点现场，持续增长中）
- 运行 A 日志：`J:\旧宇宙\代码仓库\InitDeity\Logs\iter36-core-main.log`（5×10060 后静默）
- 崩溃栈：`X:/Temp/Unity/Editor/Crashes/Crash_2026-08-12_155227022|155344350|155500337/mainline-unlock.log`
- 类型名证据：`Library/ScriptAssemblies/Editor.dll` 元数据字符串 `NEditor.OfflineValidation.LocalOnlineValidationRunner`
- 短路代码：AtmosphereTcpLoginPlanner.cs:26-44、AtmosphereTcpManager.cs:119-129、RuntimeServiceEndpoints.cs:23-40
- 相关文档：docs/iter36/q6-preflight.md（前次分析）、Tools/RunLocalOnlineValidation.ps1、Tools/UnityBatchModeGuard.ps1

## 6. 残余风险

- 未观测到任何一次"短路生效后的主流程跑通"证据（July 的 Editor.log 是交互式会话非 batchmode，且无 runner 标记）
- 未能验证 `InitDeity.Editor.*` 与 `Editor.OfflineValidation.*` 两种 executeMethod 名在"无 SDK 卡点"条件下的解析差异（两种名字的运行都被 SDK 卡点挡住，行为一致）
- SDK TcpProtobuf 重试循环是否最终终止未知：A 在 5 次错误后静默（随后被终止），B 已 6+ 次仍在继续——重试上限不明
- 本侦察的 run1/run2 均因锁冲突未产生自有运行数据；batchmode"完整跑通"结论需在锁释放后复测一次
