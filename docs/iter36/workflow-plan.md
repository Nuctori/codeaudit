# InitDeity 重构 × codeaudit 生产就绪化——完整 DAG 工作流（迭代 36+ 执行纲领）

> 目标：以真实重构 InitDeity（弱联网 Basebase 环境）驱动 codeaudit 生产就绪化；同时恢复游戏主流程、治理测试性能失控债务。
> 北极星（D-130）：codeaudit = **正确的 + 语言无关的 + 可自由拓展的** 代码质量管理库，极大方便代码质量管理和优化。
> 本文档是执行依据：DAG 结构、每节点产物、验收硬门槛、工程记录规范，全部可勾选可审计。

---

## 0. 三支柱 × 验证手段（每个重构动作必须对照）

| 支柱 | 定义 | 真实重构中的验证手段 |
| --- | --- | --- |
| **正确** | 判定方向安全（宁 UNKNOWN 不 PURE）、证明/不变量成立、无假纯 | 每轮独立审计（fresh reviewer）+ 方向安全断言 + 记账不变量 |
| **语言无关** | 统一 pack 抽象，5 语言同构（python/ts/tsx/js/csharp） | 跨语言回归网（fixture 矩阵）+ 新增语言包候选评估 |
| **可拓展** | 注入/白名单/自定义语言，用户可扩展不改库 | effectOverrides/frameworkPure/pureCtor 机制 + 真实项目注入验证 |

---

## 1. DAG 工作流总图

```
阶段 0: env-baseline
  ├─ env-unity      (修 Unity 版本匹配 62f2→62f3c1 + 验证 batchmode 可跑)
  ├─ env-basebase   (Basebase 预构建起服 + healthz + 记录 build 修复待办)
  └─ baseline-scan  (FullFlow-Core 红绿基线 + codeaudit InitDeity 扫描基线 unknown 4563)
        ↓ needs
阶段 1: test-debt（测试债治理——金字塔重建）
  ├─ t1-split       (巨型文件按领域拆: RuntimeMainlineAutopilotRuntimeTests 4864 行/StarterMainlineFlowTests 4407 行)
  ├─ t2-unittest    (无 Unity 依赖纯逻辑下沉为单元层——quest 判定/autopilot 决策纯函数)
  └─ t3-e2e-trim    (E2E 精简——只留关键用户路径, 去重 7 个 Ensure/Advance 驱动方法)
        ↓ needs
阶段 2: mainline（主流程恢复——用户路径驱动, 每 quest 一循环）
  ├─ q6-quest6      (quest 6 沿指引——真门链: 初始之地门+交互+大门_打开, 区分 quest14 BOSS 旁路)
  ├─ q7-quest7      (quest 7 撞罐——5 灵气罐 signal 宿主绑定)
  ├─ q8-quest8      (quest 8 恢复修为——expValue 10→20 已修, 端到端验证升级门槛)
  ├─ q9-9008        (9008 拾剑——GetFlyTip/技能选择/飞行解锁链)
  ├─ qa-quest9      (quest 9 沿指引)
  └─ qb-quest10     (quest 10 灭魔物——战斗入口)
        ↓ needs
阶段 3: codeaudit-ready（生产就绪化——贯穿 + 收尾）
  ├─ r1-blindspot   (重构盲区回流——每阶段暴露的工具盲区 → 修 codeaudit)
  ├─ r2-complexity  (resolveCall 207/resolveImport 190 拆分——独立审计已记录)
  ├─ r3-iter34fix   (独立审计 7 项修复: A1 项目类守卫/paramNames 冗余/--state 序列化防御等)
  └─ r4-release     (生产就绪清单 → v1.0 候选: 文档/API 契约/性能/发布)
        ↓
收尾: converge-audit（独立终审 + 基线对照报告 + 决策链归档）
```

**依赖规则**：

- 阶段 1 依赖阶段 0（测试要可信先修环境）
- 阶段 2 依赖阶段 1（E2E 可信先治债）
- 阶段 3 贯穿（每阶段收尾回流盲区）；r3-iter34fix 是代码侧修复，**可先行**（不阻塞环境）

