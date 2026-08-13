# 迭代41 分派完备性证明（01-proof）

> 果实2：S4（解析闭包——每条调用点 → 边/效应/⊥，无静默丢弃分支）从声称变引理。
> 按数学家评审修正落地：**边界声明**（全总性 ≠ 判定健全性）+ S4 推论修正（markDynamic 配对）
>
> + 判别字段补 prop/argFns + 互斥性改述控制流排他 + 行号锚定。
>
> **行号锚定**：本文件行号对应当前工作树（未提交,含迭代40/41 改动）；提交后可能漂移 ±数行,
> 符号名是稳定锚（link.ts）。

## 0. 边界声明（评审洞 2.4）

本证明只证**全总性**：每条调用点经 `resolveCall` 恰落一个通道或以 `?` 终结（无静默丢弃）。
**不证各通道判定健全**——表数据错误、遮蔽守卫缺口（本迭代已修一处活假纯,见 record.md）、
语言语义变化均可在全总性成立时产生错误判定。S4 引理的范围 = 无静默丢弃分支,不含判纯正确性。
判定健全性由 A6/A7 契约 + 表级一致性断言（M1-M6）+ 守卫对称性共同承担。

## 1. 调用点形态（判别字段有限集）

RawCall 判别字段（pack.ts）：

| 字段 | 域 | 分派作用 |
| --- | --- | --- |
| `ctor?` | string \| undefined | 0.5 通道入口判别（构造调用 vs 普通调用） |
| `receiver?` | string \| null | 0 通道入口判别（字面量/`class:` 接收者） |
| `obj` | string \| null | 1/2.25/2.5/objDispatch 通道判别（裸名 vs 对象） |
| `attr` | string | 含 "." 判别 self 与 attrPrefix 的互斥；表查询键 |
| `prop` | boolean \| undefined | 分支内精化：成员 miss → 纯判定（5 处：self/bare/ptype/lb/全局类） |
| `argFns` | string[] | 回调边义务（HOF 通道） |

判别谓词全部是 RawCall 字段函数 ⟹ 形态空间有限（constructor 有限直积,无递归）。

## 2. 通道枚举与全总性（结构归纳）

`resolveCall`（link.ts L1286）为**返回式分派**：每个通道命中即 `return`；穿透路径为显式
fallthrough；末端 5 为总 sink。

| # | 通道 | 入口判别 | 行号（当前工作树） | 终止性 |
| --- | --- | --- | --- | --- |
| 0.5 | ctor | `call.ctor !== undefined` | L1310 | 无条件 return（resolveCtorCall 全路径 return） |
| 0 | receiver | `call.receiver !== null` | L1331 | 全子路径 return（class: 三分支 + builtinTypeEffects 三分支） |
| 1 | self | `obj ≠ null ∧ obj ∈ selfNames ∧ attr 无"."` | L1382 | return（edges/unknown/纯） |
| 2 | bare | `obj === null ∧ ¬assigned(attr)` | L1433 | return（边/并集边/implicitThis/纯）或显式 fallthrough |
| 2.25 | attrPrefix | `obj ≠ null ∧ attr 含"."` | L1499 | 命中 return；miss 显式落 2.5 |
| 2.5 | framework | `obj ≠ null ∧ (¬assigned(obj) ∨ selfNames)` | L1523 | 命中 return；miss 显式落 3 |
| 3 | import | resolveImport（恒 boolean） | L1581 | 内部全路径 return；false 显式落 4 |
| 4 | 效应表 | `obj === null`（裸名）→ builtins；否则 resolveObjDispatch | L1604/L1626 | 命中 return；miss 显式落 5 |
| 5 | sink | 无条件收尾 | L1639-1657 | 裸名 → wildcard 回退/unknown；对象 → markDynamic + unknown |

**归纳骨架**：对任意调用点 c,按判别字段分解：

1. `ctor` 非空 → 0.5 截获（无条件 return）。
2. 否则 `receiver ≠ null` → 0 截获（全子路径 return——含表外方法落 `?` 分支,F9）。
3. 否则按 `obj`/`attr` 形态：self（attr 无"."）→ 1；attr 含"." → 2.25→2.5→3→4→5；
   bare（obj=null）→ 2→（fallthrough）→3→4→5。**逐 if 检查确认无静默穿出函数体**
   （每 if 分支要么 return 要么显式继续;末端 5 无条件执行）。
