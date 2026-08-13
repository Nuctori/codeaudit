# 迭代44 工程评审（02-jeff-review）：工具不完备/数据债收口的工程落地性

> 角色：工程落地评审（Jeff Dean）。只读评审，未改任何仓库文件。
> 审计基线核实：HEAD = **696a255**（Iter-43 诊断修复 2），工作树仅 `docs/iter44/`、`scripts/tmp-field-probe.cjs`、`test/unit/tmp-field.test.ts` 未跟踪。
> 测试独立实测：**368/368 通过**（33 文件，10.6s），与数学家评审一致。目标测试子集（tmp-field + csharp-lang + lang-features）151/151。
> 代码锚点独立核实：link.ts L1511 分支 2 守卫、L1340 effectFromGlobal、L1688 pureBuiltins、L1699 missTable；extractor.ts L92-100 参数先例、L1462 propertyReadOf、L1756 flattenCallTarget、L1836 ctorTypeName generic_name 剥壳先例；csharp.ts L681-682 alias_qualified_name 现状。

---

## 0. 结对审计缺口核实：global_keyword 死条目——**已在 HEAD 修复，无需本轮代码变更**

- 缺口成立（审计基线 7877021 属实），但 **696a255 已闭环**：`git show 696a255` 实证 diff = `propertyReadSkipParents` 中 `global_keyword` → `alias_qualified_name`（csharp.ts L681-682 现状核实），提交实证（null)|global 488→0、unknown 7291→7063。
- 独立复证：`alias_qualified_name` 正确性由「树外探针 AST + 重扫归零」双证据支撑；本评审另确认 B5 通道的 `qualified_name`（L680）仍在位——`using System.X` 与 `global::System.X` 是不同节点类型，二者不互斥。
- **结论**：无修复动作。残余风险（见 §7）：propertyReadSkipParents 其余 40+ 条目未与 tree-sitter-c_sharp 节点集全量对拍——作为实施轮 10 分钟小任务（正则提取 skip 表 vs grammar 节点清单差集）。

---

## 1. 候选 1（局部变量 prop 读判纯）：**do-now**，实现位置与 iter41 交互已锚定

### 1.1 工程裁决

| 维度 | 裁决 |
| --- | --- |
| 成本 | **~4 行代码 + 注释**（link.ts 分支 2 顶部），零新表/新通道/新语言常量（纯 TS 条件，三语言同构） |
| 风险 | 低——豁免面窄（`obj===null ∧ prop ∧ attr∈assigned` 三条件），不触碰 obj!=null、不触碰 prop=false |
| 回归面 | 见 1.3 全分支枚举 |

### 1.2 实现位置（确认数学家修正，且补充一个工程细节）

修复点 = **分支 2 顶部、bySimple（L1511）之前**的早期短路判纯，不是「豁免守卫进解析」：

```ts
// 裸名 prop 读 + 遮蔽名：读取存储位置恒纯（与参数读取同族，extractor L92-100 先例）。
// 必须在 bySimple/implicitThis 之前短路——遮蔽语义下读的就是局部，无需解析（防顶层同名假边）。
if (call.obj === null && call.prop && caller.assigned.includes(call.attr)) return;
```

**工程补充（实现时注意）**：放置位置有两个候选——分支 2 顶部（L1511 前）或 resolveCall 更早处。**必须放分支 2 顶部**，理由：

1. 分支 0（字面量接收者 L1411）与分支 1（self L1460）在它之前，但二者与 `obj===null ∧ prop` 不相交（receiver!=null / selfNames），无需前置；
2. 放在分支 2 内 = 语义上归类为「裸名形态的遮蔽纯读」，与分支 2 注释（局部赋值遮蔽则跳过）同段落，可读性最佳；
3. **不能放在属性链前缀白名单（L1577）之前且不能覆盖它**——L1577 要求 `obj!==null`，天然互斥，顺序无冲突。

### 1.3 回归风险——全通道枚举（独立复核数学家表格）

