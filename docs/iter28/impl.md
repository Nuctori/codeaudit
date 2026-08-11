# 迭代 28 impl：效应表注入（F16，平台化最小版）

> 实现节点（run-mspawyb5）：按 docs/iter28/audit.md 方案（库 API 最小版，CLI 记录待办）。
> 基线 HEAD efc4e6d（273/273）→ 完成后 282/282（+9：unit/effectOverride 6 + e2e/effecttable 3）。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/lang/effectOverride.ts`（新） | `EffectTables` 类型（链接侧 10 表白名单）+ `validateEffectOverride`（语言名校验/表名白名单含提取侧拒绝/值形状校验含 record-array 双形态）+ `applyEffectOverrides`（键只增不删：Record 键合并 + 数组并集 + Set 并集 + builtinTypeEffects 两层深合并 + 空 override 短路原引用）+ `loadEffectOverrides`（JSON 加载，CLI 预留） |
| `src/engine/scan.ts` | ScanOptions 增 `effectOverrides?` 字段；link 前 `validateEffectOverride`（非法 → throw）+ `applyEffectOverrides` 合并克隆入 packsByName——link.ts 零改动，提取/缓存/指纹零影响 |
| `src/index.ts` | scanProject opts 透传 effectOverrides + 导出 EffectTables 类型 + applyEffectOverrides/validateEffectOverride/loadEffectOverrides |
| `test/unit/effectOverride.test.ts`（新） | 6 用例：Record 键合并+标量覆盖（内置键全保留）、frameworkIo 数组并集（不重列内置前缀）、Set 并集、builtinTypeEffects 两层深合并、空 override 短路原引用、校验拒绝（未知语言/提取侧表/非法效应类/合法形态） |
| `test/e2e/effecttable.test.ts`（新） | 3 用例：注入 impureGlobals MySdk:net → 外部 SDK 调用 UNKNOWN→IMPURE（direct 含 net）、空 override 两次扫描逐位一致（短路）、非法语言 → scanProject rejects |
| `README.md` | 测试数 273→282（两处）、注入示例块（scanProject effectOverrides）、库函数清单 + EffectTables 类型 |
| `CHANGELOG.md` | [Unreleased] 标题加迭代 28 + 新增条目 |

## 关键实现裁决

1. **record-array 双形态校验**：impureGlobals/impureModules 值支持标量效应类（`"net"`）与成员数组（`["a","b:p"]`）两种形态——校验须都接受（初版只验数组 → 单测捕获，已修）。
2. **E2E 用外部 SDK 类**：`new NetCall().Send()` 的 receiver 是 "object"（C# literalReceivers）且项目类走 globalClasses 优先解析——效应表不命中；改用非项目内 `MySdk.Send()`（obj=MySdk 无 globalClasses → 走 impureGlobals）才是注入真实用例。
3. **merge 方向安全**：键只增不删 → override 不可能误删内置表；数组并集 → 扩展现有键（frameworkIo this）不重列内置前缀（重列 = 抄写漂移 = 漏前缀 = 假纯的根源）。
4. **短路**：无 override / 空对象 → 返回原 pack 引用（零行为变化的静态保证）。
5. **提取侧拒绝**：literalReceivers/builtinMethodReturns/chunkNodes 等参与缓存（进 cache.json），注入会缓存命中时静默失效——白名单显式报错而非静默忽略。

## 注入示例

```ts
const report = await scanProject("./src", {
  effectOverrides: {
    csharp: { impureGlobals: { MySdk: "net" } },            // 外部 SDK 类 → net 效应
    python: { frameworkIo: { client: ["post", "get"] } },   // 扩展现有键不重列内置前缀
  },
});
```

## 测试

- tsc 0 错误；全量 **282/282**（28 文件，+9）；README 门禁 OK 282。
- 回归：现有 273 全部原样通过（无 override 路径天然覆盖短路语义）。

## 残余风险

- **语言事实义务转移**：用户误标方向（把 io 标纯）= 假纯（方向不安全）——缓解：校验挡形状错别字；README 文档义务；--table-usage 的 corpus-inactive 统计可见未命中条目。
- **CLI --effect-table 待办**：本轮仅库 API；CLI 需新建 spawn 测试基础设施（现无先例），出现命令行用户需求时 ~1h 补齐（loadEffectOverrides 已就绪）。
- **无删除能力**（v1）：用户无法移除误标内置条目——覆盖可改方向，删除留待 null-marker 语法。
