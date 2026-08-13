# 迭代52 思路：图完整度提升——`<unresolved>` 真身定位（交叉审计输入）

> 用户指令（睡觉授权）：开审计修复循环，思考如何正确提升图完整度（48.2%，未知站点 96058），直到没有可干的工作。
> 交叉审计要求：结果和思路需要独立视角审计。

## 一、基线数据（DBG_UNRESOLVED 门控收集，InitDeity 全库 no-cache 重扫）

- 完整度 48.2%（totalSites 185267 / unknownSites 96059）
- `<unresolved>·bare` 11040 站 = unknown 总量 11.5%（此前误判为「设计边界/不可拍平」）
- **构成：member_access_expression 10845（98%）**——不是 flatten 白名单外形态，是**成员访问但 flatten 失败**

## 二、top 形态根因分类（各占多少站 + 可修性）

| # | 形态（DBG 样本） | 站点 | 根因假设 | 可修性 |
| --- | --- | --- | --- | --- |
| A | `client_.ReadObjectResponseAsync<ErrorResponse>(response_, ...)` | ~900（732+74+57） | attr=generic_name 成员调用的 flatten 分支未命中（obj 是变量链） | 高（探针确认 AST 后修） |
| B | `response_.Content.ReadAsStringAsync().ConfigureAwait(...)` | ~780（732+48） | 调用结果接收者链——.NET 返回类型已知（Task/string），builtinMethodReturns 表可解 | 高（补表 + 链消费） |
| C | `urlBuilder_.Append(...)` / `client_.SendAsync(...)` | ~730（366×2） | obj=变量 attr=Append/SendAsync——flatten 应成功？需探针确认为何 null | 待探针 |
| D | `base.OnDestroy` / `base.Awake` / `base.OnEnable` 等 | ~400 | **base_expression 不在 flatten 白名单**——base.X 应解析到基类成员 | 高（base → 类成员解析，复用 implicitThis 通道） |
| E | `method!.Invoke` | ~69 | **null 抑制运算符 `!` 包裹（null_forgiving）未剥壳** | 高（剥壳） |
| F | `typeof(X).GetMethod` / `System.Convert.ToString(x).ToLowerInvariant` / `ClearCache().AsUniTask().ToCoroutine` | ~180+ | typeof/调用结果链——builtinMethodReturns 或 receiverTypeOf 可解 | 中高 |
| G | `enumerator.MoveNextAsync().GetAwaiter` | 42 | 链式（MoveNextAsync→Task→GetAwaiter） | 中（表补链） |

**合计可修面 ≈ 3000+ 站（unknown 总量的 3%+，但 <unresolved> 的 27%+）**——修正后完整度预计 48.2% → ~49.5%，且这些站点在 API.g.cs 生成代码高频（ReadObjectResponseAsync 家族），修一处表/分支覆盖全族。

## 三、修复方案草案（按收益排序，待审计）

1. **base 前缀**（D，~400 站）：flattenCallTarget 加 base_expression 处理（C# base = 隐式 this 的基类形态）——receiver 解析走既有 implicitThis/类成员通道（link 分支已有 ancestorClosure）
2. **null 抑制剥壳**（E，~69 站）：flatten 遇 `!` 包裹节点剥壳递归内层（C# suppressed/null-forgiving）
3. **泛型成员 attr**（A，~900 站）：探针确认 `client_.Foo<T>(...)` 的 attr 节点形态（generic_name？）后修 flatten member 分支
4. **调用结果链**（B/F/G，~1000 站）：builtinMethodReturns 补 .NET 高频链（ReadAsStringAsync→Task<string>、ConfigureAwait→Task、AsUniTask→UniTask、GetMethod→MethodInfo、ToLowerInvariant→string）+ receiverTypeOf 消费
5. **C 类待探针**（~730 站）：urlBuilder_.Append 为何 flatten null——若 obj 是变量但 attr 提取走错字段则修 extractor

## 四、交叉审计问题

1. 修 base/null-forgiving/泛型 attr 是否有假纯风险？（base.X 解析到基类成员——多态覆写？null-forgiving 剥壳后语义）
2. 调用结果链用 builtinMethodReturns 补表——方向安全？（.NET 返回类型是语言事实；表外断链维持 ?）
3. 收益优先级：A/B/C/D/E/F 的排序是否合理？是否有更高杠杆的形态被漏掉？
4. 完整度 48.2% 的提升路径：`<unresolved>` 只占 11.5%，剩下 88.5% 是 variable 接收者（动态分派）——是否该并行推进效应表补全（Append/Count/SetActive 等高频形态）？
5. 修复后如何验证不引入假纯（A6 S1）——回归测试形态？
