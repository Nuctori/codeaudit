# Code Context — 迭代26 审计：声明名裸读抑制 + element_access 左值写（scout 产出）

HEAD 0b8e95f。全部节点形态经 web-tree-sitter 0.22.6 实际 parse 实证（probe 脚本 `.pi-subagents/probe-ast*.cjs`）。
完整方案成稿：`docs/iter26/audit.md`（本文件为其 findings 底稿 + 上下文索引）。

## Files Retrieved

1. `src/lang/extractor.ts` (L153-185) — stateWritePos：assignment/augmented/update/postfix 分支全部调 externalWritePos(left)
2. `src/lang/extractor.ts` (L196-259) — stateReadPos：identifier 分支 L197-207（① 改动点），member 分支 L208-258（⊤ 规则 L256-258）
3. `src/lang/extractor.ts` (L366-412) — externalWritePos：identifier 分支 L368-384、readTarget L385-393、attribute/member_expression/member_access_expression 分支 L394-410（② 改动点，L411 return null 前插）
4. `src/lang/extractor.ts` (L262-269) — subscriptRoot（②b 复用）
5. `src/core/state.ts` (L19-64) — stateDepsOf 匹配规则（精确/前缀 L41-48、根限定 ⊤ L50-57、全局 ⊤ L59）——② 位置语义裁决依据
6. `src/lang/packs/{python,typescript,javascript,csharp}.ts` — assignmentTargets：py=["assignment","augmented_assignment","for_statement","named_expression"]；ts/js=["variable_declarator","assignment_expression","for_in_statement","for_of_statement"]；cs=["assignment_expression","variable_declarator"]
7. `test/audit/csharp-lang.test.ts` (L196-327) — T1-T4：stateReads/stateWrites 断言（① 回归网）
8. `test/audit/lang-features.test.ts` (L886-897, L915-928) — 唯一 stateDeps 断言处（① 不受影响实证点）
9. `docs/iter25/audit.md` §4.5/§4.6/§5 — ① ② 待办溯源；§0.2 — `.fieldName` undefined、childForFieldName 正常的实证教训

## Key Code

**① 现状（stateReadPos identifier 分支，extractor.ts:197-207）**：跳过表只含成员访问节点；声明名（Py `def foo`、TS `function foo`、C# `method_declaration` 的 name 字段 identifier）不在列且 ∉ params/assigned → 裸读噪音。修复（3 行，插在 L204 成员跳过之后）：
```ts
if (p && p.childForFieldName("name")?.id === node.id) return []; // 必须 .id（iter24：`===` 恒假）
```

**② 现状（externalWritePos L366-412）**：无 subscript/subscript_expression/element_access_expression 分支 → `arr[i]=v`/`this.arr[0]=x`/`arr[i]++` 全无写 = **假纯缺陷**。修复（~15 行，L411 前插）：容器位置语义（非 "arr.⊤"），identifier 容器显式判定（params/python 短路不适用于变异），member 容器递归 externalWritePos。

**②b 同族**：`d[k].x = v`（member + element-access obj）→ readTarget null 后镜像读侧 `subscriptRoot(obj)` → "d.⊤"（5 行，可选）。

## Architecture

extract() 单次 AST 遍历 → stateWritePos/stateReadPos 产出 chunk.stateWrites/stateReads → link.ts/state.ts 传播成 verdict.stateDeps（纯元数据，不进 purity）。stateWrites 非空 → link.ts:289 加 "state" 直接效应 → IMPURE。stateDepsOf 匹配：写者==读者精确、写者前缀读者、"d.⊤" 读匹配同根一切写、"⊤" 全匹配；自写自读排除。

## Start Here

`src/lang/extractor.ts` — 两处改动点都在此（L204 后 + L411 前），零 pack 改动。改完跑 `npm test`（265 tests），新测试落点 test/audit/csharp-lang.test.ts 与 test/audit/lang-features.test.ts（project/by helper 模式，L17-30）。

## 裁决要点

- ① 对 lang-features L915-926 断言零影响：被抑制名无同名写者 → stateDepsOf 不输出（有写者的位置才进 stateDeps）。
- ② 位置语义：容器位置（"arr"/"self.arr"/"user.arr"）——读侧 plain 下标读=裸 "arr"、self 限定读="self.arr"，容器写精确/前缀双命中；"arr.⊤" 写只匹配 "d.⊤" 读者，漏主模式（state.ts:41-59 实证）。
- C# 裸字段容器写 → "self.items"（inClassMemberBody 门控），与裸 `items[j]` 读不对称（③ 不做，iter25 §4.1 延续）。
- ③ 裸字段读 self 映射：明确不做（需类型解析）。
- 优先级：② 本轮做（假纯修复）、① 本轮做（3 行零破坏）、②b 同轮可选（方向安全）；③ 与 f().x= 写记待办。
