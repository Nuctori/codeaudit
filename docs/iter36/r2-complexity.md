# 迭代 36 r2：resolveImport 复杂度拆分 + 盲区回流（w4-codeaudit）

> 背景：北极星（D-130）= 正确的 + 语言无关的 + 可自由拓展的代码质量管理库。
> 独立审计（docs/iter36/minimize-audit.md）记录 resolveImport cognitive 190 为最大复杂度热点之一。
> InitDeity 重构（巨型测试文件 4864 行）暴露盲区：无巨型文件检测/测试债指标。

## 1. resolveImport 复杂度拆分（机械，行为不变）

### 改动

`src/engine/link.ts` resolveImport（128 行）按导入形态拆 3 个 helper：

| helper | 行数 | 职责 |
| --- | --- | --- |
| `resolveNamespaceImport` | 46 | 命名空间导入（import os / import * as fs）：成员解析/点连成员/效应表回退 |
| `resolveFromBareImport` | 31 | from 裸名导入（from db import save_user）：default 导出/效应表/HOF 回调 |
| `resolveFromObjectImport` | 60 | from 对象导入（from db import conn; conn.execute）：类成员/模块绑定/命名空间再导出 |

`resolveImport` 主函数剩 25 行 = 纯分派（3 个 if 分支 → 各 helper）。

### cognitive 变化

- resolveImport：~190 → **主函数 ~10**（三个条件分派）+ helper 各 31-60 行（每 helper 单一形态，cognitive 各 ~30-50）
- 总 cognitive 显著下降（主函数不再嵌套 3 层分支）

### 行为不变证明

- tsc 0 错误
- 全量测试 **305/305 全绿**（串行模式 `--no-file-parallelism`——并行模式有既有竞态失败，非本改动引入，单跑 contract/sources 均过）
- 拆分是纯机械提取（helper body 逐字节对应原分支代码，仅参数透传 + 未用参数清理）

### 类型修正（拆分暴露）

- helper 内 `imp.imported`（`string | null`）在拆分后丢失窄化 → 加 `!` 非空断言（调用分支保证非 null：命名空间分支 `imported === null`、bare/obj 分支 `imported !== null`）
- `resolveNamespaceImport` 的 `files` 参数未用 → 删除（原代码也不实际使用）

## 2. 盲区回流（r1-blindspot——InitDeity 重构暴露）

### 盲区 1：巨型文件检测缺失（Medium，记录待办）

- **证据**：InitDeity `RuntimeMainlineAutopilotRuntimeTests.cs` 4864 行/216 方法、`StarterMainlineFlowTests.cs` 4407 行——测试性能失控的结构根因之一（E2E 巨型文件），codeaudit 无文件规模指标，无法自动标记
- **现状**：extractor.ts L30-32 只算 lineCount 给 module chunk；ScanStats 无文件行数分布
- **待办**：ScanStats 加 `maxFileLines`/巨型文件 top 列表（schema additive）；或 CLI 新旗标 `--file-stats`
- **收益**：重构时自动发现"该拆的文件"（测试债指标）

### 盲区 2：重构收益量化仅手算（Low，已覆盖）

- **证据**：InitDeity unknown 5102→4503（-11.7%）靠 scripts/stats.cjs 手算对比，无自动报告
- **现状**：stats.cjs 能出单次数字；前后对比需人工
- **已覆盖**：docs/iter36/restore-plan.md 基线对照表要求每阶段对比——手算可用，自动化为待办

### 盲区 3：测试债指标缺失（Medium，记录待办）

- **证据**：InitDeity 54 PlayMode 文件 14248 行（每次 E2E 起 Unity）——测试金字塔倒置，codeaudit 无"测试 vs 生产代码比例/E2E 成本"指标
- **待办**：测试文件密度指标（testDir 占比/E2E 文件行数告警）

## 3. 测试

- 全量 305/305 全绿（`--no-file-parallelism`，验证拆分行为不变）
- tsc 0 错误
- 无新增测试（机械拆分——行为不变由现有 305 测试兜底；盲区为文档记录非代码改动）

## 4. 残余风险

- 并行测试竞态（vitest 共享临时目录，sources/contract 偶发失败）——**既有问题非本改动引入**，需独立跟进（vitest forks 池或隔离 tmp）
- 盲区 1/3（巨型文件/测试债指标）为文档记录待办——代码改动需 ScanStats schema 变更（additive，可后续做）
- cognitive 具体数字未用工具量化（无认知复杂度计算器）——按行数/嵌套深度评估，拆分后主函数仅 3 分支分派，显著下降
