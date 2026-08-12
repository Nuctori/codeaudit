# 迭代 36 收口审计（converge-audit，独立 reviewer，只读）

> 首行：**CHANGES**（非阻塞 4 项——t2 行为分歧 1 处 + 文档计数错误 3 处；无 blocker）。
> 基线：HEAD e2a0189（D:/node/codeaudit）；审计范围 docs/iter36 四子流产物 + 对应代码/环境实测。
> 手段：全量测试复跑（串行 + 并行）、tsc、Unity/许可证/后端进程实测、RunBackend1 复跑、PureLogic 离线编译复现、逐函数生产代码对照、git diff 逐字节核对。

---

## 一、四子流验收结论

### 1) env-unity.md（W1 Unity 安装）——**验收通过**（诚实记录 + 解决路径合理）

| 声明 | 实测 | 判定 |
| --- | --- | --- |
| Unity.exe 就位 `J:/UnityHub/Editor/2022.3.62f3c1/Editor/Unity.exe` | 存在 | ✓ |
| `--version` → 2022.3.62f3c1 | 实测输出 `2022.3.62f3c1` | ✓ |
| 安装包 3,759,910,736 字节 | stat 实测 3759910736 | ✓ |
| 许可证文件存在 `C:/ProgramData/Unity/Unity_lic.ulf` | 存在 | ✓ |
| LicensingClient 进程在跑（另一实例持 mutex） | 实测 `Unity.Licensing.Client.exe` PID 29516 运行中（记录时 28988，进程已重启，主张成立） | ✓ |
| batchmode return 199（许可证 IPC 卡点） | 环境自洽（LicensingClient 在跑 + 非管理员无法杀）；未复跑 batchmode（避免 60s 超时 + 写项目），按诚实记录采信 | ✓ |

**卡点处理符合防偷懒协议**：明确标记 ✗、给出根因链（序列号型许可证 + 孤儿 LicensingClient mutex + IPC 超时 199）、列出 3 条解决路径（A 管理员杀 PID / B Hub 重新激活 / C 注销重登）并标注各自前置——不假装通过、不掩盖阻塞。**阶段 2 硬前置未满足**，正确上报需用户介入。

### 2) t2-unittest.md（W2 单元层）——**验收通过（行为分歧 1 处需修）**

| 声明 | 实测 | 判定 |
| --- | --- | --- |
| `noEngineReferences: true`（PureLogic + UnitTests 两个 asmdef） | 两个 asmdef 均 true；PureLogic.cs 无 UnityEngine 引用（仅 System）；测试文件无 Unity 引用 | ✓ |
| 离线可编译（net10.0 csc，0 错误） | **复现成功**：`dotnet csc.dll -nostdlib -r:net10.0/System.Runtime.dll` → dll 生成，0 错误 | ✓ |
| 断言 ≥30 | 47 断言（[Test] 47 个、Assert 47 处）≥30 | ✓ |
| 生产代码零改动（只新增文件） | InitDeity commit 04f5df2f3e：8 文件新增 555 行、0 修改；RuntimeMainlineAutopilot.cs 不在脏列表 | ✓ |
| E2E 保留（4864 行 + 4407 行） | 两文件均在，行数一致 | ✓ |
| 新文件在脏文件隔离外 | 新增文件均为 untracked→committed 的新文件；但脏文件数文档写 158、commit 写 163、当前实测 164——**计数漂移**（实质隔离成立） | ✓（计数小误） |
| **GetQuest11InteractivePriority 行为保真** | **✗ 分歧**：见下 | ✗ |
| "10 个纯判定函数 → 48 断言" | **实际 11 个函数 / 47 断言**（表内 11 行、逐行断言和 = 47、测试文件 47） | ✗ 计数错 |

**行为分歧（t2 核心问题，medium）**——`GetQuest11InteractivePriority` 非逐字复制：

