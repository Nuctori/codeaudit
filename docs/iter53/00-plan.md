# Iter-53：方法组实参去伪影（事件订阅/退订引用不建调用边）

> 触发：iter52 后纠缠环再分类（#3 侦察）发现 GamePlayOpenChecker 2×2 环——`Check→CheckGamePlayOpen`
> 边来自 `RemoveListener(CheckGamePlayOpen)` 方法组**引用**被误当调用。

## 0. 盲区证据

- 实边（rescan 数据）：`GamePlayOpenChecker.Check` → `CheckGamePlayOpen`；源码中该标识符唯一出现于
  `GamePlayOpenManager.instance.onGamePlayOpened.RemoveListener(CheckGamePlayOpen)`（退订，永不触发回调）。
- 机制：csharp pack `propertyReadNodes` 含 `identifier`（为隐式 this 字段读设计，迭代40 B5）→ 实参位
  裸 identifier 也发 prop 调用 → linker 隐式 this 分支（link.ts:1592）`resolveClassMember` 解析成方法边。
- 契约冲突：csharp pack 文档 L15「事件订阅（+= / AddListener）不建回调边」——V1 意图被 B5 通道绕过。
- 反例（不能全停发）：iter30-32 测试依赖实参位 prop-read 的**成员形态**通道
  （`Enumerable.Last(xs, Console.WriteLine)` → obj=Console → impureGlobals io → IMPURE=2），
  且 `Enumerable.ForEach(xs, Save)` 的 HOF 回调边此前靠同一通道兜底（addArgEdges 缺 C# implicitThis）。

## 1. 修复（两处，方向安全）

- `src/lang/packs/csharp.ts` + `src/lang/pack.ts` + `src/lang/extractor.ts`：新 pack 字段
  `bareArgReadSkipParents = ["argument","named_argument","argument_list"]`——只停发**裸 identifier**
  实参位的 prop-read（member_access 实参保留：效应表通道契约）。
- `src/engine/link.ts` `addArgEdges`：补 C# implicitThis 裸名方法组解析（与 resolveCall 裸名分支对称）——
  HOF 回调边自持，不再依赖参数位 prop-read 兜底。
- 残余（记录）：`this.Handle` 成员形态方法组实参仍走 self 分支建边（罕见形态，方向安全=过近似）。

## 2. 验证

- `npm run build` exit 0；`npx vitest run` → **415/415 passed（44 files）**（412 + 3 新增）。
- 新增：`test/audit/csharp-lang.test.ts` 「迭代53：方法组实参（AddListener/RemoveListener）不建调用边」——
  Subscribe/Unsubscribe 无指向 Handle 的边、Handle 纯、Fire 诚实未知（控件组）。
- 恢复：iter31 S3 / HIGH-1 / iter32 T3 三个 LINQ 契约测试（成员形态实参 io 通道 + HOF 本地回调边）保持通过。
- InitDeity 实证：重扫后纠缠环数对照（待扫描完成记录）。

## 3. 决策链

- D-1：只停发裸 identifier 实参而非全部实参 prop-read——成员形态实参是效应表通道（iter30-32 测试契约），
  全停发会假纯（Console.WriteLine 实参丢失 io 传染）。
- D-2：addArgEdges 补 implicitThis 而非改 prop-read 通道——HOF 回调边语义归属实参通道（argFns），
  修通道而非靠误发射兜底。
- D-3：新 pack 字段表驱动（P2-1 纪律），不写语言特判。
