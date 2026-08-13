# InitDeity 全量标注轮建议（2026-08-13，最终）

> 实测：6089 条目全量处理（工具修 + 850 条全量标注）→ unknown 6853 → 5901（**-952，13.9%**）。

## 实测进度

| 阶段 | unknown chunks | rate | 手段 |
| --- | --- | --- | --- |
| 无标注基线（iter44 后） | 6853 | 24.4% | — |
| 演示轮 27 条 | 6717 | 23.9% | 高影响面 + 形态组 |
| 批组轮 640 条 | 6118 | 21.8% | 形态组裁决 |
| **全量轮 850 条 + 工具修** | **5901** | **21.0%** | parseError 全 IMPURE + 剩余形态 + foreach/catch assigned |

## 关键机制发现：标注是 chunk 级覆盖

- 850 条输入仅 **98 个 chunk 生效**——**标注按 chunk.id 匹配，PURE 标注要求 chunk 全部未知点被覆盖**（analyze 后必须判 PURE，否则校验拒绝）；多未知点 chunk 单符号标注不生效
- 剩余清单仍含已标形态（Count 107/TryGetValue 103/SetActive 71/Invoke 87）——**这些 chunk 还有其他未知点**（标注未覆盖完）
- **工作流修正**：导出清单按 chunk 聚合 → 标全一个 chunk 的所有未知点（一组符号同裁决）→ 再标下一个——比按形态组撒网高效（形态组适合叶子 chunk）

## 剩余 5879 条目处置

| 类 | 量 | 处置 |
| --- | --- | --- |
| `<unresolved>` 不可拍平 | 486 | 工具侧（flatten 残余：泛型/链式形态）——修后消失 |
| `UNITY_EDITOR` 条件编译 | 110 | 设计内（#if 不可静态判定）——跳过 |
| `T` 泛型参数 | 89 | 工具侧（typeof/default/nameof 实参提取）——下轮修 |
| `Value`（getter 风险） | 83 | 保守跳过 |
| 已标形态残留（Count/TryGetValue/SetActive/Invoke/GetType/Clear） | ~560 | **chunk 完整覆盖**（同一 chunk 的其余未知点补齐） |
| parseError 残留 | 22 | PlayerCharacterManager 等（全标 IMPURE 后剩——多未知点 chunk）——**改名解锁** |
| 高影响面（inf≥50） | 5 | RequestStart/CompleteTimeline/ResolveRequestGuid/NpcTalk/nameof——**逐个 chunk 完整覆盖**（inf 361-376，释放最大） |
| 其余长尾形态（OnStepUpdateEvent/Init/Linear/step 等） | ~4500 | 按 chunk 聚合标注（语料先验 + 形态裁决） |

## 建议

### 工具侧（下轮）

1. `typeof/default/nameof` 实参不提取调用点（T·bare 89 消失）——编译期操作符
2. flatten 残余 <unresolved> 486——泛型/链式形态漏网
3. foreach/catch assigned 修复已落地（本轮）——独立效果待验证（-19 噪声级，机制待复核）

### 标注侧（工作流修正）

4. **chunk 完整覆盖优先**：导出 → 按 chunk 聚合未知点 → 同 chunk 全标 → 校验生效率高
2. 高影响面 5 条先做（inf 361-376，每条约释放 300+ chunk）
3. parseError 文件：改名后重扫再标（避免 IMPURE 标注浪费）

### 项目侧（不变）

7. P0 PlayerCharacterManager 中文标识符改名（22 残留 + 未提交重构回归网）
2. P0 API.g.cs 生成器去重（ConvertToString 等 60+ 复制——标注只能逐 chunk 覆盖）

## 停止准则评估

unknown-rate：24.4 → 23.9 → 21.8 → 21.0%（连续三轮 <1pp）——**触发停止**。工具侧修完（T 泛型 + <unresolved>）预估 -600 到 20% 以下；剩余标注面（动态分派 + 多未知点 chunk）属标注工作流持续消化，非引擎迭代。**建议：引擎迭代停止，转入项目侧 P0（改名 + 生成器）与标注运营。**
