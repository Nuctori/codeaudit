# codeaudit 技术债摘要（迭代 40 重基线 / B5 属性访问器假纯洞闭合 + 方向分类）

> 重基线于迭代 40（2026-08-13）：B5（C# 属性访问器假纯洞）闭合——property chunk + 属性读取 prop 边；
> B 表重审引入**方向分类**（方向安全 ≠ 假纯通道，iter31 定义对齐）；M_out 模型外通道清单形式化。
> 现基线：355/355 测试（vitest 串行）+ tsc 干净 + 真实扫描冒烟通过（迭代42：候选7 静态访问类型加载闭合 + 候选3 enum 判纯 + B4/M1 方向改标）。
> 分类：**A. 形式正确性修复（已修）** / **B. 工程妥协（有意，方向分类）** / **C. 无主债（应还）** / **D. 外部债（非本仓库可修）**
>
> **方向分类字段**（迭代40 引入，对齐 iter31 操作定义）：
>
> - `安全-过近似` = 只多报效应（假 IMPURE），S2 方向，永不假纯
> - `安全-未知` = 只降级 UNKNOWN（假 UNKNOWN），损判别力不损健全性
> - `假纯可能` = 漏报方向（S1 现实违反通道）——模型外或未建模形态；必须入 M_out 清单或触发率量化

---

## A. 形式正确性修复（已闭环）

| # | 发现 | 状态 |
| --- | --- | --- |
| A1 | **跨语言类名污染**：C# Main.Run 把 Helper.Build() 解析到 Python Helper 类（同名不同语言→串入 io 效应） | 已修：globalClasses 带 lang，调用侧同语言匹配（829b410） |
| A2 | **C# this 是 this_expression**（非 `this`）——this.gameObject 全 <unresolved> | 已修：flattenCallTarget + this_expression（18d877f） |
| A3 | **泛型方法剥除**：Resources.Load\<GameObject\> 的 generic_name 未处理 | 已修（d300d78） |
| A4 | **frameworkPure 前缀级假纯洞**（Enumerable.Select(xs, WriteLine) 判 PURE） | 已修：成员级白名单（iter32，csharp.ts frameworkPure 两级结构） |
| A5 | **string.Join 撞名误伤**（全局 HOF 表吞值实参） | 已修：Join/GroupJoin 移出全局表（iter31） |
| A6 | **记账不变量破坏**（calls[?] 而 unknownSites=0，标注不可见） | 已修：addArgEdges 兜底走 markUnknown 通道（iter31） |
| A7 | **属性访问器假纯洞（B5）**：自定义 getter io 不传染读取方（实证 `c.Value` 判 PURE 而 getter 执行 io） | 已修（迭代40）：property_declaration 提 chunk（自动属性=空 chunk）+ member_access/裸名 identifier 读取形态建 prop 调用点 + link 四通道 miss+prop 判纯（C# 静态语义：字段/自动属性/不存在成员读取无用户代码；partial 类由跨文件成员表并集覆盖）。实证：getter io 四通道全传染（参数类型/隐式 this/this/局部构造），自动属性/字段/静态字段/不存在成员全判纯；方法组实参（Select(xs, Console.WriteLine)）升级 UNKNOWN→确定 IMPURE |

## B. 工程妥协（有意——方向分类标注）