- 生产（RuntimeMainlineAutopilot.cs L7830-7837）末分支：
  `return IsQuest11EntranceTriggerPath(interactivePath) ? defaultPriority + 1000 : defaultPriority;`
- PureLogic（AutopilotPureDecisions.cs L141-146）末分支：`return defaultPriority;`
- 差异场景：`activeQuestId==11` 且**不在山洞世界加载器**中、路径非"到达山洞外"但**是山洞入口触发器**——生产给 `defaultPriority+1000`（对外部靠近入口的引导提升），PureLogic 给 `defaultPriority`。
- 无单测覆盖该分支（现有 6 个 Quest11Priority 用例不含此组合），分歧被静默固化。
- 当前无运行时影响（生产未转发、转发是后续重构），但违反文档"逐字复制/逐字节一致/防漂移"核心主张；**转发时行为会静默变化**。需补回分支 + 补 1 条测试（非山洞世界 + 入口触发器 → default+1000）。

其余 10/11 函数与生产逐字节一致（已逐函数对照）。

### 3) backend-matrix.md + env-basebase.md（W3 Basebase）——**验收通过**

| 声明 | 实测 | 判定 |
| --- | --- | --- |
| RunBackend1Validation pass:true | **复跑成功**：`pass: true`，46 请求（45×200 + 1×204），0 失败，46 audit 行 | ✓ |
| SQLite 断言（settlement/quest/boss/脏行防护） | 复跑核验：`settlement_exp_applied=1`、`quest_snapshot_has_completed_9010=1`、`boss1=1`、`activity_state_count=0`、`shop_state_count=0`、`rank_stub_ok=1`、`within_range=1` | ✓ |
| 8080 双进程抢占修复 | netstat 实测仅 `0.0.0.0:8080` PID 43352 单实例 LISTEN（旧实例已清除） | ✓ |
| healthz 200 | 实测 200 OK | ✓ |
| healthz 返回 JSON `{"ok":true,"uptime_sec":...,"projects":6}` | **✗ 与实测不符**：当前实例 healthz 返回纯文本 `Healthy`（ASP.NET UseHealthChecks 默认输出），无 JSON 体。文档 JSON 样本来源不明（疑似旧实例或臆写）——端点可用为真，body 形状声明不实（low，需修正文档） | ✗ 小 |
| "46 请求全 ok、92 响应全 200/204" | 92 = 46 请求结果 + 46 audit 行，全部 200/204 | ✓ |
| dotnet build 坏（MSB4062） | 未复现（环境问题，非本子流产物）；预构建 dll 可用已证实 | — |

### 4) r2-complexity.md + git diff（W4 resolveImport 拆分）——**验收通过**

| 声明 | 实测 | 判定 |
| --- | --- | --- |
| 拆 3 helper（46/31/60 行）+ 主函数 25 行 | awk 实测 46/31/60/25，逐字节对应 | ✓ |
| 原函数 128 行 | 实测 129（差 1，四舍五入级） | ✓ |
| `imp.imported` 加 `!`（分支保证非 null） | 命名空间分支 `imported===null` 先行返回，bare/obj 分支非 null 成立 | ✓ |
| `files` 参数从 resolveNamespaceImport 删除（原分支未用） | 原命名空间分支确实未用 files（仅 resolveMod/resolveSymbol） | ✓ |
| tsc 0 错误 | 实测 exit 0 | ✓ |
| 305/305 全绿（串行） | 实测串行 305/305 | ✓ |
| "并行模式有既有竞态失败" | **未能复现**：并行复跑 2 次均 305/305。可能为偶发/已自愈——文档已注明"非本改动引入"，无碍 | 注 |
| cognitive 190→~10 | 文档自承"未用工具量化"，结构性成立（主函数 3 分支分派） | ✓（诚实） |

---

## 二、防偷懒协议核对

