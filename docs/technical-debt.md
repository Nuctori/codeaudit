# codeaudit 技术债摘要（迭代 37 重基线 / 无特例语言无关最小化后）

> 重基线于迭代 37（2026-08-13）：原文档为迭代 19 快照（`01dd226`，216/216），已过期 23 轮。
> 现基线：HEAD `c90f401`，307/307 测试，LangPack 达成「无特例语言无关」（E/Φ 分解：引擎零语言常量，差异全经 pack 数据/行为注入——docs/iter37/03-synthesis.md §1.3）。
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
| C6 | **局部变量类型推断缺失**（API.g.cs 生成代码 30.5% 未知站点——构造器初始化子集 ~2-3k） | 2h + 度量 | **新识别**（iter33 pain-a TP3）：P1-2 独立轮次，前置 InitDeity 语料度量；守卫 = 单赋值 ∧ declared ∧ ¬param ∧ kind=class（数学 G4） |
| C7 | **重载歧义断链**（ApiClientHelper.PrepareRequest 732 站） | 0.5-1d + 文档 | **新识别**（iter33 pain-a TP2）：P1-3 并集边（数学 G5：全候选建边，禁止任选/arity 定选），产品裁决前置 |

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

## 总体评估

- **形式正确性**：核心（SCC/效应格/A6/A7/内容寻址/前缀回退/语言隔离）全部有证明或复审闭环；A1-A6 已修复并测试。
- **工程妥协**：全部方向安全（假 IMPURE 不假纯）；B1-B6 是有意取舍，A7 效应原子 7 类契约下可解释。
- **无特例语言无关**：E/Φ 分解达成（引擎零语言常量、pack 全量消化差异）；残余差异均为**数据/行为注入**而非引擎分流（docs/iter37/01-math-review.md §8 + 03-synthesis.md §1.3）。
- **偿还顺序**：C6（度量前置局部绑定）→ C7（并集边+产品裁决）→ C1（resolveCall 拆分）→ C2 → C5 → C3。