| # | 妥协 | 语义 | 代价 | 方向分类 | 状态 |
| --- | --- | --- | --- | --- | --- |
| B1 | **效应表 70+ 类基数无校准** | 每类人工裁决（Debug io/PlayerPrefs state 明确；Path fs/Screen io/Transform state 保守） | 过度判定 → 假 IMPURE（LOW 阈值分布偏移） | 安全-过近似 | **部分缓解**：P1-1 注入白名单补 frameworkPure/pureCtor——新 API 可注入免改包代码（校准仍是人工数据债） |
| B2 | **frameworkIo["this"] 20 组件 + gameObject/transform 隐式 this** | this.gameObject.SetActive → io（固定 io 非细分） | 组件链一律 io，无法区分读/写 | 安全-过近似 | 保留（数据裁决） |
| B3 | **LINQ 链全 ?**（xs.Where(...).Select(...)） | 变量 receiver 动态 → 诚实 ? | 集合内存操作判 unknown（可标注 PURE） | 安全-未知 | 保留（iter31 S1 链修复部分缓解——builtinMethodReturns 链式接收者解析） |
| B4 | **事件订阅不建模**（+= / AddListener） | 回调方法独立判定，订阅方不建边 | **现状实证（iter42 数学评审 F2）：已意外闭合**——`+=` 是 state 写（订阅方恒非 PURE）、触发端全落 `?`（诚实）→ 无假纯通道，真实残余 = 判别力损失 + 效应归因缺失 | 安全-未知 ∪ 安全-过近似（改标，原「假纯可能」不可实例化） | **已修（迭代43 B）**：事件间接层 + 订阅/触发双通道 + private 可见性守卫——handler 效应归因触发方（IMPURE 确定传播）、private 事件触发端确定判定；残余：跨实例触发（x.evt(...)）保持 `?`、UnityEvent 模型外派发（M_out） |
| B6 | **隐式 this 与局部变量竞态**：裸名 gameObject 若局部变量遮蔽 → 仍判 io | 遮蔽守卫只查 assigned | 极小 | 安全-过近似 | 保留（P0-2 数据化不改变语义） |
| B7 | **C# virtual 精度**：多态守卫不区分 virtual/非 virtual | 非 virtual 静态分派本可精确；? 是健全降级 | 基类 self 调用噪音 | 安全-未知 | 已修（迭代39 L4：virtualMembers 提取，非 virtual 免守卫） |
| B8 | **项目外子类不可见**（库/插件扩展你的类） | 多态并集漏项目外覆写 | 项目外覆写 → 假纯 | **假纯可能** | 入 M_out——与项目外写者同族，无静态解 |
| B12 | **Python **new** 逃逸**（C() 可 return 任意对象） | lb/trustedCtor 对 Python 的残余 | 构造返回任意对象 → 类型不可信 | **假纯可能** | 入 M_out（同 monkey-patch 族，文档化接受） |
| B13 | **C# 单接口基类实现的方法隐含 virtual**（base_list 单子无法区分接口与外部类） | 类侧残余罕见 | 接口方法静态分派误判 | 安全-过近似 | 保留（接口清单数据可消，IDisposable 等） |
| B14 | **静态初始化器并入 new C()**（类型加载时执行非实例化） | L5 过近似 | 构造多报静态初始化器效应（new C() 路径）；**静态访问路径（C.Get()/C.X）漏报类型加载效应——活假纯洞（iter42 候选7 实证，已修）** | 安全-过近似（new C()）＋ 假纯可能（静态访问路径，**已修**） | 新 C() 路径保留（静态初始化器独立建模 → iter43 候选2）；静态访问路径已闭合（iter42：全局类分支加类型加载闭包边，与 L5 同构） |

## M_out：模型外通道清单（S1 现实相对性边界，迭代40 形式化）

A6 的 S1 是**模型相对**的（"实际效应定义在模型真值上"）。以下通道在模型外仍可产生**现实假纯**（模型内 PURE、现实有效应）——按触发条件与接受理由逐条声明，不称"方向安全"：

