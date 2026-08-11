# 迭代 21 复审：C# 语言包 9 轮 + 迭代 21 数学解 A/C（串行自查补交）

> 补交背景：iter21-review subagent（run-83856）因 C# 大扫描超时未产出；本复审由主会话串行自查补交（HEAD 1545170，218/218）。复审范围：1) 全量测试复跑；2) C# 语言包关键路径逐行；3) 数学解 A/C；4) InitDeity 结果核验；5) 终裁。

## 1. 全量测试复跑

- **218/218 通过**（22 个测试文件，vitest 实测：218 passed / 0 failed）。
- README 声称与 D-119 纪律门禁一致（scripts/check-readme-tests.cjs 校验 README 计数）。

## 2. C# 语言包关键路径逐行复审（锚定 HEAD 1545170）

| 路径 | 代码锚点 | 复审结论 |
| ------ | ---------- | ---------- |
| implicitThis（分支 2 ownerClass） | link.ts:385-391 | 类内裸名调用解析到 `ownerClass.attr`；ambiguous 守卫 + byQualified 命中即建边；落空继续走后续分支。正确 |
| 全局类解析（语言隔离/遮蔽守卫） | link.ts:127-138（索引）、547-549（解析） | `cls[0].lang === pack.name` 同语言守卫；`cls.length===1` 歧义守卫；`assigned`/`moduleAssigned` 遮蔽守卫。**优先于效应表**（543-555）——NetCall 项目类优先。正确 |
| frameworkIo（this/gameObject/transform/System） | csharp.ts frameworkIo 表 + link.ts:182 rootOf | this.gameObject.SetActive 等链 → 前缀命中 → io/state 保守；System 前缀（System.Console.WriteLine）→ `frame:System` 命中。正确（保守方向） |
| flatten：member_access_expression | extractor.ts:620-639 | obj/attr 字段提取，generic_name 剥 type_argument_list，identifier/property_identifier 点连。正确 |
| flatten：generic_name | extractor.ts:628-634 | `Resources.Load<GameObject>` → 取 name 字段剥泛型参数。正确 |
| flatten：this_expression | extractor.ts:614 | C# this 节点直接返回 this。正确 |
| flatten：predefined_type | extractor.ts:616 | `string.IsNullOrWhiteSpace` 的 string 关键字节点。正确（迭代 20） |
| flatten：conditional_access | extractor.ts:640-648 | `obj?.Method` → 前段 + member_binding 标识符。正确（迭代 20） |
| 效应表 | csharp.ts:30-153（111 键） | **无重复键**（脚本 uniq -d 空）；Console 双表（impureBuiltins:28 裸名 + impureGlobals:35 obj=类名）为双路径非重复；Object.hasOwn 守卫防原型链污染（link.ts:560）。正确 |
| 标注一致性验证器（数学解 A） | scan.ts:273,299 + cli.ts:207-222 | PURE 置 0（一条标注=全部站点确证，unknownSites 不变量恢复）；annotationRejected 逐实例报告（parseError/判定矛盾/stale-edge 三类 reason）；语料防污染（rejected 不写入 corpus）。正确 |
| C-缺口 1（unknowns 导出 annotatable） | cli.ts:344-354 | parseError → annotatable:false；stale-edge/传播型（无自身 ?）→ false——提示避免白费人工。正确 |

## 3. InitDeity 结果核验

- 报告口径（CODEAUDIT-TECH-DEBT.md，commit d640b69ff5）：23800 chunks / 3004 文件 / pure 9545 / impure 10798 / unknown 3457（18.0%）/ 2656 条标注 / -58%。
- 标注文件实测：`initdeity-annotations.json` = **2654 条**（PURE 1331 / IMPURE 1323）——比 2656 少 2：交叉审计发现 2 条假 io 源（ChillyRoomSdkClient 的纯 URL 构建误标 IMPURE），修复 subagent（run-13860）已删除。**报告数字 2656 与文件 2654 差 2——需在报告中注明（PURE 计数相应减 2），避免下轮审计再抓口径不一致。**
- unknown 3457 与 D-122 声称一致；-58%、18.0% 算术自洽（8159→3457）。

## 4. 终裁

- **C# 支持收敛**：9 轮迭代 + 数学解 A/C 后，工具侧无已知假纯路径；效应表无重复键；解析主通道（类名效应表 + globalClasses 同语言 + frameworkIo 前缀）逐行复核正确。
- **残余（设计边界，非缺陷）**：链式调用动态 receiver（C1，2437 条 bare·bare）、扩展方法（C2）、事件回调（C3）、属性访问器（C4）——全部 unknown 侧，方向安全。
- **标注质量残余**：ground-truth 抽样（PURE 24-32% / IMPURE ~44% 准确率）暴露标注误标风险——数学解 A 拒收机制 + C-缺口 1 不可标注分类已建立护栏；2 条假 io 源已删。

## 5. 复审发现（需下轮跟进）

1. **报告口径漂移**：已修复（b04cfb18e6）——CODEAUDIT-TECH-DEBT.md section 六 2656/3457 → 2654/3449，与标注文件（2654 条）及复扫（9548/10803/3449）对齐。
2. **B 报告（效应表使用率）**已实施（755f731，effectTableUsage 三分类：provably-dead/corpus-inactive/consulted-but-miss + missSlots）。
3. 阈值重验（run-64936）结论成立：C# 效应表过度判定**不**推高风险分布（max 11.7 < 15），阈值无需重标。
