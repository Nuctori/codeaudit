# 迭代38 实施记录（record）

> 议程 00-agenda → 数学评审（01，反例优先）+ Jeff 工程评审（02，极简）→ 合成裁决 03-synthesis → 实施 → 验证。
> 基线：HEAD `d1f0f2f` + 工作树（P1-2/P1-3 未提交）。验收：tsc 干净 + vitest 串行 324/324 + 真实扫描冒烟。

## 实施内容（对照 03-synthesis）

| 项 | 落地位置 | 要点 |
| --- | --- | --- |
| A 数据 | pack.ts `RawFileFacts.classExtends/hasDynamicExtends` + extractor `classExtendsOf` | Python superclasses 字段 / C# base_list 子节点（探针实证非字段）/ TS class_heritage；isNamed 过滤逗号；动态 heritage → 语言级降 ? |
| A 引擎 | link.ts superMap（`lang\u0000cls` 键，同名类并集）+ hasSubclass + langHasDynamicExtends + `resolveClassMember`（"edges"/"unknown"/"none"） | 规则1 全祖先并集（MRO 反例）；规则2 跨文件并集；环 visited 截断；ctor 用 `${c}.${c}` 限定名 + 隐式 ctor 纯 |
| A 接入点 | self 分支、隐式 this、class: 接收者、A1 参数项目类（polymorphic=true）；lb（false）；ctor 分支（false） | 后代守卫降 ?（H4 闭合）；moduleBindings 不接（B9 债） |
| B mutate | pack.ts `builtinMutators` + csharp/python 表（List/Dictionary；list/dict/set）+ link A1 分支 | 查序 project-guard → H6 → mutate → pure/hof；sort 回调义务读 builtinTypeEffects hof 标记（规则5）；csharp List.Sort pure→hof |
| 规则7 | pack `trustedCtor`（csharp/python true；ts/js false）+ extractor 两处 new_expression 门 + link class: 门 | JS 构造器 return 对象假纯洞（P1-2 已落地洞）闭合；2 个既有测试基线翻转（A2/B → UNKNOWN） |
| H6 | link A1 内建分支 | hasSubclass 命中 → ?（字面量豁免不动） |
| --state | cli.ts `capStateCoupling` | compact 前缀和 + 二分，64M 工程上界；注释按数学评审降级（8× 余量非证明） |
| gameObject | csharp.ts `gameObjectMembers` | frameworkIo/frameworkAttrPrefix 单源 |
| 清理 | 删 test/tmp-*.test.ts 探针 ×3；README 305→324；technical-debt.md 重基线 + B7-B12 | C 项 node: 钩子按 Jeff 裁决 SKIP（一行 replace 即最小） |

## 实施中发现并修复的提取器缺陷（探针实证）

1. tree-sitter-python `typed_parameter` **无 name 字段**（name 是裸 identifier 子节点）→ paramNames/paramTypesOf 从未对 Python 生效（A1 Python 路径一直死）——修 name 回退 + `ctorTypeName` 加 `type` 别名包装剥壳。
2. tree-sitter-c_sharp `base_list` 是**子节点**非字段。
3. 基类列表含逗号匿名子节点 → 误标 dynamic。

## 测试

- 新增 `test/audit/inheritance.test.ts`：11 反例（C# 祖先解析/基类 ctor 并集/多态守卫降 ?/无子类正常、Python MRO 并集、动态 extends 降 ?、H6、mutate×2、字面量豁免、JS 构造器）。
- 基线翻转（评审裁决的预期后果）：csharp A1 集合变异 PURE→state；lang-features A2/B TS 构造器 IMPURE→UNKNOWN。

## 残余（已入 technical-debt.md B7-B12）

C# virtual 精度（B7，升级路径明确）、项目外子类（B8，无静态解）、moduleBindings 继承（B9）、mutate 无 stateWrites 位置（B10）、C# 字段初始化器（B11）、Python **new**（B12）。
