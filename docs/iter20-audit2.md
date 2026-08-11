# 迭代 20 审计：插件完备化/正确化清单（串行自查补交）

> 补交背景：iter20-audit2 subagent（run-94508）因 C# 大扫描超时未产出；本清单由主会话串行自查补交（HEAD 1545170，218/218）。审计视角：形式逻辑（该支持没支持 / 工程妥协→形式正确）。
> 锚定行以 HEAD 1545170 为准。

## 一、完备化清单（该支持没支持，按影响面）

| # | 形态 | 现状（代码锚点） | 影响面 | 优先级 |
| --- | ------ | ------------------ | -------- | -------- |
| C1 | 链式调用 receiver（`a.b().c()`，如 Unity 链 `go.transform.position`） | `flattenCallTarget`（extractor.ts:609-648）只把静态点连拍平；receiver 类型传播仅 `builtinMethodReturns` 覆盖 string 方法。变量 receiver → `markDynamic`（link.ts:592） | 剩余 unknown 中 bare·bare 2437 条（70%），主要就是动态 receiver 链 | P2（设计边界，非缺陷） |
| C2 | 扩展方法（`this` 参数） | 未建模（无扩展方法解析路径） | C# LINQ 链 `list.Where(x=>…)` 的 obj 是变量 → 动态分派 | P2（设计边界） |
| C3 | lambda 回调（事件 `AddListener(handler)`） | 明确不建回调边（csharp.ts 设计裁决注释：「事件触发是运行时语义，第一版不建模」） | 事件订阅方法判 PURE 无回调效应 | P2（方向安全——漏报侧） |
| C4 | 属性访问器（自定义 getter） | 不建 chunk（csharp.ts 注释：「第一版：属性不建，方向安全」） | 自定义 getter 的 io 不建模 | P3（方向安全） |
| C5 | 泛型类实例（`List<T>.Add` 的 obj=List） | `List`/`Dictionary` 在 `pureGlobals`（csharp.ts:160-161）；`new List<int>().Add(x)` 的 receiver 走 `literalReceivers.object_creation_expression → "object"` → builtinTypeEffects.object 无条目 → 未知 | 实例方法调用判 unknown（不误判 PURE——obj 是变量时走动态） | P3（已核实不误判） |
| C6 | 局部函数 | **已支持**：`local_function_statement` 在 chunkNodes（csharp.ts:186） | — | 已闭环 |
| C7 | 中文标识符 | wasm 硬限制（tree-sitter-c_sharp lexical grammar 只认 ASCII）——外部债 D1；预处理方案因内容寻址风险否决（D-120） | 含中文标识符文件 parseError → 标注工作流覆盖 | P1（外部债） |

## 二、正确化清单（工程妥协→形式正确）

| # | 妥协 | 现状（代码锚点） | 评估 | 优先级 |
| --- | ------ | ------------------ | ------ | -------- |
| R1 | frameworkIo 固定 io（`this.gameObject.SetActive` 判 io，实际是 state） | frameworkIo["this"] 前缀命中 → io（link.ts:182 `frame:` + csharp.ts frameworkIo） | 保守方向正确（io 仍 IMPURE，无假纯）；效应类粗（io vs state 不影响纯度判定） | P3（不修，方向安全） |
| R2 | 效应表基数（Path fs / Screen io / Transform state 过度判定） | 效应表 111 键（csharp.ts:30-153） | **阈值重验已证伪担忧**（run-64936）：300 改动集全 low（max 11.7 < 15），比迭代 15 基线 p95 26.6 更低；Transform=0/Screen=1/Camera=0 触发（死条目），Path=102（rank #14）唯一有体量；阈值无需重标（/tmp/threshold-recheck.md） | 已闭环（结论：不修表，不重标阈值） |
| R3 | 多文件同名类（partial class C# 合法） | `cls.length === 1` 守卫（link.ts:548）——partial class 多文件 → length>1 → 不解析 | 方向安全：partial class 判 unknown 而非错误边 | P3（已知边界） |
| R4 | implicitThis 裸名静态类调用 | implicitThis 分支只查 ownerClass 方法（link.ts:385-391）；非本类静态裸调 → 落空 → 走裸名回退/unknown | 方向安全（unknown 侧） | P3（已知边界） |
| R5 | 全局类名解析跨语言污染 | **已修复**（D-116，829b410）：globalClasses 带 lang，解析限定同语言（link.ts:127-138, 547-549） | 已闭环 | — |
| R6 | 类名优先级 vs 效应表（NetCall 抢占） | **已修复**（6123574）：globalClasses 优先于 impureGlobals（link.ts:543-555）——项目类先于通用库名 | 已闭环 | — |
| R7 | Console 效应表缺口（裸名 io 有、impureGlobals 无） | **已修复**（6123574，csharp.ts:35）：`Console: "io"` 进 impureGlobals（System.Console.WriteLine 的 obj=Console 走表） | 已闭环 | — |
| R8 | 状态写未建模 | **已修复**（8939454）：self.x=/this.x=/global/外部对象属性写 → state（D-117 后） | 已闭环 | — |

## 三、中文标识符方案正确性（预处理 vs wasm 补丁）

- **预处理 token 替换**：否决（D-120）——字符串/标识符难区分、id 变化破坏 chunk 内容寻址（公理 4）与标注锚点。
- **wasm 重编译**：正确路径，外部债 D1（tree-sitter-c_sharp 仓库级），工具侧不可自修。
- **标注工作流覆盖 parseError 文件**：方向安全，已实施。

## 四、结论

- 完备化：C1-C4 均为**设计边界**（动态 receiver/运行时语义），方向安全（unknown 侧，不假纯）；C5 已核实不误判；C6 已支持；C7 外部债。
- 正确化：R5-R8 已修复闭环；R1-R4 保守方向安全；R2 经阈值重验证伪担忧，无需动作。
- **无遗留假纯路径**（对照：ground-truth 抽样的 PURE 误标是**标注质量**问题，非工具判定路径——已由数学解 A 拒收机制覆盖，见 iter21 复审）。
