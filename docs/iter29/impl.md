# 迭代 29 impl：CLI `--effect-table <json>`（F16 CLI 补全）

> 实现节点（run-mspbwzlf）：按 docs/iter29/audit.md 方案落地。
> 基线 HEAD 8ed835d（282/282）→ 完成后 285/285（+3：robustness 维度 28 CLI 用例；读文件失败两例合并为一个 it 的两个断言，故 +3 非审计预估 +4）。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/cli.ts` | ① import `loadEffectOverrides` + `type EffectTables`（L5）；② `CliArgs.effectTable: string | null`（L20，含 doc 注释）；③ parseArgs 初始化`effectTable: null`（L40）+ 分支`--effect-table`（L55）；④ main() 读文件块（L171-180，`loadEffectOverrides` + catch → `console.error("无法读取效应表文件")` + exit 2，与 --annotations L167-170 同款）；⑤ scanProject opts 加 `effectOverrides`（L182-187）；⑥ printHelp 一行（L88） |
| `test/audit/robustness.test.ts` | +3 用例（维度 28 CLI 对抗）：① 注入生效正例（MySdk:net → IMPURE{net} vs 无 override UNKNOWN）；② 读文件失败 exit 2（不存在路径 + 非法 JSON 两断言）；③ 校验失败 exit 2（非法效应类 IO → scan.ts 兜底 throw → exitCode 2 + "effectOverrides 非法"） |
| `README.md` | 用法块加 `--effect-table` 行（L36）；注入节补 CLI 同构一句（L65）；测试数 282→285（两处） |
| `CHANGELOG.md` | [Unreleased] 标题加迭代 29 + 新增条目 |

**未改**：effectOverride.ts（loadEffectOverrides/validateEffectOverride/applyEffectOverrides 迭代 28 已就绪，8ed835d 已补异常处理）；scan.ts（校验兜底 L233 迭代 28 已有）；index.ts。

## 校验分工（audit §2.1 兑现）

- 读文件/JSON 语法/顶层非对象 → `loadEffectOverrides` 抛（消息含路径）→ cli catch → exit 2（与 --annotations 同款）
- 形状校验（未知语言/提取侧表/非法效应类）→ scan.ts L233 `validateEffectOverride` → throw → main().catch → exitCode 2（零额外代码）
- cast `Record<string, unknown>` → `Record<string, Partial<EffectTables>>`：信任边界在 scan.ts 兜底，无静默路径

## CLI 使用示例

```bash
# overrides.json（与库 API effectOverrides 同构）
{ "csharp": { "impureGlobals": { "MySdk": "net" }, "pureGlobals": ["MathUtility"] } }

node dist/cli.js scan ./src --effect-table overrides.json   # 注入后扫描
node dist/cli.js scan ./src --no-cache --effect-table nope.json   # exit 2：无法读取效应表文件
```

## 测试

- tsc 0 错误；全量 **285/285**（28 文件）；README 门禁 OK 285（check-readme-tests.cjs）。
- 新增 3 用例修复前均失败（无 --effect-table 分支 → 未知选项 exit 2；注入无效应 → 断言 IMPURE 失败）——防回归有效。
- 手工冒烟（真实 CLI）：baseline `Consumer.Run` UNKNOWN{?} → 注入后 IMPURE{net}；坏路径 exit 2 含"无法读取效应表文件"；非法效应类 exit 2 含"effectOverrides 非法"。
- 回归：全量 282 既有 + 3 新全绿（contract/robustness 维度 28 30/30 独立复跑确认）。

## 残余风险（audit §5 记录，非本轮缺陷）

- 无删除能力（F16 设计限制——"键只增不删"，README 已声明）；cast 逃逸类型校验由 scan.ts 兜底（throw → exit 2）；空对象 override 短路等价无 override；JSON 无大小上限（与 --annotations 同款，用户本地文件可接受）。
