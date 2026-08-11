# 迭代 26 impl：声明名裸读抑制 + 下标/元素访问左值写

> 实现节点（run-msp8shcy）：按 docs/iter26/audit.md 实现 ① ② 两项，②b 同轮落地。
> 基线 HEAD 0b8e95f（265/265）→ 完成后 269/269（+4：csharp-lang 迭代26 T1-T4）。

## 改动文件

| 文件 | 改动 |
| --- | --- |
| `src/lang/extractor.ts` | **stateReadPos identifier 分支**（L207）：声明名裸读抑制——`parent.childForFieldName("name")?.id === node.id → []`（.id 判等防 iter24 `===` 恒假陷阱；def foo/function foo/C# method name 不再当外部变量读）。**externalWritePos**：① attribute/member_expression/member_access_expression 三分支加 ②b 对偶——readTarget null 且 obj 非 identifier 时 `subscriptRoot(obj) → "d.⊤"`（d[k].x=v 镜像读侧；identifier 局部/外部已由 readTarget 判定，subscriptRoot 对裸 identifier 会误报局部）；② subscript/subscript_expression/element_access_expression 左值写分支（L432-450）——容器位置语义：参数容器变异（arr[0]=1）→ 外部 `arr`（params 短路不适用变异）；C# 类成员方法内裸字段容器（items[0]=v）→ `self.items`（declared 含则局部）；局部容器（declared/assigned 含，如 Python for 变量 item[k]=v）→ 非外部；member 容器（this.arr[0]=x）→ 递归 externalWritePos → self.arr |
| `test/audit/csharp-lang.test.ts` | +4 用例（T1 C# 下标写可见：arr 参数外部/self.items/非全局裸名；T2 Python for 变量 item[k]=v 非外部 + TS 参数 arr 变异外部；T3 声明名不裸读：方法名/类名抑制；T4 d[k].x=v → d.⊤ + 局部 o.x=1 不误报） |
| `README.md` | 测试数 265→269（两处） |

**未改**：state.ts（stateDepsOf/stateCouplingOf）、analyze.ts、link.ts、types.ts、pack.ts、stateWritePos 主链。

## InitDeity 复扫验证（--no-cache 只读）

`node dist/cli.js scan "J:/旧宇宙/代码仓库/InitDeity/Assets" --no-cache --state --top 5`：

| 指标 | 迭代25 后 | 迭代26 后 | 变化 |
| --- | --- | --- | --- |
| stateCoupling 写方总数 | 5919 | 6591 | +672（新揭示：下标/元素访问写此前完全不可见） |
| top 写方 | PushStone.Init 1139（self.hasInit） | BuglyAgent._UnregisterExceptionHandler 1888（System.⊤ 事件注册）、UICommon.Awake 1255（ICommonUI.⊤ 接口契约） | 新写方上榜（此前下标/⊤ 写不可见） |
| 含 ⊤ 降级写方 | — | 951（近似耦合，README 已知限制注记） | 新揭示 |

- **判定分布**：269/269 测试全绿；InitDeity 复扫无崩溃、秒级。
- **写方 +672 语义**：迭代26 前 subscript 左值写（arr[i]=v/items[0]=v/d[k].x=v）完全不可见（假纯缺陷）——新写方是**正确化**（真实状态/接口契约写揭示），非误报（T1/T4 断言语义证）。

## 测试

- tsc 0 错误；全量 **269/269**（26 文件）；README 门禁 OK 269。
- T1-T4 修复前均失败（防回归有效）：T1 修复前 stateWrites 为空（下标写不可见）；T2 修复前无判定（可验证 params 外部语义）；T3 修复前方法名/类名裸读；T4 修复前 d[k].x 无写。
- 回归核对：迭代24 T1-T3（调用目标排除/字段读/字段写）、迭代25 T1-T4（初始化器/++写/局部声明/self 字段）原样通过；lang-features stateDeps 断言（user.status/[]/self.v）原样通过。

## 关键实现裁决

1. **容器位置语义**：arr[i]=v → "arr"（容器本身）非 "arr.⊤"——"arr.⊤" 写只匹配 "d.⊤" 读者漏主模式（state.ts:41-59 实证，audit 裁决）。
2. **params 短路不适用于变异**：裸重绑（x=5）参数是局部（F2），但 arr[0]=1 参数数组变异影响调用方 → 外部（audit 裁决，与 readTarget 的 `params.includes → 外部` 一致）。
3. **for 变量 item[k]=v 局部**：item 在 assigned（for_statement 是 Python assignmentTargets）→ 非外部（与 readTarget 一致；declared 不含 for 变量故不能用 declared 判定）。
4. **②b 仅复杂 obj 启用**：subscriptRoot 对裸 identifier 直接返回文本——o.x=1 的 o 在 assigned 若走 subscriptRoot 会误报 o.⊤，故限定 obj.type ≠ identifier/property_identifier。

## 残余风险（audit 记录，非本轮缺陷）

- 读侧不对称：裸 `items[j]` 读（C# 字段容器读）不映射 self.items（需类型解析，audit ③ 明确不做）。
- 声明名裸读抑制未覆盖 C# variable_declarator 声明名裸读（审计 §4.6 跨语言声明名裸读抑制记录待办——本轮只做了 name 字段抑制）。
- `f().x = v`（调用结果写）由 ②b 的 subscriptRoot 兜底降级为 `"f.⊤"`（镜像读侧，方向安全）；**局部 subscript 根**（`dd[k].x = v` 的 dd 局部）仍过近似为 `"dd.⊤"`（有界：仅 ⊤ 降级键 + 同名根碰撞时假耦合，且只影响 stateDeps 元数据不进判定）——两种均审计 §5 裁决范围内。
