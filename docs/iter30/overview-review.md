# 迭代 22-29 跨迭代整体一致性复审（overview-review）

> 只读综合复审：HEAD e5f33ba（v0.3.0）。范围 = 文档一致性（非代码审查）：docs/iter22/record.md … docs/iter29/record.md（8 份）+ CROSS-AUDIT.md 迭代 22-29 节 + 各迭代 audit/impl/verify 关键数字交叉核对。
> 独立验证：全量测试复跑 285/285（28 文件）、tsc 0、README 门禁 OK 285、iter22 存档报告（40MB）逐字段反查、InitDeity 现场只读复扫（--no-cache）。

## 结论：CHANGES

存在 2 个 MEDIUM 级跨迭代数字矛盾（iter24 基线列误标 + UNKNOWN rate 与存档报告/iter25 计数对不上），需在 iter24 文档勘误；无代码/测试级问题，其余数字链一致。矛盾全部在文档口径层，不影响代码正确性与测试结论。

---

## a) 跨迭代矛盾清单

| # | 严重度 | 矛盾 | 证据 |
| --- | -------- | ------ | ------ |
| A1 | **MEDIUM** | **iter24/impl.md「修复前（迭代23 复扫）」基线列 9449/8590 与 iter23 自己的收紧后数字 9349/8590 矛盾**（Δ100 = 恰为 iter23 frameworkIo 收紧量）——iter24 表把 **iter22 报告值**当成了「迭代23 复扫」结果 | iter24/impl.md L19-26 vs iter23/impl-frameworkio.md L20-27（9449→9349/−100、UNKNOWN 5761→5860、PURE 8590 不变）；CROSS-AUDIT iter23「IMPURE 9449→9349（−100）」 |
| A2 | **MEDIUM** | **UNKNOWN rate 三处互斥**：iter22 audit 记录 27.7%、iter24 声称 28.1%→25.0%、iter25 记录同一 post-state 计数 5195/23799=21.8%（iter24 自身计数隐含 5170=21.7%）——28.1% 与 25.0% 均无法由任何已记录计数复现 | iter22/initdeity-audit.md L21「unknown-rate 27.7%」+ 存档报告实测 chainCertain false 6596/23800=**27.7%**（可复验）；iter24/impl.md L25「28.1%→25.0%」；iter25/impl.md L30「5195→5461」 |
| A3 | LOW | iter24 修复后 IMPURE/PURE 10537/8092 vs iter25「迭代24 后」基线 10545/8059（Δ8/Δ33，UNKNOWN 隐含 5170 vs 5195）——同一状态两组数字；量级小，疑语料脏文件漂移（iter22 audit 已警示 156 脏文件 chunk id 漂移），但两文档均未注明差异来源 | iter24/impl.md L26 vs iter25/impl.md L30 |
| A4 | LOW | iter23「IMPURE −100」以 iter22 报告 9449 为基线，但 iter22 实际收尾为 TestShake 删除后 9448（iter22 CROSS-AUDIT 自述）→ 真实 Δ=−99；「UNKNOWN +99 守恒」实为 +100（5761→5860，TestShake 删除不影响 UNKNOWN）。文档自注「近似守恒」，量级 1，数字不严谨但语义成立 | iter22 CROSS-AUDIT「IMPURE 9449→9448」；iter23/impl-frameworkio.md L25-31 |
| A5 | INFO | **任务前提「iter26 说 24.7%、iter28 说 24.7%」在全部文档中无据可查**——全库 grep「24.7」零命中；iter26/iter28 文档未做任何 UNKNOWN rate 声明（iter26 仅 audit.md:31 机制描述，iter28 仅 fixture 级 UNKNOWN）。当前 HEAD 现场复扫实测 chainCertain=**24.7%**（UNKNOWN purity 5103/23799=21.4%）——前提数字疑来自现场扫描输出而非文档；趋势方向（27.7%→24.7% 递减）与 iter22 基线自洽 | 全库 grep「24.7」0 命中；本次复扫 /tmp/initdeity-head.json：chainCertain false 5873/23799=24.7% |

**趋势方向自洽性**：UNKNOWN 计数链 5761（iter22）→5860（iter23）→≈5170（iter24 隐含）→5195（iter25 前）→5461（iter25 后）→5103（HEAD 实测）方向合理（iter25 的 +266 由 ++ 写补/self 收敛的 IMPURE→UNKNOWN 迁移解释，iter25 record 已注明）；**问题仅在百分比口径**（27.7/28.1/25.0 三数互斥）。