| # | 通道 | 触发条件 | 方向 | 接受理由 | 升级路径 |
| --- | --- | --- | --- | --- | --- |
| M1 | **事件订阅不建模**（B4） | 订阅方持有事件，事件触发执行 io 回调 | 假纯可能（改标：现状已意外闭合，见 B4） | 触发不确定性（回调可能永不执行）；事件驱动建模是第一版级语言语义 | **已修（迭代43 B）**：private 可见性守卫（完备集合）+ 形态守卫（lambda/方法组/跨实例/partial → 触发端 ?）+ `+=` 双语义保留；残余：跨实例触发（x.evt(...)）接收者不可证 → `?`、UnityEvent 模型外派发（无静态守卫可闭合） |
| M2 | **项目外子类覆写**（B8） | 库/插件 extends 项目类并覆写方法 | 假纯可能 | 项目外代码不可静态可见（与 M3 同族） | 无静态解；文档化 + 触发率实测 |
| M3 | **项目外状态写者** | 测试夹具/框架注入写项目状态 | 假纯可能 | 同上（README 已知限制） | 无静态解 |
| M4 | **Python **new** / monkey-patch**（B12） | `C()` 被 monkey-patch 返回任意对象；`C.m = ...` 运行时换方法 | 假纯可能 | 动态语言语义，静态不可见 | 文档化接受 |
| M5 | **C# 条件访问属性读取**（`obj?.Prop`） | conditional_access 形态未建 prop 边，getter io 不传染 | 假纯可能 | **已修（迭代40 M5）**：propertyReadNodes 加 conditional_access_expression（`a?.b()` 的 conditional 是 invocation 的 function → 现有 parent 排除覆盖） | — |
| M6 | **TS/JS/Python 属性读取** | `obj.prop` 读取（TS getter 已建 chunk 但读取不建边；Python property 动态） | 假纯可能 | **已修（迭代40 M6，TS/JS）**：member_expression 建 prop 边 + memberNames 字段清单 + selfPropReadIsPure（JS 语义 this.attr 非 getter 读取无副作用）+ __objectLiteral（对象字面量类型属性恒纯）+ TS paramNodes 补全（A1 预存盲区）。Python 保持（`__getattr__` 动态，静态不可判定） | Python：文档化接受（动态属性协议） |
| M7 | **C# enum 成员读取**（`Color.Red`） | enum 不在 classNodes → 读取落 ? | 安全-未知（非假纯） | 方向安全，判别力损失小 | **已修（迭代42 候选3）**：enum_declaration 入 chunkNodes + classNodes 双表 → 顶层 enum 成员读取判纯（编译期常量，C# 静态语义）；嵌套 enum 仍 `?`（globalClasses 裸名索引） |

**契约**：M1-M6 任一升级修复后移出清单；新发现的模型外通道必须入清单（防"方向安全"标签掩盖漏报）。

## C. 无主债（应还）

| # | 债 | 成本 | 状态 |
| --- | --- | --- | --- |
| C1 | **resolveCall cognitive 高**（迭代 18 D1 + C# 分支） | 2-4h | **部分清偿**：P0-1 削 link 硬编码分支 ~15 行、P0-2 削 extractor 3 处 pack.name；resolveImport 已拆（iter36 r2）；resolveCall 主体未拆 |
| C2 | **真实项目 fixture**（InitDeity/旧宇宙无回归快照——C# 修复无防回归网兜） | 2-3h | 保留 |
| C3 | **标注工作流 E2E**（unknowns→标注→回读→语料全链路无测试） | 1h | **已闭环**（核实于迭代40）：contract.test.ts corpus-e2e 测试覆盖导出（calls 明细/冷启动无先验）→ 回读 → 语料累积 → 幂等全链路 |
| C4 | **README 测试数漂移** | — | **已根治**：CI 门禁 check-readme-tests.cjs（D-119，81c40b1） |
| C5 | **效应表测试稀疏**：70+ 类只测 10 个——其余无断言 | 1h | 保留 |
| C6 | **局部变量类型推断缺失**（API.g.cs 生成代码 30.5% 未知站点——构造器初始化子集 ~2-3k） | 2h + 度量 | **已闭环**（迭代37 P1-2，c09d335）：localBindingsOf 单赋值构造绑定 + link 消费（G4 守卫：单赋值 ∧ ¬param ∧ 构造形态；`var xs = new List<int>()` → xs.Add 纯信箱）；残余 = 方法结果/下标 receiver 绑定（需跨 chunk 数据流，仍延后） |
| C7 | **重载歧义断链**（ApiClientHelper.PrepareRequest 732 站） | 0.5-1d + 文档 | **已闭环**（迭代37 P1-3，c09d335）：byQualifiedAll + addUnionEdges 并集边（数学 S1/S2/S3 可证安全，全候选建边禁止任选）；同名重定义从 ? 升级确定判定 |

## D. 外部债（非本仓库可修）

