# 迭代 23 设计：frameworkIo.System 前缀表收紧（ConvertToString ×47 假 io 修复）

状态：**只读审计完成，方案产出，未改任何代码**。HEAD b0f1006，工作树干净，247/247 测试基线。

## 0. 现状机制（代码事实）

- 表定义：`src/lang/packs/csharp.ts:270-273` — `frameworkIo.System` 14 条目：
  `Console / Environment / Diagnostics / IO / Net / Data / Threading / Process / GC / Reflection / Text / Globalization / Runtime / RuntimeTypeHandle`
- 消费逻辑：`src/engine/link.ts:551-566`（分支 2.5，位于 self/裸名之后、import 之前）：
  - `call.obj` = 调用链首段（`System.Console.WriteLine` → obj=`"System"`、attr=`"Console.WriteLine"`，extractor.ts:444-446 按首段切分）
  - 命中条件 `call.attr === p || call.attr.startsWith(p + ".")` → `sink.addEffect("io")` + `hitTable("frame:System")`，立即 return
  - 未命中则穿透：分支 3 import（C# resolveModule 恒 null，csharp.ts:385-389）→ 分支 4 全局类/效应表（`"System"` 无匹配 → `missTable("global:System")`，link.ts:635）→ 分支 5 兜底 `markDynamic()`（link.ts:649-650）→ `?` 入 calls
- 判定：`core/analyze.ts:156-166` 双模式运行，对外 `purity = audit.purity`；公理 3（analyze.ts:63-64）audit 模式把 `?` 计入效应源 → analyze.ts:121-127：`real=eff−{?}` 非空 → IMPURE；否则含 `?` → **UNKNOWN**；否则 PURE。
- 结论链：**前缀移除后，被删命名空间的调用落 `?` → UNKNOWN，绝不落 PURE**（`?` 在 audit 模式必然构成 UNKNOWN 判定）。MethodInfo.Invoke 不会假纯。

## 1. 14 类逐类裁定

| 类 | 裁定 | 依据 |
|---|---|---|
| Console | **保留 io** | 输出副作用；裸名形态另有 impureGlobals `Console:io`（csharp.ts:35），双轨并行 |
| Environment | **保留 io** | 进程/机器状态（GetEnvironmentVariable/GetFolderPath）；impureGlobals `Environment:io`（csharp.ts:148） |
| Diagnostics | **保留 io** | Debug/Trace/EventLog/Process 家族（输出+进程操作），保守 |
| IO | **保留 io** | System.IO.File/Directory/Stream 真实文件读写 |
| Net | **保留 io** | System.Net 网络（WebRequest/HttpClient/Socket 家族） |
| Data | **保留 io** | System.Data（DataSet/SqlClient）DB 边界 |
| Threading | **保留 io** | 线程/锁/等待（Thread.Sleep 时钟家族，保守 io） |
| Process | **保留 io** | 进程启动；impureGlobals `Process:io`（csharp.ts:149） |
| GC | **保留 io** | Collect/GetTotalMemory 内存状态，保守 io（改 state 亦可，非本次范围） |
| Reflection | **移除** | 元数据读取（GetTypeInfo/GetCustomAttribute/GetDeclaredField）= 纯读取；Invoke 动态调用移除后落 UNKNOWN（诚实，非假纯——见 §0） |
| Text | **移除** | StringBuilder/Encoding/Regex = 纯计算；裸名 StringBuilder 已在 pureGlobals（csharp.ts:170） |
| Globalization | **移除** | CultureInfo 读文化数据：InvariantCulture 常量；CurrentCulture 是读非写（state 语义只算写） |
| Runtime | **移除** | RuntimeHelpers/CompilerServices 运行时服务非 io。⚠️ 例外：Runtime.InteropServices.Marshal P/Invoke 是真实 io，移除后落 UNKNOWN——方向安全（UNKNOWN 非假纯），标注可确证，记残余风险 |
| RuntimeTypeHandle | **移除** | 纯结构体（RuntimeType 句柄），属性读无效应 |

净效果：**删 5 条字符串**（Reflection/Text/Globalization/Runtime/RuntimeTypeHandle），保留 9 条。

## 2. 改动最小方案对比（推荐 A，B/C 为可选项）

### A. 前缀表移除（推荐）
- 改动：`csharp.ts:270-273` 删 5 条目。**1 处表编辑，零机制改动**（无 pack 接口/无 link.ts/无 classifyUsage 改动——frameworkIo 键 `System` 保留，link.ts:191 rootOf 的 `frame:System` 分类不变）。
- 落点：被删命名空间下所有 `System.*` 全限定调用 → 分支 5 `markDynamic` → UNKNOWN。
- 与标注工作流闭环：UNKNOWN 由 PURE 标注确证（scan.ts 标注回读去 `?`），符合既有惯例。

### B. 方法名白名单（不推荐单独做）
- 需新机制：frameworkIo 无每方法例外；要加 `frameworkPure` 镜像表（pack.ts 接口 + link.ts 2.5 分支 loop 前加纯前缀命中 return + 3 语言包同步）≈ 20+ 行 + 表维护。
- 收益：GetTypeInfo/GetCustomAttribute 判纯 → ConvertToString 落 PURE。
- 代价：Text/Globalization/Runtime 假 io 仍在（除非白名单继续膨胀）；白名单 = 声明式语言事实义务，漏一条就回退 io。

