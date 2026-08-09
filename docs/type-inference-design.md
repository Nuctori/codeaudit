# 类型推断层设计规格 v0.1 —— 审计用

> **审计裁决（2026-08-10）：本设计不实施。** 4 个独立 reviewer 交叉审计后，收益审计以真实数据否决了完整类型层（回收上限 ≈6-7% 调用点 / ≈0-3% 翻转 chunk，见 §10.2）；健全性审计同时指出规格存在多处必修的假纯通道（§10.1）。建议主路线改为：增强 --unknowns 标注工作流（补 chunk.id）+ 可选字面量接收者单项 + egg 框架命名空间表。完整审计结论见 §10。

本文件是待审计设计的唯一规格。审计者以它为准，对照 `src/` 实现与真实扫描数据评估。

## 0. 背景与目标

假纯修复（c89d92e）后，一切"接收者不可证明"的成员调用 `o.m()` 都记 `?`，真实代码 unknown-rate 暴涨（实测：swagger-ui/src/core 36%→58%，egg.js controller 18%→41%）。其中大量是**纯形态**被误标：`created.append(user)`（`[]` 字面量接收者）、`" ".join(...)`（字面量接收者）、`name.strip()`（注解为 str 的参数）。

被否决的"脏"方案：全局纯方法表按方法名判纯——不证明接收者类型，对 `name.strip()` 假设 name 是 str，不健全（name 可以是任何对象）。

本设计目标：**提取接收者符号的具体类型（第二个抽象格），类型被证明后按类型语义判定——纯 / 连边 / 未知**。数学上 = 类型与效果系统（type-and-effect）的静态近似，与工具现有效应传播同构。

## 1. 抽象域

```
L_T = P(Types) ∪ {⊤}
Types = 项目类名 ∪ 内建类型名
       （str/int/float/bool/list/dict/set/tuple/bytes/None；JS: string/number/boolean/Array/Object/Function 等）
join = 并集（单调）
```

- ⊤ = "类型不可证明"（无注解参数、未推断出、混合不确定）。含 ⊤ 的判定一律走 `?`。
- 内建类型名集合由 LangPack 数据表 `builtinTypes` 提供（与现有 impureModules 等表同构）。

## 2. 传递函数

**表达式分类 E(expr) → 类型集：**

| 表达式形态 | E 的结果 |
| --- | --- |
| 字面量 `"x"` / `42` / `[]` / `{}` / `true` | {str} / {int} / {list} / {dict} / {bool} |
| `new C()` | {C} |
| `C()`（C 是项目内类名） | {C} |
| `C()`（C 是项目内函数） | 该函数返回类型集 RT(C)（跨函数，§3） |
| `f(args)` | RT(f) |
| 标识符 x | 函数内赋值映射 Assign[x]；无赋值且是参数 → 注解类型（§2.3）；否则 ⊤ |
| 成员访问 `a.b` | a 的类型集的成员属性类型（仅当类型是项目类且字段有初始化器/注解），否则 ⊤ |
| `x if c else y` / 逻辑表达式 | E(x) ∪ E(y) |
| 其余（下标、运算结果、闭包捕获、解构深层） | ⊤ |

**2.1 函数返回类型集** `RT(f) = ∪ { E(ret) : return ret 语句 }`；无 return → 由语言包定的空类型（None/void）。

**2.2 函数内赋值（流不敏感）**：对 `x = expr`（含 for 循环变量、with/as、except as、解构第一层）→ `Assign[x] ∪= E(expr)`。不按控制流排序，赋值即并集——保证单调。

**2.3 参数类型**：注解（TS 类型注解 / Python 注解）→ 解析为 Types 集；无注解 → ⊤。

**2.4 类字段**（TS/JS class field、Python 类属性）：字段初始化器 `f = <expr>` → 类型集，供 `this.f.m()` 与跨类 `obj.f.m()` 解析；无初始化器 → ⊤。

## 3. 跨函数传播（复用 Tarjan 凝聚）