| 通道 | assigned 守卫 | 本修复影响 |
| --- | --- | --- |
| 分支 0 字面量接收者（L1411） | 无 | 不相交（receiver!=null） |
| 分支 1 self/this（L1460） | 无 | 不相交（obj!=null） |
| 分支 2 bySimple（L1511） | 有 | **短路点在它之前**——assigned 名不再进入；非 assigned 名行为不变 |
| 分支 2 implicitThis（L1531） | 有（同外层 if） | 同左 |
| 分支 2.5 frameworkIo/frameworkPure（L1601） | 有 | 不相交（obj!=null）；`item.gameObject.SetActive` 的 item 在 assigned 时仍走 L1577 前缀表（obj!=null），**不受影响** ✓ |
| effectFromGlobal（L1340） | 有 | 不相交（obj!=null）——`const Math = evil()` 调用形态维持 ? ✓ |
| 分支 4 pureBuiltins（L1688） | 有 | assigned 名被短路吃掉，不可达；非 assigned 名不变 |
| fireEvent（L1758） | — | prop=true 才短路；`evt(...)` 调用形态 prop=false 不受影响；`evt?.Invoke()` obj="evt" 不受影响 ✓ |
| 星号导入/尾部分支（L1760-1777） | — | assigned prop 读不再落这里 → 正是修复目标 |

**特殊形态复核**（数学家表格之外的工程检查）：

- **事件字段读**（`if (OnX != null)` 方法内）：event 名在类 chunk assigned（event_field_declaration → variable_declarator），但**方法 chunk assigned 不含它** → 不触发短路 → 走 implicitThis prop-miss 判纯，行为不变 ✓。
- **类 chunk 字段初始化器裸读静态字段**：字段在类 chunk assigned → 短路判纯。静态字段读 = 内存加载，无用户代码 ✓。
- **委托调用 `Action a = ()=>{io()}; a()`**：prop=false → 不短路 → 落尾部 markUnknown ? ✓（iter41 证明义务保留）。
- **属性 getter 名**：property_declaration 无 variable_declarator 子节点（探针实证）→ 属性名不入 assigned → getter 解析路径完整保留 ✓。

### 1.4 与 iter41 阴影守卫测试（维度26）交互——**必须显式加一条 C# 对照**

- 现有维度26 三测（lang-features.test.ts L1238-1275）：Python `max = print; max(1,2)`（prop=false）、TS `const Math = evil(); Math.floor(1)`（obj="Math"）、未遮蔽对照。**全部 prop=false 或 obj!=null → 本修复零触碰**，现有断言原样通过。
- **缺口：C# 侧无阴影守卫测试**（grep 实证 csharp-lang.test.ts 无 shadow 用例）。候选 1 落地必须补一条 C# 调用形态对照：`var Console = Evil(); Console.WriteLine("x")` → 仍 ?（obj="Console" 走 L1340 守卫 → missTable）——证明「判纯豁免只覆盖读、不覆盖调用」在 C# 也成立。

### 1.5 测试策略

| 测试 | 断言形态 | 位置 |
| --- | --- | --- |
| 局部读判纯（升级 tmp-field） | `unknownSites===0` + `purity===PURE`（M 方法） | test/unit/tmp-field.test.ts（**必须从 `expect(true).toBe(true)` 升级为断言式**——现状是打印型占位，数学家已标注） |
| C# 遮蔽调用仍 ?（新增） | `purity===UNKNOWN` | audit/csharp-lang.test.ts |
| 未遮蔽纯内建不误伤（已有维度26 对照） | 原样 | lang-features.test.ts |

---

## 2. 候选 2（System 枚举判纯）：**do-now**，落地形态 = pureGlobals 白名单（方案 A），并入 B1

### 2.1 工程裁决

| 维度 | 裁决 |
| --- | --- |
| 成本 | **~6 行数据 + 注释**（csharp.ts pureGlobals L156-193 追加 4 键：StringComparison/TaskStatus/BindingFlags/AttributeTargets）；零机制代码 |
| 风险 | 低——L1340-1343 既有双守卫免费保护（项目类 globalClasses 优先 L1249 前置于 effectFromGlobal；assigned/moduleAssigned 遮蔽 → ?） |
| 键冲突核查 | 实证：impureGlobals 有 `Task: "clock"`（L108），**无 TaskStatus**——M3s 一致性检查（pack.ts L439-448）不触发；BindingFlags/AttributeTargets/StringComparison 均无既有键 |

### 2.2 落地形态确认

- **入 pureGlobals（Set<string>），不入 frameworkPure**：形态实证 `StringComparison.Ordinal` → obj="StringComparison"（裸首段），正是 pureGlobals 形状；frameworkPure.System 是**类型级子键表**（L587-618 现状核实：Uri/Convert/Enum/Math/TimeSpan/Guid/Collections/Linq/Text/Array），System 枚举若入它需要逐类型子键——两种形态等价成本，但 pureGlobals 无「System 命名空间先占」风险。确认数学家裁决。
- **pureGlobals 语义与 prop 无关**（L1340-1349 命中即 true，不看 call.prop）：枚举成员读判纯 ✓；`TaskStatus.Running.ToString()` 链（obj="TaskStatus" attr="Running.ToString"）同门判纯 ✓——链式形态无泄漏（枚举成员无成员函数副作用，.NET 值类型语义）。
- **A7 健全性**：纯全局名 = 编译期常量对象（枚举名是类型名，成员是编译期常量——C# 规范）；残余风险仅「插件类同名 + 静态 getter」，与 Math/String/Convert 既有条目暴露面相同，override 可修正。

