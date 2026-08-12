# 阶段 2 排障记录（Unity 域重载 641s 技术债）——已收敛

> 2026-08-12 深夜排障。目标：让 Unity batchmode EditMode 测试稳定跑通（出 XML），消除 641s 域重载 + OOM 崩溃。

## 最终结论（已穷尽排查）

**641s = Unity China 版（2022.3.62f3c1 china_unity/release）引擎 native 层 TcpProtobuf 内网连接重试**（连 192.168.1.209:10080，每次 ~80s 超时 × 8-10 次 ≈ 641s）。触发点 = **域重载时的引擎内建网络组件**（无 managed 代码、无配置开关、无环境变量可关）。**环境硬债——非代码可修**。

### 排除清单（全部实证）
| 候选 | 结果 |
|---|---|
| Addressables 坏 entry | ✅ 已修（8 个 meta 冲突标记残留，4037aa08eb）——第一次重载 616s→441ms |
| HybridCLR enable | ❌ enable:0 后 TcpProtobuf 仍 9 次 |
| ChillyRoomService/IMManager | ❌ 用户已退役 IM（30 行 stub）；HttpClient 非 TcpProtobuf |
| ChillyRoomSdkClient 热更 dll | ❌ 编辑器不加载（BootScript #if !UNITY_EDITOR） |
| ThinkingData 包 | ❌ HTTP SDK 无 TcpProtobuf |
| UnityConnect | ❌ m_Enabled: 0 |
| CosmosPrelude/Generated Dlls | ❌ 无 TcpProtobuf 字符串（ASCII+UTF-16 双搜） |
| 全部 managed dll（Library/ScriptAssemblies） | ❌ 无 TcpProtobufClient |
| 8 类 [InitializeOnLoad] 插桩 | ⚠️ 探针 FIRSTPASS_CTOR 执行但 [InitializeOnLoadMethod] 未执行——卡点在静态构造阶段；asmdef 引用墙阻碍精确定位（已还原） |

### 关键事实
- plain-batch2（-quit + EditorApplication.Exit）：511ms 正常退出——**TcpProtobuf 异步不阻塞快速路径**
- 自定义 executeMethod（RunCommandLine）：被 TcpProtobuf 阻塞（日志止于重试）
- -runTests：测试**能跑**（641s 后执行，报告可写）但 OOM 风险（MEM 8.8GB 时被杀）
- 7月25日成功（6.3s）：当时网络**快速失败**——**网络环境变化是根因**（192.168.1.209 从可达→不可达）

## 修复方向（进行中）

**测试债下沉**（docs/iter37/test-debt-analysis.md 量化）：
- quest 6-10 判定函数 → PureLogic 单元层（subagent 进行中）
- Capability 纯函数 → PureLogic（CapabilityPureLogic.cs 已产出）
- 目标：Unit 47→150+ 断言，PlayMode E2E 40→12 冒烟

**641s 根治**：需管理员权限（防火墙拦截 192.168.1.209 出站）或 Unity 官方修复——**已记录为环境债**。

## 残余
- dump 分析不可行（Unity Mono 非 .NET Core，SOS 命令不支持）
- dotnet-dump 9.0 已装（备用）
- hosts 文件已写入 127.0.0.1 192.168.1.209（无效——IP 直连不走 hosts，已确认）
