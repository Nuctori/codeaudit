# 迭代 28 记录（record 节点）

> DAG run-mspawyb5-feb68b05：audit → impl → verify → record（串行）
> 基线 HEAD efc4e6d（273/273）→ 当前工作树 282/282（+9：unit/effectOverride 6 + e2e/effecttable 3）

## 归档清单（docs/iter28/，4 件齐全）

| 文件 | 节点 | 内容 |
| --- | --- | --- |
| `audit.md` | audit | F16 注入面全图（link 期 10 表零缓存失效/提取侧表白名单拒绝）、按语言索引形态裁决、merge 键只增不删、CLI 待办 |
| `impl.md` | impl | effectOverride.ts 实现（EffectTables/validate/apply/load）+ scan.ts 接线 + index.ts 导出；282/282 |
| `verify.md` | verify | 复审 **APPROVED**（4 项主查实证 + n1/n2 修复记录；n3 记录不修） |
| `record.md` | record | 本文件 |

## CROSS-AUDIT.md 追加

「## 迭代 28（效应表注入平台化：F16 最小版）」节已追加（文件尾，markdown 校验通过）：

- F16 落地（长期待办 D3 债处置）：effectOverride.ts 新模块——EffectTables 10 表白名单/validate（语言名+表名+值形状含 record-array 双形态）/apply（键只增不删+数组并集+两层深合并+短路）/load（JSON CLI 预留）
- 注入形态裁决（按语言索引非全局 Partial<LangPack>——跨语言键语义不同，防 Debug/System 与 self/client 互污染）
- 生效路径（scan.ts link 前合并克隆，link.ts 零改动；链接侧表零缓存失效；提取侧表白名单拒绝防缓存幻觉）
- 测试 +9（unit 6 + e2e 3），282/282；实现裁决 2 个（record-array 双形态/E2E 绕 globalClasses）
- 复审 n1/n2 修复记录 + 下轮待办（CLI --effect-table/语言事实义务/无删除能力）

## README.md / CHANGELOG.md 同步（record 复核）

- README：测试数 282（两处，门禁 OK）、效应表注入示例块（:56-59）、库函数清单含 effectOverrides——impl 已做，record 复核通过
- CHANGELOG：[Unreleased] 标题加迭代 28 + 新增条目（impl 已做）；record 修复**重复 `### 新增` 块**（worker 插入的迭代 28 条目与原有 22-27 条目组并列两个 ### 新增）——合并为单一 ### 新增 块 + 清除重复 `--gate` 行；markdown lint clean

## 下轮待办（verify CHANGES=无，残余记录）

1. **CLI `--effect-table <json>`**（P2，~1h）：loadEffectOverrides 已就绪；需新建 spawn 测试基础设施（现无先例）；落地时校验层须拒绝对象形态的 set 表值（迭代 28 n2 已加固 mergeSet 三形态，CLI 路径安全）
2. **语言事实义务转移风险**（记录）：用户误标 io→纯 = 假纯方向不安全——缓解已就位（校验挡形状错别字 + README 文档义务 + --table-usage corpus-inactive 可见未命中条目）
3. **无删除能力**（设计裁决）：override 只能追加，删内置表需改库——防误删，接受
4. 延续记录待办：标注文件归档（基线不可复现）、F10 缓存分片、F18 英文文档、TS/JS object-pattern/for-of 解构名裸读（迭代 27 残余）、方案 B（assignedNames 收 pattern 名连 use 读）

> 处置注记（迭代 30 跨迭代复审——追踪丢失补录）：
> - **F4 sideEffects 认证**：延续列表前 6 轮在列、迭代 28 起静默消失——未实现也未关闭。裁决：暂缓（无明确用户需求；sideEffects 认证属增强语义非正确性缺陷），继续记录待办。
> - **读侧不对称**（裸 items[j]/裸字段读不映射 self）：需类型解析（迭代 25 裁决），purity 判定不受影响（仅耦合元数据），方向安全——保持记录待办，不关闭。
> - **方案 B**（assignedNames 收 pattern 名连 use 读）：独立收益小（use 读属低频假耦合）、触及 assigned 写侧语义需全量回归——保持记录待办，不关闭。

## 提交建议（主会话统一提交）

单次提交建议信息：

```
Iter-28: 效应表注入平台化（F16 最小版）+ CHANGELOG 结构修复

- F16: effectOverride.ts（EffectTables 链接侧 10 表白名单 + validateEffectOverride + applyEffectOverrides 键只增不删 + loadEffectOverrides JSON CLI 预留）
- scan.ts: ScanOptions.effectOverrides 透传，link 前校验+合并克隆（link.ts 零改动；链接侧表零缓存失效；提取侧表白名单拒绝）
- index.ts: scanProject opts + EffectTables/apply/validate/load 导出
- 注入形态: 按语言名索引 override 映射（跨语言键语义隔离）
- 测试 +9（unit/effectOverride 6 + e2e/effecttable 3），282/282 全绿
- 复审 n1/n2 修复: 重复注释删 + set 校验/mergeSet 三形态加固（+3 断言）
- CHANGELOG: 修复重复 ### 新增 块（迭代 28 条目并入 22-27 组）
- README/CHANGELOG/CROSS-AUDIT 同步
```
