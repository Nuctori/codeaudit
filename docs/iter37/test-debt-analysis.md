# InitDeity 测试技术债量化分析（test-debt-analysis）

> 迭代 37 独立任务产出（cwd=D:/node/codeaudit，只读 InitDeity）。数据源：codeaudit 0.3.1 扫描 `J:/旧宇宙/代码仓库/InitDeity/Assets/InitDeity/Tests`（2044 chunks / 190 文件 / unknown-rate 31.8%）+ 手动结构统计。
> 目标：量化测试金字塔失衡（E2E 承担过多验证责任），产出可下沉单元层的候选清单。

## 1. 总量与结构

| 目录 | .cs 文件数 | 行数 | 测试方法数（[Test]/[UnityTest]） | 断言数（Assert.*） |
| --- | --- | --- | --- | --- |
| Editor（EditMode） | 117 | 19,772 | 638 | 2,401 |
| PlayMode（含 FullFlowCore/Capabilities） | 33 | 9,925 | 40 | 336 |
| TaskSegments | 3 | 630 | —（支撑文件） | — |
| Unit（PureLogic） | 1 | — | 11+ | 47 |
| **合计** | **154** | **~30,327** | **~689** | **~2,784** |

**关键失衡**：

- PlayMode 40 个测试方法却占 9,925 行（**平均 248 行/方法**）——每个 E2E 方法内嵌大量真实用户路径驱动（场景加载、桥接、轮询）
- `StarterMainlineFlowTests.cs` 4,407 行 / 19 个 `[UnityTest]`（**232 行/测试**）——单文件 E2E 债最大源
- Editor 测试 638 方法 / 19,772 行——**多数是"EditMode 但依赖 Unity 运行时对象"**（非纯逻辑），仍不能脱离编辑器运行
- Unit（PureLogic 程序集）仅 1 文件 / 11 测试 / 47 断言——金字塔底层严重不足

## 2. 生产 API 直调

- **90/117** Editor 测试文件直接 `using Framework.* / Generated.* / InitDeity.* / Bootstrap.*`（生产命名空间）
- 直调生产静态/单例的样例：`LoginManager.ValidationStageKey`、`QuestProgressionManager.*`、`RuntimeCommandBridge.TryEnsureBridge()`
- PlayMode 全部 33 个文件直调生产链（登录→世界→quest 判定→战斗）

**含义**：测试与生产代码强耦合。生产 API 签名变更（如 quest 判定改名）会直接破坏测试编译——这是"重构→测试全红"链的主因。

## 3. 合成测试 vs 真实用户路径

| 类型 | 数量 | 代表 |
| --- | --- | --- |
| 真实用户路径 E2E（UnityTest，进 PlayMode） | 40 | StarterMainlineFlowTests（quest 6/7/8/9/10/9008 判定） |
| 合成驱动方法（Ensure/Advance/桥接） | 7 处 | `RuntimeCommandBridge.TryEnsureBridge()`、`EnsureStarterMainlineAtQuest9` 类 |
| 静态判定测试（EditMode，不玩场景） | ~50 | StarterCaveQuestBindingsTests、Quest*TaskSegmentDefinitionTests |
| 纯逻辑单元（Unit 程序集，无 Unity 引用） | 11 | AutopilotPureDecisionsTests |

**风险**：合成驱动方法（Ensure*）把"测试前状态准备"逻辑写死在测试里——生产判定逻辑变更时，驱动方法与断言不同步，出现"测试通过但生产行为错误"的假绿。

## 4. codeaudit 扫描结果（工具盲区观测）

```
STATS: pure 355, impure 1058, unknown 631（unknown-rate 31.8%）
效应表[csharp]: 163 条目 / 命中 44 / corpus-inactive 119
补表候选 top: global:BindingFlags(480) builtin:Framework(369) global:System(311) builtin:InitDeity(258)
```

**盲区（痛点记录）**：

1. **unknown-rate 31.8%**（InitDeity 全局 22.5%）——测试代码用了大量 `Entry/Decision/TaskSegmentFailureKind/Plan` 等域类型，codeaudit 的 csharp 效应表未覆盖（163 条目命中仅 44）
2. **Unity API 序列化效应**（`LoadScene/Resources.Load/AssetDatabase`）无法建模为纯/不纯——场景加载的时序副作用（GameObject 生命周期）是 E2E 独有的风险，codeaudit 无场景图分析
3. **断言数可统计但不可验证**：`Assert.*` 2,784 次（Editor 2,401 / PlayMode 336）——codeaudit 无法判断断言是否命中真实路径（合成驱动方法可绕过真实 UI 交互仍断言通过）
4. **`[UnityTest]`/`[Test]` 属性未建模**——codeaudit 不区分测试代码与生产代码，无法输出"测试债指数"（每个生产方法被多少测试依赖）

## 5. 可下沉单元层候选清单（下一步重构目标）

| 候选 | 现状 | 下沉理由 | 预估收益 |
| --- | --- | --- | --- |
| quest 6-10 判定函数（StarterCaveQuestBindings / QuestProgressionManager 判定） | PlayMode 4407 行内嵌 | 判定是纯逻辑（输入 quest 状态 → 输出完成与否），无场景依赖 | PlayMode 减 ~1200 行 |
| Quest*TaskSegmentDefinitionTests（12 个文件） | Editor 静态断言 | 已是"静态判定"，可迁到 Unit 程序集（去 Unity 引用） | PlayMode 减 0 / Editor 减 ~600 行 |
| CapabilityValidationTests（CapabilityRunner 系列） | Editor 依赖运行时 | Capability 是纯函数（输入配置→输出报告），可 Unit 化 | Editor 减 ~800 行 |
| RuntimeCommandBridge 命令解析（IsHelpVerb/Describe 签名） | PlayMode 桥接 | 命令解析是纯字符串逻辑，已拆 helper | PlayMode 减 ~300 行 |
| ExpElixirManager / PlayerCharacterLocalExpFallbackPlanner | Editor 但依赖 Unity | 经验值计算可抽纯函数 | Editor 减 ~400 行 |

**下沉总量估计**：~3300 行可从 PlayMode/Editor 迁到 Unit（Unit 47→150+ 断言），PlayMode 40 个 E2E 保留为"每 quest 一个冒烟"（40→~12 个关键路径）。

## 6. 结论

- 金字塔现状：E2E（40 测试/9925 行）承担了**所有 quest 主流程验证**，但每次跑 = 起 Unity + 641s SDK 域重载债 = 半小时/次
- 修复方向：**判定逻辑下沉 Unit（去 Unity 引用）** + E2E 只保留关键路径冒烟（每 quest 1 个）
- codeaudit 增强建议：测试债指数（生产方法被测试依赖数）、`[Test]` 属性识别、Unity 序列化效应建模——列为迭代 41+ 候选

## 7. 证据

- 扫描原始输出：`docs/iter37/test-scan-raw.txt`（130 行）
- 结构统计：本节内（文件数/行数/断言数均来自 grep/wc 实跑）
