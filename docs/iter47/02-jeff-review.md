# 迭代47 工程评审：圈复杂度语义 + 簇聚合形态（02-jeff-review）

> 评审者：工程视角（落地成本 / 输出交互 / 测试策略 / 回归风险）。
> 前置：01-math-review.md（数学裁决：方案 A do-now / B do-later / C defer）。
> 只读评审，未改仓库源码。基线 HEAD c3b478b + 工作树 iter46 并行改动。
> 注：链式 plan.md/progress.md（.pi-subagents/chain-runs/2c2dd028/）不存在（ENOENT），按 00-plan + 01-math-review 直接评审。

---

## 〇、本次逐行核对的锚点（与数学评审的差异已标）

| # | 事实 | 锚点 |
| --- | ------ | ------ |
| E1 | **污染累加点在 module.ts:54-55**（循环内 `const cx = v.chunk.complexity ?? 0; maxComplexity.set(...)`），非数学评审标注的 68-69（那是输出 push 段）——**实现者按 54-55 改** | src/core/module.ts:54-55（对照 66-77） |
| E2 | `--complexity` 已过滤类 chunk（`kind !== "class"`），打印循环在 639-642 | src/cli.ts:631-635 |
| E3 | 类 chunk 复杂度 = 全子树计数：extractor 对**每个** chunk（含 class）执行 `mc.complexity = this.complexityOf(node)`（85 行），complexityOf 遍历整个子树（1373-1387） | extractor.ts:85 / 1373-1387 |
| E4 | `kind` 取值：class/function 在 extractor.ts:82 判定；`<module>` 伪 chunk 走 `fresh(...,"module")`（43 行）且无 complexity 字段 → module.ts 中 `?? 0` 无害 | extractor.ts:43/82；module.ts:54 |
| E5 | `nesting` 独立遍历（maxNesting 1354-1369），两轴表数据不重叠：C# complexityNodes（929-940）含 switch/catch/三元，nestingNodes（771-784）含 class/lambda/method——**互为补充** | csharp.ts 两段 |
| E6 | 方法名 = `ownerClass.name` 限定（link.ts:489）；nesting/complexity/kind 透传（493-495） | link.ts:489-495 |
| E7 | 类 chunk 的 **maxChain 不受污染**：chain 是链上 max（幂等），不是和——类 chunk 的 chain = 各方法 chain 的 max，与函数级 max 天然一致。**maxChain 一行都不用动**（与数学评审 §5 裁决一致，此处给出工程理由） | module.ts:52-53 |
| E8 | 无测试断言 maxComplexity（moduledeps.test.ts 仅 chunks/purity/effects）；已有 complexity.test.ts 只覆盖 extractor 函数级计数 | test/unit/moduledeps.test.ts、test/unit/complexity.test.ts |
| E9 | complexity 消费面 = cli.ts --complexity/--modules + JSON 透传，risk/proof 零消费 | grep 全仓 `.complexity` |
| E10 | **嵌套类归属断裂已实锤**：ownerClass() 取**最近**类祖先（extractor.ts:1341-1351）→ 嵌套类 chunk 名 "Outer.Inner"（owner=Outer），其方法名 "Inner.M"（owner=Inner）——前缀匹配按类 chunk 名分组**必然失败**。数学评审 §1.2 的脆弱性判断成立 | extractor.ts:1341-1351；link.ts:489 |

---

## 一、数学 do-now（方案 A）的工程裁决：**批准，落地成本极低，零回归面**