### 2.3 与 iter42 项目 enum 测试合并

- 机制**不重叠**：iter42（csharp-lang.test.ts L1154-1170）走「项目 enum → globalClasses → prop miss + propMissIsPure → PURE」；候选 2 走「System 枚举名 → pureGlobals」。两条通道，同一结论（枚举读纯），无合并冲突。
- 合并点只在**审查流程**：候选 2 的 4 键与 top-N 补表条目同批审查（同一 missTable 记账通道、同一「语料实证 + 世界知识」双注记纪律）。
- 测试：+1 断言 `StringComparison.Ordinal` 读取不产 unknown（RMA 形态）。

---

## 3. 候选 3（`<unresolved>` 两漏网形态）：**do-now**，~8 行 + 1 测试

### 3.1 工程裁决

| 维度 | 裁决 |
| --- | --- |
| 成本 | **~8 行**（flattenCallTarget L1756-1816 加 2 分支）+ 1 回归测试 |
| 风险 | 低——剥壳先例已存在（ctorTypeName L1836-1841 generic_name 剥壳、L1843-1851 qualified_name 递归）；flatten 返回 null 的语义（→ `<unresolved>` → ?）不改变，只是让可拍平形态离开盲区 |
| 收益 | 13575 站点中两形态可分类部分从盲区进解析/missTable 通道，直接为候选 4 供数（`global::System.*` → obj="System" → missTable global:System） |

### 3.2 实现锚点

```ts
// flattenCallTarget 顶部（members 分支之前）加：
if (node.type === "generic_name") { // Foo<int>(1)——invocation function 字段
  const id = node.childForFieldName("name") ?? node.children[0];
  if (id && (id.type === "identifier" || id.type === "type_identifier")) return id.text;
  return null;
}
if (node.type === "alias_qualified_name") { // global::System.IO.File.ReadAllText
  // 剥 global:: 前缀，递归 flatten 内层（qualified_name/identifier）
  const inner = node.children.find(c => c.isNamed && c.type !== "identifier") ?? node.children[1];
  if (inner) return flattenCallTarget(inner, pack);
  return null;
}
```

- generic_name 分支注意 `children[0]` 是 identifier（与 L1784 既有写法一致）；alias_qualified_name 的 children[0] 是 `identifier[global]`（探针实证）→ 取第 2 个 named 子节点（qualified_name）递归，避免剥到 global 本身。
- **前置探针（实施第 1 步，10 分钟）**：统计 InitDeity `<unresolved>` 调用点 function 节点类型分布，确认两形态合计份额；<5% 可降级延后（数据驱动，数学家已给同款裁决）。

---

## 4. 候选 4（top-N 补表）：**本轮做数据收集，条目落地视规模分轮**

### 4.1 操作形态（具体到命令）

1. **提取**：现有 `--table-usage`（cli.ts L642-647）只打印 top 15（`slice(0, 15)`）——**不够**。最小改动二选一：
   - (a) cli.ts `slice(0, 15)` → `slice(0, 100)`（一行，但改变所有用户默认输出体量——不推荐作为默认）；
   - (b) **推荐**：仿 `scripts/tmp-field-probe.cjs` 先例写一次性脚本 `scripts/top-miss.cjs`，直接调 scan API + classifyUsage（effectUsage.ts L177-195 全量 missSlots 已排序），对 InitDeity 输出 per-pack top-100 JSON（slot + miss 数）。零 CLI 改动，脚本留在 scripts/（与既有探针先例一致）。
2. **人工裁决流程**：top-100 清单 → 按「语料实证频次 + 世界知识」双注记审查 → 纯类（如 `GameObject` 子树的纯成员）/枚举（并入候选 2）/已知效应（io/state/clock）分别入 csharp.ts 对应表（impureGlobals/pureGlobals/pureCtor/frameworkPure），每条带频次注释（既有风格：`// 语料 882 站全 EscapeDataString`）。
3. **规模控制**：N=100 名；只收「分类后站点贡献 ≥ 阈值」的条目；估 ~10-30 条 ≈ 30-80 行数据。覆盖 <50% 停（帕累托下界），长尾走标注工作流。

### 4.2 测量口径（必须按 chunk 级）

