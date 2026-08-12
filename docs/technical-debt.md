# codeaudit 技术债摘要（迭代 39 重基线 / 数学模型细化后）

> 重基线于迭代 39（2026-08-13）：数学模型细化为 M=(IR,Σ,Λ,π,H,F)（docs/iter39/00-model.md），
> 收掉 P0-1（字段初始化器假纯洞）、B7（C# virtual 精确分派）、B9（moduleBindings 继承）、
> B10（mutate 写位置）、node: 数据化、AST 形状契约网（P2-2）、投影数据化（P2-1）。
> 现基线：335/335 测试（vitest 串行）+ tsc 干净 + 真实扫描冒烟通过。评审：迭代39 独立审计。
> 分类：**A. 形式正确性修复（已修）** / **B. 工程妥协（有意，方向安全）** / **C. 无主债（应还）** / **D. 外部债（非本仓库可修）**

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

## B. 工程妥协（有意，方向安全——但降低判别力）

| # | 妥协 | 语义 | 代价 | 迭代37 后状态 |
| --- | --- | --- | --- | --- |
| B1 | **效应表 70+ 类基数无校准** | 每类人工裁决（Debug io/PlayerPrefs state 明确；Path fs/Screen io/Transform state 保守） | 过度判定 → 假 IMPURE（方向安全，但 LOW 阈值分布偏移） | **部分缓解**：P1-1 注入白名单补 frameworkPure/pureCtor——新 API 可注入免改包代码（校准仍是人工数据债） |
| B2 | **frameworkIo["this"] 20 组件 + gameObject/transform 隐式 this** | this.gameObject.SetActive → io（固定 io 非细分） | 组件链一律 io，无法区分读/写 | 保留（数据裁决） |
| B3 | **LINQ 链全 ?**（xs.Where(...).Select(...)） | 变量 receiver 动态 → 诚实 ? | 集合内存操作判 unknown（可标注 PURE） | 保留（iter31 S1 链修复部分缓解——builtinMethodReturns 链式接收者解析） |
| B4 | **事件订阅不建模**（+= / AddListener） | 回调方法独立判定，订阅方不建边 | 事件回调不传染（方向安全） | 保留（语言语义建模，第一版级） |
| B5 | **属性访问器不建 chunk**（自定义 getter/setter 有逻辑） | 自动属性无逻辑；自定义 getter 漏检 | 带逻辑的 getter 效应漏（方向安全） | 保留（第一版级） |
| B6 | **隐式 this 与局部变量竞态**：裸名 gameObject 若局部变量遮蔽 → 仍判 io | 遮蔽守卫只查 assigned | 极小 | 保留（P0-2 数据化不改变语义） |

## C. 无主债（应还）

| # | 债 | 成本 | 状态 |
| --- | --- | --- | --- |
| C1 | **resolveCall cognitive 高**（迭代 18 D1 + C# 分支） | 2-4h | **部分清偿**：P0-1 削 link 硬编码分支 ~15 行、P0-2 削 extractor 3 处 pack.name；resolveImport 已拆（iter36 r2）；resolveCall 主体未拆 |
| C2 | **真实项目 fixture**（InitDeity/旧宇宙无回归快照——C# 修复无防回归网兜） | 2-3h | 保留 |
| C3 | **标注工作流 E2E**（unknowns→标注→回读→语料全链路无测试） | 1h | 保留 |
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
| B12 | **Python __new__ 逃逸**（C() 可 return 任意对象） | lb/trustedCtor 对 Python 的残余（同 monkey-patch 族） | 文档化接受 |

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

## 总体评估

- **形式正确性**：核心（SCC/效应格/A6/A7/内容寻址/前缀回退/语言隔离）全部有证明或复审闭环；A1-A6 已修复并测试。
- **工程妥协**：全部方向安全（假 IMPURE 不假纯）；B1-B6 是有意取舍，A7 效应原子 7 类契约下可解释。
- **无特例语言无关**：E/Φ 分解达成（引擎零语言常量、pack 全量消化差异）；残余差异均为**数据/行为注入**而非引擎分流（docs/iter37/01-math-review.md §8 + 03-synthesis.md §1.3）。
- **偿还顺序**：C6（度量前置局部绑定）→ C7（并集边+产品裁决）→ C1（resolveCall 拆分）→ C2 → C5 → C3。
