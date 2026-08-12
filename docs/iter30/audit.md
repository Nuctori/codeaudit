# 迭代 30 审计：C# 全限定 System.* 调用 missSlots 数据驱动发现（global:System 1869）

> 只读审计 + 方案产出（未改任何代码）。HEAD 513fde0（docs-only 提交，src 与 dist 同步，本次已 `tsc` 重构建验证）。
> 独立复扫：`node dist/cli.js scan "J:/旧宇宙/代码仓库/InitDeity/Assets" --no-cache --json`（EXIT 0，27.7s，报告 /tmp/iter30-initdeity.json 197MB）——与任务前提 **global:System miss = 1869** 完全吻合；全库 23799 chunks、PURE 8044 / IMPURE 10652 / UNKNOWN 5103（24.7%）。

---

## 1. 机制核实（代码事实）

**调用形态切分**（`src/lang/extractor.ts`）：
- `flattenCallTarget`（L749-792）把 `System.Uri.EscapeDataString(x)` 拍平成点连文本；`callOf`（L563-586）**按首点切分** → obj=`"System"`、attr=`"Uri.EscapeDataString"`、target=`"System.Uri.EscapeDataString"`。
- 故 C# 全限定调用一律是 obj=首段命名空间（`System`），attr=其余段（含类名+方法）。

**判定链路**（`src/engine/link.ts`）：
1. 分支 1 self / 分支 2 裸名（L511-549）：obj="System" 不命中。
2. **分支 2.5 frameworkIo**（L551-566）：`frameworkIo["System"]` 9 条前缀（csharp.ts L270-277：Console/Environment/Diagnostics/IO/Net/Data/Threading/Process/GC）→ attr 前缀命中 → io；**未命中穿透**。注意 iter23 已从该表删除 Reflection/Text/Globalization/Runtime/RuntimeTypeHandle（docs/iter23/frameworkio-design.md，方案 A：删 5 条留 9 条）。
3. 分支 3 import（L568 → resolveImport L329-457）：C# using 不绑定 local（csharp.ts L336-361 只处理 using 别名）→ `importMap.get("System")` 无 → return false。
4. 分支 4（L588-635）：obj="System" → globalClasses 无、`impureGlobals["System"]` 无、`pureGlobals` 无 → **L635 `missTable("global:System")`**。
5. 分支 5 兜底（L649-650）`markDynamic` → `?` 入 calls → audit 公理 3（`?` 构成效应源）→ chunk 判 **UNKNOWN**（analyze.ts，PURE=0/UNKNOWN=1/IMPURE=2）。

**机制核心**：`pureGlobals`（csharp.ts L156-190）已含 `Convert/Enum/Math/TimeSpan/Guid/Array/StringBuilder/List/Dictionary`，但按 **obj** 键——全限定形态 obj="System" 全部绕过；`pureModules`（L323-334）含 `System`/`System.Collections`/`System.Linq`/`System.Text` 等，但只经 `effectFromModule`（L195-234，模块导入形态）消费，obj="System" 走不到。**「System 命名空间的纯子域在效应表体系里无前缀查询入口」= 机制缺口**。

---

## 2. 影响面分解（1869 站点实证构成）

按 attr 首段聚合（InitDeity 现场复扫，与 missTable 计数逐一对齐，sum=1869）：

