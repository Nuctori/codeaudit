APPROVED

# 迭代 32 复审（Blocking 已修复并复验）

> 复审发现 1 Blocking（Text 死键）+ 3 minor；主会话修复后 297/297 复验通过。

## CHANGES 修复闭环

1. **[Blocking] Text 3 个死键**：初版把 StringBuilder/Encoding/RegularExpressions 放 System 顶层散键，但匹配按 rest 首段 "Text" 查 → System.Text.* 整子树 miss 落 ?（55 站翻纯→?、global:System miss 111→166、TransportManager.RoomSharingCode 翻转）。**修复**：嵌套进 `Text: { StringBuilder/Encoding/RegularExpressions: pure }` + 注释写明教训 + 补 T4 回归测试（System.Text.Encoding.UTF8.GetBytes → PURE）。复验：InitDeity 效应表 161 条目/80 命中恢复迭代 31 基线、miss 回落、T4 绿。
2. **Linq 整类 hof 过宽（Major latent）**：非委托成员（Concat/Skip/Take/ToArray）带标识符实参 → UNKNOWN（方向安全，语料零影响）。审计"整类 hof 与逐成员等价"对 argFnsOf 收数据实参不成立——记录待办（arity 感知），不阻塞。
3. **classifyUsage 不递归 Array 嵌套**（minor）：17 个 Array 成员在报告不可见——条目 +2 实际是 Text 拆分，impl.md 归因修正。
4. **impl.md 指标行错误**（minor）：global:System miss 111→166 非 0→0——已修正描述。

## 复验

- tsc 0 错误；**297/297 全绿**（28 文件，+4：迭代32 T1 未列落 ?/T2 Array 拆分/T3 Enumerable hof/T4 Text 嵌套）；README 门禁 OK 297。
- InitDeity 复扫（双 HEAD 对照）：pure 8044/impure 10652/unknown 5103（−1/+1 未列成员正确化）；global:System miss 111（Text 修复后回落）；chunk 级差分仅 TransportManager.RoomSharingCode（Text.Encoding.UTF8.GetBytes——修复后回纯）。
- 成员级白名单核心正确：未列落 ? 诚实（T1）、Array hof 回调保留（T2）、Enumerable hof unconditional 门（T3）、iter30/31 全部回归绿。

## 残余（非阻塞，记录待办）

- Linq 非委托成员（Concat/Skip/Take/ToArray）带标识符实参 → ?（arity 感知 argFnsOf 待办）。
- pure 成员被传真正函数实参 → 假纯（语言事实缓解，无语料实证）。
- Linq.Expressions.* 未列 → ?（审计预期；当前 PURE 是 iter30 基线延续，收紧待办）。
