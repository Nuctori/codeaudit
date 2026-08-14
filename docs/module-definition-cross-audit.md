# 模块定义交叉审计（InitDeity · 2026-08-14）

审计对象：有向边图节点的"模块"聚合定义（当前 = 目录路径前缀 2 级键）。
方法：四维独立对照——asmdef（编译单元）/ 命名空间（语言组织）/ 目录（文件组织）/ 文件（实现粒度），数据源 initdeity-audit.json（42759 chunks）+ 工程文件系统。

## A. 目录 vs asmdef（编译单元）

InitDeity 第一方有 14 个 asmdef。目录模块按文件归属统计：

| 目录模块 | chunks/文件 | asmdef 分布 | 判定 |
| --- | --- | --- | --- |
| InitDeity/Tests | 2207/200 | EditorTests:1359, PlayModeTests:622, UnitTests:147, TaskSegments:79 | ⚠ 跨 4 个测试程序集 |
| InitDeity/Framework | 9234/927 | Framework:9186, PureLogic:48 | ⚠ 跨 2 个（PureLogic 独立 asmdef） |
| CosmosFramework/AOT | 337/43 | AOT:99, AOT.Misc:238 | ⚠ 跨 2 个 |
| InitDeity/UIs | 3200/390 | InitDeity（根程序集） | ✓ 单 asmdef |
| InitDeity/Worlds/Units/Story/Widgets/BossFight/Vfx_Test/Effects/Sect/Generated | — | InitDeity（根程序集） | ✓ 单 asmdef |
| InitDeity/Bootstrap / Editor | — | Bootstrap / Editor | ✓ 与独立 asmdef 对齐 |
| ChillyRoomSdkClient 系 | 2503+141+122 | ChillyRoomSdkClient | ✓ 对齐 |
| CosmosEditor/Build 等 | 175 | InitDeity.asmdef（经 asmref 共享） | ✓ asmref 语义 |

**结论**：26/29 模块与 asmdef 边界一致；3 处跨 asmdef 均为"子程序集包含在目录内"（Tests 合并 4 个测试程序集、PureLogic ⊂ Framework、AOT.Misc ⊂ AOT）——目录是 asmdef 的**超集**，聚合未错分，仅粒度略粗。

## B. 目录 vs 命名空间（语言组织）

| 目录模块 | 命名空间数 | 形态 |
| --- | --- | --- |
| InitDeity/UIs | **152** | UIs.CreateCharacterPanel / UIs.DayRewardPanel…（面板级） |
| InitDeity/Framework | **135** | Framework.Utils / Framework.Online…（子域级） |
| InitDeity/Units | 28 | Combat.Enemies.Skill / **Worlds.LingWorld**（跨目录命名空间） |
| InitDeity/Worlds | 18 | World.StartWorld / **Framework**（跨目录） |

**结论**：命名空间碎片化到面板/子域级（UIs 152 个）——**不可作聚合键**；但证实真实"模块"粒度 = 目录 3 级（UIs/<面板>、Framework/<子域>），与当前"模块级下钻"的 3 级键恰好一致。Units/Worlds 存在跨目录命名空间（代码组织与目录漂移的真实案例，量小）。

## C. 文件级下钻可行性

| 模块 | 文件数 | 可否作下钻层 |
| --- | --- | --- |
| InitDeity/Framework | 927 | ✗ 需先下钻到 3 级（Module/NonModule） |
| InitDeity/UIs | 390 | ✗ 同上 |
| InitDeity/Worlds | 137 | △ 勉强 |
| InitDeity/Bootstrap | 93 | △ |
| 3 级模块（Framework/Module/Online 等） | 数十 | ✓ |

## D. 定义缺陷清单（审计发现）

1. **API.g.cs 生成代码冒充第一方模块**：`ChillyRoomSdkClient/InitDeity`（2503 chunks / **1 文件**）是 SDK 生成代码，被当普通模块参与聚合/环检测——应排除（与 InitDeity/Generated 同款处理）。
2. **UIs 目录聚合太粗**：390 文件 / 152 命名空间——UIs 是"面板容器"非模块；模块级下钻（3 级键 = 面板）才是真实粒度。当前交互设计已覆盖。
3. **Tests 跨 4 asmdef**：目录键合并合理（统一测试桶），但若未来要 asmdef 级视图需拆。

## 结论

- **目录 2 级键是 InitDeity 可行的最佳聚合**：asmdef 太粗（大半代码在单个 InitDeity.asmdef，asmdef 级图仅 ~5 节点）、命名空间太碎（152 个/模块）、类级不可读。
- **3 级键（模块级下钻）与真实功能模块对齐**（UIs/<面板>、Framework/<Module|NonModule>）——现有交互层级设计正确。
- **待修复**：API.g.cs 生成代码排除（缺陷 1）。
- 文件级作为第 4 级下钻仅在 3 级模块内可行（数十文件）。