RT(f) 依赖被调函数的 RT → 在 chunk 调用图上做与效应传播同构的传播：

- 图 = 现有 Tarjan 凝聚 DAG（`src/core/tarjan.ts` 已产出；`src/core/analyze.ts` 的 runOnce 同构）
- SCC 内成员互相依赖 → 类型集并集（单调、有界、终止）
- 逆拓扑单趟：后继 SCC 的 RT 已定，再算本 SCC——一次扫描即收敛（Types 有限、图无环，无需不动点迭代）
- 依赖序：RT 传播需要"边已解析"（f 调谁已知）→ 类型层在 link 之后、analyze 之前，或与 link 集成（实现位置待审）

## 4. 接收者分派规则（o.m() 的判定）

已知 R = E(o)：

| R | 判定 |
| --- | --- |
| R ⊆ 单个内建类型，且内建表有 m 的语义 | 按表：纯（无效应）或 io。表 = 语言包数据 `builtinTypeEffects`（`{ str: {strip: pure, ...}, list: {append: pure}, dict: {get: pure} }`）。**仅当 R 是证明的单一类型时查表** |
| R ⊆ 项目类 | CHA：R 的层次闭包（`class B extends A` 边）中定义 m 的方法集 → 连真边（多实现并集） |
| R 含 ⊤ / 混合集（如 {str, list}） | `?`（诚实） |
| R = ∅ | `?` |

## 5. 数据与架构

- 新增 LangPack 数据表：`builtinTypes`、`builtinTypeEffects`（同 impureModules 等现有表同构）
- 类层次边（`class B extends A` / `class B(A)`）：extractor 提取时产出（新 RawClassFacts 或并入 facts）
- 每文件缓存（`src/engine/scan.ts` cache.json）：per-file 可缓存部分 = 局部赋值映射、注解、类层次（提取期产物）；跨文件 RT 传播 = link 期计算，不进缓存。cache version 是否需 bump——审计点
- 层序：extract（提取 + 局部类型原料）→ link（边 + 接收者类型 E(o)）→ 类型传播（RT）→ analyze（效应传播，**不变**）
- 公理 1/2/4/5 不变；公理 3 语义不变（`?` 仍传导为 audit 悲观）

## 6. 明确不做（用户决策）

- **monkey-patch 检测不做**（`str.strip = ...`、`Object.prototype.x = ...`）。含义：内建类型效应表在"项目不改写内建类型语义"假设下才完全健全；该假设被接受为已知局限。审计者需评估此取舍是否可接受、是否动摇"数学上健全"的宣称。
- 不做完整 points-to / 别名分析；不做跨函数实参→形参类型流；不做流敏感分析。

## 7. 预期收益（供收益审计实测核对）

- pyshop：`created.append`（list 字面量）、`" ".join`（字面量接收者）、带注解参数的方法 → 收回部分翻转
- egg.js controller/service：`this.service.login()` 若字段初始化器可推断 service 为项目类 → 连真边（不只去噪）
- swagger-ui/core：字面量接收者 + 构造器 + 注解 → 部分收回；无注解参数成员调用仍 `?`

## 8. 验证策略（审计者评估充分性）

- 性质测试：随机类型表达式对照朴素参考；RT 传播对照朴素不动点（复用 property.test.ts 纪律）
- 回归：pyshop/egg/swagger 翻转清单逐项断言收回/连边
- 健全性模糊：构造"类型证明错误"反例，断言不产生假纯（宁 UNKNOWN 不 PURE）

## 9. 参考物（审计者可自行重扫验证）

- 源码：`src/lang/extractor.ts`、`src/engine/link.ts`、`src/core/analyze.ts`、`src/core/tarjan.ts`、`src/lang/pack.ts`
- 真实数据：`node dist/cli.js scan <dir> --format json --no-cache`
  - `/d/node/nodejs_wx_aipay_api-master/app/controller`（egg.js，5 文件）
  - `/d/node/nodejs_wx_aipay_api-master/app/service`
  - `/d/node/nodejs_wx_aipay_api-master/app/model`
  - `/d/node/swagger-ui/src/core`（164 文件，798 chunks）