| # | 债 | 影响 |
| --- | --- | --- |
| D1 | **tree-sitter-c_sharp Unicode 标识符缺陷**（中文枚举 → parse-error） | InitDeity 77 文件降级 UNKNOWN（方向安全）——wasm 升级或自行补丁 |
| D2 | **协程构造 new WaitForSeconds 的 ?** | 已修：iter33 C1 构造器建模（WaitForSeconds:clock 入 impureGlobals）→ **已闭环** |
| D3 | **Unity 引擎本身不可扫**（UnityEngine.dll 无源码——效应表人工维护） | **部分缓解**：P1-1 注入白名单补全——新 Unity API 可 `--effect-table` 注入免改包代码 |

---

## 迭代 37 清空项（本轮闭合）

| 项 | 类型 | 闭合方式 |
| --- | --- | --- |
| link.ts `X.gameObject.*` 硬编码 | 引擎语言常量 | P0-1：frameworkAttrPrefix 数据化（attr 首段查表，位次保持） |
| extractor 3 处 `pack.name` 分流 | 引擎语言常量 | P0-2：assignmentScopesLocals / bareNameMeansThisInMethod 2-bit 数据化 |
| effectOverride 白名单缺 C# 专表 | 映射缺口 | P1-1：frameworkPure（ns-nested-pure-hof）+ pureCtor（set）注入支持 |
| 统一效应表冲动 | 过度抽象 | P2-1 明确不做 + G3' 护栏注释（pack.ts 通道分派语义声明） |

**验收口径**（docs/iter37/03-synthesis.md §4）：`grep "gameObject" src/engine/` 仅剩记账槽位字符串 ✓；`pack.name` 在 extractor 控制流 = 0 ✓；305→307 全绿 ✓。

## 迭代 38 清空项（本轮闭合）

| 项 | 类型 | 闭合方式 |
| --- | --- | --- |
| 继承/多态真空（self/new C()/参数接收者落 ?） | 精度回收 | A：classExtends 提取 + link 祖先闭包并集（规则1 全并集，规则2 同名类并集）+ 后代守卫降 ?（H4 假纯洞闭合）+ 基类 ctor 并集 + 隐式 ctor 纯 |
| 动态 extends 假纯通道 | 假纯 | 规则3 健全版：语言存在动态 heritage → 该语言多态分派整体 ? |
| 参数容器方法变异 d.Add 判纯 vs d[0]=1 判 state | 假纯/语义分叉 | B：builtinMutators 表（C#/Python 9+8 方法）→ state 效应；sort 回调义务保留（规则5）；H6 内建子类守卫 → ? |
| JS/TS `new C()` 构造器 return 任意对象信任类型 | 假纯（P1-2 已落地洞） | 规则7：trustedCtor=false → 不产 trusted localBinding/moduleBindings，class: 接收者落 ? |
| --state 序列化无上界（500×1.3万读者可崩） | 崩溃 | capStateCoupling：compact 前缀和 + 二分，64M 工程上界（8× 余量） |
| csharp gameObject 双份清单漂移 | 漂移 | gameObjectMembers 单一数据源 |

## 迭代 38 新增债（有意残余 + 升级路径）

| # | 债 | 语义 | 升级路径 |
| --- | --- | --- | --- |
| B7 | **C# virtual 精度**：多态守卫不区分 virtual/非 virtual——所有方法视同可覆写 → 基类 self 调用一律 ? | 非 virtual 静态分派本可精确；? 是健全降级 | 提取 virtual/override 修饰符，非 virtual 免守卫（预期显著降 C# 基类噪音） |
| B8 | **项目外子类不可见**（库/插件扩展你的类） | 多态并集漏项目外覆写 → 假纯通道（文档化） | 与项目外写者同族，无静态解 |
| B9 | **moduleBindings 不接继承**（db = new Pool() 只查 own-class） | 模块单例基类方法 → ?（诚实） | resolveClassMember 入 resolveFromObjectImport（参数管道 ~6 行） |
| B10 | **mutate 无 stateWrites 位置** | --state 耦合图漏该方法变异（下界，元数据级） | 变异方法名作位置（`d.append`）需读方对称匹配 |
| B11 | **C# 字段初始化器效应不建模**（int x = ReadFile()） | 隐式 ctor 纯的健全性前提（预存在残余） | 字段初始化器归入 class chunk（与 ctor 体合并同款） |
| B12 | **Python **new** 逃逸**（C() 可 return 任意对象） | lb/trustedCtor 对 Python 的残余（同 monkey-patch 族） | 文档化接受 |

