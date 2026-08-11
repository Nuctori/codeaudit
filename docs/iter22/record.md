# 迭代 22 记录（record 节点）

> DAG run-msp4e6hw-dde13fbd：audit-base-rate → audit-gate → audit-initdeity（并行）→ impl → verify-tests / verify-initdeity（并行）→ record
> 基线 HEAD 9ac6b4c（236/236）→ 当前工作树 247/247（+11：corpus+5/risk+1/robustness+5）

## 归档清单（docs/iter22/，7 件齐全）

| 文件 | 节点 | 内容 |
| --- | --- | --- |
| `base-rate-design.md` | audit-base-rate | fitBaseRate 实现规格（矩估计公式/冷启动/测试点/InitDeity 数据 §5） |
| `gate-design.md` | audit-gate | --gate 设计（旗标解析/依赖校验/语义矩阵/测试点） |
| `initdeity-audit.md` | audit-initdeity | InitDeity 复扫现状（无标注口径 PURE 8590/IMPURE 9449/UNKNOWN 5761）+ 安全重构清单 + 工具盲区观察 |
| `initdeity-report.json` | audit-initdeity | 复扫原始报告（40.8MB，未入库——体积过大，仅存档于工作区） |
| `impl.md` | impl | 实现报告（改动文件表/关键裁决/InitDeity 拟合实测/残余风险） |
| `verify.md` | verify-tests | 复审结论 **APPROVED**（4 轮独立复验；BLOCKER 修复记录） |
| `initdeity-result.md` | verify-initdeity | InitDeity 2 项安全重构 + 复扫对比 + 工具盲区确认 |

## CROSS-AUDIT.md 追加

「## 迭代 22（真实校准 + 合入门禁 + InitDeity 重构验证）」节已追加（449 行尾部，markdown 校验通过）：

- F9 分层基率落地（fitBaseRate/priorFor 第三参/corpus API 导出）——pipeline.md 四/六兑现
- F5 --gate 落地（Debtmap 外部参考，gateExit 纯函数入 risk.ts）
- InitDeity 安全重构验证（SRList chain 3→0、TestShake 源消除；严格限定 2 项，未触碰脏文件）
- 工具盲区 3 项（ConvertToString ×47 假阳 / 纯数据结构构造器 state 口径 / 基线不可复现）
- 复审 BLOCKER 修复记录（--gate 替换 --topology 分支 → 恢复 + 回归测试）

## README.md / CHANGELOG.md 同步（已由主会话+impl 完成，record 复核）

- README：测试数 247（两处）、--gate 说明与示例（L34/L68/L76）、库函数清单（L56 含 gateExit/fitBaseRate/priorFor/corpus API）、`check-readme-tests.cjs` 门禁通过
- CHANGELOG：[Unreleased] 迭代 22 条目（--gate 新增 + fitBaseRate/corpus API + 修复条目：--topology 回归/README 重复行）

## 下轮待办（verify-initdeity 工具盲区 + 用户新方向）

1. **frameworkIo.System 收紧**（P1，假 IMPURE 最大单类）：Reflection/Runtime/Globalization/Text 前缀移出或方法名白名单（GetTypeInfo/GetDeclaredField/GetCustomAttribute 加 pure 例外；MethodInfo.Invoke 不放行）——API.g.cs ConvertToString ×47 direct io 假阳
2. **标注文件归档**（P1，基线不可复现）：找回/重建 `initdeity-annotations.json` 入库，或接受无标注基线（UNKNOWN 5761）为新基准并在文档声明
3. **状态耦合图（用户建议新方向）**：stateWrites/stateReads/stateDepsOf 全链路已存在但**零用户可见输出**（仅进 risk 的 R_state 一个数字）——扩展为 write→readers 映射可见输出（--state 旗标或 JSON 字段），改动小（复用 stateDepsOf）、冲击力中（状态耦合链可视化）
4. **纯数据结构构造器口径**（P3，方向安全）：字段写判 state 对纯数据结构构造器是假 IMPURE，属效应表口径已知保守方向，可记录不修
5. 记录待办（延续）：F4 sideEffects 认证、F10 缓存分片、F16 效应表注入、F18 英文文档

## 提交建议（主会话统一提交）

单次提交建议信息：

```
Iter-22: fitBaseRate 分层基率 + --gate 合入门禁 + InitDeity 重构验证 + 复审 BLOCKER 修复

- F9: fitBaseRate(corpora) 分层矩估计（μ 加权均值/κ 方差反解/冷启动 projects<2）+ priorFor 第三参
- corpus 面 API 补齐导出（emptyCorpus/updateCorpus/mergeCorpus/summarize/siteShapeInfo/isCorpus/fitBaseRate/priorFor）
- F5: --gate 合入门禁（grade≥HIGH → exit 1；gateExit 纯函数；无 --changed 报错 exit 2；Math.max 保序）
- InitDeity: SRList 构造器去内部环（chain 3→0）+ TestShake 删除（源消除）——真实项目重构验证
- 修复: --gate 分支曾替换 --topology 分支（复审 BLOCKER）→ 恢复 + CLI 回归测试
- 测试 +11（corpus+5/risk+1/robustness+5），247/247 全绿；README/CHANGELOG/CROSS-AUDIT 同步
```
