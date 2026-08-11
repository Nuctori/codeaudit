import type { Chunk, Verdict } from "./types";

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
export function stateDepsOf(
	chunks: readonly Chunk[],
): Map<string, readonly string[]> {
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

/**
 * 状态耦合图条目（迭代23 D-127 --state）：一个写方 + 它被哪些 chunk 读。
 * 纯元数据聚合（复用 verdict.stateDeps——analyze 已算结果，不重复调 stateDepsOf）。
 */
export interface StateCouplingEntry {
	/** 写方 chunk key。 */
	readonly key: string;
	/** 写方展示名。 */
	readonly name: string;
	readonly file: string;
	readonly line: number;
	/** 写位置列表（chunk.stateWrites 原样，含 "⊤" 降级条目）。 */
	readonly writes: readonly string[];
	/** 读者数（排序主键，降序；位置被多写者写时读者会重复计入各写者——按写者列读者的自然语义）。 */
	readonly readers: number;
	/** 读者 chunk key 列表（字典序）。 */
	readonly readerKeys: readonly string[];
}

/**
 * 全图状态耦合链（迭代23 D-127）：写方 → 读者映射，按读者数降序。
 *
 * 算法：反查 verdict.stateDeps（位置 → 写者索引）。stateDeps 内位置必非本 chunk 自写
 * （stateDepsOf 已保证），无需再自排除。复杂度 O(Σ|stateDeps| × 每位置写者数)，近线性。
 *
 * 与 risk R_state 差异：R_state 是改动集视角的读者占比（--changed 输入 Δ）；
 * --state 是全图视角的耦合链（无 Δ，架构热点"谁写、谁读、哪个写方扩散面最大"）。
 * 两者共用 stateDeps 数据但互不依赖。
 *
 * 方向安全继承 stateDepsOf 声明：盲区（下标写/调用结果写/项目外写者）只漏报不假报
 * → 耦合图是**下界**；⊤ 降级与同名异对象可过近似，仅影响耦合元数据可见性，不进判定。
 * 零读者写方不输出（耦合图语义 = 有传播的写方；全图无读者 → 空数组）。
 */
export function stateCouplingOf(verdicts: readonly Verdict[]): StateCouplingEntry[] {
	// 写者索引：位置 → 写者 key 列表 + 写者元数据
	const posIndex = new Map<string, string[]>();
	const writerMeta = new Map<
		string,
		{ name: string; file: string; line: number; writes: readonly string[] }
	>();
	for (const v of verdicts) {
		const c = v.chunk;
		if (c.stateWrites.length === 0) continue;
		writerMeta.set(c.key, { name: c.name, file: c.file, line: c.line, writes: c.stateWrites });
		for (const w of c.stateWrites) {
			const arr = posIndex.get(w);
			if (arr) arr.push(c.key);
			else posIndex.set(w, [c.key]);
		}
	}
	// 读方反查：每个 verdict 的 stateDeps 位置 → 命中写者 → 读者集合
	const readersOf = new Map<string, Set<string>>();
	for (const v of verdicts) {
		if (v.stateDeps.length === 0) continue;
		for (const d of v.stateDeps) {
			const writers = posIndex.get(d);
			if (!writers) continue;
			for (const wk of writers) {
				let s = readersOf.get(wk);
				if (!s) {
					s = new Set();
					readersOf.set(wk, s);
				}
				s.add(v.chunk.key);
			}
		}
	}
	// 输出：只列有读者的写方；readers 降序，平手按 key 字典序（公理5）
	const out: StateCouplingEntry[] = [];
	for (const [key, meta] of writerMeta) {
		const readers = readersOf.get(key);
		if (!readers || readers.size === 0) continue;
		out.push({
			key,
			name: meta.name,
			file: meta.file,
			line: meta.line,
			writes: meta.writes,
			readers: readers.size,
			readerKeys: [...readers].sort(),
		});
	}
	out.sort(
		(a, b) =>
			b.readers - a.readers || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
	);
	return out;
}
