# 迭代 24 impl：stateReadPos C# 覆盖 + 调用目标排除死代码修复

> 实现节点（run-msp6owmq）：按 docs/iter24/audit.md 方案 ①-⑦ 修复。
> 基线 HEAD 17adf9f（258/258）→ 完成后 261/261（+3：csharp-lang T1/T2/T3）。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/lang/extractor.ts` | **stateReadPos 重写**（L175-207）：① 节点同一性 `===`→`.id`（修复「调用目标排除」「赋值左值跳过」自迭代8 起的死代码——web-tree-sitter 每次属性访问返回新节点对象，`===` 恒假，对**所有语言**生效）；② 成员访问结构子标识符整体跳过（C#/Python 成员名是 identifier 类型 → `Foo.instance.x` 的 instance/成员名不再裸读）；③ 节点过滤补 C#（member_access_expression/conditional_access_expression）；④ 调用 parent 列表补 C#（invocation_expression/object_creation_expression）；⑤ 边缘 `a.b?.c()` 内层成员（parent=conditional_access_expression 的调用链）；⑥ obj/attr 按类型分支（C# 字段 expression/name；`?.` 的 name 在 member_binding_expression 内）。**externalWritePos 补 ⑦**（L386-393）：C# `this.x = v` 的 left=member_access_expression 写侧对偶（此前 C# 字段写完全不可见） |
| `test/audit/csharp-lang.test.ts` | +3 用例：T1（C# 方法调用目标不产生 stateRead——instance.Configure() 不误报读者，断言不含 "instance"/"Configure"/"instance.Configure"）、T2（C# 字段读仍产生 stateRead——instance.Value 位置读保留）、T3（C# 字段写可见——this.counter= 产生 "self.counter" 写 + state 效应） |
| `test/audit/fixture.test.ts` | UIWorldLink 断言更新：`transform.position = x` 修复前 C# 字段写不可见 → 误判 UNKNOWN(1)；修复后写侧对偶生效 → state 效应 IMPURE(2)（**正确行为**，原断言是漏报） |
| `README.md` | 测试数 258→261（两处） |

**未改**：state.ts（stateDepsOf/stateCouplingOf）、analyze.ts、link.ts、types.ts、pack.ts。

## InitDeity 复扫验证（--no-cache 只读，scanProject API 内存分析）

| 指标 | 修复前（迭代23 收紧后） | 修复后 | 变化 |
| --- | --- | --- | --- |
| instance 写方 | 22 | 22 | 0 |
| instance 写方最大读者数 | 2633（Demo_Player.Start） | **1005**（Demo_GUI.Awake） | **−62%** |
| instance 写方 top 读者 | 2633/2655/2641/2640...（全库调用目标噪音） | 1005/997/984/980... | 调用目标噪音消除，残余为真实单例调用 + 同名异对象（state.ts 文档化语义） |
| stateCoupling 写方总数 | — | 6860 | — |
| UNKNOWN 计数 | 5860 | 5170 | 判定分布变化（见下） |
| IMPURE / PURE | 9349/8590 | 10537/8092 | C# 字段写可见后 state 效应增加（写侧对偶⑦） |

> 勘误（迭代 30 跨迭代复审 A1/A2）：本表"修复前"基线应为**迭代 23 收紧后**（9349/8590/5860，iter23/impl-frameworkio.md）——初稿误用了迭代 22 报告值（9449/8590/5761，Δ100 恰为 iter23 frameworkIo 收紧量）。UNKNOWN rate 百分比口径（28.1%/25.0%）无法由任何已记录计数复现（iter22 实测 chainCertain 27.7%、iter25 计数 5195/23799=21.8%）——本表改用**计数**（5860→5170，计数可从 iter25 基线 5195 反推差 25 为脏文件漂移量级），百分比口径统一以 iter30 现场复扫 chainCertain 为准（27.7%→24.7% 递减方向自洽）。

- **判定分布变化说明**：UNKNOWN 5860→5170、IMPURE 9349→10537——`transform.position = x` 等 C# 字段写此前不可见（假 UNKNOWN/假 PURE 方向），写侧对偶⑦后正确判 state → IMPURE。这是**正确化**（C# 字段写从不可见到可见），非误伤（T3 用例证语义）。
- **残余噪音（修复前既有，非本修复引入）**：Quest12*.Create 写方 1949 读者——写 SegmentId/QuestId 等**对象初始化器属性名**（`new X { SegmentId = ... }` 的 left=identifier 裸写，externalWritePos 裸标识符分支未改动）；ConfigSingleMenu.DoParse 2674 读者——写 message/messageType 等**类字段名裸写**（C# 无 this 前缀的字段赋值 = 裸 identifier 写）。两者均为「裸标识符写 = 外部」的既有语义（TS/JS 模块级变量同款），被 instance 噪音压制未显。下轮待办：C# 对象初始化器/字段声明的属性名应排除裸写（类作用域内字段 = self.x 语义，非全局）。

## 测试

- tsc 0 错误；全量 **261/261**（26 文件）；README 门禁 OK 261。
- T1/T2/T3 修复前会失败（T1：修复前 stateReads 含 "instance"/"Configure"；T2：修复前无位置读；T3：修复前无 "self.counter" 写）——防回归有效。
- 全量回归：258 → 261（+3），唯一行为变化断言是 fixture UIWorldLink（UNKNOWN→IMPURE，正确化）。

## 残余风险

- **instance 读者 1005 未到审计预估 <100**：残余 = 真实单例调用（instance.Method 的 obj 前缀命中）+ 全库同名 instance 变量读（state.ts「同名异对象跨模块可过近似」文档化语义）——名基匹配设计上限，非提取缺陷。
- **Quest12 对象初始化器属性名裸写**（1949 读者）：修复前既有，类作用域字段语义待下轮（C# 字段名 → self.x 而非全局裸名）。
- `a?.b?.c()` 双层 `?.` 内层不覆盖（审计 §4 记录，罕见）。
- C# 属性/字段声明标识符仍裸读（SingletonManager.cs 样本，审计 §4 记录，既有噪音）。
