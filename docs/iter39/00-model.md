# 迭代39 数学模型细化（00-model）

> 迭代38 落地后，模型各部件收敛到位。本文件把分散在各处的事实（pack 注释、axioms.md、iter37 数学评审、
> iter38 合成裁决）装配成**单一规格**：定义 → 引理 → 定理，并标注每个「已知残余」在模型中的位置。
> 本轮按此模型收掉缺口：P0-1（字段初始化器）、B7（virtual）、B9（moduleBindings 继承）、
> B10（mutate 位置）、node: 数据化、AST 形状契约网、投影数据化。

## 1. 模型定义

**M = (IR, Σ, Λ, π, H, F)**，加证据层 A（标注）。

### 1.1 IR（最小语言）

```
RawFileFacts = file × lang × contentHash × chunks[] × imports[] × defaultExport
             × moduleBindings × classExtends × hasDynamicExtends × parseError
RawChunk     = name × kind{function|class|module} × normText × nesting
             × calls[] × assigned[] × params[] × paramTypes × localBindings
             × stateWrites[] × stateReads[] × thrownTypes[] × catches[] × ownerClass
RawCall      = target × obj × attr × receiver × argFns[] × ctor?
```

IR 是**投影目标**：形态由「效应传播需要知道什么」决定，不由语言决定。语言差异全部在 π 与数据表。

### 1.2 Σ（效应原子集，A7）

Σ = {io, net, fs, db, random, clock, state}。`?` 不是效应（知识标记，参与传播但不入 Σ）。
判定格 Λ = {PURE < UNKNOWN < IMPURE}。

### 1.3 π（投影：AST → IR）

π = 节点类型表（chunkNodes/classNodes/callNodes/nestingNodes/assignmentTargets/literalReceivers）
  ∪ 形状识别（调用拍平/接收者类型/基类提取/参数类型/赋值绑定——**迭代39 前散布在 extractor 硬编码，
  迭代39 P2-1 数据化为 pack 投影表**）
  ∪ 行为函数（extractImports/resolveModule——名字解析是行为不是数据，明确保留）

**投影公理**：π 只产出 IR 事实，不裁决效应；所有 `?` 化在 F 层发生。π 的健全义务：产出的证据
（receiver/paramTypes/localBindings/classExtends）必须「证明后可用」——证不了的形态产 null（如动态
extends → hasDynamicExtends 标记而非伪造边）。

### 1.4 H（类层次，link 期合并）

- `classExtends: cls → bases[]`（静态 identifier 基类；动态 heritage → lang 级 `hasDynamicExtends`）
- `superMap: lang\u0000cls → Set<base>`——**同名类跨文件基类并集**（规则2：禁 first/last-wins）
- `ancestors(cls)`：BFS-up，visited 截断环（并集语义下环天然健全）
- `hasSubclass: Set<lang\u0000base>`：被项目类继承的名字（H6 守卫 + 多态降级原料）
- **virtualMembers（迭代39 B7 新增）**：`lang\u0000cls → Set<method>`（C# virtual/override/abstract；
  Python/JS 一切方法多态 → pack flag `polymorphicMethods=true` 免表）

### 1.5 F（分派：调用点 → 边/效应/?）

通道族（G3' 护栏：每表一个通道，优先级不可重排）：
ctor → literal receiver → self → bare → frameworkAttrPrefix → frameworkIo/frameworkPure →
import（ns/from-bare/from-object）→ A1 参数类型 → lb 局部绑定 → 全局类 → impureGlobals/pureGlobals
→ wildcard → ?。类成员统一走 `resolveClassMember`（迭代38）：

```
resolveClassMember(cls, m, polymorphic) =
  | polymorphic ∧ (langHasDynamicExtends(lang) ∨ virtualGuard(cls,m)) → unknown   （降级，S2 安全）
  | impls = { X.m' : X ∈ {cls} ∪ ancestors(cls), X 直接声明 m' }                   （规则1：全并集）
      （m' = m；ctor 形态 m' = X 自身名）
      同名类跨文件 → addUnionEdges 全候选（规则2 + P1-3）
  | impls = ∅ → none（调用方落 ? 或继续）
```

