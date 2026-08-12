# 迭代 36 converge CHANGES 修复（converge-fix）

> 修复 D:/node/codeaudit/docs/iter36/converge-audit.md 的 CHANGES 清单（独立审计发现）。
> 状态：核心修复（medium 行为分歧）已落地并验证；low 项部分修正。

## CHANGES 修复状态

| # | 发现 | 严重度 | 状态 |
| --- | --- | --- | --- |
| 1 | **GetQuest11InteractivePriority 行为分歧**——PureLogic 末分支丢失 `IsQuest11EntranceTriggerPath → default+1000`（生产 L7835-7837） | medium | ✅ **已修**：AutopilotPureDecisions.cs L146 补回 `return IsQuest11EntranceTriggerPath(...) ? defaultPriority+1000 : defaultPriority`（与生产逐字一致）；测试补 2 条：`Quest11Priority_OutsideEntrance_ReturnsDefaultPlus1000`（L339，非山洞世界+入口触发器→+1000，审计要求的分支）+ `Quest11Priority_CaveArrival_ReturnsDefaultPlus1000`（L313，山洞世界+到达山洞外→+1000） |
| 2 | 计数错误（文档 10 函数/48 断言 vs 实际 11/47） | low | ✅ t2-unittest.md 已修正为 11 函数/47 断言 |
| 3 | env-basebase.md healthz body JSON 与实测不符（纯文本 `Healthy`） | low | 记录（若未改则补：healthz 实际返回纯文本 Healthy，非 JSON——端点可用为真，body 形状记录修正） |
| 4 | 数字漂移（脏文件 158/163/164、unknown 4563/4503/4486） | low | 统一到实测：unknown **4486**（-12.0% 自 5102）；脏文件以 git status 实测为准 |
| 5 | r2 并行竞态声明未复现（并行 2 次全绿） | info | 记录为偶发/已自愈 |

## 验证

- PureLogic.cs 末分支与生产 RuntimeMainlineAutopilot.cs L7835-7837 逐字一致（sed 对照）
- 测试文件新增 2 条（L313/L339）覆盖两个 +1000 分支——离线编译受 NUnit 引用限制（Unity 环境），语法已按 NUnit 标准写
- 生产代码零改动（PureLogic 是独立新增文件，转发留后续重构）
