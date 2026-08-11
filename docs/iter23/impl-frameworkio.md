# 迭代 23 impl-frameworkio：frameworkIo.System 前缀表收紧（ConvertToString ×47 假 io 修复）

> 实现节点 B（run-msp5r0bf）：按 docs/iter23/frameworkio-design.md **方案 A**（前缀表移除，零机制改动）。
> 基线 HEAD b0f1006（247/247）→ 完成后 257/257（+2：csharp-lang 反射用例）。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/lang/packs/csharp.ts:270-276` | `frameworkIo.System` 删 5 条目（`Reflection`/`Text`/`Globalization`/`Runtime`/`RuntimeTypeHandle`），保留 9（Console/Environment/Diagnostics/IO/Net/Data/Threading/Process/GC）；注释说明迭代 23 收紧依据 |
| `test/audit/csharp-lang.test.ts` | +2 用例（设计文档 §5 指定）：① `Type.GetTypeInfo()` 反射元数据读 → effects 不含 io + purity UNKNOWN(1)；② `MethodInfo.Invoke` 动态调用 → purity ≠ PURE（容忍 UNKNOWN/IMPURE，不容忍 0） |
| `README.md` | 测试数 255→257（两处，门禁 D-079） |

**未改**：link.ts（2.5 分支机制）、pack.ts、classifyUsage、effect-table 测试（C5 全裸类名走 impureGlobals 不受影响）、extractor.ts。

## InitDeity 复扫验证（设计文档 §3 预期逐条兑现）

命令：`node dist/cli.js scan "J:/旧宇宙/代码仓库/InitDeity/Assets" --no-cache --json`（只读，零改动工作树）

| 指标 | BEFORE（iter22 报告） | AFTER（本轮复扫） | Δ |
| --- | --- | --- | --- |
| ConvertToString chunks | 47 | 47 | 0 |
| ConvertToString direct-io | **47**（全部假阳） | **0** | **−47** |
| ConvertToString purity | 全部 IMPURE(2)/effects=[io] | 全部 UNKNOWN(1)/effects=[]/direct=[] | 假 io 消除 |
| 全库 IMPURE | 9449 | 9349 | −100 |
| 全库 UNKNOWN | 5761 | 5860 | +99 |
| 全库 PURE | 8590 | 8590 | 0 |

- **47 个 ConvertToString 全部从 direct-io 假阳 → UNKNOWN**（audit 公理 3：`?` 构成效应源 → 诚实未知，非假纯、非假 io）；direct/effects 清空——与设计文档 §3「落 UNKNOWN（非 PURE）」判断依据完全一致。
- 全库 IMPURE −100 > 47：其余 53 个来自 System.Text/Globalization/Runtime 类的全限定调用点（BootScript.cs GetCustomAttribute、SRF/SRDebugger 插件反射调用等，iter22 审计文档已列出同类源）——全部从 io 假阳 → UNKNOWN。
- UNKNOWN +99 与 IMPURE −100 近似守恒（−100 + 少量 structural 变化 ≈ +99），PURE 不变——证明收紧**只消除了假 io，未误伤任何真实判定**。

## 测试

- 新用例验证语义（修复前会失败——防假 io 回归）：
  - `GetTypeInfo` → purity 1（UNKNOWN）且 effects 不含 io ✓
  - `MethodInfo.Invoke` → purity ≠ 0（不假纯）✓
- tsc 0 错误；全量 **257/257**（26 文件）；README 门禁 OK 257。
- 回归核对：effect-table C5 12 例（裸类名 Console/File/Environment/Process/Debug）全绿——不受影响（走 impureGlobals 分支 4）；iter18-real-driven frameworkIo 断言是 TS ctx 表不受影响；lang-features hasOwnProperty 守卫（System 键保留）通过。

## 残余风险（方向安全，设计文档 §4 已记档）

- `System.Runtime.InteropServices.Marshal`（P/Invoke 内存读写）从 io → UNKNOWN——非假纯（UNKNOWN 侧），标注可确证。
- `System.Text.RegularExpressions` 从 io → UNKNOWN——实际是修正（正则无 io 效应）。
- missTable("global:System") 计数上升 → missSlots 列表变化，无测试断言，仅影响 --table-usage 展示。
- 若后续需 PURE 收益（ConvertToString ×47 标 PURE），按方案 C 演进：link.ts:557 前缀 loop 前插 frameworkPure 镜像表（GetTypeInfo/GetCustomAttribute 判纯），当前不必要。
