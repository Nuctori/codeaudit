# 迭代 30 impl：C# 全限定 System.* 纯命名空间回退（frameworkPure）

> 实现节点（run-mspd8zcb）：按 docs/iter30/audit.md 方案 A 落地。
> 基线 HEAD 513fde0（285/285）→ 完成后 287/287（+2：csharp-lang 迭代30 T1/T2）。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/lang/pack.ts` | +`frameworkPure?: Readonly<Record<string, readonly string[]>>` 可选字段（frameworkIo 声明后）——TS/Python 零改动（无此键 = no-op） |
| `src/engine/link.ts` | 分支 2.5 frameworkIo loop 后加纯回退：`pack.frameworkPure && Object.hasOwn(pack.frameworkPure, call.obj)` → 前缀命中 → `sink.hitTable("pure:...")` + return。**io 先行、纯回退在后**——两表交叠时 io 胜（保守），9 条 io 前缀行为零变化 |
| `src/lang/packs/csharp.ts` | +`frameworkPure` 定义（`System: ["Uri","Linq","Convert","Enum","Text","Array","Math","TimeSpan","Guid","Collections"]`，10 首段严格白名单 + 注释准入标准）→ 导出加 `frameworkPure` |
| `test/audit/csharp-lang.test.ts` | +2 用例：T1（System.Uri.EscapeDataString + System.Collections.Generic.List.Add 判 PURE=0 无 io）、T2（System.Net.Http.HttpClient.SendAsync 首段 Net 命中 frameworkIo → 仍 IMPURE=2 含 io） |
| `README.md` | 测试数 285→287（两处） |

**未改**：extractor.ts / scan.ts / effectOverride.ts / index.ts / effectUsage.ts（classifyUsage 未枚举 frameworkPure——纯侧条目不进使用率报告，audit §3.f4 记录可选未做）。

## 实现裁决

1. **可选字段零破坏**：`frameworkPure?` 仅 C# 定义 → typescript.ts/python.ts 无此键 = link.ts 的 `pack.frameworkPure &&` 短路 → no-op。验证：全量 287/287 含全部 TS/Python fixture 原样绿。
2. **io 先行纯回退在后**：两表交叠时 io 胜（保守方向）——`Net` 同时在 io 9 表与 pure 白名单不存在交集，但顺序保证未来若有交叠不会放纯。
3. **严格白名单**：10 首段 = audit 语料逐段聚合（Uri 882/Linq 461/Convert 238/Enum 97/Text 55/Array 14/Math 5/TimeSpan 3/Guid 3/Collections 对称）+ .NET 领域双重确证；Reflection/Runtime/Activator/DateTimeOffset 明确排除（注释理由），漏条落 ? 非假纯。
4. **hitTable 槽位**：`pure:${obj}.${p}` 独立槽位（与 `frame:` 区分）——missSlots 计数不再把纯命中计入 global:System miss。

## InitDeity 复扫验证（--no-cache 只读）

| 指标 | 修复前 | 修复后 | 变化 |
| --- | --- | --- | --- |
| global:System miss | 1869（#1 槽） | **0**（从 top 15 消失） | −1869 |
| missSlots 总站点 | 39049 | 37291 | −1758（Reflection/Runtime/DateTimeOffset 等未入白名单的 ~111 保留在 ? 侧——方向安全） |
| purity 分布 | 8044/10652/5103 | 8045/10652/5102 | 变化极小——audit 预估 213 chunks 转 PURE 未完全兑现（见残余风险） |

**合成探针**（dist 产物真实扫描）：

- `U.Encode`（Uri.EscapeDataString）→ PURE=0 ✓
- `L.Count1/Count2`（Linq.Enumerable.Count 无 lambda / 有 lambda）→ 均 PURE=0 ✓（lambda 回调无 io 效应时保持纯）
- `U.Linq`（Linq.Enumerable.ToDictionary 带 lambda）→ UNKNOWN——因字典迭代器/泛型返回链式接收者未知（既有设计边界：链式 receiver 不建模，C1），非 frameworkPure 缺陷

## 测试

- tsc 0 错误；全量 **288/288**（28 文件）；README 门禁 OK 288（check-readme-tests.cjs）。
- T1/T2/T3 修复前会失败（T1：global:System miss → ? → UNKNOWN=1；T2：边界守卫；T3：HOF 回调边丢失 → 假纯 PURE）。
- 回归核对：iter23 Reflection 守卫（L165-194，GetTypeInfo→UNKNOWN 非 io、Invoke→非 PURE）原样通过——白名单不含 Reflection 整体，活守卫保持绿。

## 复审修复闭环（verify 节点发现，主会话落地）

1. **HOF 回调效应丢失（中，假纯方向）**：frameworkPure 命中直接 return 吞掉回调边——`Enumerable.ForEach(xs, Save)`（Save 写 Console）判 PURE 假纯。三层修复：① link.ts 纯命中前 `hofCallsArgs` 检查 + addArgEdges（末段匹配——call.attr 是完整点连 Linq.Enumerable.ForEach，表存短名）；② csharp.ts hofCallsArgs 补 LINQ 静态运算符（ForEach/Select/Where/Count/ToDictionary 等 23 个——此前空表，C2 只记变量 receiver 链，静态 obj=Enumerable 可建模）；③ extractor.ts argFnsOf 补 C# argument_list 形态 + argument 包装节点解包（C# 参数是 argument→identifier 两层，此前全漏）。T3 守卫（Save 的 io 传染 Run → IMPURE=2）。
2. **pack.ts frameworkIo JSDoc 重复两行（低）**：已删。
3. **link.ts 死变量 dynamicCalls（低）**：已删。

## 残余风险

1. **audit 预估 213 chunks 转 PURE 未完全兑现**（实测 purity UNKNOWN 5103→5102）：预估基于「318 chunks 唯一 ? 来源是 System 站点」，但实测中多数 System.* 调用点所在的 chunk 同时含其他未知点（自递归/链式 receiver/其他 obj 变量），唯一 ? 来源的 chunk 数远小于预估。**missSlots 层面修复完全生效（1869→0），purity 层面是边际改善**——判别力价值在 missSlots 聚焦与标注工作流，非大范围翻案。
2. `System.Collections.Generic.*` 全限定调用站点在 InitDeity 为 0（审计修正），白名单含 Collections 仅对称性——不产生实际影响。
3. `new System.Collections.Generic.List<T>()` 构造器路径（flatten null → 裸 UNRESOLVED）不在本方案覆盖（audit §3.f5，待办）。
4. classifyUsage 未枚举 frameworkPure → 纯侧条目不进 effectTableUsage 报告（audit §3.f4，可选未做）。
