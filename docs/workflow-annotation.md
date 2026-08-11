# 标注工作流（迭代21 工作流优化固化）

## 目标

把「AI 标注闭环」从临时脚本升级为可重复流水线：分片（并行标注）→ 合并（去重+校验）→ 回读（一致性验证）→ 语料累积。

## 流水线步骤

```bash
# 0. 扫描 + 导出未知清单
codeaudit scan <project> --no-cache --unknowns unknowns.json --format json > report.json

# 1. 分片（未标注 UNKNOWN 按影响面轮询 → N 片）
node scripts/annotate-slice.cjs report.json ann-work 4 annotations-current.json
#    → ann-work/slice-0.json … slice-3.json + annotations-current.json + meta.json

# 2. 并行标注（每片一个标注器，读源码判断 PURE/IMPURE——只标有依据的）
#    输出 ann-work/slice-0-out.json …（[{id, verdict}]）

# 3. 合并（去重 + id 存在性校验 + 矛盾双 verdict 标记）
node scripts/merge-annotations.cjs ann-work report.json annotations.json
#    → annotations.json（合并后，id 字典序）

# 4. 回读（标注 → 判定更新 + 一致性验证）
codeaudit scan <project> --no-cache --annotations annotations.json --corpus .codeaudit/corpus.json
#    → 控制台报告 annotationRejected（被拒标注原因：parseError/判定矛盾/未生效）
```

## 校验逻辑（merge-annotations.cjs）

| 检查 | 规则 | 处理 |
| --- | --- | --- |
| **id 存在性** | 标注 id 必须在本轮扫描 verdicts 中 | 拒收（stale——内容已变） |
| **矛盾双 verdict** | 同 id 多片 verdict 不同 | 取 **IMPURE**（保守方向——宁假 IMPURE 不假纯） |
| **去重** | 同 id 同 verdict | 幂等 |
| **排序** | 输出按 id 字典序 | 确定性（可 diff） |

## 一致性验证（scan.ts 内置，迭代21 数学解 A）

回读时每条 PURE 标注在 analyze 后必须判 PURE：

| 拒因 | 语义 | 处置 |
| --- | --- | --- |
| `parseError（H1 守卫）` | 内容不可信，PURE 不可撤销降级 | 不生效，不进语料 |
| `判定矛盾` | 标注 PURE 但效应闭包非空（如标了含 `console.log` 的函数） | 不生效，不进语料（堵 priorFor 污染） |
| `未生效` | stale-edge/传播型 UNKNOWN（应标调用链上游的 `?` 源） | 不生效 |

被拒标注由 `stats.annotationRejected` 逐实例报告（id/file/reason），CLI 显示数量与样例。

## 标注纪律

1. **宁 UNKNOWN 不 PURE**（A6）：不确定的调用链不标 PURE——只有函数体可确证无效应才标
2. **函数体为准**（suggested_prompt 契约）：一条 PURE 标注 = 全部调用点确证（`unknownSites` 置 0）
3. **类级批量不可信**（ground truth 实证）：PURE 24-32% 准确率——网络 SDK/状态操作（SetActive/Destroy/transform 写/DOTween）常被误标 PURE——批量标注后必须跑一致性验证
4. **annotatable 标记**（导出清单）：parseError/stale-edge/传播型标记 `annotatable: false`——不要白标

## 语料累积

- 回读时 `--corpus` 把 **accepted** 标注（非 annotationRejected）幂等累积为语料（形态 × 纯/不纯计数）
- 被拒标注**不进语料**（防 priorFor 错误先验——getattr 先验误导 ApiClient 是实证）
- 下次 `--unknowns` 的 suggested_prompt 携带语料先验（「getattr」形态历史 ≈9 成被标 PURE（n=26）——建议置信度非判定）

## 已知边界

- **链式调用**（`GetComponent<T>()().Method()`/扩展方法链）：动态 receiver——标注无法确定——保持 UNKNOWN（设计边界）
- **动态分派**（项目类实例方法）：同上
- 分片按影响面轮询——高影响面优先但每片工作量均衡；可换 `--top` 语义
