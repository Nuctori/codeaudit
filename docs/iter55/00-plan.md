# 迭代55：H1 守卫行粒度化（中文标识符 ERROR 误降级修复）

## 背景

InitDeity 全量扫描 parseError chunks 1556（项目侧 1072，68 文件）。
QuestProgressionManager.cs（2688 行）90 chunks 全标 parseError——但根因只是 **L2356 一个中文标识符
（`.草木之森`）**：tree-sitter-c_sharp 不识别 Unicode 标识符 → ERROR 节点 2 个 → `root.hasError=true`
→ 文件级 H1 守卫把 **90 个 chunk 全部降级**（parseError + 强制 UNKNOWN）——其中 L739 的
ApplyQuestProgression 等大方法（在 ERROR **之前**）解析实际可靠，被误降级。

## 修复

- `extractor.ts`：visit 收集 ERROR/isMissing 节点行号 → RawFileFacts.errorLines
- `scan.ts`：parseErrFiles `Set<string>` → `Map<string, number>`（文件 → 最小 ERROR 行号）
- H1 守卫降级条件：~~`chunk.line >= minErrorLine`~~ → **`!(chunk.endLine < minErrorLine)`**
  （iter54-r5 审计修正：`chunk.line >= errLine` 漏掉"chunk 覆盖 ERROR"形态——函数从 ERROR
  前一行的 def 开始、body 含 ERROR（未闭合字符串）→ 内容被错误恢复吞边，不降级 = 假纯回归，
  迭代2 H1 修复的洞复活；正确判据 = chunk 完全在最小 ERROR 行之前才保留）
- 标注回读 PURE 拒绝守卫（L453）同步行粒度

## 验证

- build 通过 + unit 135/135
- 全量重扫对比：QuestProgressionManager 应只降级 L2356 之后的 chunk（预计 90 → 个位数）
- iter54-r5 补充：lang-features +1 测试（H1 行粒度：ERROR 前独立 chunk 保留 / 覆盖 ERROR 降级），421/421

## 备注

- 保守性：ERROR 节点之前的 chunk 解析在流解析器语义下可靠（错误恢复是向前吸收）
- 中文标识符是合法 C#（Unicode 标识符）——tree-sitter-c_sharp 的 identifier 规则限制，
  非项目代码问题；不为此改项目代码
