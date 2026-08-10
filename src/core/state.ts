import type { Chunk } from "./types";

/**
 * 读方传播（迭代8 视角2）：全项目名基匹配——哪个 chunk 读的状态位置被哪个 chunk 写。
 * 纯元数据（verdict.stateDeps），不进 purity/effects/chain（公理3：读不是副作用）。
 *
 * 匹配规则：
 * - 精确：写者 w == 读者 r；子树：r 以 w+"." 开头（写整棵子树，读子字段）
 * - ⊤：全局 ⊤ 匹配一切；根限定 ⊤（"d.⊤"）匹配同根一切位置
 * 自排除：同一 chunk 自写自读不构成外部依赖。
 *
 * 方向安全（迭代9 精确声明）：精确/子树匹配零假阳性；盲区（下标写 d[k]=、调用结果写
 * f().x=、项目外写者、读者读整对象、裸下标值读）只漏报不假报；⊤ 降级与同名异对象
 * （跨模块/作用域同名）可过近似——仅影响耦合元数据可见性，不进判定。
 *
 * 残余（文档化，README 已知限制）：项目外写者（测试夹具/框架注入）不可见 → 漏报；
 * 写侧盲区（下标写 d[k]=、调用结果写 f().x=）不检测 → 精确读者对这些写者漏报。
 */
export function stateDepsOf(chunks: readonly Chunk[]): Map<string, readonly string[]> {
  const writes = new Map<string, boolean>(); // 全项目写位置
  const chunkWrites = new Map<string, readonly string[]>();
  for (const c of chunks) {
    if (c.stateWrites.length > 0) {
      chunkWrites.set(c.key, c.stateWrites);
      for (const w of c.stateWrites) writes.set(w, true);
    }
  }
  const out = new Map<string, string[]>();
  for (const c of chunks) {
    if (c.stateReads.length === 0 || writes.size === 0) continue;
    const selfWrites = new Set(chunkWrites.get(c.key) ?? []);
    const deps = new Set<string>();
    for (const r of c.stateReads) {
      if (r === "⊤") {
        // 全局 ⊤ 读：匹配一切非自写位置
        for (const w of writes.keys()) if (!selfWrites.has(w)) deps.add(w);
        continue;
      }
      // 精确 + 写者写子树（w 是 r 的前缀）：逐前缀查（"user.profile.name" → "user.profile" → "user"）
      let prefix = r;
      while (prefix.length > 0) {
        if (writes.has(prefix) && !selfWrites.has(prefix)) deps.add(prefix);
        const idx = prefix.lastIndexOf(".");
        if (idx < 0) break;
        prefix = prefix.slice(0, idx);
      }
      // 根限定 ⊤：写者写同根任意位置（"d.x" 被 "d.⊤" 读命中）
      const dotIdx = r.lastIndexOf(".");
      if (dotIdx > 0 && r.slice(dotIdx + 1) === "⊤") {
        const root = r.slice(0, dotIdx);
        for (const w of writes.keys()) {
          if (selfWrites.has(w)) continue;
          if (w.startsWith(root + ".")) deps.add(w);
        }
      }
      // 全局 ⊤ 写者：匹配一切
      if (writes.has("⊤") && !selfWrites.has("⊤")) deps.add("⊤");
    }
    if (deps.size > 0) out.set(c.key, [...deps].sort());
  }
  return out;
}