**virtualGuard（B7 细化，替代 hasSubclass 宽守卫）**：
`virtualGuard(cls, m) = pack.polymorphicMethods ? hasSubclass(lang, cls)
  : (cls ∈ hasSubclass ∧ m 在 cls 祖先链首个声明处为 virtual 族)`
依据：C# 非 virtual 方法是静态分派（`new` 隐藏不改变 `B b = new D(); b.M()` → B.M），
精确解析健全；Python/JS 一切方法原型分派 → 宽守卫。

## 2. 引理

**L1（投影证据方向）**：π 产出的 receiver/paramTypes/localBindings 证据为真时，F 查表结论为真；
证据缺失 → F 落 ?。证明：π 对不可证形态产 null（构造）。

**L2（并集闭包，iter37 数学命题 3/4）**：任意候选集 C，∪ 建边满足 S1（PURE ⟺ ∀c∈C eff(c)=∅）、
S2（∪ ⊇ 真分派效应）、S3（min 链 ≤ 真分派链）。禁止任选单候选。

**L3（祖先全并集完备，规则1）**：impls 含 {cls} ∪ ancestors(cls) 中全部声明者 →
对任意 MRO 序，真分派实现 ∈ impls → S1 保持（Python 多继承最近层并集反例已闭）。

**L4（virtual 精确分派健全，B7）**：C# 非 virtual 方法运行时静态分派到声明类实现 →
virtualGuard 豁免下精确解析不产生假纯；virtual 族 + 子类存在 → 降 ?（保守）。

**L5（构造器效应完备，P0-1）**：`new C()` 的运行时效应 = 闭包内全部显式 ctor ∪ **字段初始化器
（含静态/属性访问器——并集过近似）**。隐式纯的充分条件 = 闭包无显式 ctor ∧ 闭包全部 class chunk
零调用（迭代39 收紧；迭代38 版本缺字段初始化器前提 = 已披露假纯洞）。

**L6（mutate ≡ 下标写，iter38 B）**：参数共享容器方法变异（builtinMutators 表）与
`d[0]=1` → stateWrites 同语义 → state 效应 + 写位置 `obj`（迭代39 B10：耦合图可见性补齐）。

**L7（trustedCtor，规则7）**：语言构造器不保证返回实例（JS/TS return 任意对象）→
该语言不产 trusted 构造绑定，`class:` 接收者落 ?（L1 的直接推论）。

## 3. 定理（A6/A7 操作版，不变）

- **S1 永不假纯**：PURE ⟹ 模型效应闭包 ∅。依赖 L2/L3/L4/L5/L7 + 表数据正确。
- **S2 过近似**：报告 ⊇ 模型。所有降级路径（?/并集/语言级降级）方向保持。
- **S3 悲观下界** / **S4 解析闭包**：不因本轮细化改变（无新静默丢弃分支）。
- **区间定理**：真值 ∈ [audit 链, dev 链]，不变。

## 4. 已知残余在模型中的位置（诚实标注）

| 残余 | 模型位置 | 性质 |
| --- | --- | --- |
| 项目外子类（B8） | H 的完备性前提：desc(B) 仅含项目内类 | 外层保真度，无静态解（axioms §五 同族） |
| 字段初始化器过近似（静态初始化器/访问器并入） | L5 并集方向 | S2 方向安全 |
| Python `__new__` 逃逸（B12） | L7 前提例外（trustedCtor=true 的残余） | 文档化接受 |
| monkey-patch / 内建表数据正确 | Σ 表数据 | 外层保真度 |
| MRO 序 | L3 并集（不做序） | 过近似安全 |
| mutate 位置无读方对称（B10 修复前） | stateDeps 匹配 | 元数据下界，不进判定 |

## 5. 本轮缺口关闭清单 → 模型条款

P0-1/B11 → L5；B7 → L4 + 1.4 virtualMembers；B9 → F 通道（moduleBindings 走 resolveClassMember，
polymorphic=false）；B10 → L6；node: 数据化 → π 行为侧（模块说明符规范化 = 语言事实）；
P2-2 → π 的形状假设测试网；P2-1 → π 节点类型表全量入 pack。