---

## 2. 每节点：任务 / 产物 / 验收硬门槛

### 阶段 0：环境基线

| 节点 | 任务 | 产物 | 验收硬门槛 |
| --- | --- | --- | --- |
| **env-unity** | 修 FindUnityEditor.ps1 版本（62f2→62f3c1）；验证 Unity batchmode 可跑一个最小 EditMode 测试 | `docs/iter36/env-unity.md` | Unity.exe 定位成功；batchmode 跑测试 exit 0 + testResults XML 存在含 passed |
| **env-basebase** | Basebase 预构建 dll 起服；healthz 验证；记录 dotnet build 修复待办 | `docs/iter36/env-basebase.md` | `http://127.0.0.1:8080/healthz` → `{"ok":true}`；SQLite 可读写 |
| **baseline-scan** | FullFlow-Core 全量跑（含 Unity 子集）记录红绿；codeaudit InitDeity 扫描基线 | `Logs/fullflow-baseline.json` + `docs/iter36/baseline.md` | 报告可生成；27 capability 红绿清单明确；codeaudit 扫描数字与 4563 对照 |

### 阶段 1：测试债治理

| 节点 | 任务 | 产物 | 验收硬门槛 |
| --- | --- | --- | --- |
| **t1-split** | RuntimeMainlineAutopilotRuntimeTests 按领域拆（quest 判定/交互决策/状态管理）；StarterMainlineFlowTests 按主线段拆 | 拆分后的测试文件 + `docs/iter36/t1-split.md` | 巨型文件每文件 <2000 行；拆分后全量测试通过（用例数不变或 + 因暴露重复）；codeaudit 扫描无新增假纯 |
| **t2-unittest** | 识别 53 处直接调生产 API 中可静态测试的纯逻辑（quest 判定/autopilot 决策纯函数）→ 下沉独立单元层 | 单元测试文件（无 Unity 依赖）+ `docs/iter36/t2-unittest.md` | 单元层用例 ≥ 30 个纯逻辑断言；`dotnet test`（纯逻辑部分）可离线跑；覆盖 quest 6-10 判定函数 |
| **t3-e2e-trim** | 去重 7 个 E2E 驱动方法（EnsureStarterMainlineAtQuest9 等）；E2E 只留关键用户路径 | `docs/iter36/t3-e2e-trim.md` | E2E 用例数下降（目标 -30%）；每 quest 保留 ≥1 条真实用户路径；全量测试通过 |

### 阶段 2：主流程恢复（每 quest 一循环）

每个 qX 节点统一模板：

| 项 | 内容 |
| --- | --- |
| **任务** | codeaudit 分析该 quest 相关代码（效应/耦合/盲区）→ 找阻断 → 最小修复 → 用户路径 PlayMode 测试 |
| **产物** | `docs/iter36/quest-N.md`（分析/修复/证据）+ PlayMode 测试 + 结构化 marker |
| **验收硬门槛** | ① 用户路径测试通过（真实玩家操作序列，非合成）② 结构化 stage marker 出现（如 `questN_signal_triggered`）③ testResults XML 真实生成且该用例 passed ④ codeaudit 扫描该 quest 相关 chunk 无假纯 |

| 节点 | 已知卡点（历史证据） |
| --- | --- |
| **q6-quest6** | 真门链：初始之地门 + 交互 + 初始之地_大门_打开；区分 quest14 BOSS 房门口旁路（旧测试误把 BOSS 门口当 quest6） |
| **q7-quest7** | 撞碎 5 灵气罐 → signal(quest7,1)；prefab 宿主绑定确认 |
| **q8-quest8** | 升级门槛：expValue 10→20 已修（区块0_山洞.prefab）；端到端验证 level 2 + signal(8,2) |
| **q9-9008** | 拾剑链：GetFlyTip / 技能选择 / 飞行解锁 |
| **qa-quest9** | 沿指引前进（引导点真实触发） |
| **qb-quest10** | 灭魔物 → 战斗入口（combat-entry）→ 后续 combat-boss-loop 独立 |

