# Changelog

## [Unreleased] — 迭代 42（工程妥协形式化评审落地：静态访问类型加载闭合 + enum 判纯）

### 新增

- 静态成员访问类型加载效应闭合（候选7，活假纯洞）：全局类分支（link.ts）加类型加载闭包边——`C.Get()`/`C.X` 触发类型加载，闭包内 class chunk 原始调用（静态/实例字段初始化器）并集，与 L5 ctor 合并同构（S2 过近似方向安全）；纯静态工具类（闭包零原始调用）零变化
- C# enum 成员读取判纯（候选3，M7 闭合）：enum_declaration 入 chunkNodes + classNodes 双表（只加 classNodes 不产 chunk，globalClasses 索引不到）——顶层 enum 成员读取按 C# 静态语义判纯（编译期常量）；嵌套 enum 仍 `?`
- 评审流程 docs/iter42/：范畴论数学家（01-math-review）+ Jeff Dean（02-jeff-review）双评审——F2 实证 B4/M1「假纯可能」不可实例化（`+=` 是 state 写 + 触发端落 `?`）→ 方向分类改标；B14 改双路径分类；候选 4/5/6 defer 论证（无读者 / Λ 不变死数据 / Σ_ext 无挂接点）
- C# 测试 +3（enum 判纯 / 候选7 三态 / 对照零变化）

### 修复

- 静态访问路径漏报类型加载 io（实证：`P.Get()`/`P.X` 判 PURE 而类型加载执行 `File.ReadAllText`——S1 现实违反）→ IMPURE fs；裸名初始化器（Compute(1)）→ 诚实 UNKNOWN
- README 343→355 测试数同步（C4 门禁绿）

### 已知残余

- 事件订阅边建模（iter43-r1，修正版：private 可见性守卫 + 形态守卫 + `+=` 双语义保留）；static-init 独立 chunk（iter43-r2，side table 方案）；接口清单/效应细分/Σ_ext 维持 defer

## [Unreleased] — 迭代 41（表一致性断言 + 阴影守卫 + S4 引理化）

### 新增

- validatePackConsistency（M1/M2s/M3s/M4s/M5/M6 表级互斥断言）：互斥性从约定变机器校验；effectOverrides 合并点 warn（用户数据可制造死条目）；测试 5 用例
- S4 引理化（docs/iter41/01-proof.md）：调用点形态有限枚举 + 全总性结构归纳 + 控制流排他 + 判别字段穷举静态表
- 阴影守卫回归测试 3 用例（函数内/模块级遮蔽/未遮蔽对照）

### 修复

- 阴影守卫不对称假纯洞（评审发现 blocker）：pureBuiltins/pureGlobals 查询加 assigned + moduleAssigned 守卫（`const Math = evil()` 此前假 PURE）
- pureCtor 删 3 死条目（GUILayout/Texture2D/SystemInfo）；hofAlwaysArgs 12 名并入 hofCallsArgs（子集契约）
- B1 事故：M6 修数据误删 map → `[1].map(未解析回调)` 假 PURE——加回 + 回归测试
- README 350 测试

## [Unreleased] — 迭代 40（B5 属性访问器假纯洞闭合 + P0-3 引擎零语言常量全数据化）

### 新增

