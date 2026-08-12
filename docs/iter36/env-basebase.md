# InitDeity Basebase 环境验证（w3-basebase，迭代 36 env-basebase）

> 验证时间：2026-08-12 22:15；结论：**后端环境就绪**（弱联网 Basebase localhost）

## 服务状态

| 项 | 值 |
| --- | --- |
| 服务 | Basebase.dll（预构建，7/27）监听 `0.0.0.0:8080`（PID 43352） |
| healthz | `{"ok":true,"uptime_sec":...,"projects":6}` |
| 数据库 | `App_Data/initdeity-offline.db`（SQLite，表自动创建） |
| 后端验证 | RunBackend1Validation `pass: true`（46 请求全 ok，见 backend-matrix.md） |

## 关键环境修复

**多实例端口抢占**（本次发现并修复）：

- 8080 原被两个 dotnet 进程监听：旧残留（127.0.0.1:8080，只注册 healthz 无 controller 路由——业务 endpoint 全 404）+ 新 Basebase（0.0.0.0:8080）
- 处置：杀旧实例（PID 83324），保留新实例（43352）——Login/Login 404→200
- **教训**：healthz 200 不能证明业务可用（旧实例 healthz 正常但业务 404）；后端验证必须含业务 endpoint 探针

## dotnet build 修复待办（阻塞，不影响运行）

| 项 | 详情 |
| --- | --- |
| 错误 | `MSB4062: 未能从 NuGet.Build.Tasks.dll 加载任务 CheckForDuplicateNuGetItemsTask`——`Microsoft.Build.Utilities.v4.0` 缺失 |
| 路径 | `F:\Program Files\Microsoft Visual Studio\18\Community\...\NuGet\NuGet.targets`（VS18 路径存在但 v4.0 程序集缺失） |
| 影响 | `dotnet build` 失败——但**预构建 dll 可用**，运行不阻塞 |
| 候选修复 | ① 修 MSBuild 路径（VS18 的 MSBuild 指向错误 SDK）；② 降级 SDK 版本；③ 用 `dotnet build --no-restore` 或指定 MSBuild 路径 |
| 优先级 | P2（运行已可用，仅构建/改代码后需手动 tsc 等价物验证时阻塞） |

## 验证命令记录

```bash
curl http://127.0.0.1:8080/healthz                    # {"ok":true,...}
cd InitDeity.ServerlessFunctions && pwsh -NoProfile -File Tools/RunBackend1Validation.ps1 -BaseUrl "http://127.0.0.1:8080"  # pass: true
```

## 残余风险

1. **弱联网下载依赖**：若需重装/更新 Basebase，`dotnet build` 仍阻塞（P2 待办）
2. **服务重启脚本缺失**：当前靠手动 nohup 启动；建议后续固化 `Tools/StartBasebase.ps1`（防多实例抢占）
3. **旧实例残留风险**：启动前应检查 `netstat :8080` 仅一个 LISTEN
