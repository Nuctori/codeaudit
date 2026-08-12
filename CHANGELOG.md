# Changelog

## [0.3.1] — 2026-08-12（迭代 30：frameworkPure System 回退 + HOF 假纯修复）

### 修复

- `frameworkPure` 纯命名空间回退（C# 全限定 System.* 纯类判纯——InitDeity global:System miss 1869→0）
- HOF 回调假纯三层修复：`Linq.Enumerable.ForEach(xs, Save)` 回调 io 传染（此前判 PURE 假纯）——C# argument_list/argument 提取、LINQ 静态运算符 hofCallsArgs、纯前缀命中回调边保留
- pack.ts JSDoc 重复 + link.ts 死变量清理

## [0.3.0] — 2026-08-12（真实校准 + 门禁 + 状态耦合图 + 效应表注入轮）

### 新增

- `frameworkPure` 纯命名空间回退（迭代30）：C# 全限定 `System.*` 调用（obj=System）在 frameworkIo.System 9 条 io 前缀外，按首段查严格纯白名单（Uri/Linq/Convert/Enum/Text/Array/Math/TimeSpan/Guid/Collections）——94.1% 纯类从 UNKNOWN 判纯（InitDeity `global:System` miss 1869→0）；Reflection/Runtime/Activator/DateTimeOffset 明确排除防假纯；可选字段 TS/Python 零影响

- CLI `--effect-table <json>`（F16 CLI 补全，迭代29）：读文件 + 传 scanProject effectOverrides——JSON 形状与库 API 同构（`{ 语言: { 表名: 值 } }`）；读文件/JSON 解析失败 exit 2（与 --annotations 同款）；形状校验（未知语言/提取侧表/非法效应类）由 scan.ts 兜底 throw → exit 2

- `--gate` 合入门禁（F5，Debtmap 借鉴）：与 `--changed` 联用，`grade ≥ HIGH`（风险≥35）时退出码 1——CI 阻止高危改动合入；`LOW/MEDIUM` → 0；`invalid` → 1（不静默放行）；无 `--changed` 时报错 exit 2（不静默失效）
- `fitBaseRate(corpora)` 分层贝叶斯基率（pipeline.md 四落地）：跨项目语料 → `BaseRateModel{mu, kappa, projects}`——μ 替代硬编码 `GLOBAL_THETA0`；矩估计闭合解（加权均值 + 方差反解 κ），`projects < 2` 冷启动回退现状
- `priorFor(corpus, site, baseRate?)` 第三参：缺省路径逐位兼容（`baseRate?.mu ?? 0.25`）
- corpus 面库 API 补齐导出：`emptyCorpus`/`updateCorpus`/`mergeCorpus`/`summarize`/`siteShapeInfo`/`isCorpus`/`fitBaseRate`/`priorFor` + 类型（pipeline.md 三工作流示例消费面）
- `--state` 状态耦合图（D-127）：写方 stateWrites → 读方 stateDeps 映射——text 摘要 top 15 按读者数降序，json 顶层 `stateCoupling` additive（零 schema 破坏）；`stateCouplingOf(verdicts)` 纯函数反查 verdict.stateDeps（零重复传播）

### 修复