- C# 属性访问器建模（B5 假纯洞闭合）：property_declaration 提 chunk（自动属性=空 chunk，自定义 getter/setter 体调用归属属性 chunk）；propertyReadNodes 数据表（member_access_expression + 裸名 identifier 读取形态）→ prop 调用点
- link 五通道 prop 解析：self/隐式 this/参数类型/局部构造/全局类分支——成员 miss + 属性读取 → 纯（C# 静态语义：字段/自动属性/不存在成员读取无用户代码；partial 类由跨文件成员表并集覆盖）
- B 表方向分类三值（安全-过近似 / 安全-未知 / 假纯可能）+ M_out 模型外通道清单 M1-M7（S1 现实相对性边界形式化）
- C# 测试 +2（B5 传染组 + 纯成员组）
- P0-3 独立审计 25 项 hack 全数据化：LangPack 新增 ~30 数据字段（ctorChunkNames/ctorTypeFields/ctorMarkNodes/virtualModifiers/sealedModifiers/interfaceNodes/catchDeclNodes/cjsExportObjNames/requireFnNames/interfaceHeuristicMinBases/classMemberBodyNodes/foreachNodes/foreachInToken/throwArgFields/heritageFields/paramNameSlots/typeNameNodes/bytesPrefixTypes/patternNameNodes/fnLiteralNodes/lambdaNodes/exportStmtTokens/paramListNodeTypes/paramListField/nestedFnBoundaryNodes/heritageWrapNodes/argWrapNodes/keywordArgNodes/catchMultiTypeNodes/valueWrapNodes/incDecTokens/propMissIsPure 等）——extractor 零语言常量恢复真实（C01 声称闭环）
- RawChunk 补 params 字段：参数名进 assigned（防 import 遮蔽）+ ptype 分支参数豁免（A1 类型标注是声明事实）
- examples/essence.mjs 恢复（TODO P0-1）：90 行蒸馏副本，8/8 断言（handle_request chain=2 → sqlite3 chain=0）
- M5 C# `obj?.Prop` 条件访问读取（propertyReadNodes 加 conditional_access_expression——`a?.b()` 调用形态由现有 parent 排除覆盖）
- M6 TS/JS 属性读取建模：member_expression 建 prop 边 + memberNames 字段清单（public_field_definition 提取）+ selfPropReadIsPure（JS 语义 this.attr 非 getter 读取无副作用）+ __objectLiteral（对象字面量类型属性恒纯）+ TS paramNodes/paramNameSlots/typeWrapNodes 补全（**A1 参数类型绑定对 TS 的预存盲区**）+ ptype 链式首段查询（u.name.length 的接收者根）
- docs/essence-guide.md（TODO P3-1）：五层结构图 + 被砍项映射表 + 使用路径
- vitest maxWorkers=2：B5 后 CLI 单进程内存增大，全并发 spawn 峰值超限（V8 Zone OOM 实证）——限并发保 CI 稳定（迭代21 forks 先例同族）
- 诊断脚本清理（TODO P1-1）：删 diag-id×3/analyze-id-report/stats-purity/guard-annotations 6 个历史脚本；保留 annotate-slice/merge-annotations（标注工作流，docs 引用）与 check-readme-tests（CI 门禁）

### 修复

- 自定义 getter io 传染（实证反例：`c.Value` 读取方此前判 PURE 而 getter 执行 io）——参数类型/隐式 this/this/局部构造四通道全传染
- 方法组实参升级确定判定（Select(xs, Console.WriteLine) 从 UNKNOWN → 确定 IMPURE——方法组被 HOF 调用必然执行 io）
- 探针发现：C# variable_declarator 无 name 命名字段（children[0] 兜底）；web-tree-sitter 节点引用不恒等（位置比较替代 ===）
- P0-3 回归 3 例（341 测试网兜住）：Python typed_parameter 进 assigned → ptype 误挡 → params 豁免；TS 参数列表字段名/节点类型两维度混淆 → 拆 paramListField/paramListNodeTypes 双表；python.ts nestingNodes for_statement 两次编辑被吞 → nesting 回归
- C# 参数进 assigned（补四·五 #6 参数遮蔽对 C# 的死路径）+ 参数名 prop 读取跳过（参数引用读取纯是静态事实）
- C# 类型化 catch 精确提取（B01）：catch_declaration 含 type → 类型文本（此前被 TS 吞一切语义覆盖，throwsTypes 元数据修复）
- effectOverride EXTRACT_SIDE_TABLES 补 propertyRead* 5 表（C02：注入静默失效 bug）
- README 339 测试

### 已知残余（M_out）

- 事件订阅（B4）/ 项目外子类覆写（B8）/ 项目外状态写者 / Python **new**（B12）→ 假纯可能通道，触发条件与接受理由见 docs/technical-debt.md M_out 清单
- C# `obj?.Prop` 条件访问读取、TS/JS/Python 属性读取 → 迭代40 范围外（M5/M6，升级路径已列）
- B15（C# 裸名 identifier 全量建边性能）待大库实测；H20 SKIP_DIRS 为工程默认配置（非语言知识）

## [Unreleased] — 迭代 39（数学模型细化 M=(IR,Σ,Λ,π,H,F) + 缺口全收）

### 新增