- 既有基线（旧版 dist 已不可用；以"PURE→UNKNOWN 翻转 = 该函数含不可证明成员调用"为准，可先重扫当前 dist 看现状）

## 10. 交叉审计裁决（4 独立 reviewer，2026-08-10）

### 10.1 健全性缺口（agent1 数学健全性 + agent2 反例攻击，强制必修否则假纯）

| # | 缺口 | 后果 | 必需规则 |
| --- | --- | --- | --- |
| C1 | §4 缺「层次闭包中未找到 m」判定行 | 自然实现=丢弃 → 假纯 | 未找到 m → 记 `?`（永不静默丢） |
| C2 | 层序矛盾：E(o) 依赖 RT 而 RT 在 link 后 | 类型未收敛就分派 → 假纯 | 三相：extract → link（仅边）→ RT 全图收敛 → 用最终类型分派 → analyze |
| F1/M3 | 参数注解即类型证明（Python 注解无运行时强制） | `f(x: str); x.strip()` 传自定义对象 → 假纯；TS 有编译强制，两语言必须分置信级 | 注解假设写入已知局限；或 Python 侧仅在注解+表内纯方法时给 PURE |
| F2/H3 | 字段类型只取初始化器，忽略实例重赋值 `self.x = evil` | 字段判纯但运行时被换 → 假纯 | 字段类型 = 类内所有 `self.x=`/`this.x=` 并集（流不敏感） |
| F3 | nonlocal/global 跨函数共享 | 条件赋值覆盖参数类型 → 假纯 | global/nonlocal 声明 → 该变量 ⊤ |
| H2 | `C()` 类名/函数名歧义 | 类表/函数表静默选一 → 假纯 | RawChunk 加 kind；同名并存 → 混合/⊤ → `?` |
| H4 | 层次闭包方向未定义 + 跨文件继承未规定 | 漏子类覆写 → 假纯 | 闭包 = 祖先 ∪ 后代；跨文件层次边 link 期合并、闭包不进缓存 |
| F4 | 构造调用效应未定义 | 构造器 io 漏报 | 构造调用 = 普通调用，效应 = 构造器体 ∪ 字段初始化器 |
| F5 | 装饰器返回新函数 | 包装器 io 漏报 | 检测到装饰器 → 该函数 RT/效应 ⊤ |
| H5 | 条件赋值丢参数类型 | `if c: x = "a"` 后 x.format → 假纯 | 赋值存在时 Assign ∪= 参数注解 |
| H6 | 内建子类（`class MyStr(str)`）覆写方法 | 注解 str 判纯 → 假纯 | 项目内有内建子类覆写 m → `?`（字面量接收者不受影响，已验证健全） |
| H7 | JS 原型赋值惯用法 / Python `__getattr__` | 类表缺方法 → 依赖 C1 兜底 | 项目自身类原型动态化 = 惯用法非 monkey-patch，需规则 |
| F9 | §4 表格外：「单内建但表无该方法」未定义 | 实现落到丢弃/错分支 | 补第五行 → `?` |
| F10 | async 返回未包 Promise | 类型污染下游 | async RT = Promise<∪E(return)> |
| F11/M2 | 循环变量元素类型未定义 | 错型（for x in [1,2,3] → x={list}） | 循环变量 = 元素类型（字面量序列可推断，否则 ⊤） |
| M3/M4 | 无 monkey-patch（§6）+ 注解可信 + this 绑定逃逸（fn.call(o)） | 条件健全未声明 | 三假设显式列入已知局限 |

### 10.2 收益审计（agent4，决定性：真实数据否决）

重扫 4 个真实项目，225 个 `?` 调用点按接收者类别：

