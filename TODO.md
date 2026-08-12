# codeaudit 重构 TODO（提炼方向）

> 背景：项目 ~1 万行（src 9321 + scripts 556），核心算法层仅 297 行（analyze.ts 226 + tarjan.ts 71）。
> 已用 90 行蒸馏副本（examples/essence.mjs）证明：全项目灵魂 = 凝聚 DAG 一次扫描 + 双跑成区间。
> 本清单 = 顺着这个思路的完整重构路线。**核心原则：提炼 ≠ 删功能**——原功能一个不少，
> 减的是理解成本；行数瘦身只针对死重/重复，不碰算法层。

## P0 恢复与对齐（1 文件，~10 分钟）

- [x] **P0-1 恢复 examples/essence.mjs**
  - 现状：已恢复（2026-08-12，迭代 40 P0-3 轮）；`node examples/essence.mjs` 8/8 断言通过
  - 动作：重写文件（tarjan 递归版 + runOnce + analyze + 8 断言 + 工作示例），`node examples/essence.mjs` 全绿
  - 验收：8 断言通过，输出与 README 传染链行为一致（handle_request chain=2 → sqlite3 chain=0）

## P1 死重清理（纯删除，低风险，~550 行）

- [x] **P1-1 删除诊断/探针脚本**（迭代 40 P0-3 轮已执行）
  - 已删：`diag-id.cjs` `diag-id2.cjs` `diag-id3.cjs` `analyze-id-report.cjs` `stats-purity.cjs` `guard-annotations.cjs`（纯历史诊断，仅 iter33 文档提及）
  - 保留：`check-readme-tests.cjs`（**CI 门禁**，ci.yml:26 引用——TODO 原清单误列）；`annotate-slice.cjs`/`merge-annotations.cjs`（**标注工作流活工具**，docs/workflow-annotation.md 引用）；`stats.cjs`（README 提及）
  - 验收：`npm test` 341 全绿
  - 风险：低。这些是一次性诊断工具，不参与构建/测试

## P2 中等重构（有收益，需回归）

- [x] **P2-1 extractor.ts 数据表合并**（迭代 40 P0-3 已执行）
  - 现状：独立审计 25 项 hack 全数据化——LangPack 新增 ~30 数据字段，extractor 零语言常量恢复真实
  - 动作：提取公共遍历骨架（node kind 表驱动），语言差异收敛为纯数据
  - 验收：四语言 E2E + 特性矩阵测试全绿（341/341）；行为零变化（除 B01 C# 类型化 catch 元数据修复与 C# 参数遮蔽补全——均为正确性方向）
  - 风险：中。tree-sitter node kind 命名因语言而异，合并需逐一对照

- [ ] **P2-2 scripts/ 收敛为单个工具入口**
  - 动作：`analyze-id` / `merge-annotations` / `guard-annotations` 等仍被使用的合并为 `scripts/codeaudit-utils.cjs` 子命令
  - 验收：原命令的等价调用可用
  - 风险：低-中（若 P1 已删大部分，此项可能自然消失——先做 P1 再评估）

## P3 文档与维护（理解成本，项目的真实目标）

- [x] **P3-1 essence 中文导读**（docs/essence-guide.md，迭代 40 已做）
  - 内容：蒸馏三问（唯一分析函数在哪 / 两个结构 trick 是什么 / 被砍项回原文件的映射表）+ 90 行代码逐段解读
  - 验收：新读者按导读 30 分钟内看懂全项目（五层结构图 + 映射表 + 使用路径）
  - 意义：README 的"架构"章节可以指向它，替代逐文件说明

- [x] **P3-2 把 essence 纳入测试**（迭代 40 已做）
  - 动作：CI 加一行 `node examples/essence.mjs`（8 断言 exit code 语义；保持独立脚本，未引入依赖）
  - 意义：算法层语义变更时 essence 断言同步失败，防止"灵魂"与实现漂移

## 明确不做（YAGNI）

- 不重写语言包（每种语言一张表是刻意设计，新语言=加一个文件，核心零改动）
- 不合并派生层（influence/risk/proof/corpus 是 verdicts 的不同读法，合并省行数但损内聚）
- 不把迭代 tarjan 换回递归版（50k 深链爆栈是真实约束，essence 里的递归版只是演示）

## 执行约束

- 当前仓库有并发工作（13 modified / 6 deleted），**动文件前先 git status 确认边界**
- 每次只做一项，做完跑 `npm test` 全量回归（337 用例）
- P1 删除前先确认 6 个 probe 的删除是否已同步 README（避免文档残留）
