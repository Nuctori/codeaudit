import type { Verdict } from "./types";

/** 迭代44-r4：文件级依赖（重构拆分决策）——calls 的 key 形如 `file::id`——反解即得文件级边。
 *  纯派生（report 数据），零新扫描。 */

export interface FileDep {
	readonly file: string;
	readonly edges: number;
}

/** 出边：文件内 chunk 的 calls 指向的文件（按边数降序）。UNKNOWN_TARGET/同文件排除。 */
export function outDepsOf(
	verdicts: readonly Verdict[],
	file: string,
): FileDep[] {
	const out = new Map<string, number>();
	const fileOf = (key: string): string | null => {
		const i = key.indexOf("::");
		return i > 0 ? key.slice(0, i) : null;
	};
	for (const v of verdicts) {
		if (v.chunk.file !== file) continue;
		for (const k of v.chunk.calls) {
			const f = fileOf(k);
			if (f === null || f === file) continue;
			out.set(f, (out.get(f) ?? 0) + 1);
		}
	}
	return [...out.entries()]
		.map(([f, n]) => ({ file: f, edges: n }))
		.sort(
			(a, b) =>
				b.edges - a.edges ||
				(a.file < b.file ? -1 : a.file > b.file ? 1 : 0), // 公理5：等边数平手按文件（乱序输入稳定）
		);
}

/** 入边：哪些文件（的 chunk）调用了本文件的 chunk（按边数降序）。 */
export function inDepsOf(
	verdicts: readonly Verdict[],
	file: string,
): FileDep[] {
	const out = new Map<string, number>();
	const fileOf = (key: string): string | null => {
		const i = key.indexOf("::");
		return i > 0 ? key.slice(0, i) : null;
	};
	const targets = new Set<string>();
	for (const v of verdicts) {
		if (v.chunk.file !== file) continue;
		targets.add(v.chunk.key);
	}
	for (const v of verdicts) {
		if (v.chunk.file === file) continue;
		for (const k of v.chunk.calls) {
			if (targets.has(k))
				out.set(v.chunk.file, (out.get(v.chunk.file) ?? 0) + 1);
		}
	}
	return [...out.entries()]
		.map(([f, n]) => ({ file: f, edges: n }))
		.sort(
			(a, b) =>
				b.edges - a.edges ||
				(a.file < b.file ? -1 : a.file > b.file ? 1 : 0), // 公理5：等边数平手按文件（乱序输入稳定）
		);
}