**重复修复声明检查（任务 b）**：无重复。唯一同类问题两次处理为 --gate/--state 旗标分支顶替（BLOCKER 二次再现）——iter23 明确记录为「同类复发 + 根因护栏」，非重复修复声明；ConvertToString ×47 假阳 iter22 列为盲区、iter23 唯一闭环；对象初始化器裸写 iter24 列待办、iter25 唯一闭环；lambda/element_access iter25 列待办、iter26 唯一闭环；variable_declarator iter26 列待办、iter27 唯一闭环；CLI --effect-table iter28 列待办、iter29 唯一闭环。

**下轮待办闭环检查（任务 c）**：无「过期待办」（已在后续实现但仍列待办）——所有被实现的下轮待办均由实现迭代显式闭环（iter23 闭 iter22①③、iter25 闭 iter24①②③、iter26 闭 iter25②③、iter27 闭 iter26①、iter29 闭 iter28①）。**反向问题（追踪丢失，非过期待办）**：

- **F4 sideEffects 认证**：iter22-27 延续列表连续 6 轮在列，iter28/29 延续列表静默消失，未记录处置；
- **读侧不对称**（iter25①/iter26②/iter27④）、**方案 B**（iter27②/iter28④）：在后续迭代列表中消失，未注明关闭或继续；
- iter28 record「需新建 spawn 测试基础设施（现无先例）」被 iter29 实证推翻（robustness.test.ts run() helper L82-89、8 个 spawn 先例）——iter29 CROSS-AUDIT 已显式标注「已证过时」，自愈记录，保留为信息项。

---

## b) 过期待办清单

无（见上：所有已实现待办均已注销；3 项属「静默消失」需补处置记录，非「已实现仍列」）。

---

## c) 整体一致性结论

**CHANGES**（首行结论）。依据：

1. **一致且已验证的部分**（占绝大多数）：
   - 测试数链 236→247→258→261→265→269→273→282→285 逐迭代衔接无断点；独立复跑 **285/285（28 文件）**、tsc 0、README 门禁 OK 285——与 iter29 记录完全一致；
   - 各迭代 InitDeity 主指标链自洽：instance 读者 2633→1005（iter24）、stateCoupling 6860→5919→6591（iter25/26）、top 写方结构 iter27 与 iter26 一致、TestShake chunks 23800→23799；
   - 提交链与基线 HEAD 一一对应（17adf9f=Iter-23 … e5f33ba=HEAD，与各 record 基线声明吻合）；
   - 无重复修复声明、无过期待办。

2. **需勘误的部分**（全部文档层，均不触及代码/测试结论）：
   - A1：iter24/impl.md「修复前（迭代23 复扫）」基线列应为 9349/8590/5860（iter23 收紧后），或明示该列引用 iter22 报告而非 iter23 复扫；连带 iter24/record.md 与 CROSS-AUDIT iter24 节中的 IMPURE 9449 表述；
   - A2：UNKNOWN rate 需统一口径（chainCertain 基 vs purity 基）并勘正 28.1%/25.0%（与 iter22 27.7% 及 iter25 计数 21.8% 对不齐）；
   - 追踪丢失 3 项（F4/读侧不对称/方案 B）补一句处置记录。

**建议动作**：对 iter24 文档做一次勘误提交（口径统一 + 基线列标注），对 iter28/29 延续列表补 F4/读侧不对称/方案 B 的处置注记；不阻塞 v0.3.0 发布结论。

## 验证证据

- `node node_modules/vitest/vitest.mjs run` → 28 passed / 285 passed（7.26s），独立复跑；
- `npx tsc --noEmit` → 0 错误；
- `node scripts/check-readme-tests.cjs` → README test count OK: 285；
- iter22/initdeity-report.json 反查：purity {0:8590, 1:5761, 2:9449} total 23800（与 iter22/23 记录一致）；chainCertain false 6596/23800=27.7%（复验 iter22 的 27.7%）；
- InitDeity 现场复扫（--no-cache）：purity {0:8044, 1:5103, 2:10652} total 23799；chainCertain 24.7%；
- 全库 grep「24.7」：0 命中（A5 依据）。