| 首段 | 站点数 | 占比 | 实际形态 | 裁定 |
|---|---|---|---|---|
| **Uri** | 882 | 47.2% | 全部 `Uri.EscapeDataString` | **纯**（URL 编码=纯计算） |
| **Linq** | 461 | 24.7% | `Linq.Enumerable.ToDictionary` 等 | **纯**（LINQ 运算符；与 pureModules "System.Linq" 同语义） |
| **Convert** | 238 | 12.7% | `Convert.ToString/ToBase64String/ChangeType/FromBase64String` | **纯**（已在 pureGlobals "Convert"） |
| **Enum** | 97 | 5.2% | `Enum.GetName/GetValues/GetUnderlyingType/Parse` | **纯**（已在 pureGlobals "Enum"） |
| **Reflection** | 96 | 5.1% | `IntrospectionExtensions.GetTypeInfo`×47、`CustomAttributeExtensions.GetCustomAttribute`×47、`Assembly.LoadFrom`×2 | **混合**——94 纯读取（iter23 裁定），**2 真实 fs**（LoadFrom） |
| **Text** | 55 | 2.9% | `Text.Encoding.UTF8.GetString/GetBytes`、`Regex.Replace`、`UTF8Encoding` | **纯**（iter23 已裁定 Text=纯计算） |
| **Array** | 14 | 0.7% | `Array.Empty/Exists/Resize` | **纯**（已在 pureGlobals "Array"） |
| **Runtime** | 8 | 0.4% | `Runtime.Serialization.FormatterServices`×7、`CompilerServices.RuntimeHelpers`×1 | 边界——iter23 移除裁定，**不白名单**（落 ? 诚实） |
| **Activator** | 6 | 0.3% | `Activator.CreateInstance` | 边界——反射实例化（≈new，new 本身也判 ?）——**不白名单** |
| **Math** | 5 | 0.3% | `Math.Max/Min` | **纯**（已在 pureGlobals "Math"） |
| **TimeSpan** | 3 | 0.2% | `TimeSpan.FromSeconds` | **纯**（已在 pureGlobals） |
| **Guid** | 3 | 0.2% | `Guid.NewGuid` | **纯**（已在 pureGlobals） |
| **DateTimeOffset** | 1 | 0.05% | `DateTimeOffset.UtcNow.ToUnixTimeSeconds` | **clock（不纯）**——**不白名单**（落 ? 诚实；DateTime 同族在 impureGlobals=clock） |

**关键实证**：
- **纯类/纯命名空间 = 1758 站点（94.1%）**：Uri+Linq+Convert+Enum+Text+Array+Math+TimeSpan+Guid。真实 io 类**不在** 9 表的仅 2 处（`Reflection.Assembly.LoadFrom` fs）+ 1 处 clock（`DateTimeOffset.UtcNow`）——即 **真实未入表 io 类 ≈ 0，1809/1869 是纯类被误判 UNKNOWN**。
- **任务前提修正**：`System.Collections.Generic.*` 全限定**调用**站点 = **0**（List/Dictionary 实例方法经变量调用，不产生 obj="System"；`new System.Collections.Generic.List<T>()` 走构造器路径，flatten 为 null → 裸 UNKNOWN，不在 1869 内）。「Collections」列入白名单仅因纯命名空间对称（pureModules 已含）与测试形态需要，非语料驱动。
- **chunk 级影响（更准确）**：1869 站点分布在 505 chunks；其中 **318 chunks 的唯一 ? 来源就是 obj="System" 站点**。当前纯度分布：215 UNKNOWN + 103 IMPURE（? 混在真实效应中，链精度受损）。
  - 严格白名单下：**316/318 可离 UNKNOWN**（仅 2 个被 DateTimeOffset/Runtime 站点挡住）；其中 **213 chunks 当前 UNKNOWN → 预期转 PURE**（其余 103 本已 IMPURE，? 消除仍净化链）。
  - UNKNOWN rate 预估 **5103 → ~4890（24.7% → ~20.5%）**，上界 −213（实际略低，受调用边传播影响）。
  - 分布：InitDeity 164 / Plugins(SRF) 45 / CosmosFramework 3 / UltimateSafeArea 1——真实项目代码，非生成客户端。

---

## 3. 方案（a-e）

### a) 修复方向
obj="System" 时，attr **首段**（Collections/Generic/Linq/Text…）查「System 命名空间纯子域白名单」；命中 → 纯（`hitTable` 后 return，与分支 4 pureGlobals 命中同语义），不命中 → 维持现状落 `?`（诚实）。

### b) 实现位置（推荐 A，落点与 iter23 方案 B 预埋一致）
**新增 `frameworkPure` 镜像表**（iter23/frameworkio-design.md §2-B 已定义此形态并注明落点「link.ts 2.5 prefix loop 前插纯前缀命中，与 addEffect 对称」，当时选 A 未建；本轮数据证明纯侧收益成立）：

1. `src/lang/pack.ts`（frameworkIo 声明 L122 后）：
   ```ts
   /** 框架纯命名空间（frameworkIo 镜像：对象名 → 成员前缀列表，命中视为纯；严格白名单语义，漏条落 ? 非假纯）。迭代30。 */
   readonly frameworkPure?: Readonly<Record<string, readonly string[]>>;
   ```
   **可选字段** → typescript.ts/python.ts 零改动（无此键 = no-op）。