| 维度 | 裁决 | 依据 |
| --- | ------ | ------ |
| 落地成本 | ~20 行（2 行核心 + 1 行注释 + ~15 行测试），单会话可完成 | E1/E2：守卫 1 行 + 注释；无新类型、无新 CLI 面、无 pack 表改动 |
| 与现有输出交互 | --modules C 列从「Σ/异质 max」变为「函数级 max」——**唯一可见变化，且是预期变化**；JSON 不变（类 chunk complexity 保留）；--complexity 不受影响（已过滤） | E2/E9；模块表仅 cli.ts:624 一处消费 |
| 缓存/管线影响 | **零**。不改 extractor、不改 pack 表（effectOverride.ts:57 的 cache-key 形态清单无涉）→ RawFileFacts 不变 → cache.json 不失效，verdicts 字节级不变 | 方案 A 全部改动在 module.ts + types.ts + cli.ts（纯派生/展示层） |
| 测试策略 | 新增断言而非改造既有测试：moduledeps.test.ts 加一个类内双分支方法 fixture（类 Σ > 任一方法 C），断言 `maxComplexity === 方法级 max`；既有测试零破坏 | E8 |
| 回归风险 | LOW。唯一行为差异是模块表 C 列数值下降（污染数字归零）；无其他消费者 | E9 |

**工程补充修正（数学评审 §5）**：守卫放在 `moduleSummary` 循环内（数据层）而非 cli.ts 调用侧——同意且必须。具体形态：

```ts
// 迭代47：模块级 max = 函数级 max（类 chunk 的 Σ 是尺寸代理，与 --complexity 口径对齐）
const cx = v.chunk.kind === "class" ? 0 : (v.chunk.complexity ?? 0);
```

`kind === "class"` 的严格等值判断安全：`kind` 缺失（undefined）视同 function 纳入，与现状行为一致；`<module>`/`<static-init>`（kind="module"）本就 `?? 0` 无影响。

**maxChain 不动的工程理由**（补强数学 §5）：chain 是路径 max，幂等 ⇒ 类 chunk 的 chain 恒等于函数级 max，**没有量纲混排问题**——污染只在 Σ 形态的 complexity。

---

## 二、类级复杂度画像（方案 B）的实现形态裁决：**do-later，report/link 层纯派生，extractor 零改动**

- **否定 extractor 侧聚合**：类 chunk 的复杂度就是全子树 Σ（E3），已经是"聚合"了——它在数学上恰好是**错的形态**（尺寸代理）。extractor 不能再产任何类级单数。
- **正确形态 = 消费侧纯派生**：verdicts 已含全部函数级 chunk（含 complexity/nesting），分布 (k, M, p90) 可全量现算，零新扫描、零新字段、零缓存失效。这是最优雅路径，与 math §1.2/§3.2 的「p90 从基准集现算」一致。
- **唯一的实现前置障碍 = owner 归属**：现 Chunk 类型只有限定名（link.ts:489），顶层类可按 `Class.` 前缀分组；**嵌套类必然断**（E10：类 chunk 名与成员名前缀不一致）。do-later 时的正解：RawChunk 的 `rc.ownerClass` 本来就存在（extractor.ts:81），只在 link.ts:489 处被揉进 name 丢弃——补一个 `ownerClass` 字段透传 = link.ts 1 行 + types.ts 1 行。**本轮不动。**
- **裁决**：方案 B 不入本迭代（无消费者 + 需 owner 字段设计轮），数学形态已定档；若未来实施，禁止从类 chunk Σ 反推分布（数学 §3.2：分位数不可组合）。

---

## 三、--modules 字段集修正 + --complexity 嵌套列：**修正同意；加列同意（1 行，展示层）**

### 3.1 --modules 修正（方案 A 本体，见 §一）——改完字段集**不再增删**

C 列语义从「Σ/异质 max」→「函数级 max」，其余列（chunks/P/U/I/unknownRate/chain/effects）不动。模块级 p90 属方案 B do-later，不引入。

### 3.2 --complexity 加嵌套深度列：**加**（正交双列，1 行展示改动）

