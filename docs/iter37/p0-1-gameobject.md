# 迭代 37 P0-1：gameObject 前缀数据化（frameworkAttrPrefix）

> 执行者：P0-1 子代理。交付并入 c90f401（并行 P0/P1 提交，含 P0-1 + P0-2 + P1-1）。
> 验收：307/307 全绿 + tsc 无 P0-1 错误 + 验收标准① grep 达标。

## 改动（HEAD c90f401 内）

| 文件 | 改动 |
| --- | --- |
| `src/lang/pack.ts` | +`frameworkAttrPrefix?: Readonly<Record<string, readonly string[]>>`（属性链前缀白名单：attr 首段 ∈ 键且 member ∈ 清单 → io 边界；引擎在 assigned 守卫前查表；miss → UNKNOWN） |
| `src/engine/link.ts` | L642-659 原 `call.attr.startsWith("gameObject.")` 硬编码 → 查 `pack.frameworkAttrPrefix[attr首段]` + member 清单；位次保持守卫前；槽位 `frame:${head}` |
| `src/lang/packs/csharp.ts` | +`frameworkAttrPrefix = { gameObject: ["SetActive","GetComponent","transform","layer","tag","name","AddComponent"] }` + 导出 |

## 测试（+2，307 总）

- **E**（lang-features）：Python 无 frameworkAttrPrefix → `item.gameObject.SetActive` 不误判 io（UNKNOWN 方向安全）——通用机制缺失验证
- **F**（lang-features）：C# frameworkAttrPrefix 命中 → IMPURE io——等价迁移验证
- 既有 C2 测试（L678-700 迭代33）逐字不变（305→307 保持）

## 验收核对

| 标准 | 结果 |
| --- | --- |
| ① `grep gameObject src/engine/` 仅剩注释/槽位 | ✅ HEAD link.ts 无逻辑分支（仅注释 + hitTable 槽位） |
| ② 305/305 → 307/307 绿 | ✅ 29 files 307 passed |
| ③ 位次在 assigned 守卫前 | ✅ link.ts L646（守卫在 L669 后） |
| ④ C# 白名单 miss → UNKNOWN | ✅ RefreshSelf 用例（C2 既有 + E 验证） |

## 残余

- 本实现用 **attr 首段查表**（frameworkAttrPrefix[head]）而非任务描述的 obj 查表——更通用（任意变量 receiver 的 head.member 链），C2/F 测试证明语义等价
- 工作树残留 pack.ts/technical-debt.md 为 P0-2 worker 半成品（非 P0-1 范围）
- 未独立提交（被 c90f401 合并）——无 staged 残留