- 数学模型规格 docs/iter39/00-model.md：M=(IR,Σ,Λ,π,H,F) + 引理 L1-L7——投影公理/并集闭包/祖先全并集/virtual 精确分派/构造器效应完备/mutate≡下标写/trustedCtor
- C# virtual 精确分派（B7）：polymorphicMethods=false + virtualMembers 提取（virtual/override/abstract，sealed 排除）+ BFS 首声明层守卫——非 virtual 静态分派精确（C# `new` 隐藏不改分派）；接口接收者无条件 virtual（接口分派恒动态）
- P2-1 投影数据化：astShapes 19 集投影表（py/ts/js/cs 全声明）——extractor 全部节点类型判定走 pack 表，新语言接入 = 纯数据
- P2-2 AST 形状契约网（ast-shape.test.ts 6 契约）：wasm 升级防静默失效

### 修复

- 字段初始化器假纯洞（P0-1/B11）：ctor 分支闭包 class chunk 原始调用并集（含基类字段初始化器）+ 隐式纯条件收紧；显式 ctor 并存 = 并集非 XOR（独立审计必修 1）
- 接口接收者假纯回归（独立审计必修 2）：interface_declaration 方法无条件标 virtual
- bindAssigns 投影集（独立审计必修 3）：`x += C()` 不再假绑定；TS/C# 模块级裸赋值绑定恢复
- C# catch_clause 恢复（独立审计必修 4）：异常捕获减法不再静默失效
- moduleBindings 接继承（B9）：模块级值绑定走 resolveClassMember（祖先闭包并集）
- mutate 写位置（B10）：参数容器变异 → stateDeps 可见（--state 耦合图补齐）
- node: 硬编码数据化：stripModulePrefixes（link + effectUsage 零语言常量完整态）
- TS extends_clause 包层剥壳（探针实证：静态基类提取此前全漏 + 误标 dynamic）
- README 337 测试

## [Unreleased] — 迭代 38（继承/多态最小健全版 + mutate 语义统一 + JS 构造器不可信门）

### 新增

- 继承/多态最小健全版：classExtends 提取 + resolveClassMember（祖先闭包全并集，规则1 禁最近层——Python MRO 反例；同名类跨文件并集规则2）+ 后代守卫降 ?（H4 假纯洞闭合）+ 基类 ctor 并集/隐式 ctor 纯 + 动态 extends 语言级降 ?（规则3）
- A1 mutate 语义统一（builtinMutators）：参数共享容器变异（d.Add）≡ 下标写（d[0]=1）→ state 效应；sort 回调义务保留（规则5）
- JS/TS 构造器不可信门（规则7）：trustedCtor=false → 不产 trusted 绑定（P1-2 已落地假纯洞闭合）
- H6 内建子类守卫：项目内 extends 内建类型并覆写 → ?（字面量豁免）
- --state 序列化工程上界（capStateCoupling：compact 前缀和 + 二分，64M ≈8× 余量）

### 修复

- csharp gameObject 双份清单漂移 → gameObjectMembers 单一数据源
- 探针实证：Python typed_parameter 无 name 字段（paramTypes/paramNames 对 Python 一直是死路径）、C# base_list 是子节点非字段、逗号匿名子节点误标 dynamic
- README 324 测试

## [Unreleased] — 迭代 37（P1-2 局部绑定 + P1-3 并集边 + 无特例语言无关最小化）

### 新增

- P1-2 局部单赋值构造绑定（localBindings）：`var xs = new List<int>()` → xs.Add 纯信箱——最小语言类型层第一个传递函数（G4 守卫：单赋值 ∧ ¬param ∧ 构造形态）
- P1-3 重载并集边（addUnionEdges + byQualifiedAll）：同限定名多定义 → 全候选并集边（数学 S1/S2/S3 可证安全，禁止任选）——ApiClientHelper.PrepareRequest 732 站重载歧义断链闭合
- P0-1 `X.gameObject.*` 前缀白名单数据化（frameworkAttrPrefix）+ P0-2 extractor 2-bit 数据化（assignmentScopesLocals/bareNameMeansThisInMethod）
- P1-1 effectOverride 注入白名单补全（frameworkPure + pureCtor）

### 修复

- Iter-37 audit blocker：LangPack 接口补 P0-2 2-bit 字段声明（提交信息失实 + 构建红线）
- 技术债 C6/C7 标记闭环
- README 305 测试

## [Unreleased] — 迭代 35-36（A1 参数绑定 + 独立审计修复 + 生产就绪规划）

