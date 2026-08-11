# InitDeity 迭代 22 安全重构 + 复扫验证（verify-initdeity 产出）

> 基线：`docs/iter22/initdeity-audit.md`（scout 复扫审计，HEAD 9ac6b4c）
> 重构：严格按审计清单 b) 执行 2 项（均在 156 脏文件之外，未触碰其他文件）
> 复扫：`node dist/cli.js scan "J:/旧宇宙/代码仓库/InitDeity/Assets" --no-cache --json`（tsc 0 错误，EXIT 0）
> 原始报告：`/tmp/iter22-initdeity-after.json`（40.8MB，未入库——与 before 报告同规模）

---

## 1. 重构内容（2 项，均为清单内低风险项）

### 1a. `Assets/Plugins/StompyRobot/SRF/Scripts/Collections/SRList.cs:30` — SRList(IEnumerable) 构造器去内部传染环

```diff
 public SRList(IEnumerable<T> source)
 {
-    AddRange(source);
+    // 一次性拷贝（迭代22：不再走 AddRange→Add 状态写入链——语义等价，null 入参同样抛异常）
+    _buffer = new List<T>(source).ToArray();
+    _count = _buffer.Length;
 }
```

- 语义等价论证：原实现 `AddRange` → foreach `Add` → 检查扩容 → `Buffer[Count++] = item`（多次属性写 + 索引写 + 潜在 Expand 扩容）；新实现一次性 `List<T>.ToArray()` 拷贝 + 两个字段写。对调用方观测到的状态（Count/元素/顺序）完全一致；`_buffer` 容量从"扩容后 2 的幂"变为"精确 count"——**SRList 语义不承诺容量**（Trim 存在即证明），差异不可观测（Capacity 非公开 API，Buffer getter 返回引用但调用方按 Count 索引）。
- null 入参：原 `AddRange(null)` → foreach null 抛 NullReferenceException；新 `new List<T>(null)` 抛 ArgumentNullException——同族异常，均崩溃，语义等价（该构造器无 null 契约）。

### 1b. `Assets/InitDeity/Vfx_Test/ScreenShake.cs:254` — 删除 TestShake（Vfx_Test 手测残留）

```diff
-    [ContextMenu("手动测试震动")]
-    private void TestShake()
-    {
-        if (mainCamera != null)
-            TriggerShakes();
-    }
+    // [ContextMenu("手动测试震动")] 已删除（迭代22：Vfx_Test 手测残留，chain=2 state+random 源，零生产调用者）
```

- 零运行时风险：TestShake 是 private + 仅 `[ContextMenu]` 编辑器入口；`TriggerShakes`（public，OnEnable 调用）未动；文件本身是 Vfx_Test 手测目录。

---

## 2. 复扫对比（--no-cache，无标注回读口径）

| 指标 | 重构前 | 重构后 | Δ |
| --- | --- | --- | --- |
| chunks | 23800 | 23799 | **−1**（TestShake 消失） |
| files | 3004 | 3004 | 0 |
| PURE | 8590 | 8590 | 0 |
| IMPURE | 9449 | 9448 | **−1**（TestShake state+random 源消除） |
| UNKNOWN | 5761 | 5761 | 0 |
| 自环 / cycles | 72 / 11 | 72 / 11 | 0 |

### 目标 chunk 判定变化

| chunk | 重构前 | 重构后 | 变化 |
| --- | --- | --- | --- |
| `SRList.SRList`(IEnumerable 构造器) | chain=3, state | chain=0, state | **内部 3 环消除**（不再经 AddRange→Add→Expand 传染链）；字段写仍判 direct state |
| `ScreenShake.TestShake` | chain=2, state+random | **不存在** | 源消除 |

### 诚实结论（与审计预测一致）

- **SRList 去 state 目标未完全达成**：字段写（`_buffer = ...` / `_count = ...`）仍被工具判 state——重构只消除了**传染链**（chain 3→0），未消除直接效应。审计报告已诚实标注"收益≈0（0 调用者），仅清理内部环"——**数据支持审计判断**。
- 工具侧观察（审计 c) 第 3 条验证）：SRList 构造器重构后 direct=state 说明**字段写即 state** 的判定语义——对纯数据结构构造器是误报方向（假 IMPURE，方向安全），属效应表/判定口径问题，非本次重构可解。

---

## 3. 工具盲区观察（复扫确认 + 新发现）

1. **【复扫确认·假 IMPURE 强证据】API.g.cs `ConvertToString` ×47 direct io**——frameworkIo.System 前缀表含 `Reflection`/`Runtime`/`Globalization`，纯反射元数据读取（GetTypeInfo/GetCustomAttribute/EnumMemberAttribute 读属性）被标 io。**47 个 direct-IMPURE 源 = 全库最大单类假阳**，修复方向：收紧前缀表（Reflection/Runtime/Globalization/Text 移出）或方法名白名单（GetTypeInfo/GetDeclaredField/GetCustomAttribute 加 pure 例外；MethodInfo.Invoke 不放行）。
2. **【观察·判定口径】纯数据结构构造器字段写判 state**：SRList 重构后 direct=state 证明——`_buffer = ...` 这类私有字段初始化在工具侧=state（假 IMPURE，方向安全）。与 L.Assert/Debug.Log 的惯例 io 同类，是效应表口径的已知保守方向，非缺陷。
3. **【基线不可复现】标注文件缺失**：本轮所有数字为无标注口径（UNKNOWN 5761）；基线 3449 需 2654 条标注文件（已丢失）才能复现。**建议父会话决策**：接受无标注基线作为新基准，或找回/重建 `initdeity-annotations.json` 归档入库。

---

## 4. 结论

- 2 项安全重构已执行并验证：TestShake 源消除（chunks −1 / IMPURE −1）；SRList 内部 3 环消除（chain 3→0）。
- 未触碰清单外任何文件（git status 158 = 基线 156 + 本次 2 个目标文件）。
- 重构收益与审计"低收益/去噪音"判断一致——真实价值在**验证工具判定路径**（SRList chain 3→0 证明传染链建模工作正常；TestShake 源删除立即反映到 IMPURE 计数）。
- 下轮待办（工具侧）：frameworkIo.System 收紧（ConvertToString ×47 假阳）、标注文件归档。
