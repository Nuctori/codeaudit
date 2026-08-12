# 迭代38 合成裁决（03-synthesis）

> 评审输入：01-math-review（数学健全性，反例优先）+ 02-jeff-review（工程极简）。
> 本文件 = 最终实施清单。冲突项以「健全性 > 最小性」裁决。

## A. 继承/多态最小健全版 —— DO（按数学规则修正版）

**数据**

- `RawFileFacts.classExtends?: Record<string, readonly string[]>`（顶层；类名 → 静态基类名列表）。
  - Python class_definition superclasses / JS class_heritage identifier / C# base_list（identifier + generic/qualified 取末段；接口名照记——保守并集，文档化）。
  - 动态 heritage（非 identifier 形态）→ 该类不记边，且文件级 `hasDynamicExtends = true`。
- `RawFileFacts.hasDynamicExtends?: boolean`（规则3 健全版：该语言存在动态 extends → **该语言多态分派整体降 `?`**，不做文档化残余）。
- `LangPack.trustedCtor?: boolean`（默认 true；javascript/typescript = false）。
  - 规则7：JS/TS `new C()` 构造器可 return 任意对象 → extractor 不产 trusted localBinding / moduleBindings 的 new_expression 绑定；link `class:` 接收者对 JS/TS 落 `?`。Python `__new__` 逃逸 = 文档化残余（同 monkey-patch 族）。

**引擎（link 期）**

- per-lang 合并 super map：**同名类基类并集**（规则2，禁 first/last-wins）→ `hasSubclass: Set<baseName>`（被项目类继承的名字）。
- `resolveClassMember(cls, m, sink, polymorphic)`：
  - polymorphic=true（self/this 分支、paramTypes 项目类）：`cls ∈ hasSubclass` → `?`（后代守卫降级，Jeff TRIM）；`langHasDynamicExtends` → `?`（规则3）；否则 impls = **{cls} ∪ ancestors(cls) 中全部直接声明 m 的类并集**（规则1——禁止最近层停止，Python MRO 反例）→ addUnionEdges 全候选；零 impl → `?`。
  - polymorphic=false（`class:` 接收者、lb、moduleBindings）：精确构造 → 同 firstDef 但**无 hasSubclass 守卫**；JS/TS 经 trustedCtor=false → `?`。
- H6 内建子类守卫：A1 内建表判定前 `hasSubclass.has(ptype)` → `?`（builtinMutators 与 builtinTypeEffects 都守卫；字面量接收者豁免不动；lb 精确构造不守卫）。
- 环：visited 闭包终止，并集语义天然健全（无需专门 `?`）。
- 不接：静态类访问祖先解析（Q6 可选不做）、MRO 序（并集过近似）、TS implements/C# 接口（不记/照记保守）。
- 缓存：classExtends 属提取行为 → computeFingerprint 自动失效；validFacts 补可选字段形状校验（规则8）。

## B. A1 mutate 语义统一 —— DO

- `LangPack.builtinMutators?: Record<string, ReadonlySet<string>>`：
  - csharp：`List {Add, Remove, RemoveAt, Clear, Insert, Sort}`、`Dictionary {Add, Remove, Clear}`；`List.Sort` 在 builtinTypeEffects 改为 `"hof"`（补 Comparison 回调义务——现标 pure 丢回调，规则5 连带修复）。
  - python：`list {append, pop, reverse, clear, sort}`、`dict {clear, popitem}`、`set {clear}`。
  - TS/JS：不加（array_type 不进 ctorTypeName 剥壳 → A1/lb 不可达，死表）。
- 引擎 A1 分支（仅 param；lb 不接——局部对象变异不可见，与 extractor 局部下标写豁免一致）：project-class 守卫**之后**、H6 守卫之后、pure/hof **之前**：
  - mutate 命中 → `addEffect("state")`；`builtinTypeEffects[ptype][attr]==="hof"` 或 hof 表含 attr → addArgEdges（规则5）；hitTable(`mutate:${ptype}.${attr}`)；return。
- 不注入 effectOverride（YAGNI，规则9 条件不成立）；effectUsage 不注册（与 type:/lb: 槽位现状一致）。
- 文档化：mutate 无 stateWrites 位置 → `--state` 耦合图为下界（规则10）。

## C. node: 钩子 —— SKIP（Jeff 裁决）

一行 `replace(/^node:/,"")` 即全局最小态；可选函数字段 = 3 文件 + 间接层，为 1 行特例加抽象 = 过度工程。引擎内保留一行 + 注释。effectUsage 统计层硬编码不动（纯统计，不影响纯度）。

## D. 已落地两项 —— 保留 + 措辞修正

- `capStateCoupling`：代码与二分正确；注释「数学上界」降级为「工程上界（64M ≪ V8 536M 的 8× 余量）」；补前缀和非数组长度（≤500 条目开销 ~502 字符）说明。
- `gameObjectMembers` 单源：成立，保留。

## 附带清理

- scan.ts `SCAN-DEBUG` 直写 stdout（调试残留，数学评审发现）→ 删。
- test/tmp-*.test.ts 探针文件（并行会话遗留）→ 删（untracked scratch）。

## 实施顺序

1. pack.ts 数据面（classExtends/hasDynamicExtends/builtinMutators/trustedCtor）
2. extractor.ts（classExtends 提取 + ctorClsOf trustedCtor 门 + hasDynamicExtends）
3. packs（csharp/python builtinMutators + List.Sort hof；js/ts trustedCtor:false）
4. link.ts（super map/hasSubclass/resolveClassMember + 5 接入点 + H6 + mutate 分支）
5. scan.ts validFacts + SCAN-DEBUG 清理；cli.ts 注释修正
6. 测试：反例级（A1 MRO 并集 / A2 同名类 / A3 动态 extends / B1 sort 回调 / B2 JS 构造器 / H6 / mutate / 继承正例）
7. 验证：tsc + vitest 串行 + 真实扫描冒烟；technical-debt.md 重基线
