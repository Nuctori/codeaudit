APPROVED

# 迭代 23 复审：--state 状态耦合图 + frameworkIo.System 收紧（BLOCKER/MEDIUM 已修复并复验）

> 复审方式：只读（git diff b0f1006..工作树 + 全量测试复跑 + 独立探针实验）；BLOCKER/MEDIUM 由主会话修复后复验。
> 全量测试（修复后）：`node node_modules/vitest/vitest.mjs run` → **258/258 passed**（26 文件）；tsc 0 错误；README 门禁 OK 258。

## BLOCKER/MEDIUM 修复闭环

| # | 发现 | 严重度 | 处置 |
| --- | --- | --- | --- |
| 1 | `--state` 分支整行替换了 `--table-usage` 分支（迭代22 --gate 顶 --topology 同款 bug 再现，实跑 exit 2） | **BLOCKER** | 恢复 `--table-usage` 分支（cli.ts:59）；**根因护栏**：新增「全部布尔旗标可解析」CLI 回归测试（--strict/--topology/--sources/--state/--table-usage 逐一冒烟，顶替兄弟分支即 exit 2 失败）——防第三次复发 |
| 2 | 新增 csharp-lang 用例用参数接收者（`t.`/`mi.`）不触达 `obj="System"` 前缀路径，修复前也通过——测试无效 | MEDIUM | 改为全限定 `System.Reflection.IntrospectionExtensions.GetTypeInfo(t)` / `System.Reflection.MethodInfo.Invoke(mi,o,null)`（obj="System" 走前缀命中路径），断言含 effects 无 io + purity 非 PURE |

## 已验证正确（证据）

- **stateCouplingOf ↔ stateDepsOf 一致性**：独立前向模拟比对 → 逐写方精确一致（双写者同位置、子树匹配、自排除、无假报/漏报）。
- **⊤ 处理**：全局 ⊤ 写者/读者反查语义正确；unit 测试覆盖 ⊤ 暴露。
- **截断策略**：text top（args.top ?? 15）+ 超限注记；json 全量；零读者写方不输出、空图 `[]`/「无」。
- **json additive**：`{ ...payload2, stateCoupling }` 仅 --state 附加；自扫顶层 keys 无碰撞；不加 --state 无该字段。
- **frameworkIo 收紧**：保留 9 条目与 design §1 一致；全限定 System.* 调用移除后落 UNKNOWN 非 PURE（实测）；effect-table C5 裸类名走 impureGlobals 不受影响。

## 残余风险（方向安全，已文档化）

- `System.Reflection.Assembly.LoadFrom/LoadFile`（真实文件 io）现落 UNKNOWN——非假纯，标注可确证。
- InitDeity 复扫数字（ConvertToString ×47、IMPURE −100 等）依赖外部仓库（J:/…）；机制方向已由本地探针证实。
- stateDeps 盲区（下标写/调用结果写/项目外写者）→ 耦合图下界语义继承，已文档化。