- `--topology` 解析分支回归（`--gate` 分支曾顶掉兄弟分支——迭代 22 复审发现，已恢复 + 补 CLI 回归测试）
- frameworkPure HOF 回调效应丢失（迭代30 复审发现，假纯方向）：`Enumerable.ForEach(xs, Save)` 判 PURE 假纯——纯前缀命中直接 return 吞回调边；三层修复（link.ts hofCallsArgs 末段匹配 + addArgEdges、csharp.ts hofCallsArgs 补 23 个 LINQ 静态运算符、extractor.ts argFnsOf 补 C# argument_list + argument 包装节点解包）
- frameworkIo.System 前缀表收紧（迭代 22 盲区处置）：删 Reflection/Text/Globalization/Runtime/RuntimeTypeHandle 5 条目——纯反射元数据读不再假 io（InitDeity ConvertToString ×47 direct-io 47→0，全库 IMPURE −100 / UNKNOWN +99 守恒零误伤）；移除后落 UNKNOWN 非 PURE（MethodInfo.Invoke 不假纯）
- `--state` 解析分支回归（`--state` 曾顶掉 `--table-usage`——迭代 22 `--gate` 顶 `--topology` 同款 bug 二次再现）：恢复 + 根因护栏「全部布尔旗标可解析」CLI 回归测试（5 旗标逐一冒烟）防三次复发
stateReadPos 节点同一性 `===`→`.id`（web-tree-sitter 每次属性访问返回新节点对象，`===` 恒假——「调用目标排除」「赋值左值跳过」自迭代 8 起死代码，跨语言修复）：`user.save()` 不再计入 stateReads、`user.status = x` 不再同时写+读
C# 成员节点覆盖（member_access_expression/conditional_access_expression 进 stateReadPos 过滤 + 调用 parent 补 invocation_expression/object_creation_expression + 子标识符抑制）：InitDeity instance 写方读者 2633→1005（−62%）；C# 字段读位置从「永不产生」到正确
externalWritePos 写侧对偶（C# `this.x = v` 字段写可见——此前完全不可见）：`transform.position = x` 正确判 state，UNKNOWN 28.1%→25.0%（正确化）
C# 对象初始化器属性写不再裸写全局（`new C { A = v }` 非外部状态写——Quest12* 1949 假读者源头消除）
C# 类字段裸写收敛 self 语义（`score = v` → `self.score` 而非全局裸名——ConfigSingleMenu 2674→903 读者，−66%）
C# `i++`/`this.x++` 写侧补全（postfix/prefix_unary_expression，仅认 ++/-- 操作符——`!x`/`-x` 是读不误写，字段自增方法不再假纯）
C# 局部声明名并入 assigned（variable_declarator 进 assignmentTargets + children[0] fallback）——`int q=1; q*2` 不再假裸读
声明名裸读抑制（跨全语言：def foo/function foo/C# method name 的声明名不再当外部变量读——`parent.childForFieldName("name")?.id === node.id`，.id 判等防迭代 24 === 恒假陷阱）
下标/元素访问左值写可见（`arr[i]=v`/`this.arr[0]=x`/`d[k].x=v`——此前完全不可见 = 假纯缺陷）：容器位置语义（参数容器变异外部/self.items C# 门控/for 变量 assigned 局部）；`d[k].x=v` 与调用结果写 `f().x=v` 镜像读侧降级 `d.⊤`/`f.⊤`（方向安全）；InitDeity stateCoupling 5919→6591（+672 正确化揭示）
声明名裸读抑制补齐（迭代 27：C# tuple_pattern 解构名 / C# foreach 变量（`in` 位置判断防集合误抑制）/ TS-JS catch 变量 / Python except-as 变量——统一 5 规则声明名抑制，全 `.id` 判等；嵌套 pattern depth-1 局限记录）

## [0.2.0] — 2026-08-11（生产就绪轮）

### 新增

- `--sources`：效应源清单（chain=0 IMPURE——直接调 io/net/random/state 的"背锅者"，按调用点排序）
- `--topology`：拓扑健康度（graphMetrics：密度/环/深度/自环/层/链直方图 + 人类解读）
- `graphMetrics` 库 API（拓扑派生层纯函数）
- `R_state` 因子：回归风险六因子（状态写改动 → stateDeps 读者耦合）
- `ChangeRisk.evidence`：证据质量（unknownRate/parseErrorRate/missingSiteRate——证明系统最小方案）
- CLI 可解释性层：grade action 行 + 证据置信度警告 + 拓扑人类解读
- GitHub Actions CI（build + 测试 + 自扫描健康检查）

### 修复

- 定时器异步边真实生效（D-092：hofAlwaysArgs 触发门死配置修正）——回调进反向闭包
- CJS 解构 require 盲区（exports.x=fn 建命名 chunk）——解构回调可解析
- F2 参数重绑不再判外部状态写（纯局部）
- 解构绑定 declaredNames（`const {a}=obj; a=5` 不再假 IMPURE）
- 阈值重标 15/35/60（实测分布驱动，30/60/85 两个死区）

### 内部

- 最简性清扫：S1-S3 消重（changedImpact 复用/annotationCurve 加权/共享比较器）+ D1-D5 死代码删
- 标注曲线分母统一 |U|（对齐 proof Θ）
- 发布面：exports/types/bin/files/repository 齐备；npm pack 消费者验证通过

## [0.1.0] — 2026-08-09

- 初始发布：跨语言纯度审计（Python/TS/JS/TSX）
- 核心：chunk 调用图 + SCC 凝聚 + 效应传染链 + 三值判定（A6/A7 健全性契约）
- 回归风险（`--changed`）：L×C 五因子 + 阈值分级
- 证明完整度（proofCompleteness Θ）+ 标注闭环（unknowns/annotations/corpus）
- AI 标注闭环：影响面排序导出 + 标注回读 + 语料先验
