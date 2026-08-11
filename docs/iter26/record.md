# 迭代 26 记录（record 节点）

> DAG run-msp8shcy-ffd169a5：audit → impl → verify → record（串行）
> 基线 HEAD 0b8e95f（265/265）→ 当前工作树 269/269（+4：csharp-lang 迭代26 T1-T4）

## 归档清单（docs/iter26/，4 件齐全）

| 文件 | 节点 | 内容 |
| --- | --- | --- |
| `audit.md` | audit | 声明名裸读抑制（3 行方案）+ element_access 左值写（容器位置语义）+ ②b 同族裁决（.id 判等教训） |
| `impl.md` | impl | ① name 字段抑制 + ② 下标写分支 + ②b 镜像对偶；3 个实现陷阱；InitDeity +672 正确化揭示 |
| `verify.md` | verify | 复审 **APPROVED**（三项主查实证 + 3 minor 修复闭环；无 blocker） |
| `record.md` | record | 本文件 |

## CROSS-AUDIT.md 追加

「## 迭代 26（声明名裸读抑制 + 下标/元素访问左值写）」节已追加（文件末尾）：

- 迭代 25 残余待办处置（audit §4.5/§4.6）：① 声明名裸读抑制（.id 判等）② element_access/subscript 左值写（容器位置语义，假纯缺陷修复）③ 裸字段读 self 明确不做
- ②b 同族落地：`d[k].x = v` → `d.⊤`（调用结果写 `f().x = v` 由此覆盖，读侧对偶）
- 实现陷阱 3 个（subscriptRoot 裸 identifier 误报 / Python for 变量 assigned / C# 参数容器变异外部）
- InitDeity 复扫：stateCoupling 5919→6591（+672 正确化）、951 ⊤ 降级写方新揭示
- 测试 +4（T1-T4 修复前均失败），269/269 全绿
- 复审：三项主查实证 + 3 minor 修复（T3 类名断言移类 chunk / state.ts f().x= 声明校正 / ②b 局部根边界明示）
- 下轮待办：C# variable_declarator 声明名裸读抑制 / 读侧不对称（需类型解析）/ Python self[k]=1 弱键

## README.md / CHANGELOG.md 同步（record 复核）

- README：测试数 269（两处）已由 impl 同步；`check-readme-tests.cjs` 门禁通过（269 OK）
- CHANGELOG：[Unreleased] 标题改「迭代 22-26」，修复条目补 3 条（声明名抑制 / 下标写 / ②b 镜像对偶）

## 提交建议（主会话统一提交）

单次提交建议信息：

```
Iter-26: 声明名裸读抑制 + 下标/元素访问左值写（假纯修复）

- ① 声明名裸读抑制（跨全语言）：parent.childForFieldName("name")?.id === node.id → []（.id 防 === 恒假）
- ② subscript/element_access 左值写（arr[i]=v/this.arr[0]=x 此前完全不可见=假纯）：容器位置语义
  （参数容器变异外部/self.items C# 门控/for 变量 assigned 局部）
- ②b d[k].x=v → d.⊤（调用结果写 f().x=v 覆盖，读侧对偶；仅复杂 obj 防局部误报）
- InitDeity: stateCoupling 5919→6591（+672 下标写正确化揭示）、951 ⊤ 降级写方
- 测试 +4（T1 下标写/T2 for 局部+参数变异/T3 声明名/T4 d[k].x），269/269 全绿
- 复审 3 minor 修复（T3 断言移类 chunk / state.ts f().x= 校正 / ②b 边界明示）
- README/CHANGELOG/CROSS-AUDIT 同步
```

## 下轮待办（verify/audit 记录）

1. C# variable_declarator 声明名裸读抑制（本轮只做 name 字段）
2. 读侧不对称（裸字段读/裸 items[j] 读不映射 self，需类型解析——purity 判定不受影响）
3. Python `self[k]=1` 弱键 "self" 经前缀规则与全项目 self.x 读者耦合（频率低）
