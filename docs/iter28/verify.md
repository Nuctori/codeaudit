APPROVED

# 迭代 28 复审（只读）

复审范围：docs/iter28/impl.md + git diff（4 改 + 3 新）+ 全量测试独立复跑。
基线 efc4e6d（273/273）→ 282/282（+9）。

## 1) merge 语义正确性 — 通过

- **追加不删内置**：`mergeRecord` 从 `{...base}` 起步（effectOverride.ts:143），键只增不删；同键标量覆盖是文档化裁决「方向可纠正」（impl.md 关键裁决 3）。数组双数组走 `[...new Set([...b, ...v])]` 并集（:147），frameworkIo `this` 前缀扩展不丢内置（单测 :23-30 断言内置前缀全保留）。
- **误删风险**：v1 无删除能力，impl.md 残余风险已声明（null-marker 语法留待）。
- **builtinTypeEffects**：两层深合并（:156-168），给 `string` 加方法不丢内置（单测 :41-50 逐方法断言）。
- **Set**：`mergeSet` 并集（:171-174）。单测 :32-39 断言 `MyPureUtil` 注入且内置全保留。
- **短路**：`applyEffectOverrides` 无 override/空对象 → 原 pack 引用（:185）；scan.ts `if (opts.effectOverrides)` 空对象走空循环，行为零变化。
- **五语言包无回归**：合并是泛型克隆（`...pack` 保留 extensions/wasm/行为函数），全量 282 通过（含五语言 E2E）。

## 2) 生效路径 — 真实接线，非假接线

- link.ts:71 `const pack = packs.get(facts.lang)!` —— link 消费传入的 `ReadonlyMap`，即 scan.ts 合并后的 `packsByName`。链路：scan.ts:229-236 合并 → link → 查表（impureGlobals link.ts:606 / frameworkIo :556 / pureGlobals :630 / builtinTypeEffects :503 / hof* :372/396/446）。
- `classifyUsage(packs, ...)` 也在 link 内（link.ts:312）消费同一合并 map → 注入条目计入 effectTableUsage（`frame:MySdk` 命中可统计，impl.md 残余风险缓解成立）。
- E2E 实证（effecttable.test.ts:19-44）：无 override `MySdk.Send()` → UNKNOWN；注入 `MySdk: "net"` → IMPURE 且 `direct` 含 net。同文件真实运行通过。
- 注入面 = link 期 10 表全数覆盖（effectOverride.ts:13-24 与 LangPack 一一对应，无遗漏表）。

## 3) 向后兼容 — 无 override 逐位不变

- 无 override：`packsByName` = 原 pack 引用 Map，与原 `link(facts, ...)` 输入等价 → 行为逐位一致。
- E2E effecttable.test.ts:46-57 空 override 两次扫描 verdict (key, purity, direct) 序列化逐位相等，真实运行通过。
- 缓存/指纹：合并发生在缓存读（scan.ts:150）与缓存写（:197）**之后**、link 前；链接侧表不缓存，override 值不参与指纹 → 注入不造成缓存误命中/失效。指纹含 src/lang（effectOverride.ts 在 src/lang），改合并代码会自然失效缓存，方向保守无害。
- 现有 273 测试原样通过（282 总 = 273 + 9）。

## 4) 全量测试独立复跑 — 通过

- `node node_modules/vitest/vitest.mjs run`：**28 文件 / 282 通过 / 0 失败**（7.18s）。
- `npx tsc --noEmit`：0 错误。
- README 门禁两处 273→282 与实测一致；CHANGELOG 条目与实现一致。

## 非阻塞发现（n1/n2 已由主会话修复并复验）

- **n1（低）**：src/index.ts:19-20 文档注释重复一行——**已删**（index.ts:19）。
- **n2（低，潜在）**：`"set"` 形态校验空操作 + mergeSet 对 JSON 对象形态原生 TypeError——**已修**：校验层接受数组/对象键双形态、数组内非法成员拒绝；mergeSet 加固为 Set/数组/对象键三形态（`instanceof Set ? ... : Array.isArray ? ... : Object.keys`）。补 3 断言（pureGlobals 数组形态合法/对象键合法/`[42]` 非法成员拒绝）。修复后 282/282 复跑 + tsc 0 确认。
- **n3（低，UX）**：校验在提取+缓存写之后抛错（scan.ts:230-232）——非法 override 的报错要等整轮提取完成。非正确性问题，记录不修。

结论：4 项复审目标全部通过，无 blocker。282/282 + tsc 0 错误独立复跑确认。残余风险（语言事实义务转移 / CLI 待办 / 无删除能力）与 impl.md 声明一致。
