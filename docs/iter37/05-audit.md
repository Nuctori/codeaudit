# 迭代37 独立审计：无特例语言无关最小化改造实施结果（05-audit）

> 审计者：独立复审子代理（未参与实施）。只读核查：git diff/log、源码逐文件、`tsc`、`vitest`、运行时探针。
> 基线对照：docs/iter37/03-synthesis.md（可执行改造清单）。
> 核查对象：`c90f401`（P0-1/P0-2/P1-1）+ `e10e620`（P2-5）+ 工作树（含 untracked `docs/iter37/p0-1-gameobject.md`，P0-1 worker 日志）。

---

## 结论：**FAIL**

运行行为全部正确（307/307 测试绿，验收口径 ①③ 达标，无假纯、无过度抽象），但存在 **1 个 blocker**：
P0-2 的 2-bit 字段（`assignmentScopesLocals` / `bareNameMeansThisInMethod`）**从未进入 `LangPack` 接口**，
`npm run build`（tsc）报 6 个类型错误退出 2；`e10e620` 提交信息声称「pack.ts 恢复 P0-2 2-bit 字段」但该提交对 pack.ts 的实际 diff **只有 G3' 护栏注释**——恢复未落地，提交信息失实。

基线（`2c90d9b`）实测 `tsc --noEmit` exit 0；HEAD 实测 exit 2。构建红线被破坏。

---

## 一、逐项核实表

| 清单项 | 优先级 | 预期（03-synthesis） | 实际（HEAD 实测） | 判定 |
| --- | --- | --- | --- | --- |
| P0-1 gameObject 前缀数据化 | P0 | link L646-654 `startsWith("gameObject.")` → `pack.frameworkAttrPrefix` 查表；位次在 assigned 守卫前；miss 落回 ? | link.ts L642-658 已数据化，位次正确（在 2.5 frameworkIo 的 assigned 守卫之前）；`grep gameObject src/engine/` 仅剩注释；槽位 `frame:${head}` 对 C# 输出 `frame:gameObject` 与原槽位一致；C2 测试（csharp-lang.test.ts L678-705）逐字未变；+E/F 两用例 | **达成** |
| P0-2 extractor 2-bit 数据化 | P0 | pack.ts +2 布尔字段；extractor L425/L432/L487 判据换字段；python T/F、ts F/F、csharp F/T | extractor 3 处已换字段（L425/L432/L487）；三包字段值正确（python.ts L180-181、typescript.ts L260-261、csharp.ts L584-585）；`pack.name` extractor 控制流 = 0（仅 L104 记账） | **运行时达成；类型层失败（blocker）** |
| P1-1 effectOverride 注入白名单补全 | P1 | frameworkPure（ns-nested-pure-hof）+ pureCtor（set）入白名单与校验；深合并；~25 行；校验测试扩展 + 注入端到端用例；CLI/README 文档 | 实现完整（effectOverride.ts：EffectTables +2、SHAPES +2、validateEffectOverride L121-144 校验、mergeFrameworkPure L225-253 三层深合并、applyEffectOverrides L278-279）；运行时探针实证：合法形状通过、非法 tag 拒绝、深合并保内置 System、pureCtor 并集保 52 内置；**但计划要求的校验/端到端测试未写（0 用例），README 未更新** | **功能达成；测试与文档欠账（note）** |
| P2-5 G3' 护栏 + 债单重基线 | P2 | pack.ts/link.ts 注释声明通道分派语义；technical-debt.md 重基线到 305/305 | pack.ts L90-95 G3' 护栏注释 ✅；technical-debt.md 已重基线（标题 + A4-A6 闭环 + B1 标注 P1-1 缓解 + C6/C7 新增 + D2 闭环 + 迭代37 清空项节，基线声明 c90f401/307） | **达成** |
| P2-4 低价值清理（node:/cjsExportName/bytes） | P2 可选 | 行为保持收敛（0c 步可选） | 未做（link.ts L195 `replace(/^node:/,"")` 仍在）。计划标「可选收尾」，验收口径三项不依赖它 | **未做，非失败** |
| P2-1 统一效应表 / P2-2 A1 无门泛化 / P2-3 ctor 对称泛化 | 明确拒绝 | 不做 | 未做（G3' 护栏已声明拒绝理由） | **符合** |
| P1-2 局部绑定 / P1-3 并集边 | P1 独立轮次 | 前置语料度量/产品裁决，本轮不实施 | 未做；technical-debt.md 记为 C6/C7 保留 | **符合** |

**验收口径核对**（03-synthesis §4，Jeff §3 采纳）：