2. `src/engine/link.ts` 分支 2.5（L565 frameworkIo loop 后、同一 `if` 守卫内）：
   ```ts
   // 迭代30：frameworkPure 纯前缀镜像（白名单——漏条落 ? 非假纯，与 frameworkIo 的 io 判定对称）
   const purePrefixes = pack.frameworkPure && Object.hasOwn(pack.frameworkPure, call.obj)
     ? pack.frameworkPure[call.obj] : undefined;
   if (purePrefixes) {
     for (const p of purePrefixes) {
       if (call.attr === p || call.attr.startsWith(p + ".")) {
         sink.hitTable(`pure:${call.obj}.${p}`); // 迭代21 B 风格：纯侧独立槽位
         return;
       }
     }
   }
   ```
   **顺序：io 先行（既有 loop），纯回退在后**——两表交叠时 io 胜（保守），且 9 条 io 前缀行为零变化。
3. `src/lang/packs/csharp.ts`（frameworkIo 定义旁）：
   ```ts
   /** System 纯子命名空间白名单（迭代30，全限定 System.* obj="System" 回退）。
    *  严格白名单：语料 + .NET 领域双重确证才可入列；漏条落 ? 非假纯。
    *  不列入：Reflection（IntrospectionExtensions/CustomAttributeExtensions 纯读取但
    *  Assembly.LoadFrom=fs、MethodInfo.Invoke=动态——iter23 裁定 UNKNOWN 诚实，不整体放纯）、
    *  Runtime（FormatterServices 序列化底层）、Activator（反射 new≈new 本身判 ?）、
    *  DateTimeOffset（UtcNow=clock）。与 frameworkIo.System 9 条不相交（Text 已在 iter23 移出 io 侧）。 */
   frameworkPure: {
     System: ["Uri", "Linq", "Convert", "Enum", "Text", "Array", "Math", "TimeSpan", "Guid", "Collections"],
   },
   ```

**不推荐 B/C（已否决）**：
- **B. effectFromModule("System", attr) 复用**：`pureModules` 已含 `"System"`（L324）→ 全部 System.* 判纯 → `Reflection.Assembly.LoadFrom`×2（fs）、`DateTimeOffset.UtcNow`（clock）、未来未知 io 类**假纯**——违反审计公理 3（绝不假纯）。拒绝。
- **C. csharp.ts 表结构调整**（pureGlobals 加子键等）：pureGlobals 按 obj 键，无法表达首段前缀；机制改动（link.ts）反正要做，A 即最小机制。

### c) 与 frameworkIo.System 9 表边界
- 9 条（Console/Environment/Diagnostics/IO/Net/Data/Threading/Process/GC）继续管 io 类；白名单只管纯类。两表**不相交**（Uri/Linq/Convert/Enum/Text/Array/Math/TimeSpan/Guid/Collections ∩ 9 条 = ∅；Text 已 iter23 移出 io 侧）。
- 命中顺序 io→纯，交叠时 io 胜（保守）。
- `System.Net.Http` → attr="Net.Http…" 首段 Net ∈ 9 条 → 仍 io。边界回归测试见 §4。

### d) 其他语言影响
- **Python**：`os.path.join` 形态**已**由 effectFromModule 前缀回退处理（python.ts:42 `"path.join:p"` 等 tagged 条目）；`import os` 绑定首段 → obj="os" 走模块表。无 System 式 obj=命名空间首段形态。**零影响**。
- **TS/JS**：无全局命名空间限定调用形态（Math/process 已由 pureGlobals/frameworkIo 覆盖）；frameworkPure 为可选字段 = no-op。**零影响**。
- 修复是 C# 专属（唯一定义 frameworkPure 的 pack），C# 借此补齐与 Python 模块前缀回退的对等能力。

