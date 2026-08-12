# InitDeity Unity 安装记录（迭代 36 W1）

> 任务：安装 Unity 2022.3.62f3c1 到 J:\UnityHub\Editor，验证 batchmode 可用（阶段 2 主流程硬前置）。
> 状态：**安装完成 + 可执行验证通过；batchmode 许可证 IPC 受阻（环境卡点，需用户介入）**。

## 1. 下载（已完成）

- 源：`https://download.unity3d.com/download_unity/1623fc0bbb97/Windows64EditorInstaller/UnitySetup64-2022.3.62f3c1.exe`
- 目标：`J:/UnityHub/downloads/UnitySetup64-2022.3.62f3c1.exe`
- 大小：**3,759,910,736 字节（3.76GB）**
- 耗时：约 7 分钟（速率 ~9MB/s，弱联网可用）
- 验证：文件头 `MZ`（PE 可执行）、size 稳定

## 2. 安装（已完成）

- 方式：NSIS 静默安装 `UnitySetup64-2022.3.62f3c1.exe /S /D=J:\UnityHub\Editor\2022.3.62f3c1`
- 目标：`J:/UnityHub/Editor/2022.3.62f3c1/`
- 结果：`Editor/Unity.exe` 就位（89MB）+ `Editor/Data`（1.8GB）——**编辑器核心完整**
- 验证：`Unity.exe --version` → `2022.3.62f3c1` ✓

## 3. batchmode 验证（**受阻——许可证 IPC 卡点**）

尝试：`Unity.exe -batchmode -nographics -quit -projectPath J:/旧宇宙/代码仓库/InitDeity`

结果：**return code 199**（`IPC channel to LicensingClient doesn't exist; aborting`）

根因链：
1. 许可证文件存在：`C:/ProgramData/Unity/Unity_lic.ulf`（SerialHash 序列号型，2026-07-28 更新，`SerialMasked F4-PMZY-ZAH2-Y8TN-G4CZ-XXXX`）
2. **孤儿 LicensingClient 进程 PID 28988 持有全局 mutex**（`Failed to acquire global mutex Unity-LicenseClient-Nuctori`——另一实例在跑）
3. Unity 启动时连 channel `LicenseClient-Nuctori` 被拒 → 超时 60s → abort 199
4. `taskkill /f /im Unity.Licensing.Client.exe` → **拒绝访问**（非管理员权限）

尝试过的绕过（均未解决）：
- `-createManualActivationFile`：生成流程但 license IPC 仍失败
- 杀 LicensingClient：权限不足
- 启动 Unity Hub（--headless）：Hub 起来了但未替换孤儿 LicensingClient（PID 28988 仍持有）

## 4. 卡点与解决路径（需用户/管理员介入）

| 选项 | 操作 | 前置 |
|---|---|---|
| A（推荐） | 管理员 PowerShell `taskkill /f /pid 28988` 杀孤儿 LicensingClient → 重跑 batchmode（Unity 会自启新 client） | 管理员权限 |
| B | Unity Hub 图形界面 → Sign in / Manage License → 重新激活 2022.3 许可证 | 桌面会话 + Hub 登录 |
| C | 检查 LicensingClient 是否由另一用户/服务启动（session 1）——注销重登后 mutex 释放 | 用户会话管理 |

**影响**：Unity 安装本身完成且可执行；batchmode（PlayMode/E2E 测试、阶段 2 主流程）需许可证 IPC 恢复后才能跑。

## 5. 验收对照

| 硬门槛 | 状态 |
|---|---|
| Unity.exe 定位成功 | ✓（J:/UnityHub/Editor/2022.3.62f3c1/Editor/Unity.exe） |
| Unity --version 可执行 | ✓（2022.3.62f3c1） |
| batchmode 启动（阶段 2 前置） | ✗ 受阻（return 199，许可证 IPC）——**需用户介入** |
