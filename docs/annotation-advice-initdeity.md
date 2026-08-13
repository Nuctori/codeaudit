# InitDeity 标注轮建议（2026-08-13，批组标注后）

> 基于完整形态批组标注实测（640 条：276 PURE + 364 IMPURE）+ 标注后剩余结构分析。

## 标注进度（实测量化）

| 阶段 | 标注 | 生效 | unknown chunks | rate |
| --- | --- | --- | --- | --- |
| 无标注基线 | 0 | 0 | 6853 | 24.4% |
| 演示轮（高影响面+形态） | 27 | 59 | 6717 | 23.9% |
| **完整批组轮** | **640** | **363** | **6118** | **21.8%** |

- 批组效率 ≈ 1:1（叶子 chunk 为主）；高影响面轮 1:5（释放下游）——**先高影响面后批组的顺序正确**
- 363/640 生效（277 条未生效：id 已释放/parseError PURE 被忽略/重复）——标注有损率 ~43%，批量时需接受

## 剩余 6089 条目消化策略（分类）

| 类 | 量 | 处置 |
| --- | --- | --- |
| `<unresolved>` 不可拍平 | 544 | 跳过（不可拍平 ≠ 纯，标 PURE 有假纯风险）——工具侧 flatten 残余修复后自然消失 |
| 空 shape / 单字母（x/i/e/item/each） | ~350 | 局部变量读残余——**工具侧**（catch/循环变量 assigned 缺口）修后消失，不标 |
| `T` 泛型参数误收 | 94 | **工具侧**（flattenCallTarget 泛型参数）——下轮修 |
| `UNITY_EDITOR` 条件编译 | 117 | 设计内（#if 不可静态判定）——跳过 |
| `Value`（getter 风险） | 80 | 保守跳过或标 IMPURE——变量接收者 .Value 可能是自定义属性 getter |
| **可标批组**：ContainsKey 29 / childCount 25 / Length 24 / GetComponent 23 / name 27 / RefreshUI 25 | ~150 | **下一批**（ContainsKey=Dictionary 纯读 PURE；childCount/Length=纯读 PURE；GetComponent=Unity 查询 IMPURE 保守；RefreshUI=UI 刷新 state） |
| parseError 文件条目 | 693 | 只能标 IMPURE——**先改名/修源码**（PlayerCharacterManager 中文标识符）——改名后这 693 条可正常标注 |
| 高影响面长尾（inf 2-376） | ~500 | 影响面排序逐个裁决（优先） |

## 项目侧建议（标注数据 + 诊断综合）

1. **P0 PlayerCharacterManager 中文标识符改名**：693 parseError 条目（10% 剩余）卡在它——改名后这批可标注，且未提交重构获得回归网
2. **P0 API.g.cs 生成器去重**：ConvertToString/ReadObjectResponseAsync 60+ 复制——标注只能逐份标（ConvertToString 组已标 1 条，其余 47 份同形态同裁决——**生成器修复一劳永逸**）
3. **P1 高影响面优先**：inf≥50 的 ~500 条目逐个标——释放下游最多（1:5 已验证）——HttpRequestTimelineRecorder/ApiClientHelper/QuestProgressionManager 是 top 文件
4. **P1 标注纪律**：形态组裁决要保守（Value/Play 等有 getter/副作用不确定的跳过）；parseError 只标 IMPURE
5. **P2 语料复用**：本轮 corpus 已累积 Count·variable pure 9/0、SetActive 0/8 等先验——**下一轮标注（无论本项目或新项目）同形态自动带建议**——标注预算曲线（--unknowns 输出）随语料丰富而收紧

## 工具侧建议（标注轮新发现）

1. `T` 泛型参数误收（94）——flattenCallTarget 对泛型类型参数的处理——下轮修（与 generic_name 同族）
2. `ContainsKey`/`childCount`/`Length` 等纯形态可入批组表（数据驱动：语料 cell 先验 ≥80% pure 的形态自动建议 PURE）
3. catch/循环变量 assigned 缺口（e/x/i ~350）——assignedNames 补 catch_declaration/for 初始化器——与候选 1 同族扩展

## 下一步

```
1. 工具侧：T·bare 泛型参数 + catch/循环变量 assigned（~1h，unknown -450 预估）
2. 标注：下一批 ~150 条（ContainsKey/childCount/Length/name 纯 + GetComponent/RefreshUI 不纯）+ 高影响面 ~500 逐条
3. 项目侧：PlayerCharacterManager 改名（P0）——693 条解锁
4. 重扫评估：unknown 6118 → 目标 <5500（20% 以下）
```