### C. 结合（演进路径）
- 先 A 落地（1 行）。若 InitDeity 复扫后 47×UNKNOWN 标注载荷不可接受，再按**标注确证清单**增量加 B（落点已定：link.ts:557 prefix loop 前插纯前缀命中，与 addEffect 对称）。

**决策**：A。理由：改动最小、方向安全（UNKNOWN 非假纯、非假 io）、与标注闭环兼容；B 的 PURE 收益在当前要求（"落 PURE 或 UNKNOWN 均可"）下不构成必要性。

## 3. InitDeity 预期影响（判断依据）

- **ConvertToString ×47**：direct io 消除。
  - 反射元数据调用（IntrospectionExtensions.GetTypeInfo / CustomAttributeExtensions.GetCustomAttribute，iter22 报告 iter22/initdeity-audit.md:88-92）→ 前缀移除后无可匹配 → 分支 5 `?`。
  - 自递归数组 join：自环是内部边（非 `?`）；`string.Join` → obj=`"string"` 命中 pureGlobals（csharp.ts:176）→ 纯。
  - 故 direct={}、calls={self, `?`} → audit 公理 3 → **落 UNKNOWN**（非 PURE）。判断依据：analyze.ts:64 `?` 构成效应源 → 121-127 判 UNKNOWN。仅当加 B 白名单（GetTypeInfo/GetCustomAttribute 判纯）→ PURE。
- 全库：所有 `System.Reflection/Text/Globalization/Runtime/RuntimeTypeHandle.*` 全限定调用从 io 假阳 → UNKNOWN；裸名类（StringBuilder/Console/File 等）不受影响（走 impureGlobals）。同类修复源：BootScript.cs（GetCustomAttribute）、SRF/SRDebugger 插件 8 处反射调用（iter22/initdeity-audit.md:91）。
- 口径数字（iter22 基线）：direct-io 4019 下降（≥47 ConvertToString + 反射类调用点）；UNKNOWN 5761 上升。
- chain：ConvertToString 自环保留（自递归），链长结构不变。

## 4. 回归风险（已核对，无阻断）

- 现有测试**零依赖** System 前缀：
  - `test/audit/effect-table.test.ts:40-74` C5 12 例全裸类名（Console.WriteLine/File.ReadAllText/Environment/Process/Debug）→ 走 impureGlobals 分支 4，不触 frameworkIo。
  - `test/audit/csharp-lang.test.ts:131-145`（gameObject/transform/this 前缀）、fixture.test.ts（UnityComponents/CoroAsync，裸类名+Unity 前缀）→ 不受影响。
  - iter18-real-driven.test.ts:69 frameworkIo 断言是 TS `ctx` 表（typescript.ts:260）→ 不受影响。
  - lang-features.test.ts:596-604 hasOwnProperty 守卫测试：`System` 键保留 + Object.hasOwn 守卫（link.ts:554-556）不变 → 通过。
  - 已 grep test/ 全目录：无 `frame:System` / `global:System` / missSlots 计数断言。
- 非测试影响：`missTable("global:System")` 计数上升（Text/Globalization 等全限定调用落入分支 4 miss，link.ts:635）→ 改变 missSlots 列表，无测试断言，仅影响使用率报告展示。
- classifyUsage（core/effectUsage.ts）不枚举 frameworkIo 条目 → 效应表使用率报告不受影响。
- 残余风险（方向安全，记档）：`System.Runtime.InteropServices.Marshal`（P/Invoke 内存读写）从 io → UNKNOWN，非假纯；`System.Text.RegularExpressions` 从 io → UNKNOWN（正则无 io 效应，实际是修正）。

## 5. 测试点 2 个（落 `test/audit/csharp-lang.test.ts`，Purity: PURE=0/UNKNOWN=1/IMPURE=2）

1. **反射元数据读非 io**：`System.Reflection.IntrospectionExtensions.GetTypeInfo(typeof(T))`（或 CustomAttributeExtensions.GetCustomAttribute）→ `purity === Purity.UNKNOWN (1)` 且 `effects` 不含 `"io"`。修复前 io/IMPURE=2 → 本测试失败，语义=防假 io 回归。
2. **MethodInfo.Invoke 不假纯**：`System.Reflection.MethodInfo.Invoke(x)` → 断言 `purity !== Purity.PURE`（期望 UNKNOWN=1；容忍 io=2 但不容忍 0）。语义=移除后动态调用落 `?`/UNKNOWN 而非假纯（audit 公理 3 保证，双保险防未来机制改动破坏）。

验证命令（改动落地后）：`npx vitest run test/audit/csharp-lang.test.ts test/audit/effect-table.test.ts` → 247/247 全绿；InitDeity 复扫对比 direct-io 源清单（iter22 口径）确认 ConvertToString ×47 移出 io。

## 关键文件索引

- `src/lang/packs/csharp.ts:255-279` — frameworkIo 定义（改动点：270-273 删 5 条目）
- `src/lang/packs/csharp.ts:156-190` — pureGlobals（string/StringBuilder 等已覆盖裸名形态）
- `src/engine/link.ts:551-566` — 2.5 分支消费逻辑（不改）
- `src/engine/link.ts:589-650` — 前缀未命中穿透路径（分支 4/5 → `?`）
- `src/core/analyze.ts:121-127, 63-64` — UNKNOWN 判定依据（audit 公理 3）
- `src/core/types.ts:15-19` — Purity 枚举（PURE=0/UNKNOWN=1/IMPURE=2）
- `src/lang/extractor.ts:444-446` — obj/attr 切分（首段/余链）