## 迭代 39 清空项（本轮闭合）

| 项 | 类型 | 闭合方式 |
| --- | --- | --- |
| P0-1/B11 字段初始化器假纯洞 | 假纯（迭代38 隐式 ctor 纯引入） | L5：ctor 分支并集闭包全部 class chunk 原始调用（含基类字段初始化器）；隐式纯条件收紧为「闭包无显式 ctor ∧ 全部 class chunk 零调用」 |
| B7 C# virtual 精度 | 精度（宽守卫） | L4：polymorphicMethods=false + virtualMembers 提取（virtual/override/abstract，sealed 排除，base_list≥2 接口启发）+ BFS 首声明层 virtual 守卫；非 virtual 静态分派精确 |
| B9 moduleBindings 继承 | 精度 | resolveFromObjectImport 模块绑定走 resolveClassMember(polymorphic=false)（HierarchyCtx 参数束） |
| B10 mutate 无写位置 | 元数据 | Sink.addStateWrite → stateWrites 合并出站（位置 = 参数名，前缀匹配读者） |
| node: 硬编码 ×2 | 引擎语言常量 | stripModulePrefixes 数据化（link effectFromModule + effectUsage P2/P4 判据） |
| P2-2 形状契约网 | 工程 | ast-shape.test.ts 6 契约（typed_parameter/base_list 子节点/extends_clause 包层/修饰符/接口启发/动态 heritage）——wasm 升级防静默失效 |
| P2-1 投影数据化 | 架构 | astShapes 19 集投影表（四 pack 全声明）+ extractor 全部节点类型判定走表；identifier/property/type_identifier/predefined_type = tree-sitter 跨语言公共名（非语言常量，模型注明） |
| 探针实证新缺陷 | 正确性 | TS class_heritage 内包 extends_clause（静态基类此前全漏 + 误标 dynamic）——形状契约网捕获 |

## 迭代 39 新增债（有意残余 + 升级路径）

| # | 债 | 语义 | 升级路径 |
| --- | --- | --- | --- |
| B13 | **C# 接口作静态类型接收者**（IRepo r; r.Get()）——已修（interface_declaration 方法无条件 virtual，审计必修 2）；残余 = **单接口基类实现的类方法隐含 virtual**（base_list 单子无法区分接口与外部类） | 接口接收者已闭合；类侧残余罕见 | 接口清单数据（IDisposable 等） |
| B14 | ~~属性访问器并入 class chunk~~（审计修正：访问器体是独立 chunk 从未并入，文档幻觉）——实际残余 = **静态初始化器并入 new C()**（静态初始化器在类型加载时执行非实例化——过近似 S2 方向安全） | L5 过近似 | 静态初始化器独立建模 |

**验收口径**（docs/iter39/00-model.md + 独立审计必修 5 反例）：337/337（迭代39 缺口闭合 4 + ast-shape 6 契约 + B7 拆分 2 + 审计反例 2）；tsc 干净；真实扫描分布正常。

## 迭代 40 清空项（本轮闭合）

| 项 | 类型 | 闭合方式 |
| --- | --- | --- |
| B5 属性访问器假纯洞 | 假纯（实证：`c.Value` 读取方 PURE 而 getter 执行 io） | A7：property_declaration 提 chunk（自动属性=空 chunk，自定义 getter/setter 体调用归属属性 chunk）+ propertyReadNodes 数据表（C# member_access_expression + identifier）+ link 四通道 prop 解析（self/implicitThis/参数类型/局部构造/全局类：成员 miss + prop → 纯，C# 静态语义论证） |
| "方向安全"标签掩盖漏报 | 文档正确性 | B 表方向分类三值（安全-过近似 / 安全-未知 / 假纯可能）+ M_out 模型外通道清单 M1-M7（B4/B8/B12 改标假纯可能） |

