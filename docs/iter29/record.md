# 迭代 29 记录（record 节点）

> DAG run-mspbwzlf-fbeb185c：audit → impl → verify → record（串行）
> 基线 HEAD 8ed835d（282/282）→ 当前工作树 285/285（+3：robustness 维度 28 CLI 用例）

## 归档清单（docs/iter29/，4 件齐全）

| 文件 | 节点 | 内容 |
| --- | --- | --- |
| `audit.md` | audit | CLI 接线设计（5 处改动点/测试策略/校验分工/迭代 28 两条推后理由失效实证） |
| `impl.md` | impl | cli.ts 6 处接线 + 校验分工兑现 + CLI 示例（285/285） |
| `verify.md` | verify | 复审结论 **APPROVED**（链路真实/测试判别力/向后兼容/285 独立复跑） |
| `record.md` | record | 本文件 |

## CROSS-AUDIT.md 追加

「## 迭代 29（--effect-table CLI：F16 补全）」节已追加（尾部，迭代 28 节后）：

- 迭代 28 待办①闭环（CLI --effect-table，loadEffectOverrides 已就绪只接线）
- 校验分工（读文件/JSON 语法 → cli exit 2；形状校验 → scan.ts 兜底 exitCode 2 零额外代码）
- 测试 +3（注入生效/读文件失败/校验失败）+ 285/285 全绿
- 下轮待办 4 项（语言事实义务/无删除能力/CLI 层低价值断言/F10+F18+标注归档延续）

## README.md / CHANGELOG.md 同步

- README：测试数 282→285（两处，impl 已完成）+ `--effect-table` 用法行（L36）+ 注入节 CLI 同构一句（L65）——门禁 `check-readme-tests.cjs` OK 285（已由 impl 验证）
- CHANGELOG：[Unreleased] 标题加迭代 29 + 新增条目（--effect-table CLI）

## 提交建议（主会话统一提交，单次）

```
Iter-29: --effect-table CLI（F16 补全——loadEffectOverrides 接线）

- cli.ts 6 处: import/CliArgs/parseArgs/main 读文件块 exit 2/scanProject opts/printHelp
- 校验分工: 读文件错误→exit 2（--annotations 同款）；形状校验→scan.ts 兜底 exitCode 2 零额外代码
- 测试 +3（注入生效/读文件失败/校验失败），285/285 全绿
- README 用法行 + 注入节 CLI 同构 + 285 门禁 OK；CHANGELOG 迭代 29
```

## 验证

- tsc 0 错误（impl 已验）；全量 285/285（impl + verify 双独立复跑）；README 门禁 OK 285；CROSS-AUDIT markdown 追加完成
- git 未提交（主会话统一提交）