### 阶段 3：codeaudit 生产就绪

| 节点 | 任务 | 产物 | 验收硬门槛 |
| --- | --- | --- | --- |
| **r1-blindspot** | 每阶段收尾把工具盲区入列；统一修复 | `docs/iter36/blindspots.md`（盲区清单 + 修复状态） | 每个盲区有 evidence（文件:行 + 预期 vs 实际）且修复有测试 |
| **r2-complexity** | resolveCall（cognitive 207）/resolveImport（190）拆分 | 拆分后代码 + `docs/iter36/r2-complexity.md` | 拆分后 cognitive 下降（目标 <150）；行为不变（全量测试通过 + fixture 无回归） |
| **r3-iter34fix** | 独立审计 7 项修复（**可先行**） | 见 §3 修复清单 | 每项有回归测试；304+ 全绿 |
| **r4-release** | 生产就绪清单：README/API 契约/性能基准（大项目扫描 <30s）/发布 v1.0 候选 | `docs/iter36/r4-release.md` | 清单全勾选；消费者安装冒烟（GitHub 直装）；性能基准达标 |

---

## 2.5 可控发散思维专家（divergence-oracle）——避免钻死胡同过早收敛

> 动机（用户 2026-08-12）：主流程恢复的密集重构易陷入局部最优（反复修同一类问题而不跳出）。
> 设计目标：**定期强制跳出当前思维框架**，审视被忽略的方向/盲区/替代路径，但**受控**——
> 发散产物必须回流主线，不无限漂移。

### 触发时机（每个阶段边界 + 每 3 个 quest 节点）

| 触发点 | 发散问题 | 产物 |
|---|---|---|
| 阶段边界（0→1、1→2、2→3） | 本阶段是否有"以为对但可能错"的假设？工具盲区是否被当成设计边界？ | `docs/iter36/divergence-<stage>.md` |
| 每 3 个 quest 节点 | 主流程是否在修"现象"而非"根因"？是否有更小的 game-state 改动路径？ | `docs/iter36/divergence-quest.md` |
| codeaudit 每轮独立审计后 | 审计发现的修复是否治标？是否存在结构性问题（需重构而非补丁）？ | 追加到 minimize-audit |

### 发散专家工作方式（fresh-context reviewer/advisor）

1. **输入**：最近 N 个节点的 diff + 决策链 + 基线对照 + 盲区清单
2. **发散**（允许跳出框架）：
   - 假设挑战：质疑当前方向的前提（如"quest 6 门链是正确卡点"→ 是否其实是场景加载/输入系统问题）
   - 盲区扫描：codeaudit 未覆盖的信号（测试日志中的异常、被忽略的 marker、历史遗留文档）
   - 替代路径：更小/更快的 game-state 改动（如"补 expValue"vs"改升级门槛判定"）
   - 工具反思：codeaudit 本次重构暴露了什么（真盲区 vs 误报 vs 方向安全妥协）
3. **收敛**（强制回流）：
   - 每个发散发现必须给出：证据 + 采纳/记录/拒绝 + 理由
   - **采纳** → 进入下一节点任务；**记录** → 盲区清单；**拒绝** → 写明理由（防重复发散）
4. **防失控**：
   - 发散有预算（≤15min 或 ≤3 轮子代理）
   - 发散结论必须"回写主线"（要么产生新节点，要么确认当前方向继续）
   - 连续 2 次发散无采纳 → 暂停发散 1 轮（防止为发散而发散）

### 验收

- 每阶段边界有发散报告（含采纳/记录/拒绝三栏）
- 被采纳的发散方向有对应节点/任务（不回写 = 发散失效）
- 防偷懒协议适用：发散报告也必须有证据，禁止"我觉得可能有别的问题"式无据发散

---

## 3. 优先修复队列（r3-iter34fix——独立审计 7 项，代码侧先行）