### e) 测试点 2 个（落 `test/audit/csharp-lang.test.ts`，沿用 project() helper；PURE=0/UNKNOWN=1/IMPURE=2）
1. **全限定纯类判纯**：`System.Collections.Generic.List<int>.Add(new System.Collections.Generic.List<int>(), 1)`（任务指定形态；语料无此形态=合成回归）→ `purity === 0` 且无 io 效应。修复前 UNKNOWN=1（global:System miss）。
2. **frameworkIo 9 表边界仍 io**：`System.Net.Http.HttpClient.SendAsync(null)` → attr="Net.Http.HttpClient.SendAsync" 首段 Net 命中 frameworkIo → `purity === 2` 且 effects 含 io。
3. **既有守卫不破**（无需改）：L165-179（`System.Reflection.IntrospectionExtensions.GetTypeInfo` → UNKNOWN=1 非 io）与 L181-194（`System.Reflection.MethodInfo.Invoke` → 非 PURE）——白名单**不含 "Reflection" 整体**，两测试天然继续绿；这是「Reflection 不可整体放纯」的活守卫。
4. （可选）白名单 ∩ frameworkIo.System = ∅ 的单元断言。

### f) 风险
1. **假纯方向（最高风险）**：白名单必须严格。缓解：a) 仅收语料（1869 逐站点聚合）+ .NET 领域双重确证的 10 个首段；b) Reflection/Runtime/Activator/DateTimeOffset 明确排除并注释理由；c) 误判方向安全网——漏条（未入列纯域）落 ? 非假纯（公理 3）；d) 白名单是声明式语言事实义务（同 pureModules），注释写明准入标准，防膨胀。
2. **残余理论风险**：`Convert.ToString(obj)` 若 obj 的自定义 ToString 含 io——与既有 `String.Concat/Format`、string.ToString（builtinTypeEffects）纯判定同一致，为已接受先例，不单独例外。
3. **Uri 882 全部为 EscapeDataString**（逐站点实证），无 Uri 其他成员被误覆盖。
4. **可选未做**：classifyUsage（core/effectUsage.ts L63-73）未枚举 frameworkPure → 纯侧条目不进使用率报告（仅 hit 槽不可见；missSlots 自然降至 111）。如需 corpus-inactive 可见性，+4 行枚举，非必须。
5. **形态边界**：`new System.Collections.Generic.List<T>()` 构造器路径（flatten 为 null → 裸 UNRESOLVED）不在本方案覆盖——另行问题，记待办。

---

## 4. 优先级判断：**本轮做**

| 维度 | 证据 |
|---|---|
| 价值 | #1 miss 槽（1869，远超次位 urlBuilder_ 1173——后者 obj=变量不可表修）；**316 chunks 离 UNKNOWN、~213 转 PURE，UNKNOWN 24.7%→~20.5%**（−4.2pp，本轮最高性价比单点） |
| 成本 | ~15 行 + 2 测试 + 1 注释表；无包接口破坏（可选字段） |
| 风险 | 严格白名单下假纯风险 ≈ 0（真实 io 未入表仅 2+1 站点，全部留在 ? 侧） |
| 沿革 | iter23 方案 B 预埋落点（frameworkio-design.md §2-B/C 演进路径），本轮数据（94% 纯站点）恰好满足其触发条件（「47×UNKNOWN 标注载荷不可接受」已扩大为 1869×） |
| 不做的代价 | 1869 站点继续占 #1 miss 槽、318 chunks 的 ? 继续毒化链精度与标注工作流聚焦 |

**验证命令**（落地后）：`node node_modules/vitest/vitest.mjs run test/audit/csharp-lang.test.ts` → 新 2 测试绿 + 既有 285 全绿 + `npx tsc --noEmit` 0 + InitDeity 复扫对比 `global:System` 1869→111、UNKNOWN 5103→~4890（±传播）。

## 关键文件索引
- `src/engine/link.ts` L551-566（分支 2.5 落点）、L588-635（分支 4 miss 源）
- `src/lang/packs/csharp.ts` L257-283（frameworkIo.System 9 条）、L156-190（pureGlobals）、L323-334（pureModules）
- `src/lang/pack.ts` L122（frameworkPure 字段落点）
- `src/lang/extractor.ts` L563-586（obj/attr 首点切分）、L749-792（flattenCallTarget）
- `test/audit/csharp-lang.test.ts` L165-194（iter23 Reflection 守卫，必须保持绿）
- `docs/iter23/frameworkio-design.md` §2（方案 B 预埋设计）
