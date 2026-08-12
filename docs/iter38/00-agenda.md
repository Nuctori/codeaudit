# 迭代38 议程：剩余工作「数学家 × Jeff Dean」评审

> 用户裁决：落地审计残余中「数学层优雅正确」项 + 会前讨论确定的继承/多态最小健全版。
> 评审输入：本议程 + 源码 + 历史审计（type-inference-design.md §10、iter36 minimize-audit、iter37 05-audit）。
> 评审产出：01-math-review（健全性，反例优先）、02-jeff-review（最小完成态，砍掉优先）→ 03-synthesis 裁决 → 实施。

## 现状基线

- HEAD `d1f0f2f`；工作树（未提交）已含：P1-2 localBindings（extractor/pack/link 局部构造绑定）、P1-3 并集边（addUnionEdges）、#3 --state 序列化上界（cli.ts `capStateCoupling`，64M 字符预算 + 前缀和二分）、#4 csharp `gameObjectMembers` 双表单源。
- tsc 干净；vitest 串行 309 绿（并行 worker 崩溃 = 环境干扰，忽略）。
- 会前讨论结论：闭包**不做**（现有 state 折叠模型健全，残余=逃逸分析/项目 HOF 实参流，与被否决类型层同族）；继承是真空区（src/ 零继承表示）——本轮主项。

## A. 继承/多态最小健全版（本轮主项）

- **数据**：`RawFileFacts.classExtends: Record<className, readonly string[]>`（可选字段）。extractor 提取：Python `class B(A, C)` 基类表 / JS `class B extends A` heritage identifier / C# base_list。只收静态 identifier（qualified/generic 取末段？）；动态 extends 表达式 → 不记（不可证）；TS `implements` / C# 接口名 → 不记。
- **引擎（link 期合并，闭包不进缓存）**：per-lang super map → 祖先闭包（BFS + visited，环安全 → 环内类解析落 `?`）+ 后代索引。
- **解析助手** `resolveClassMember(rcvCls, m, polymorphic, sink)`：
  - polymorphic=true（self/this 分支、`class:` 接收者、paramTypes/lb/moduleBindings 项目类）：`impls = { firstDef(X,m) : X ∈ {B} ∪ desc(B) }`；firstDef = X 沿祖先链（多继承取并集）第一个声明 m 的类；X 内重载/多定义 → addUnionEdges 全候选；零 impl → `?`（S4）。
  - polymorphic=false（静态类访问 `X.foo()`）：firstDef(B,m) + 祖先链；**不并后代**（类对象精确）。
- **H6 内建子类守卫**：builtinTypeEffects/builtinMutators 表判定前（A1/lb 内建分支），项目内存在 extends T 且覆写 m 的类 → `?`（候选替代：并其实现边，更精确）；**字面量接收者豁免**（不可子类化，已验证健全）。
- **残余**：项目外子类不可见（文档化）；MRO 序忽略（基类并集过近似）；接口不记。
- **缓存**：classExtends 属提取行为变更 → computeFingerprint 自动失效（核实 scan.ts，无需手 bump CACHE_VERSION）。

## B. A1 mutate 语义统一（iter36 §b-7 落地）

- **新表** `LangPack.builtinMutators?: Record<string, ReadonlySet<string>>`（G3' 通道：参数共享对象方法变异 → state）。
- 数据候选：python `list {append,pop,reverse,clear,sort} / dict {clear,popitem} / set {clear}`；csharp `List {Add,AddRange,Clear,Insert,Remove,RemoveAt,Sort,Reverse...}`、`Dictionary {Add,Remove,Clear}`（按现表条目核对）；TS/JS Array 变异（但 TS array_type 不在 ctorTypeName 剥壳 → A1 可能不可达，不可达则表不加——YAGNI）。
- **引擎 A1 分支（仅 param；lb 不动**——局部对象变异不可见 → 纯，与 extractor 局部下标写豁免一致**）**：mutate 命中 → `addEffect("state")` + attr ∈ hofAlwaysArgs/hofCallsArgs → addArgEdges（sort 回调义务保留）→ hitTable(`mutate:${ptype}.${attr}`)；查序在 pure/hof 之前。
- **模型依据**：extractor 已判参数下标写 `d[0]=1` → stateWrites（「影响调用方 → 外部」）；`d.Add(x)` 同语义 → 统一为 state。字面量/局部变异豁免方向安全。
- effectUsage 槽位：新槽位家族 `mutate:` 是否需注册（查 effectUsage.ts 分类逻辑）。

## C. P2-4 node: 剥离出引擎

- `LangPack.normalizeModuleSpecifier?(module: string): string`（可选行为钩子）；link.ts effectFromModule 的 `rawModule.replace(/^node:/,"")` 换钩子调用；javascript/typescript 包提供 node: 剥离。引擎零语言常量完整态。

## D. 已落地待复核（只读核查）

- cli.ts `capStateCoupling`：64M 预算 + compact 前缀和二分——「数学上界」声明是否成立（pretty 缩进膨胀有界 ≲2× 的论证可否接受；单条目超预算 → 空数组是否合法交付）。
- csharp.ts `gameObjectMembers`：单一数据源成立。

## 待裁决问题

- Q1 classExtends 放 RawFileFacts 顶层 vs RawChunk 字段。
- Q2 lb 分支 polymorphic 与否（JS `new C()` 构造器可 return 任意对象）。
- Q3 sort = mutate+hof 的表内表示（builtinMutators 与 hof 表并存即可？）。
- Q4 H6 守卫方向：`?` vs 并子类实现边。
- Q5 TS/JS builtinMutators 是否 YAGNI。
- Q6 静态类访问 `X.foo()` 是否接祖先解析（还是最小版只接实例通道）。
- Q7 mutate 效应用现有 `"state"` 原子 vs 新原子（A7 Σ 扩展）。

## 必读

src/lang/pack.ts、src/lang/extractor.ts、src/engine/link.ts、src/engine/scan.ts（cache/fingerprint）、src/cli.ts（capStateCoupling）、src/core/effectUsage.ts、src/lang/effectOverride.ts、src/lang/packs/{python,typescript,javascript,csharp}.ts、docs/type-inference-design.md（§10 教训：H4/H6/C1）、docs/axioms.md（A6/A7）、docs/iter36/minimize-audit.md（§b-2/§b-7）、docs/iter37/05-audit.md。
