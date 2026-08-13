# InitDeity 技术债分析报告（2026-08-14，当前引擎全能力）

> 扫描对象：`J:/旧宇宙/代码仓库/InitDeity/Assets`（3014 文件 / 28060 chunks）
> 引擎：HEAD caee7c6（迭代 48——含可规约性/骨架/桥/割点/量纲内治理排序/圈复杂度全能力）
> 无标注（纯机器判定）；缓存禁用；invariantViolations=0 / staleEdges=0 / skippedFiles=0
> 数据：scripts/initdeity-report.cjs → X:/tmp/initdeity-report2.json

---

## 一、总体健康度

| 指标 | 值 | 解读 |
| --- | --- | --- |
| chunks | 28060 | 全部可判定单元 |
| PURE / IMPURE / UNKNOWN | 11131 (39.7%) / 12739 (45.4%) / 4190 (14.9%) | 近半代码有确定副作用；14.9% 工具无法判定（低于上次 24.4%——迭代 44-48 工具收口见效） |
| 环（SCC>1） | 83 个 | 循环依赖团 |
| **多入口纠缠环** | **47 个（57%）** | 可规约性：过半递归是纠缠的（多调用者从不同节点进环）——重构雷区 |
| 自递归 chunk | 856 个 | 终止性需注意 |
| 桥边 | **5192 条** | 模块间唯一连通通道——契约测试/版本兼容必保接口 |
| 割点枢纽 | **2737 个** | 必经分量——改动影响面最大，评审从严 |
| 依赖骨架 | 24760 边（已知 30770 中） | 传递去重后真直接依赖——拆分/分层依据 |
| 密度 | 0.00004（近树） | 整体耦合低，桥/割点即全部结构风险点 |
| parseError | 4.3% chunks | 中文标识符等外部债（D1 族） |

## 二、模块级治理排序（chunk 数降序 top 10）

| 模块 | chunks | PURE | UNKNOWN | IMPURE | unknown% | maxC | 判定 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| InitDeity/Framework | 9223 | 3558 | 1764 | 3901 | 19.1% | **119** | 核心框架——unknown 面最大 + 最复杂函数（Plan C=119） |
| InitDeity/UIs | 3202 | 868 | 515 | 1819 | 16.1% | 46 | UI 层 impure 占比高（状态写/激活/动画），可接受域 |
| ChillyRoomSdkClient/InitDeity | 2503 | 1395 | 141 | 967 | **5.6%** | 32 | SDK 客户端判定最确定（生成代码 + 标注闭合），低债 |
| Plugins/Behavior Designer | 2446 | 1063 | 120 | 1263 | 4.9% | 14 | 第三方插件——低 unknown，无需治理 |
| InitDeity/Tests | 2221 | 630 | 286 | 1305 | 12.9% | 68 | 测试代码 impure 属正常；高复杂度测试函数（C=68）可拆分 |

## 三、治理清单 top（量纲：直接调用者数——被最多人引用的非纯 chunk 优先）

| chunk | callers | 效应 | chain | C | 位置 | 治理建议 |
| --- | --- | --- | --- | --- | --- | --- |
| ApiException.ApiException ×2 | **414** | state | 0 | 1 | ChillyRoomSdkClient/BasebaseApiSupport.cs | 全项目最多调用者——异常构造写状态，行为耦合面最大 |
| ApiClientHelper.ProcessResponse | 366 | clock,state | 0 | 11 | ApiClientHelper.cs:300 | 响应处理枢纽——366 调用者 + 高复杂度，**重构最高优先** |
| ApiClientHelper.ProcessApiException | 366 | state | 0 | 5 | ApiClientHelper.cs:365 | 同上枢纽 |
| ApiClientHelper.PrepareRequest ×2 | 366 | clock,state,net | 0 | 2 | ApiClientHelper.cs:226/244 | 请求准备枢纽（曾 732 站断链，迭代37 并集边已修） |
| ApiClientHelper.\<static-init\> | 366 | clock | 0 | 0 | :19 | 类型加载时钟读取 |
| NetCall.\<static-init\> | 290 | random | 0 | 0 | Framework/Module/Online/NetCall.cs:139 | 静态初始化随机种子——构造序风险 |
| ChillyRoomService.GetSdk | 258 | io,net,state | 0 | 2 | :154 | SDK 单例获取——io+net+state 三效应当前枢纽 |
| Debugger.Log ×2 | 242 | io | 0 | 1 | Bootstrap/Utils/Debugger.cs | 日志网关——242 调用者的 io 源（设计内，但确认无泄漏） |

**结构判据**：前 8 名全在 ChillyRoomSdkClient/InitDeity + 两个 Framework 枢纽——SDK 客户端是**全项目耦合最密集区**（414 调用者的异常类型、366 调用者的响应/请求枢纽），任何改动波及面最大。

## 四、效应源（背锅者 top——chain=0 直接引入 io/net/random/state）

- **ReadObjectResponseAsync 家族**（MailBox/Merchant/Player/PlayerCharacter/PlayerDailyEnergy/PlayerDocument/PlayerFriend Client × 52 calls each）：API.g.cs 生成代码——io+fs+state 直接效应源，生成器杠杆（改生成器一次修复全族）
- 完整清单见数据 JSON `sources`（top 20）