4. 5 是总 sink：裸名经 wildcard 回退后 `addUnknownCall + markUnknown`；对象 `addUnknownCall +
   markDynamic`。

**结论**：∀ 调用点,恰落一通道或以 `?` 终结 ⟹ S4 引理成立（无静默丢弃分支）。

## 3. 互斥性（控制流排他,评审洞 2.3）

通道两两互斥由**控制流结构**保证,不依赖 extractor 或数据断言：

+ 0.5 vs 其余：`ctor` 分支无条件 return,后续通道不可达（提取侧互斥是冗余前提,不采用）。
+ 0 vs 1/2/2.25/2.5/3/4/5：receiver 分支无条件 return,obj/attr 判别不可达。
+ 1 vs 2.25：attr 含 "." 判别互斥（self 要求无 ".",attrPrefix 要求含 "."）。
+ 1/2 vs 2.5/4：obj null vs 非 null 判别互斥。
+ 2.25 vs 2.5：attr 含 "." 是 2.25 的必要条件,2.5 无此要求——但 2.25 miss 显式落 2.5,
  二者是**顺序截获**非平行通道（同一调用点不会同时命中两个 return）。
+ 表对（impure/pure、frameworkIo/Pure）语义重叠：由表级一致性断言 M1-M6 兜底（pack.ts
  validatePackConsistency）——数据层死条目机器校验,与控制流互斥正交。

## 4. S4 推论（评审洞 2.1 修正）

`?` 参与传播的记账配对（`unknownSites++` + unknownCalls 追加）发生在两类 sink：

+ `markUnknown`：resolveFromObjectImport（L680-682）、sink 裸名路径（L1646-1648）等;
+ `markDynamic`：resolveObjDispatch 末尾（L1279 前 return false 后由调用方处理）与 sink 对象路径
  （L1652-1653）。

二者记账等价（同一 Sink 实现：同增 unknownSites + UNKNOWN_TARGET）。推论：**无路径只记效应不
记 unknown**——任何落 `?` 的调用点都进入未知统计（S4 的传播侧保证）。

## 5. 判别字段穷举静态表（可做④）

| 判别组合 | 通道 | 终点 |
| --- | --- | --- |
| ctor ≠ ∅ | 0.5 | impureGlobals 类型键 / 项目类 / pureCtor / ? |
| receiver = "class:X" ∧ ¬assigned ∧ trustedCtor | 0 | resolveClassMember(false) → edges / ? |
| receiver = "class:X" ∧ (assigned ∨ ¬trustedCtor) | 0 | ? |
| receiver = 字面量 ∧ 表内 hof | 0 | argEdges |
| receiver = 字面量 ∧ 表内 pure | 0 | 纯 |
| receiver = 字面量 ∧ 表外 | 0 | ?（F9） |
| obj ∈ selfNames ∧ attr 无"." | 1 | edges / ? / prop miss 纯 |
| obj = null ∧ ¬assigned | 2 | 顶层边 / 并集边 / implicitThis / fallthrough |
| obj = null ∧ assigned | 2 跳过 | → 3/4/5 |
| obj ≠ null ∧ attr 含"." ∧ 前缀白名单命中 | 2.25 | io |
| obj ≠ null ∧ attr 含"." ∧ 白名单 miss | 2.25→2.5 | Io/Pure 命中或 → 3/4/5 |
| obj ≠ null ∧ frameworkIo/Pure 命中 | 2.5 | io / pure / hof |
| import 命中 | 3 | 项目内边 / 外部效应表 / 遮蔽跳过 |
| obj = null ∧ impureBuiltins/pureBuiltins 命中 | 4 | 效应 / 纯 / argEdges |
| obj = null ∧ 双未中 | 4→5 | wildcard 回退 / ? |
| obj ≠ null ∧ objDispatch 命中 | 4 | A1 / lb / 全局类 / globals 表 / ? |
| obj ≠ null ∧ objDispatch 未中 | 4→5 | ? + markDynamic |

（prop/argFns 在 5 个分支内精化 miss→纯 与回调义务,不改变通道归属。）

## 6. 不做（评审裁决）

+ 调用点形态穷举测试：resolveCall 不导出,合成调用点须镜像判别逻辑 = 重复实现（极小性违反）。
  证明文档逐 if 标注 + 现有回归（351 测试,含本迭代 8 新增）承担。
+ 断言/守卫之外的进一步形式化（如机器可证的分派表）：过度工程,证明义务随收益递减。