| 类别 | egg（≈72） | swagger（≈153） | 占比 | 规格能否收回 |
| --- | --- | --- | --- | --- |
| (a) 字面量接收者（`" ".repeat`、`[].push`） | 3% | 6% | ≈5% | ✓（需 AST 层接收者事实 + 表覆盖） |
| (b) 注解参数 | 0% | 0% | **0%** | ✓ 但真实数据零触发（纯 JS/JSX，PropTypes 非注解） |
| (c) 构造器 new C() | 0% | 1.5% | ≈1% | ✓ 仅内建构造器 |
| (d) 字段初始化器 this.service= | 0% | 0% | **0%** | ✓ 但零触发（egg 用 `const {ctx}=this` 解构，无字段） |
| (e) 无注解参数/局部/闭包/属性链 | 97% | 88% | **≈91%** | ✗ 任何类型层都救不了（§6 已自认不做） |
| (f) 全局静态成员（Object.keys 等） | — | ≈2% | ≈2% | 已被现有 pureGlobals 覆盖，规格必须保留否则回退 |

- **规格可收回上限 ≈ 6-7% 调用点；翻转 chunk 级 ≈ 0-3%（172 个翻转中估 0-5 个）**；swagger 421 个含 `?` chunk 中 344 个 calls 恰好 = `["?"]`（单哨兵，chunk 级收回要求全部 `?` 都可证明）。
- **§7 的 egg 预期与事实不符**：egg 无 `this.service` 字段，真实形态是 `const { ctx, app } = this` + `ctx.service.order.update()`（框架注入）→ 类型层对 egg 收回 = 0/19。
- **证明后查表 vs 全局纯方法表**（agent4 §3）：非等价，证明后查表严格更健全（残余 = monkey-patch + 内建子类覆写，全局表残余 = monkey-patch + 错误接收者——后者是常态编程现象）。

### 10.3 架构落地（agent3：可行，无阻断，但成本与前提修正）

- 缓存必须 bump v2 + 读侧校验（现状零校验）；「从 sourceText 重推类型原料」不可行（嵌套归属/类级事实在方法文本外/parseError fallback 无 sourceText）。
- RawChunk 需加 kind 字段；TS `new_expression` 当前根本不提取（构造器 I/O 整体不可见）。
- 「共享同一份凝聚」前提不成立（CHA 新边改变图）；analyze audit/dev 双跑重复 tarjan 才是真去重点（抽 condense() helper）。
- resolveModule O(F) 热点被类基类解析放大 → 必须 memoize。
- 类型层落地前先修 [×4] Windows 路径规范化（scan.ts:46 一行）。
- 测试：RT/分派对拍 + 不变量 + 健全性模糊（靶子=E(o) 证明机制，"注解撒谎"反例文档化排除）；现有断言会翻转需重基线（pyshop batch_create chain 0→1）。

### 10.4 最终建议（agent4 + 综合）

1. **不做完整类型层**：收益（≈0-3% chunk）与成本（100+ 行 + 4 语言包表 + 传播 pass + 缓存迁移）不匹配；(b)(d) 两大能力来源在真实分布为 0，(e) 91% 任何类型层救不了。
2. **主路线 = 增强 --unknowns 标注工作流**：导出补 `chunk.id`（~5 行，堵 CROSS-AUDIT 锚点缺口），suggested_prompt 已有，人工/AI 标注闭环成立——91% 的 `?` 本就不可能自动判。
3. **可选小步 = 字面量接收者单项**（≈60 行 + AST 接收者事实 + 表）：收回 ≈5-6% 调用点，健全、低风险，验收以 unknown-rate 降 1-3pp 为准。
4. **egg 噪音走框架命名空间表**（`ctx.service`/`ctx.model` → 已知映射），一行数据表 + 一条分支，比类型层便宜一个量级。
5. **保留 pureGlobals**（全局静态成员已有覆盖，类型层规格不得使其回退）。

### 10.5 已验证健全（不受否决影响，可复用）

- 字面量接收者判定健全（字面量不可替换/子类化）；条件/三元并集、逻辑表达式、try/except 双路径并集、局部重绑并集、混合集/⊤/∅ → `?` 全部健全；`?` 传导与公理 3 保持（类型层若做，只影响分派前证据，不破坏效应层）。