| # | 发现 | 严重度 | 修复 |
| --- | --- | --- | --- |
| 1 | **A1 参数绑定无项目类守卫**——项目自建 List/Dictionary 类作参数类型 → `xs.Add` 判 PURE（假纯，红线） | **High（假纯方向）** | link.ts A1 分支加 globalClasses 项目类守卫（4 行，与 ctor 分支对称） |
| 2 | paramNames C# fallback 冗余夹带（实证 C# 全有 parameters 字段，补丁不可达） | Low | 删 fallback + 修正错误前提注释 |
| 3 | paramTypesOf 注释-行为不符（收集全部类型非"仅合类型"） | Low | 修正注释（string/int 表条目全纯方向安全已实证） |
| 4 | ctor 优先级注释与实现不符（impureGlobals vs 项目类顺序） | Low | 修正注释（行为有界可辩） |
| 5 | ctorTypeName 旧行为描述失真 | Low | 修正注释 |
| 6 | --state 500 硬上限无数学保证（500 × 巨大 readerKeys 仍可超 V8 上限） | Med | 序列化前长度估算/渐进截断，或注释注明残余 |
| 7 | CHANGELOG 缺迭代 35 条目 + docs/iter35 空目录 | Low | 补文档 |

**验收**：每项修复有回归测试；304+ 全绿；独立复审通过。

---

## 4. 工程记录规范（每节点强制）

每节点完成后必须产出**四件套**（沿用 codeaudit 既有惯例）：

| 记录 | 内容 | 硬性要求 |
| --- | --- | --- |
| **audit/analysis** | 分析/阻断定位（证据：文件:行 + 预期 vs 实际） | 不写"我认为"——全部有实证 |
| **impl/fix** | 改动清单 + 每项改动的最小性说明 | diff 可审；无夹带 |
| **verify/test** | 测试证据（命令 + 输出 + XML） | 真实跑通，非自述 |
| **record/decision** | 决策链条目（D 链）+ 基线对照 | 关键取舍入链；对照数字 |

**额外纪律**：

1. 基线对照表（阶段 0 → 阶段 2 结束）：unknown 率/测试成本/E2E 数量/主流程通过数——收敛证据
2. 每阶段收尾独立审计（fresh reviewer）——最小化非工程妥协检查
3. 弱联网纪律：Basebase localhost 唯一后端；不依赖内网/外网；包管理仅本地
4. Unity 验证纪律：exit 0 不单独作为证据——必须同时见 testResults XML + 目标用例 passed
5. 脏文件纪律：用户工作树 158 脏文件严格隔离；只改任务相关文件

---

## 5. 风险与熔断

| 风险 | 缓解 |
| --- | --- |
| Unity batchmode 不稳定（历史 2/12 次偶发崩） | 重试机制 + XML 证据双确认；CI 观察并发 |
| Basebase build 坏（VS NuGet 路径） | 预构建 dll 路径优先；build 修复列独立待办 |
| 阶段 2 quest 卡点深（宿主绑定/信号链） | 每 quest 独立提交；卡点按"最小 game-state 改动"原则，不扩散 |
| A1 假纯若已污染语料 | 修复后重扫对照；已污染标注标记 |
| 弱联网中断 | 全本地依赖；无远程拉取 |

---

## 6. 当前执行状态（从哪里开始）

1. **已完成**：r3-iter34fix（7 项）、r2-complexity（resolveImport 拆分）、env-basebase（19+ 能力域绿）、env-unity（许可证 IPC 解决 + 编译通过）、t2-unittest（单元层 48 断言）、发散专家节点（§2.5）
2. **当前**：阶段 2 主流程恢复启动点——环境已通（Unity 许可证 ✓ 编译 ✓ 运行时 ✓），Basebase 就绪
3. **待处理**：Unity 运行时 TcpProtobuf 连 Basebase 超时（弱联网降级——确认 localhost 连接或离线短路）→ 跑 quest 6 用户路径 E2E

