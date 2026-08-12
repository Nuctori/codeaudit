# 迭代 32 impl：frameworkPure 成员级白名单（compromise-audit C1 结构性收紧）

> 实现节点（run-mspib7ep-cefe9230）：按 docs/iter32/audit.md 案 1（成员级白名单）+ 内建回调不变量。
> 基线 HEAD 0c35349（293/293）→ 完成后 296/296（+3：csharp-lang 迭代32 T1-T3）。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/lang/packs/csharp.ts` | frameworkPure 前缀级（System 10 字符串数组）→ **成员级两级结构**：`Record<ns, Record<type, "pure"\|"hof" \| Record<member, "pure"\|"hof">>>`（13 整类型键 pure + Linq 整类 hof + Text 3 子键 + Array 异质嵌套 17 成员）；**linqHof 表删除**（Linq: "hof" 1 键取代 29 算子表） |
| `src/engine/link.ts` | 2.5 分支 frameworkPure 消费改两级匹配（type 键段前缀 + Array 嵌套成员表剩余段查）；`addArgEdges` 加 `unconditional=false` 参数（true → 未解析回调必记 UNKNOWN）；linqHof 门删除（` | | linqHof.has(hof)` → unconditional 参数承担） |
| `src/lang/pack.ts` | frameworkPure 类型改两级结构（嵌套成员表）；linqHof 声明删除 |
| `src/core/effectUsage.ts` | frameworkPure 枚举适配（Object.entries 嵌套 member 遍历） |
| `test/audit/csharp-lang.test.ts` | +3 用例（T1 未列成员落 ? / T2 Array 拆分 / T3 Enumerable hof） |
| `README.md` | 测试数 293→296（两处） |

## 关键实现裁决

1. **两级结构**（审计 §1 的成员键与 §2 的 Array 表矛盾——键=rest 首段 vs 成员名）：Array 是唯一异质类型（6 hof + 11 pure），用嵌套成员表（type 键 Array → 剩余段查 Find/Sort…）。其余 13 类型同质 → 整类型键（pure/hof）。匹配：type 键 = rest 首段段前缀；嵌套表按剩余段首段查。**审计 §4 的"无嵌套递归"拍平假设对异质 Array 不成立**——实现选择两级（牺牲拍平简洁，换 Array 正确性），classifyUsage 仍按类型键枚举（无递归）。
2. **pure 成员忽略 argFns**（修正审计 §3 草案"纯命中 + argFns 非空 → ?"）：`Uri.EscapeDataString(s)` 的 s 是值实参被 argFnsOf 收集——纯成员无委托形参（语言事实）故无回调义务，忽略 argFns 判纯。仅 hof 成员承担回调义务（argFns 非空 → unconditional 门）。
3. **unconditional 门取代 linqHof**：addArgEdges 第 3 参 true = 未解析回调必记 UNKNOWN（完整记账：unknownSites++ + unknownCalls）——linqHof 表的"LINQ 算子无条件调用"语义由 hof 标记 + unconditional 承担，表删除（S3/HIGH-1 行为不变，靠 unconditional 门）。
4. **槽位连续性**：hitTable 槽位 `pure:${obj}.${typeKey}`（Uri→pure:System.Uri 等）——与 iter30 前缀槽位连续；Array 从 pure:System.Array（前缀级）变 pure:System.Array（类型级，同键）——classifyUsage 条目数 151→163（成员拆分可见）。

## InitDeity 复扫验证（--no-cache 只读）

| 指标 | 迭代31（HEAD 0c35349） | 迭代32 后 | 变化 |
| --- | --- | --- | --- |
| pure / impure / unknown | 8045/10652/5102 | 8044/10652/5103 | −1/+1（成员级收紧：个别未列成员纯→?，方向安全） |
| csharp 效应表条目 | 161 | 163 | +2（Array 嵌套表拆分） |
| global:System miss | 0 | 0 | 保持（表键不变） |
| 命中 | 80 | 79 | −1（极微——unlisted 类型不再前缀放纯） |

- 判定分布变化解释：iter31 的 frameworkPure 前缀级把 System 下**所有** Uri/Linq/... 成员放纯（含未列成员如 Text.Decoder 若存在）；成员级只放**已确证**成员。−1/+1 是"未列成员纯→?"的正确化（方向安全），非误伤（T1 断言 semantics）。
- 回调不变量：S3/HIGH-1 语义保持（Enumerable hof → unconditional 门 → Console.WriteLine 未解析 → UNKNOWN）——回归测试全绿。

## 测试

- tsc 0 错误；全量 **296/296**（28 文件）；README 门禁 OK 296（check-readme-tests.cjs）。
- T1/T2/T3 修复前失败（T1：旧前缀级 Runtime 段不在白名单已 UNKNOWN——新用例守卫成员级不越界；T2：Array 前缀级全放纯 → Find 回调被吞假纯；T3：旧 linqHof 门依赖表——删除后靠 unconditional）。
- 回归：迭代30 T1/T2/T3、迭代31 S1/S3/HIGH-1/MEDIUM-2/撞名守卫 全部原样绿。

## 残余风险

- **纯成员被传真正函数实参**（异常用法）：pure 成员忽略 argFns → 若某纯成员实际有委托重载且被传函数 → 假纯。缓解：表注释准入标准（纯 = 无委托形参语言事实）+ 语料驱动（iter30 分解未发现纯成员带回调调用）；argFnsOf 的 arity 感知（审计 §2#2）记录待办。
- **Linq.Expressions 等未列子命名空间** → ?（诚实，方向安全）——若语料出现需补键。
- Array 嵌套表维护义务：新增 Array 成员需判断 hof/pure。
- TS/Python no-op 不变（可选字段，TS/Python pack 无 frameworkPure 键）。