- 复扫后报告 **UNKNOWN chunks 7063 → ?**（θ 是 chunk 级指标），站点级 113529 只作线索——与候选 1 同口径，防站点级数字误导收敛判定（数学家的修正 1 采纳）。
- 163 条目中 80 条未命中**不自动删**（世界知识合理性），top-N 审查时顺带标注条目依据（修正 2 采纳）。

---

## 5. 候选 5/6：维持 defer + 探针

- **候选 5（类型流）**：维持 defer。29.7% = 局部变量接收者，需跨 chunk 数据流 = 新机制族，成本 >> 收益，无争议。
- **候选 6（声明位显式类型绑定）**：只探针。`ObjectResponseResult response_ = GetThing(); response_.StatusCode`——类型在声明位，同文件，无跨 chunk 流，若 InitDeity 接收者多为显式类型声明则它是 P1-2 同级廉价切片；多为 var → defer 无争议。探针成本 = 1 脚本（grep 声明形态计数），数据留给 03-synthesis 裁决。

---

## 6. 落地顺序（本轮规模控制 ~200 行参照）

| 序 | 项 | 代码量 | 测试 | 轮次 |
| --- | --- | --- | --- | --- |
| 1 | 候选 1 短路判纯（link.ts 分支 2 顶部） | ~4 行 | +1 升级断言 +1 C# 对照 | 本轮 |
| 2 | 候选 3 flatten 两分支 | ~8 行 | +1 回归 | 本轮 |
| 3 | 候选 2 pureGlobals 4 键 | ~6 行 | +1 断言 | 本轮 |
| 4 | 候选 4 top-miss.cjs + 清单审查 | 脚本 ~40 行 + 条目 30-80 行 | 无（数据） | 本轮收集 + 审查；**条目落地若合计 >100 行则条目顺延下轮** |
| 5 | 候选 6 探针脚本 | ~30 行（可并入 4 的脚本） | 无 | 本轮（数据） |
| 6 | propertyReadSkipParents 与 grammar 对拍 | 0（检查任务） | 无 | 本轮末尾 10 分钟 |

合计本轮代码 ≈ 18 行 + 测试 ~60 行 + 脚本 ~70 行 ≈ **~150 行**，在 200 行参照内。数据条目单独控制。

---

## 7. 验收口径

1. **测试**：368 → **~371-372**（+1 tmp-field 升级为断言式、+1 C# 阴影对照、+1 候选 3 回归、+1 候选 2 断言；维度26 三测原样通过）。全部绿。
2. **InitDeity 重扫目标**（chunk 级口径）：
   - unknown chunks **7063 → <6900**（候选 1 翻 API.g.cs 生成代码叶 chunk 为主力；具体数值以复扫为准，但必须报 chunk 级 delta）；
   - `(null)|global` 维持 **0**（回归确认）；
   - `<unresolved>` 站点 13575 → 两形态分类后下降，残余不可拍平形态维持 ?（设计诚实）；
   - `--table-usage` 产出 per-pack top-100 missSlots JSON（候选 4 数据）。
3. **断言形态**：测试用 `unknownSites===0` / `purity===PURE|UNKNOWN`（csharp-lang.test.ts L613-620 既有断言形态），**禁止 `expect(true).toBe(true)` 占位**（tmp-field 现状必须升级）。
4. **停止准则**：iter44 若 unknown-rate 降幅 <1pp 即正式评估触发停止（数学家在 01-math-review L134 的提示），转入标注工作流。

---

## 8. 残余风险

1. propertyReadSkipParents 未与 tree-sitter-c_sharp 节点集全量对拍——global_keyword 同类死条目系统性排查未做（§0 已闭环的只是这一个；同类风险仍存在，实施轮小任务）。
2. InitDeity 复扫未由本评审独立重跑（只读；证据 = 提交实证 + 代码现状 + 探针 AST + 368/368 套件）。
3. 候选 1 的 chunk 级收益未实测（7063 → ? 是预测值，复扫为准）。
4. 候选 2 的 pureGlobals 追加键若未来出现插件类同名 + 静态 getter 的语料，需 override 修正（表语义既有风险类，可接受）。

---

## 9. 结论

候选 1/2/3 do-now 无阻塞，合计 ~18 行代码 + ~60 行测试，回归面已全通道枚举为低风险；候选 4 本轮做数据收集（脚本 + 审查），条目落地视规模分轮；候选 5 defer、候选 6 探针。结对审计的 global_keyword 死条目缺口**已在 HEAD 696a255 闭环，无需代码变更**。无 blocker。
