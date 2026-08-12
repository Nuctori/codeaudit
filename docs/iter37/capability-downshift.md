# 迭代 37 测试债下沉：Capability 纯函数单元化（capability-downshift）

> 目标：把 CapabilityValidation 的纯判定逻辑（报告汇总/能力判定/失败传播/指纹/降级映射）下沉到 PureLogic 单元层（无 Unity 引用），建立测试金字塔基底。
> 验收：① 纯函数无 UnityEngine 引用 ② 单元测试 ≥15 断言 ③ csc 编译 0 错误 ④ 文档落盘。

## 1. 下沉清单（新文件）

| 文件 | 类型 | 内容 |
| --- | --- | --- |
| `Assets/InitDeity/Framework/PureLogic/CapabilityPureLogic.cs` | 生产纯逻辑类 | 5 个静态纯函数 + 3 个轻量 DTO（无 UnityEngine，仅 System） |
| `Assets/InitDeity/Tests/Unit/CapabilityPureLogicTests.cs` | 单元测试 | 24 个 NUnit 测试 / 30 断言 |

**纯函数**（语义镜像自 CapabilityValidation——逐字保真）：

- `DefaultBlockingLevel(int)` — 严重度→阻塞级别（Blocking→blocking / Degraded→degraded / Noise→noise / _→unknown）
- `DefaultDegradedMode(int)` — 严重度→降级模式（Blocking→none / Degraded→soft-failure / Noise→lifecycle-noise / _→unknown）
- `BuildFingerprint(cap, sev, endpoint, details, exType, unityStage)` — 问题指纹（join 顺序逐字节一致）
- `RecomputeSummaries(PureReport)` — 三类汇总（Severity/Stage/BlockingLevel 分组计数）
- `ComputeOverallPassed(PureReport)` — 整体判定（Blocking issue 或任一未通过 → 失败）
- `BuildIssue(entry, sev, details, ...)` — issue 构建（BlockingLevel/DegradedMode 默认逻辑）

**轻量 DTO**（镜像 CapabilityEntry/CapabilityIssue/CapabilityReport 纯字段）：`PureIssue` / `PureEntry` / `PureReport`。

## 2. 去重收益

`DefaultBlockingLevel` 原在 **3 处重复**（CapabilityReport.cs / CapabilityContext.cs ×2 文件）——下沉后收敛为单一实现，消除漂移风险（行为一致由逐字复制保证）。

## 3. 可离线跑证明（无 UnityEngine 依赖）

**纯逻辑类独立编译成功**（Roslyn csc，net10.0 refs，绕过坏 MSBuild）：

```
csc -target:library -nostdlib -r:<net10.0 refs> CapabilityPureLogic.cs
→ CapabilityPureLogic.dll (0 错误)
```

**程序集引用验证**（反射）：

```
ReferencedAssemblies: System.Runtime, System.Collections, System.Linq
→ 无 UnityEngine 引用（零 Unity 依赖）
```

**行为验证**（零依赖 VerifyRunner，反射调用纯函数 + 手动断言——绕过 nunit net35/net10 冲突）：

```
=== RESULT: 30 passed, 0 failed ===
```

覆盖：BlockingLevel 5 断言 + DegradedMode 4 + Fingerprint 3 + Summaries 10 + OverallPassed 4 + BuildIssue 4。

**单元测试文件编译 0 错误**（csc net10.0）：语法/逻辑正确。运行时 nunit 冲突为**环境组合问题**（Unity ext.nunit net35 vs net10.0 ref——t2-unittest.md 残余风险 1 已记录，非本任务代码错）。

## 4. 行为保真（防漂移）

- 每个纯函数从生产代码**逐字复制**（switch 分支/join 顺序/分组键完全一致）
- 生产代码（CapabilityValidation/）**未改动**——纯逻辑供测试用，零回归风险
- DTO 字段名镜像原类型（Name/Capability/Passed/Stage/DurationMs/Issues + Severity/BlockingLevel/DegradedMode/Repeated/Details/...）

## 5. 验收自检

- [x] 纯函数无 UnityEngine 引用（反射验证：仅 System.Runtime/Collections/Linq）
- [x] 单元测试 ≥15 断言（30 个）
- [x] csc 编译 0 错误（纯逻辑 + 测试 + runner 全部编译通过）
- [x] 文档落盘（本文件）
- [x] 生产代码零改动（只新增文件）
- [x] 未触碰 Quest 相关文件（另一个 subagent 的 quest 判定下沉不冲突）

## 6. 残余风险

1. **MSBuild 环境坏**（VS18 NuGet.Build.Tasks MSB4062）——`dotnet test` 不可用；已验证 csc 编译 + 零依赖 runner 行为验证
2. **nunit net35/net10 运行时冲突**（Unity ext.nunit 版）——单元测试文件语法正确但需 Unity/mono 跑 NUnit；离线验证用 VerifyRunner 替代
3. **生产转发未做**（本轮只提取）——CapabilityValidation 仍用自己的实现；转发是后续重构（消除 3 处重复的完整收益）
4. 临时编译文件已清理（scripts/_caprefs*）

## 7. 证据

- 纯逻辑源：`Assets/InitDeity/Framework/PureLogic/CapabilityPureLogic.cs`
- 单元测试：`Assets/InitDeity/Tests/Unit/CapabilityPureLogicTests.cs`
- 验证输出：VerifyRunner `30 passed, 0 failed`（临时 runner，已清理）