## 五、圈复杂度 top（>5 的 1200+ 个中 top）

| 函数 | C | n | 纯度 | 位置 | 判定 |
| --- | --- | --- | --- | --- | --- |
| SSUShaderGUI.OnGUI | **128** | 9 | IMPURE | Plugins/Sprite Shaders Ultimate/Editor | 第三方插件编辑器——非本项目债 |
| **RuntimeMainlineAutopilotPlanner.Plan** | **119** | 5 | **UNKNOWN** | Framework/Module/Automation/RuntimeMainlineAutopilot.cs | **本项目最高复杂度 + 未知判定**——重构 + 标注双优先 |
| ShaderFaderSSUEditor.OnInspectorGUI | 74 | 6 | IMPURE | 插件 | 第三方 |
| DOTweenAnimationInspector.OnInspectorGUI | 72 | 4 | IMPURE | 插件 | 第三方 |
| StarterInteractionCapability.Run | 68 | 3 | IMPURE | Tests/PlayMode | 测试代码，可拆分 |
| RuntimeMainlineAutopilot.BuildSnapshot | 47 | 3 | IMPURE | 同上文件 | 与 Plan 同文件——Autopilot 文件是复杂度热点 |
| BagItemSlot.InitItemInfo | 46 | 5 | IMPURE | UIs/BagPanel | UI 初始化逻辑过重，可拆 |
| NetCall.ProtectCall | 33 | **13** | IMPURE | Framework/Online | 嵌套 13 层——最深嵌套函数 |

**判据**：项目自有代码的复杂度债集中在 **RuntimeMainlineAutopilot（Plan C=119 + BuildSnapshot 47）** 与 **NetCall.ProtectCall（嵌套 13）**；插件高复杂度（OnGUI 128 等）非本项目治理范围。

## 六、未知点形态分布（标注工作流输入）

| 形态 | 站点数 | 判定 |
| --- | --- | --- |
| `<unresolved>·bare` | 9339 | 调用结果接收者（factory()().x）——动态分派设计边界，标注或接受 |
| Value·variable | 2169 | 读取值形态——多为纯读，可批量标注 PURE |
| Object·variable / Text·variable / Content·variable | 2162/1811/1153 | 变量接收者成员访问——动态分派面 |
| SetActive·variable | 1162 | Unity 状态变更——可批量标 IMPURE |
| Count·variable / Append·variable / Key·variable | 1110/1101/1020 | 集合操作——多为纯，批量标 PURE 候选 |

**判据**：`<unresolved>·bare` 9339 主导（占 33%）——工具 flatten 极限（调用结果接收者需类型流，已判无解 D-073）；其余形态大多有清晰批量标注方向（Value/Count/Append/Key → PURE，SetActive → IMPURE）。

## 七、可规约性（纠缠环）与结构债

- **83 环中 47 个多入口（57%）**——多数递归是纠缠的：改环内任一成员波及多个外部入口路径。入口分布 [25,11,36,7,3,1]（25 个无外部入口的孤立递归团 + 36 个恰 2 入口 + 7 个 3 入口 + 1 个 7 入口）
- **5192 条桥**：模块间唯一通道——**任何桥的改动都是全模块面影响**；桥清单即「契约测试必保接口」清单
- **2737 个割点**：必经枢纽——其中治理 top 的 ApiClientHelper/NetCall/Debugger 正是割点（结构判据与调用者数判据互相印证）

## 八、结论与建议（按优先级）

1. **重构最优先**：`RuntimeMainlineAutopilot.Plan`（C=119 + UNKNOWN——复杂度与不可判定叠加）→ 拆 Plan 为子步骤 + 标注。`NetCall.ProtectCall`（嵌套 13）次之。
2. **接口契约保护**：ApiClientHelper 三枢纽（ProcessResponse/ProcessApiException/PrepareRequest，366 调用者）+ ApiException（414）——改 SDK 客户端前先跑全量影响面（`--changed`）；这是全项目耦合最密集区。
3. **标注批量消化**：Value/Count/Append/Key → PURE 批组（~5400 站），SetActive → IMPURE 批组（1162 站）——`--unknowns` 导出 + 形态批组回读，可把 unknown 4190 降 ~30%。
4. **生成器杠杆**：ReadObjectResponseAsync 家族是生成代码——改生成器一次修复 8+ 客户端。
5. **非本项目债**：插件高复杂度（SSUShaderGUI 128 / DOTween 72）与中文标识符 parseError（4.3%）维持外部债分类。
6. **结构监控**：多入口环 57% 是长期架构债信号——新增环时优先收敛为单入口（结构化递归）。

## 附：引擎能力对照（本轮新能力在报告中的体现）

- 可规约性（multiEntryScc/sccEntryHistogram）→ 第七节纠缠环
- 依赖骨架（dependencySkeleton）→ 第一节 24760 真直接依赖
- 桥/割点（bridgesOf）→ 第一/七节 5192/2737
- 治理清单量纲排序（迭代48）→ 第三节 callers 降序
- 圈复杂度（迭代44-r4/47）→ 第五节