## 迭代 40 新增债（有意残余 + 升级路径）

| # | 债 | 语义 | 方向 | 升级路径 |
| --- | --- | --- | --- | --- |
| B15 | **C# 裸名 identifier 读取全量建边**（性能） | 表达式位置 identifier 都建 prop 边，每处走裸名解析（bySimple + implicitThis resolveClassMember） | 安全-未知（miss 判纯，无假纯） | **已实测（迭代40）**：合成 500 文件 C# 大库 790ms（1.6ms/文件）——性能可接受，无需优化；大库（InitDeity 级）如遇退化再启用快速拒绝 |
| B16 | **方法组实参升级确定 IMPURE**（Select(xs, Console.WriteLine)） | 方法组引用经 prop 通道命中效应表 → 确定效应（旧 UNKNOWN） | 安全-过近似 | 测试已更新（S3/HIGH-1/T3 断言 UNKNOWN→IMPURE）；方法组引用语义 = 委托创建（未执行），精确建模需区分"引用"与"读取"形态 |
| B17 | **C# qualified_name/字段名探针债** | variable_declarator 无 name 命名字段（children[0] 兜底）；web-tree-sitter 节点引用不恒等（=== 失效，位置比较） | — | 已数据化（propertyReadNameSlots "__child0"）；位置比较已固化；若 wasm 升级改变形态，ast-shape 契约网兜底 |
| B18 | **B5 数据化收敛（0hack 要求）** | 初版 isPropertyRead 排除判定硬编码在引擎（PROP_READ_SKIP_PARENTS 40+ C# 节点 + variable_declarator/parameter/catch_declaration 字段特判）——违反 P2-1；link prop miss→纯 无语言门控（语义泄漏） | — | 已收敛：propertyReadSkipMorphs / propertyReadSkipParents / propertyReadNameSlots / propMissIsPure 四表数据化（pack.ts + csharp.ts），extractor 零语言常量，link 五通道 propMissIsPure 门控（动态语言未来接入自动落 ? 诚实） |

## 迭代 40 P0-3 清空项（独立审计 25 项 hack 全数据化）

