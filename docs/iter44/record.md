# 迭代44 记录（record）

> 议题：工具不完备/数据债的数学最小性收口（InitDeity 诊断驱动：未知站点分类 53.3% 裸名/29.7% 动态/8.8% 枚举/7.9% unresolved）。
> 流程：00-plan → 01-math-review → 02-jeff-review → 03-synthesis → 实施 → 验证。

## 评审裁决

| 项 | 裁决 | 关键论证 |
| --- | --- | --- |
| 候选 1 局部变量 prop 读判纯 | do-now | 读取存储位置恒纯（C# 规范级事实，与参数读取同族——extractor 参数跳过先例）；豁免面 = obj===null ∧ prop ∧ attr∈assigned 三条件；实现须早期短路（bySimple 前）防顶层同名假边；调用形态遮蔽维持 ?（iter41 不回退） |
| 候选 2 System 枚举 | do-now（A 方案） | B 否决：无类型系统无法识别枚举 vs 类，泛化 = 插件静态 getter 假纯（A7 结构违反）；A = pureGlobals 白名单 4 键（StringComparison/TaskStatus/BindingFlags/AttributeTargets），globalClasses 优先 + assigned 遮蔽双保险 |
| 候选 3 <unresolved> | do-now | 探针实证 2 漏网形态：generic_name（Foo<int>() 调用目标）+ alias_qualified_name（global:: 前缀）——各 3 行剥壳；残余不可拍平形态设计诚实维持 |
| 候选 4 top-N 补表 | 数据收集 + 首批 3 条目 | top-miss.cjs 出 per-pack missSlots；首批 HttpRequestMessage/HttpMethod/StringContent（生成代码 HTTP 构造）入 pureCtor |
| 候选 5 类型流 | defer 维持 | 跨 chunk 数据流 = 新机制族，成本 >> 收益 |
| 候选 6 声明位类型绑定 | 探针项（数据留给后续） | 非流分析切片，P1-2 同级 |

## 实施

| 变更 | 文件 | 内容 |
| --- | --- | --- |
| 候选 1 短路 | link.ts 分支 2 顶部 | `if (call.obj === null && call.prop && caller.assigned.includes(call.attr)) return;`（bySimple 之前） |
| 候选 2 | csharp.ts pureGlobals | 4 枚举键 + 注释（语料频次 + B 否决论证） |
| 候选 3 | extractor.ts flattenCallTarget | generic_name → name 子节点；alias_qualified_name → children[1] 递归 |
| 候选 4 首批 | csharp.ts pureCtor | HttpRequestMessage/HttpMethod/StringContent |
| 测试 | field-read.test.ts（新 2）+ csharp-lang +2 | 局部读判纯（unknownSites=0 + PURE）/ 遮蔽调用仍 ?（C# 对照——用非表键名避开 impureGlobals 过近似）/ System 枚举判纯 / generic+global 不落 <unresolved> |

## 验证

- `npx vitest run`：**371/371**（368 → +3）
- `npx tsc --noEmit`：exit 0；README 门禁 OK 371
- **InitDeity 重扫**：unknown chunks **7063 → 6853（24.4%）**；`<unresolved>` 站点 13575 → 11702；`(null)|global` 维持 0
- 停止准则核查：26.0→25.2→24.4 连续两次 <1pp——**触发停止准则评估**（数学评审提示）——iter44 后正式转入标注工作流评估

## 残余（诚实）

- **catch/循环变量**（`e`/`x` 约 3000 站）：assigned 覆盖缺口（catch_declaration/for 初始化器不在 assignedNames）——候选 1 的相邻扩展，下轮或标注消化
- **ReadObjectResponseAsync 1079 站**：生成代码方法裸名调用未解析（非泛型形态）——待定位
- missSlots top 主体 = 局部变量接收者（response_/urlBuilder_ 等）——动态分派标注面（29.7% 设计边界）
- 条目落地（top-100 剩余 ~20-30 条：System/UnityEngine/ICommonUI 等）按「语料频次 + 世界知识」双注记审查——分轮
- propertyReadSkipParents 与 grammar 全量对拍未做（global_keyword 同类死条目排查）——小任务
- `Console` 遮蔽测试用例发现：impureGlobals 无遮蔽守卫（iter41 已知过近似，记录在案）

## 决策链

见 decision chain（D-1xx：iter44 五候选裁决——1/2/3 do-now、4 数据收集、5 defer、6 探针）。
