# codeaudit 技术债摘要（迭代 19 后 / C# 语言包上线）

> 基于 19 轮迭代审计 + C# 语言包 6 轮实战（InitDeity 3028 文件）。HEAD `01dd226`，216/216。
> 分类：**A. 形式正确性修复（已修）** / **B. 工程妥协（有意，方向安全）** / **C. 无主债（应还）** / **D. 外部债（非本仓库可修）**

---

## A. 形式正确性修复（迭代 19 复审发现，已闭环）

| # | 发现 | 状态 |
| --- | --- | --- |
| A1 | **跨语言类名污染**：C# Main.Run 把 Helper.Build() 解析到 Python Helper 类（同名不同语言→串入 io 效应） | 已修：globalClasses 带 lang，调用侧同语言匹配（829b410） |
| A2 | **C# this 是 this_expression**（非 `this`）——this.gameObject 全 <unresolved>，frameworkIo["this"] 永不触发 | 已修：flattenCallTarget + this_expression（18d877f） |
| A3 | **泛型方法剥除**：Resources.Load\<GameObject\> 的 generic_name 未处理 → <unresolved> | 已修（d300d78） |

## B. 工程妥协（有意，方向安全——但降低判别力）

| # | 妥协 | 语义 | 代价 |
| --- | --- | --- | --- |
| B1 | **效应表 70+ 类基数无校准** | 每类人工裁决（Debug io/PlayerPrefs state 明确；Path fs/Screen io/Transform state 保守） | 过度判定 → 假 IMPURE（方向安全，但 LOW 阈值分布偏移） |
| B2 | **frameworkIo["this"] 20 组件 + gameObject/transform 隐式 this** | this.gameObject.SetActive → io（固定 io 非细分） | 组件链一律 io，无法区分读/写 |
| B3 | **LINQ 链全 ?**（xs.Where(...).Select(...)） | 变量 receiver 动态 → 诚实 ? | 集合内存操作判 unknown（可标注 PURE） |
| B4 | **事件订阅不建模**（+= / AddListener） | 回调方法独立判定，订阅方不建边 | 事件回调不传染（方向安全） |
| B5 | **属性访问器不建 chunk**（自定义 getter/setter 有逻辑） | 自动属性无逻辑；自定义 getter 漏检 | 带逻辑的 getter 效应漏（方向安全——漏检方向） |
| B6 | **隐式 this 与局部变量竞态**：裸名 gameObject 若局部变量遮蔽 → 仍判 io | 遮蔽守卫只查 assigned——C# 局部 gameObject 变量罕见 | 极小 |

## C. 无主债（应还）

| # | 债 | 成本 |
| --- | --- | --- |
| C1 | **resolveCall cognitive 290**（迭代 18 D1 未还 + C# 分支再加） | 2-4h |
| C2 | **真实项目 fixture**（InitDeity/旧宇宙无回归快照——C# 修复无防回归网兜） | 2-3h |
| C3 | **标注工作流 E2E**（unknowns→标注→回读→语料全链路无测试） | 1h |
| C4 | **README 测试数漂移**（5 次复发——CI 校验 10min 根治） | 10min |
| C5 | **效应表测试稀疏**：70+ 类只测 10 个（PlayerPrefs/File/GameObject/Resources/Debug/Task）——其余无断言 | 1h |

## D. 外部债（非本仓库可修）

| # | 债 | 影响 |
| --- | --- | --- |
| D1 | **tree-sitter-c_sharp Unicode 标识符缺陷**（中文枚举 `草木之森` → parse-error） | InitDeity 77 文件降级 UNKNOWN（方向安全）——wasm 升级或自行补丁 |
| D2 | **协程构造 new WaitForSeconds 的 ?**（object_creation 提取盲区——new 构造器未解析） | 构造器调用记 ?（MoveCoroutine 仍正确判 io） |
| D3 | **Unity 引擎本身不可扫**（UnityEngine.dll 无源码——效应表人工维护） | 靠效应表覆盖，新 Unity API 需补 |

---

## 总体评估

- **形式正确性**：核心（SCC/效应格/A6/A7/内容寻址/前缀回退/语言隔离）全部有证明或复审闭环；迭代 19 的 3 个形式级缺陷（A1-A3）已修复并测试。
- **工程妥协**：全部方向安全（假 IMPURE 不假纯）；B1-B6 是有意取舍，A7 效应原子 7 类契约下可解释。
- **判别力损失**：LINQ/事件/属性（B3-B5）是 C# 判别力的主要损失——但全部诚实 ?（可标注）而非静默假纯。
- **偿还顺序**：C4（10min）→ C1（复杂度拆分）→ C2（真实 fixture）→ C5（效应表测试）→ C3（E2E）。