### 新增

- A1 参数显式类型绑定（迭代35）：C# 参数 `Dictionary<string,int> d` → `d.TryGetValue/Add` 查 builtinTypeEffects 判纯——InitDeity 970 站集合方法痛点，unknown 4635→4563
- 工作流规划（迭代36）：restore-plan/workflow-plan/anti-laziness 三文档——InitDeity 重构 × codeaudit 生产就绪化 DAG + 验收硬门槛 + 防偷懒协议

### 修复

- A1 项目类守卫（迭代36 独立审计 High 假纯红线）：参数类型为项目自建 List/Dictionary 类 → 按类型名解析到项目类实例方法（io 传导），不走表绑定
- paramNames/paramTypesOf 删除不可达 fallback + 修正"参数收集对 C# 失效"错误前提注释（实证 C# 全有 parameters 字段）
- ctor 优先级注释修正（impureGlobals vs 项目类顺序差异记录不修——行为有界）
- ctorTypeName 旧行为描述修正（返回末段 identifier 非空 → null）
- README 305 测试

## [Unreleased] — 迭代 33-34（InitDeity 痛点修复 + 构造器建模 + 独立审计修复）

### 新增

- C1 构造器建模（`new X()`）：C# object_creation_expression → ctor 标记 → 专用分支——impureGlobals 类型键（FileStream:fs/Random:random/WaitForSeconds:clock）/ 项目类构造边（ctor chunk 传导构造体效应，防假纯）/ pureCtor 清单（List/Dictionary/Vector*/异常族等纯分配）/ 未列类型 `?` 诚实。InitDeity unknown 5102→4644（-9%）
- C2 `X.gameObject.*` 前缀白名单 → io（Unity 组件属性，局部变量 receiver——98 chunks 翻确定效应）
- TP5 NUnit StringAssert/Does 入 pureGlobals（675 站假 UNKNOWN 恢复）

### 修复

- `--state` json 崩溃（Invalid string length）：全量计算 + 输出截断（默认 top 50、硬上限 500）
- 效应表记账按语言分桶（TP4）：5 个 pack 行不再显示同一数据；module 命中键带 pack 前缀（独立审计 Med-High 修复）
- C2 分支移回 assigned 守卫之前（独立审计 Med——真局部变量 receiver 覆盖）
- ctor 判定顺序：项目类优先于 pureCtor 名单（独立审计 Med——项目类撞名单构造体 io 不再假纯）
- ctorTypeName 泛型末段递归 + predefined_type（独立审计 Low-Med）
- effectUsage missSlots 死逻辑删除、ctor Array.isArray 注释修正（独立审计 Low）
- README 303 测试

## [Unreleased] — 迭代 31-32（LINQ monad 审计 + S1 链修复 + S3 假纯堵洞 + frameworkPure 成员级白名单）

### 新增

- frameworkPure 成员级白名单（compromise-audit C1 结构性收紧）：前缀级 → 两级结构（Record<ns, Record<type, pure|hof|Record<member, ...>>>）——13 整类型键 pure + Linq 整类 hof + Text 3 子键 + Array 异质嵌套；linqHof 表删除（Linq:hof 1 键 + unconditional 门取代）；未列键落 ? 诚实
- builtinTypeEffects 补 IEnumerable/List/Dictionary monad 判定表（与 builtinMethodReturns 对齐——A1 变量绑定前置）
- builtinMethodReturns 扩展（string 链方法 + array/List/Dictionary/IEnumerable 返回类型——S1 链解析表）

### 修复

- S1：receiverTypeOf 支持 invocation_expression（C# 链式调用第二环起恢复——21,488 bare 站点受益）
- S3：hofAlwaysArgs 空表假纯洞（Select(xs, Console.WriteLine) → PURE 假纯）→ linqHof 分离 + unconditional 门
- HIGH-1：addArgEdges UNKNOWN 门认 linqHof（差集 15 算子命名回调不再被吞）
- MEDIUM-2：Join/GroupJoin 移出全局 HOF 表（String.Join 值实参不误伤）
- 记账不变量：addArgEdges 兜底走 markUnknown 通道（calls[?] === unknownSites>0 恢复）
- Text 死键（迭代 32 复审 Blocking）：StringBuilder/Encoding/RegularExpressions 嵌套进 Text 键 + UTF8Encoding 补键

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
