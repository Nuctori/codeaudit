# 迭代 23 记录（record 节点）

> DAG run-msp5r0bf-04ffa82e：audit-state / audit-frameworkio（并行）→ impl-state / impl-frameworkio（串行防 dist 竞争）→ verify → record
> 基线 HEAD b0f1006（247/247）→ 当前工作树 258/258（+11：unit/state 6 + audit/state 2 + csharp-lang 2 + 全旗标护栏 1）

## 归档清单（docs/iter23/，6 件齐全）

| 文件 | 节点 | 内容 |
| --- | --- | --- |
| `state-design.md` | audit-state | --state 状态耦合图规格（stateCouplingOf 反查/⊤ 处理/截断/json additive/测试点） |
| `frameworkio-design.md` | audit-frameworkio | System 前缀 14 类逐类裁定（删 5 保 9）+ 方案 A + 预期影响 + 回归风险 |
| `impl-state.md` | impl-state | stateCouplingOf + --state 实现报告（+8 测试、255/255） |
| `impl-frameworkio.md` | impl-frameworkio | 前缀表收紧 + InitDeity 复扫对比（ConvertToString 47→0、IMPURE −100） |
| `verify.md` | verify | 复审结论 **APPROVED**（BLOCKER/MEDIUM 修复闭环记录，258/258） |
| `record.md` | record | 本文件 |

## CROSS-AUDIT.md 追加

「## 迭代 23（状态耦合图 + 效应表收紧）」节已追加（459 行后，markdown 校验通过）：

- 状态耦合图 D-127 落地（--state 旗标 / stateCouplingOf / json additive / ⊤ 暴露 / 下界语义）
- frameworkIo.System 收紧（删 5 保 9）+ InitDeity ConvertToString ×47 假 io 闭环（IMPURE −100 / UNKNOWN +99 守恒零误伤）
- 工具盲区处置：① 已闭环；② 记录不修（方向安全）；③ 基线不可复现 → 待办
- 复审 BLOCKER 二次再现修复记录（--state 顶 --table-usage + 根因护栏）

## README.md / CHANGELOG.md 同步

- README：测试数 258（两处）、`--state` 示例行（:32）——已由 impl-state + 主会话完成，`check-readme-tests.cjs` 门禁通过
- CHANGELOG：[Unreleased] 标题改「迭代 22-23（真实校准 + 门禁 + 状态耦合图 + 效应表收紧）」；新增 `--state` 条目；修复 2 条目（frameworkIo 收紧 + --state 分支回归）

## 下轮待办（verify 结论 APPROVED——残余风险 + 迭代 22 遗留）

1. **基线不可复现**（迭代 22 遗留 ③，P1）：2654 条标注文件丢失，无标注口径 UNKNOWN 5761 vs 基线 3449——找回/重建 `initdeity-annotations.json` 入库，或接受无标注基线为新基准并文档声明
2. **`System.Reflection.Assembly.LoadFrom/LoadFile`**（verify 残余，P3 方向安全）：真实文件 io 现落 UNKNOWN——非假纯，标注可确证；若后续纳入需加 io 条目
3. **`System.Runtime.InteropServices.Marshal`**（design §4 已记档）：P/Invoke 内存读写 io→UNKNOWN，非假纯，标注可确证
4. **纯数据结构构造器字段写判 state**（迭代 22 遗留 ②，P3 方向安全）：效应表口径已知保守，记录不修
5. 记录待办（延续）：F4 sideEffects 认证、F10 缓存分片、F16 效应表注入、F18 英文文档
6. **parseArgs else-if 链维护成本**（BLOCKER 两次复发暴露）：本次已加「全部布尔旗标可解析」护栏兜底；若未来再增旗标且链继续膨胀，考虑重构为旗标表驱动（当前不必要——护栏已防复发）

## 提交建议（主会话统一提交）

```
Iter-23: --state 状态耦合图 + frameworkIo.System 收紧 + 复审 BLOCKER 二次修复

- D-127: --state 状态耦合图（stateCouplingOf 反查 verdict.stateDeps；text top15 + json additive；⊤ 暴露）
- frameworkIo.System 收紧: 删 Reflection/Text/Globalization/Runtime/RuntimeTypeHandle（ConvertToString ×47 假 io 闭环，IMPURE −100/UNKNOWN +99 守恒零误伤）
- 修复: --state 曾顶掉 --table-usage 分支（BLOCKER 二次再现）→ 恢复 + 根因护栏「全部布尔旗标可解析」CLI 回归
- 测试修正: csharp-lang 反射用例改全限定 System.Reflection.*（参数接收者不触达前缀路径=无效测试）
- 测试 +11（unit/state 6 + audit/state 2 + csharp-lang 2 + 全旗标护栏 1），258/258 全绿；README/CHANGELOG/CROSS-AUDIT 同步
```
