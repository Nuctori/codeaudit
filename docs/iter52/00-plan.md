# Iter-52：拓扑视图重载族去伪影（InitDeity 纠缠环报告驱动）

> 触发：InitDeity 技术债报告（2026-08-13 复扫，28070 chunks / 3014 文件 / 83 环 / 47 纠缠环）纠缠环解耦线。
> scout 定位：报告 #1「Event.Track 7 入口 × 6 成员 影响 42」与 #2「ResourceTracker.ReleaseOnDestroy 4 × 4 影响 16」
> 在源码中均为**重载星形委托**（无任何真实递归），环由链接器并集边自连产生。

## 0. 盲区证据（文件:行 + 预期 vs 实际）

- 链接器重载解析：`src/engine/link.ts:793-796` — 限定名多候选（重载组）→ `for (const k of cands) sink.addEdge(k)` 并集边。
  C# 隐式 this 裸名调用分支（`link.ts:1592` implicitThis → resolveClassMember）对 `Track(...)`/`ReleaseOnDestroy(...)` 解析出全部重载。
- 实际（源码事实）：`DataCollect.cs:296-494` 的 `Event.Track` 7 个便利重载全部委托 2 参主入口（星形，无环）；
  `ResourceTracker.cs:65-200` 的 8 个 `ReleaseOnDestroy` 重载全部委托私有 `ReleaseOnDestroy(Res)`（星形，无环）。
- 预期：重载星形不构成「纠缠递归」（Hecht-Ullman 多入口 SCC）。
- 实际（报告）：`7 入口 × 6 成员 Event.Track 影响 42` 列纠缠环 #1——并集边把星形自连成人工 SCC。
- 复现：对同一份 2026-08-13 扫描数据（28070 verdicts）用旧口径重算 → 精确复现 83 环 / 47 纠缠 / Event.Track 影响 42。

## 1. 修复（最小 diff，纯拓扑视图，不动纯度传播）

- `src/core/topology.ts`：`graphMetrics` 增加同名族过滤（chunk.name 非空且相同的调用 = 自环口径）——
  边提取、edgeSet、succComp、sccEntry 四处同口径；族内边计 selfLoopCount、不计 knownEdges/SCC/入口。
- `src/core/htmlreport.ts`：纠缠环 edgeSet 同款过滤（长传播链共用该 edgeSet，一并修正）。
- 方向安全：并集边仍保留（重载不可消歧的保守并集 = 假纯防线不动）；仅**拓扑视图**把族内边视作自环。
- 同名跨类安全：chunk.name 为限定名（`Class.Method`/`DataCollect.Event.Track`），跨类同名方法不误过滤；
  无 name 的 fixture 行为不变（fam 返回 null → 不过滤）。

## 2. 验证

- 回归：`npx vitest run` → **412/412 passed（44 files）**。
- 新增测试：
  - `test/unit/topology.test.ts`：重载星形不构成 SCC（3 用例 + 无 name 旧口径不变）。
  - `test/unit/htmlreport.test.ts`：纠缠环列表排除重载族、真实双入口环仍在。
- 实证（同一份 InitDeity 2026-08-13 扫描数据，旧 vs 新口径）：
  - 环 SCC：83 → **30**；纠缠环：47 → **15**。
  - 消失（伪影）：Event.Track（影响 42，#1）、ResourceTracker.ReleaseOnDestroy（影响 16，#2）、
    BottomBtnUI.RefreshExpAndLevel、TopCustomItemDisplay.RefreshItemCount、HasReceivedEvent.ReceivedEvent、SRMath.SpringLerp。
  - 保留（真实）：QuestAutoSubmitManager 4×5（新 #1，影响 20）、AtmosphereClient 3×4、
    HeritageCaveManager 3×5、BuglyAgent 2×5、VeinCollision 3×3、NetCall.HandleApiExceptionAsync↔ProtectCall↔LoginManager.DoLogin 2×3（新暴露）。
- 产物：`InitDeity/.codeaudit/report-iter52.html`（新口径完整报告）。

## 3. 决策链

- D-1：修工具拓扑视图而非改项目代码——重载星形是合法结构化递归，改代码讨好报告 = 修症状；
  去伪影是根因，且使后续所有纠缠环重构决策基于真实信号。
- D-2：过滤口径 = chunk.name 相等（限定名族），不按签名消歧——消歧有假纯风险（link.ts:782 命题 1），
  族内边保守降级为自环，纯判定零变化。
- D-3：作用域 = topology.ts + htmlreport.ts（SCC/纠缠/传播链/入口分布）；治理清单 inDeg、--state、
  桥/割点视图不动（各自量纲独立，桥边 static-init 假象另立盲区条目）。

## 4. 残余

- 桥边清单仍被 `SingletonMonoBehaviour.<static-init>` 类节点主导（2161 callers）——static-init 聚合节点
  的语义待单独评估（下一条盲区）。
- inDeg（治理清单）按调用边计数而非去重调用者——重载并集边使 ctor 重载共享计数（ApiException 414×2）。