| 协议条款 | 核对结果 |
| --- | --- |
| 不可伪造产物（外部进程/真实测试） | Unity `--version` 真实、RunBackend1 pass:true 复跑真实、PureLogic 离线编译复现真实、305/305 复跑真实——无伪造 | ✓ |
| 诚实报告（卡点如实） | **W1 batchmode 199 如实上报**（最关键的卡点协议履行），根因链 + 解决路径 + 明确"需用户介入"，未假装通过 | ✓ |
| 诚实报告（数字） | t2 断言数 48→47、函数数 10→11 计数有误；healthz JSON body 与实测不符；unknown 基线文档内 4563 与 4503 不一致（实测 4486）——**数字精确性欠账 3 处**（low，不影响门槛达成） | ✗ 小 |
| 基线对照 | unknown 5102→实测 4486（-12.0%，文档 4503 略偏）、单元层 47 断言 ≥30、E2E 4864/4407 保留——方向全对 | ✓ |
| 最小化非工程妥协 | t2 只加新文件不碰生产 ✓；r2 机械拆分 + 类型修正有据 ✓；Unity 卡点走用户介入而非 hack ✓ | ✓ |

---

## 三、阶段 2 主流程前置满足度评估

| 前置 | 状态 | 证据 |
| --- | --- | --- |
| Unity batchmode（PlayMode/E2E 运行） | **✗ 阻塞**——许可证 IPC return 199，需用户/管理员介入（env-unity §4 选项 A/B/C） | 实测 LicensingClient 在跑、非管理员无法杀 |
| Basebase 后端（login/settlement/quest/reward…） | ✓ 就绪 | 复跑 pass:true、46 请求全绿 |
| 单元层（测试金字塔基底） | ✓ 就绪（1 处行为分歧待修，不影响本阶段） | 47 断言、noEngineReferences 实证 |
| codeaudit 工具链 | ✓ 就绪 | 305/305、tsc 0 |
| E2E 保留 | ✓ | 4864/4407 行文件在位 |

**结论**：阶段 2 主流程唯一硬阻塞 = **Unity batchmode 许可证 IPC**。后端/单元层/工具链全部就绪。按防偷懒协议，阶段 2 不应以"降级/绕过"启动——必须等许可证 IPC 恢复（或用户在选项 A/B/C 中选择其一）后才可跑用户路径 PlayMode。此判断与 env-unity.md 一致，文档诚实。

---

## 四、CHANGES 清单（均非阻塞，需修复闭环）

1. **[medium] t2 行为分歧**：`AutopilotPureDecisions.GetQuest11InteractivePriority` 末分支丢失 `IsQuest11EntranceTriggerPath → defaultPriority+1000`（生产 L7835-7837 vs PureLogic L146）。补回分支 + 新增 1 条单测（非山洞世界 + 入口触发器路径 → `defaultPriority+1000`）。当前无运行时影响，但转发前必须修。
2. **[low] t2 计数错误**：文档"10 个纯判定函数 → 48 断言"应为 **11 函数 / 47 断言**（表内 11 行、行和 47、测试文件 47；commit 消息"10 个"同样错）。
3. **[low] env-basebase healthz body**：`{"ok":true,"uptime_sec":...,"projects":6}` 与实测（纯文本 `Healthy`）不符，删改该行。
4. **[low] 数字漂移**：脏文件数 158（文档）/163（commit）/164（实测）；unknown 4563（restore-plan/anti-laziness）/4503（r2）/4486（实测）。统一到实测口径。
5. **[info] r2 并行竞态**：文档称并行有既有失败，实测并行 2 次全绿——标注为偶发或已自愈即可。

## 五、残余风险

- Unity batchmode 许可证 IPC 是阶段 2 硬前置，恢复时间依赖用户介入，不可由本工作流自行解除。
- t2 转发重构（生产 → PureLogic）执行前必须完成 CHANGES#1，否则 quest 11 外部靠近入口的引导优先级会静默下降。
- RunBackend1 为状态写入型验证（会写 SQLite 测试玩家数据），基线数字随重跑略微漂移属正常。