- 现状：cli.ts:639-642 只打印 `C=xxx name file:line`，nesting 数据在 chunk 里（必填字段）但无处可见——用户问「不是嵌套深度吗」，正确回答是**把另一轴摆出来**。
- 改法（cli.ts:641 一行）：`C=${...}  n=${String(v.chunk.nesting).padStart(2)}  ${name} ${file}:${line}`
- 边界：**只加展示列**——排序键仍是 C（不加双键排序）、阈值仍是 C>5、JSON 不变（两字段本就在）。README 公理5 无涉（无加权求和、无组合指标）。
- 成本/风险：1 行 + 无新数据 + 无消费面变更。这是对用户「正交性」质疑的最小结案——组合指标（方案 C）按数学裁决 defer。

### 3.3 否决的旁路改动（防顺手扩大）

- maxChain 不动（E7 幂等论证）；
- --modules 不加 n 列（模块级 maxNesting 无消费者，加了就是新指标面）；
- 不修 pack 表缺口（C# switch_expression / Python match——数学 §4.1 记档，非本迭代主题，混入违反迭代极小性）。

---

## 四、落地顺序 + 验收口径

### 顺序（4 步，一个提交内完成）

1. **module.ts:54-55** 加 kind 守卫 + 注释（§一代码形态）；**types.ts:50** complexity 字段注释补「类 chunk = Σ 方法复杂度，尺寸代理，非函数级语义」。
2. **cli.ts:641** --complexity 输出加 n 列（§3.2）；cli.ts:50 选项注释同步提一句「并列 n（嵌套深度，正交轴）」。
3. **测试**：moduledeps.test.ts 追加用例——新 fixture：一个类含两个分支方法（各 C≥3）→ 类 chunk Σ > 方法 max；断言 `maxComplexity === 方法级 max`（修复前该断言失败 = 测试有效）。complexity.test.ts 不动。
4. **全量回归 + 实证**：`npm test`（基线 389/389）+ `tsc` 0 错误；InitDeity 重扫 `--modules`。

### 验收口径（数字进提交信息，实证闭环）

- 单元：新断言通过 + 全量 389/389 + tsc 0（数学 §六 判据「污染数字归零 + 测试全绿」）。
- 实证：InitDeity `--modules` 的 Framework C 1136 → **函数级 max（预期回落到两位数）**；SDK C 797 → 同步回落。`--complexity` 输出出现 n 列且两轴独立（可挑一个 C 大 n 小的函数肉眼验证）。
- 反向证伪口径：若 Framework 的 C 回落**不足**（仍三位数），说明模块内真有超复杂函数（如巨型正则/事件处理器）——那是真实信号不是残留污染，需在提交信息里写明「回落目标未达 + 原因核查」而非静默放行。
- JSON 不动：类 chunk 的 complexity 字段保留（D-065 公共数据工件），语义由 types.ts 注释定档。

---

## 五、残余风险与注意

1. **LOW——锚点行号修正**：数学评审把污染点标在 module.ts:68-69（输出段），实际累加在 54-55——实施时按 54-55 定位，别在 push 段找守卫。
2. **LOW——嵌套类归属**（方案 B 前置）：E10 已实锤前缀分组断裂；do-later 必须补 ownerClass 透传，勿用字符串前缀方案凑合。
3. **LOW——n 列的展示误导面**：--complexity 新增 n 列后，若某函数 C 大 n 小（平铺 elif），读者可能误以为指标冲突——建议提交信息/README 一句话点明两轴正交（C=分支数，n=结构深度），防 3am 式误读。
4. **INFO——InitDeity 本轮未实跑**（只读评审 + 外部仓库）：计划实证数字（1136/797）与 E3 结构一致（大/生成类 = 方法多 → Σ 大），可信；落地后按 §四 口径实测闭环。

## 裁决摘要

- 方案 A（module.ts kind 守卫 + 注释）：**do-now**，~20 行，零回归面。
- --complexity 加 n 列：**do-now**（1 行展示，正交双列结案）。
- 方案 B（类级画像）：**do-later**，report 层纯派生，前置 = ownerClass 透传（1+1 行）。
- 方案 C（组合指标）、pack 表缺口：**defer/记档**，不在本迭代。
