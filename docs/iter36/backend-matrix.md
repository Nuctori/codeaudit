# InitDeity Basebase 后端能力验证矩阵（w3-basebase，迭代 36）

> 验证时间：2026-08-12 22:15；BaseUrl：`http://127.0.0.1:8080`（预构建 dll `Basebase.dll`，7/27 构建）
> 验证入口：`InitDeity.ServerlessFunctions/Tools/RunBackend1Validation.ps1`（纯 HTTP，不依赖 dotnet build）
> 结果：**pass: true**——46 请求全 ok、92 响应全 200/204、0 失败/0 降级/0 脏行

## 环境根因修复（本次发现）

| 项 | 发现 | 处置 |
|---|---|---|
| 业务 404 | 8080 被**两个 dotnet 进程**抢占：旧残留（127.0.0.1:8080，healthz 误报 ok 但无 controller 路由）+ 新 Basebase（0.0.0.0:8080） | 杀旧实例（PID 83324），保留新实例（PID 43352）——Login/Login 从 404 → 200 |
| 根因教训 | healthz 200 **不能**证明业务 endpoint 可用（旧实例只注册了 healthz） | 后端验证必须含业务 endpoint 探针，非仅 healthz |

## 验证矩阵（RunBackend1 实测）

| 能力域 | 请求 | 状态 | 证据 |
|---|---|---|---|
| 认证 | user_auth_login | 200 ok | session/token 返回 |
| 登录 | login | 200 ok | 角色文档 + quest 6 主线引导 |
| 角色文档 | get_player_document | 200 ok | GamePlayOpens 持久化 |
| 角色状态 | get/set_player_state | 200 ok | 状态读写 |
| 结算 | player_settlement | 200 ok | exp 应用/在线时长/仓库回读（sqlite `settlementExpApplied=1`） |
| 时间 | server_utc_now | 200 ok | 时间窗口合理（`within_range=1`） |
| 任务快照 | quest_set_snapshot / get_progressions / get_completed | 200 ok | 快照写入/读取/登录回读闭环 |
| 任务流 | quest_start / complete / batch | 200 ok | start 9011/complete 9010+9011/batch 幂等 |
| 任务信号 | quest_trigger_signal(+world_state) | 200 ok | 计数递增/世界状态持久化 |
| 任务登录引导 | login quest 处理 | 200 ok | main kept 6/side cleared/progression 清理 |
| 奖励 | reward_get_today / refresh_single_box | 200/204 ok | 首次 GoldCoin +88 幂等；refresh no-content-noop |
| 背包 | bag_set_currency / warehouse0 / get_item_slots | 200 ok | 货币/仓库持久化 |
| Boss 掉落 | reward_get_boss_kill_reward | 200 ok | BossDailyDropCount 回写（`boss1=1`） |
| 玩法开启 | gameplay_open | 200 ok | GamePlayOpens SQLite 持久化 |
| 奇物图鉴 | ancient_item_get_all | 200 ok | 空图鉴（无脏行） |
| 活动 | activity_get_states | 200 ok | 空列表（`activity_state_count=0`） |
| 商店 | shop_get_items | 200 ok | 空列表（`shop_state_count=0`） |
| 显示设置 | player_show_setting | 200 ok | SQLite 持久化 |
| 队伍/公会/排行 | player_team_up / guild / rank | 200 ok | stub ok（`rank_stub_ok=1`） |

## SQLite 断言亮点

- 任务：`quest_snapshot_has_completed_9010=1`、`login_quest_main_kept_6=1`、`quest_start_returned_9011=1`
- 奖励：`refresh_single_box_no_content=1`、`boss_daily_drop_count_has_boss1=1`
- 脏行防护：`activity_state_count=0`、`shop_state_count=0`（facade 不创建脏 PlayerStates）
- 结算：`settlement_exp_applied=1`、`settlement_returned_warehouse0=1`

## 结论

- **后端核心能力全部绿**（login/settlement/quest/reward/bag/gameplay/boss-reward）——弱联网（Basebase localhost）后端层已就绪
- 满足验收硬门槛（核心 ≥5 capability 绿——实际 19+ 能力域全绿）
- 主流程恢复的前置（后端）已具备；下一步 Unity 就绪后即可跑用户路径 PlayMode