| 口径 | 实测 | 结果 |
| --- | --- | --- |
| ① `grep "gameObject" src/engine/` 仅剩记账槽位字符串 | 仅 link.ts L643-644 注释；无逻辑分支、无字面量 | ✅ |
| ② 305/305 绿 + 全量 e2e 断言不变 | `npx vitest run` → 29 files / **307 passed**（=305 基线 + E/F 两新增）；C2 断言逐字未变；**但 `npm run build`（tsc）exit 2 失败** | ⚠️ 测试绿，构建红 |
| ③ `pack.name` extractor 控制流 = 0 | 仅 L104 记账（lang: pack.name），无分流 | ✅ |

---

## 二、Blocker 清单

### B1. P0-2 字段类型缺失 → `npm run build` 失败（提交信息失实）

- **文件**：`src/lang/pack.ts`（LangPack 接口，缺字段）；引用方 `src/lang/extractor.ts:425,432,487`；设置方 `src/lang/packs/csharp.ts:584-585`、`src/lang/packs/python.ts:180-181`、`src/lang/packs/typescript.ts:260-261`
- **预期 vs 实际**：
  - 预期（P0-2）：`LangPack` 增加 `assignmentScopesLocals: boolean` 与 `bareNameMeansThisInMethod: boolean` 两个必填字段（plan「pack.ts +2 布尔字段」，~14 行）。
  - 实际：`LangPack` 接口**无这两个字段**（grep 全文件零命中，三个提交版本 `2c90d9b`/`c90f401`/`e10e620` 均无）；extractor 读取、三包写入，类型两侧都悬空。
  - `e10e620` 提交信息写「pack.ts 恢复 assignmentScopesLocals/bareNameMeansThisInMethod（并行会话覆盖后重建）」，但该提交对 pack.ts 的 diff（`git show e10e620 -- src/lang/pack.ts`）**只有 +6 行 G3' 注释**——恢复没有进入提交，信息与内容不符。
- **实测证据**：
  - `node node_modules/typescript/bin/tsc --noEmit` → exit 2，6 错误：
    - `extractor.ts(425,21)/(432,21)/(487,23): TS2339 Property does not exist on type 'LangPack'`
    - `csharp.ts(584,2) / python.ts(180,3) / typescript.ts(260,3): TS2353 excess property`
  - 基线对照：`git checkout 2c90d9b -- .` 后同命令 exit 0（基线构建干净，证明这是本轮引入的回归）。
  - `npm run build`（package.json: `tsc`）同样 exit 2；`prepare`（install 时执行）亦挂。
  - vitest 307/307 通过——esbuild 转译不做类型检查，运行时字段实际存在，**运行时行为正确，纯类型层断裂**。
- **影响**：构建/CI 门禁全挂；`dist/` 无法从 HEAD 正常重建（现有 dist 为含错 emit/陈旧产物）。功能上三语言 stateWrites 语义均正确（307 绿）。
- **修复建议**（约 4 行，行为零变化）：在 `src/lang/pack.ts` `LangPack` 接口数据侧补声明：

  ```ts
  /** Python：赋值即局部定义（迭代37 P0-2）。 */
  readonly assignmentScopesLocals: boolean;
  /** C#：方法内裸字段写 = this 字段（self.x；迭代37 P0-2）。 */
  readonly bareNameMeansThisInMethod: boolean;
  ```

  补后 `tsc --noEmit` 应 exit 0，307/307 保持；并修正 `e10e620` 提交信息（或补一个修复提交）。

---

## 三、审计要点逐条回答

### 1. 对照 03-synthesis.md 逐项核实：是否全部实施、是否符合清单描述

见第一节表。P0-1/P1-1/P2-5 全部实施且与清单描述一致（P0-1 有一处实现细节偏差，见下）；P0-2 运行时一致但类型层缺失；P2-4 属「可选」未做；P1-2/P1-3 按计划延后；P2-1/P2-2/P2-3 明确拒绝项未做——均符合清单。

### 2. 达成度

- **link.ts 语言特例分支**：已清零。`X.gameObject.*` 硬编码 → `frameworkAttrPrefix` 数据化（link.ts L642-658），`gameObject` 在 src/engine/ 仅剩注释。`node:` 剥离（L195）仍在（P2-4 可选未做），不破坏本轮验收口径。
- **LangPack 仅单一语言使用的字段**：`frameworkAttrPrefix` / `pureCtor` / `frameworkPure` 均为 C# 单用（可选字段）。按 E/Φ 分解这**不是问题**——机制通用、数据语言专属，正是「数据侧已通用」的既有形态（Jeff §1-c 采纳）；缺陷只在 P0-2 两个字段连接口声明都没有（B1）。
- **语言包数据同构**：python 与 ts 包键集合完全一致（除 name/extensions/wasm）；csharp 更丰富（C# 语义表多，合法差异）；三包均设置 2-bit 字段（值符合清单：python T/F、ts F/F、csharp F/T）；tsx 经 spread 继承 2-bit 正确。同构性成立。