| 审计项 | 类型 | 闭合方式 |
| --- | --- | --- |
| H01 构造器 chunk 名（link `__init__`/`constructor`） | 语言常量 | `ctorChunkNames`（Python/TS 填；C# 走 isCtor 分支） |
| H02 构造节点→字段策略（object_creation/new_expression 特判 ×3） | 语言常量 | `ctorTypeFields` + `ctorMarkNodes`（C# type / TS constructor；统一 ctorTypeName 剥壳） |
| H03 sealed/virtual/override/abstract + interface_declaration | 语言常量 | `virtualModifiers`/`sealedModifiers`/`interfaceNodes`（仅 C# 填） |
| H04 inClassMemberBody C# 节点集 | 语言常量 | `classMemberBodyNodes`/`classMemberBodyStopNodes` |
| H05 self/cls/this 绕开 selfNames 表（×2） | 表绕过 | `pack.selfNames.includes` |
| H06 externalWritePos 四段同构复制 | 极小性 | memberNodes 统一分支消重（-24 行；conditional 排除保等价） |
| H07 for_each_statement + "in" token | 语言常量 | `foreachNodes` + `foreachInToken` |
| H08 conditional_access 点名特判 | 表绕过 | memberWrapNodes/成员字段统一提取（既有表） |
| H09 raise/throw 分叉 | 语言常量 | `throwArgFields`（TS throw→argument；Python 子节点查找） |
| H10 class_definition/base_list 继承字段分叉 | 语言常量 | `heritageFields`（Python superclasses；C#/TS 走 heritageNodes） |
| H11 typed_parameter 特判（×3） | 语言常量 | `paramNameSlots`（__firstIdentifier 槽位机制） |
| H12 exports/module.exports/require（×3） | 语言常量 | `cjsExportObjNames`/`requireFnNames`（仅 JS 族——C#/Python 不再误触发） |
| H13 ctorTypeName 节点名（type/generic/qualified） | 语言常量 | `typeNameNodes`（ctorTypeName 收 pack 参数递归） |
| H14 str + bytes 前缀正则 | 语言常量 | `bytesPrefixTypes`（仅 Python 声明） |
| H15 tuple_pattern/array_pattern/as_pattern_target | 语言常量 | `patternNameNodes` |
| H16 /function/ 正则 + lambda/assignment | 语言常量 | `fnLiteralNodes`/`lambdaNodes`/`lambdaAssignNodes` |
| H17 export_statement/default/export token | 表绕过 | `exportStmtTokens` + declNodes 复用 |
| H18 "parameters" 节点/字段混淆 | 语言常量 | `paramListNodeTypes`（节点类型：TS formal_parameters）+ `paramListField`（字段名：跨语言 parameters）——字段名与节点类型是两维度，审计实证混淆即坏 |
| H19 嵌套函数边界 8 节点集 | 语言常量 | `nestedFnBoundaryNodes` |
| H20 SKIP_DIRS 生态目录名 | 工程配置 | 保留（跨语言工程默认值，非语言知识；文档化） |
| B01 catch_clause → "*" 施加于 C# 类型化 catch | 语义泄漏 | `catchDeclNodes`（C# 类型化提取；TS/JS 吞一切）——throwsTypes 元数据修复 |
| B02 CJS 导出语义对任意语言生效 + stateWrites 抑制 | 语义泄漏 | `cjsExportObjNames` 门控（仅 JS 族触发） |
| B03 namedBases≥2 virtual 启发式无条件运行 | 语义泄漏 | `interfaceHeuristicMinBases`（仅 C# 填） |
| C01 "引擎零语言常量/零 extractor 改动"声称失实 | 文档 | P0-3 全数据化后声称恢复真实（pack.ts 注释复核通过）；extractor 残留节点名 = 跨语言公共名/核心语义值 |
| C02 EXTRACT_SIDE_TABLES 白名单滞后（新提取侧表注入静默失效） | 正确性 | 补 propertyRead* 5 表 + 同步纪律注释 |

**修复过程实证**：P0-3 引入 3 处回归（Python typed_parameter 进 assigned → ptype 分支误挡 → RawChunk 补 params 字段豁免；TS formal_parameters 字段/节点两维度混淆 → 拆双表；python.ts for_statement 两次编辑被吞 → nesting 回归）——全部由 341 测试网兜住；vitest maxWorkers=2（CLI 并发 spawn 内存峰值，迭代21 forks 先例同族）。

## 迭代 42 清空项（本轮闭合——工程妥协形式化评审落地）

| 项 | 类型 | 闭合方式 |
| --- | --- | --- |
| **静态访问路径类型加载漏报（活假纯洞，02-jeff-review P1 实证）** | 假纯（S1 现实违反）：`C.Get()`/`C.X` 判 PURE 而类型加载执行 `File.ReadAllText` | 候选7：全局类分支（link.ts）加类型加载闭包边——`ancestorClosureOf` 闭包内 class chunk 原始调用并集（与 L5 同构，S2 过近似方向安全）；纯静态工具类（闭包零原始调用）零变化 |
| **M7 enum 读取落 ?** | 安全-未知（判别力） | 候选3：enum_declaration 入 chunkNodes + classNodes 双表（只加 classNodes 不产 chunk，globalClasses 索引不到——数学评审 §3 修正）；顶层 enum 成员读取判纯 |
| **B4/M1 方向分类过时** | 文档正确性 | 数学评审 F2 实证：`+=` 是 state 写 + 触发端落 `?` → 「假纯可能」不可实例化 → 改标「安全-未知 ∪ 安全-过近似」；B14 改双路径分类（new C() 过近似 / 静态访问路径已修） |

**验收**：355/355（+3：enum 判纯 / 候选7 三态 / 对照零变化）+ tsc 0 + 自扫描 invariantViolations=0 + README 测试数同步（343→355，C4 门禁绿）+ essence 8/8。