### 3. 正确性

- **测试**：`npx vitest run` → 29 files / 307 passed（7.3s），无回归。E/F 新增用例方向正确（E：Python 无表 → UNKNOWN 不误判 io；F：C# 命中 → IMPURE io）。C2 既有断言（4 形态：Hide/Ext/Direct/Local）逐字不变。
- **假纯（A6 S1）**：未引入。P0-1 只新增 io（过近似 S2 方向安全），无纯通道；P0-2 纯判据重构零效应面；P1-1 注入数据与手写包数据等价（iter28 F16 既有信任模型，非新引擎通道）；miss 路径全落 ?（S4 保持：白名单 miss → 后续分支 → UNKNOWN，E 用例实证）。
- **P0-1 语义等价性**：实现用 **attr 首段**（head）查表而非清单描述的 `call.obj` 查表——worker 日志（p0-1-gameobject.md L31）自证，对 C# 数据（head 恒 "gameObject"）逐点等价，E/F/C2 三用例共同证明；槽位 `frame:${head}` 与旧 `frame:gameObject` 一致。可接受偏差。
- **运行时探针（P1-1）**：直接 require dist 实测——合法 `frameworkPure`/`pureCtor` 注入校验通过、非法 tag 拒绝、三层深合并保留内置 System、pureCtor 并集保留全部 52 内置 + 新增。功能正确。
- **B1 是唯一正确性缺口**：类型层断裂 + 提交信息失实。

### 4. 最小性（Jeff 标准：为统一而统一 = 过度抽象？）

- P0-1：单语言单键表（frameworkAttrPrefix 仅 C# gameObject 一条）——这是 Jeff 明确的**最小完成态**（§0「数据化它是本轮的最小完成态」），非过度抽象。
- P0-2：2 个布尔替代 3 处 `pack.name` 分流，最小。
- P1-1：补全既有注入白名单（补映射类），非新抽象。
- P2-1 统一效应表被明确拒绝且未被实施——最可能的过度抽象被护栏挡下。
- 判定：**无过度抽象**。
- 次要观察（非 blocker）：csharp.ts L399（frameworkIo.gameObject）与 L423（frameworkAttrPrefix.gameObject）清单**重复**——plan 允许「搬移或共享引用」，实现选择复制，当前完全一致但未来单边修改会漂移。

---

## 四、残余风险

| 风险 | 说明 |
| --- | --- |
| 构建红线（B1） | 修复前任何 CI/prepare 流程失败；dist 无法可靠重建。修复成本 ~4 行，无行为面。 |
| P1-1 无测试网 | 计划要求的校验+端到端用例未写（0 用例）；实现正确性目前只靠代码评审 + 本审计探针，无防回归。README effect-table 文档未补 frameworkPure/pureCtor 示例。 |
| 提交信息失实 | e10e620 声称「恢复 2-bit 字段」实际未发生——后续维护者按提交信息排查会误判；建议补修复提交并修正信息。 |
| P2-4 未做 | 引擎仍有 `node:` 剥离一处语言字符串（link.ts L195）；「引擎零语言常量」完整态未达，但非本轮验收项。 |
| 清单复制漂移 | frameworkIo.gameObject ↔ frameworkAttrPrefix.gameObject 双份；建议未来改为单一数据源（export 共享引用）。 |
| dist 陈旧 | dist/ 为含错 emit/陈旧产物（gitignored，未跟踪）；B1 修复后需重建。 |
| 审计副作用披露 | 审计期间运行了 `node_modules/typescript/bin/tsc`（非 --noEmit）一次，重写了 gitignored 的 dist/ 产物（非源代码，无跟踪文件受影响；git status 仅剩原有 untracked p0-1-gameobject.md）。 |

---

## 五、总评

改造意图与工程量完全符合 03-synthesis 的裁决：P0-1 数据化（Jeff 最小完成态）干净达成且语义等价有测试证明；P1-1 注入补全功能完备（缺测试/文档）；P2-5 护栏与债单重基线到位；拒绝项全部未越线；无假纯引入、无过度抽象。**唯一实质缺陷是 P0-2 的类型层落地事故**——2-bit 字段在接口侧缺失且声称的「恢复」未进入提交，导致构建失败。这是交付态问题（提交信息与产物不符 + 构建红线破坏），按执行-门禁纪律判定为 **FAIL**；修复为 4 行声明级改动，修复后应即达 PASS 态。