**评审流程**：docs/iter42/（00-plan → 01-math-review → 02-jeff-review → 03-synthesis）；延后项：候选1 事件订阅（iter43-r1，修正版：private 可见性守卫 + 形态守卫 + `+=` 双语义）、候选2 static-init 独立 chunk（iter43-r2，side table 方案）、候选 4/5/6 defer（无读者 / Λ 不变死数据 / Σ_ext 无挂接点）。

## 迭代 43 清空项（本轮闭合——B4/M1 事件订阅建模）

| 项 | 类型 | 闭合方式 |
| --- | --- | --- |
| **B4/M1 事件订阅不建模** | 假纯可能（改标后精度特性） | 候选B：事件间接层 + 订阅边（evt += h，类内跨方法关联）+ 触发边（裸名 evt(...) / evt.Invoke / evt?.Invoke 展开 handler 闭包，S2 过近似）——private 可见性守卫（完备集合 → 触发端确定）+ 完整性守卫（lambda/方法组/跨实例/partial → 触发端 ?）；`+=` 双语义 = state ⊕ 订阅边直和 |
| **事件字段初始化器意外 prop 边** | 噪音（S2） | 数学修正 1：propertyReadSkipParents 加 event_field_declaration；初始化器 RHS identifier 入订阅集合（构造序早期注册，引理成立），RHS 调用形态保留调用边 |

**验收**：362/362（+5 + fixture 扩展）+ tsc 0 + 自扫描 invariantViolations=0 + README 门禁绿（355→362）+ essence 8/8。

**评审流程**：docs/iter43/（00-plan → 01-math-review → 02-jeff-review → 03-synthesis）；延后项：static-init side table + L1 跨语言测试（iter43-r2）、A1 真实感 C# 合成大库回归网（iter43-r3，B/C 后校准）、A2/--state 输出 defer。残余：跨实例触发（x.evt(...)）保持 ?（接收者类型不可证）；UnityEvent 模型外派发（M_out）；事件不可标注（无 chunk/公理4 id）。

## 迭代 43-r2 清空项（static-init 单元精确化）

| 项 | 类型 | 闭合方式 |
| --- | --- | --- |
| **static-init 单元拆分（候选C）** | 过近似精确化 | 合成 chunk `<static-init>`（C# static 字段初始化器 + 静态构造器体）+ staticInitKey 映射 + 三消费点改指：L5 new C() 并集 staticInit（计入 bodyEdges 防隐式纯假纯）、候选7 静态访问只并 staticInit（实例初始化器不执行于静态访问——H1 lumped 过近似消除）、其他语言保持 class chunk 并集 |
| **eventsOf 初始化器订阅隐性失效** | 正确性（探针实证） | C# variable_declarator 初始化器在 equals_value_clause 子节点（无 value 命名字段）——staticInitOf + eventsOf 双双修复 |
| **L1 跨语言测试** | 覆盖缺口 | TS static 字段初始化器 / Python 类体赋值 → 静态访问路径 IMPURE |

**验收**：366/366（+4）+ tsc 0 + essence 8/8 + README 门禁绿（362→366）。残余：static-init 标注 id 迁移发布动作（静态 ctor chunk id 消失）；A1 回归网排 iter43-r3（分布稳定后校准）。

## 总体评估

- **形式正确性**：核心（SCC/效应格/A6/A7/内容寻址/前缀回退/语言隔离）全部有证明或复审闭环；A1-A7 已修复并测试。
- **工程妥协**：方向分类后**不再整体声称方向安全**——B 表逐条标注；假纯可能通道（B8/B12）全部入 M_out 清单并声明触发条件与接受理由。
- **M_out 契约**：模型外通道 = S1 现实违反边界；任一升级修复后移出清单；新通道必须入清单（防标签掩盖）。
- **无特例语言无关**：E/Φ 分解达成（引擎零语言常量、pack 全量消化差异）；残余差异均为**数据/行为注入**而非引擎分流（docs/iter37/01-math-review.md §8 + 03-synthesis.md §1.3）。
- **偿还顺序**：B15（性能实测）→ C1（resolveCall 拆分）→ C2 → C5 → C3。
