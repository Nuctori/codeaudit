import type { Verdict } from "./types";

/** 迭代44-r4：模块级聚合（重构范围决策视图）——按文件路径前缀聚合 verdicts。
 *  数据全部来自 report（纯派生，零新扫描）。depth = 目录段数（2 = 顶级模块/命名空间）。 */
export interface ModuleSummary {
	readonly module: string;
	readonly files: number;
	readonly chunks: number;
	readonly pure: number;
	readonly impure: number;
	readonly unknown: number;
	/** 效应面：该模块 chunk 出现过的效应原子并集（"io"/"state"/...）。 */
	readonly effects: readonly string[];
	/** 最长效应链（该模块内 chunk 的 max chain——副作用藏多深）。 */
	readonly maxChain: number;
	/** 未知率（0..1）。 */
	readonly unknownRate: number;
}

export function moduleSummary(
	verdicts: readonly Verdict[],
	depth = 2,
): ModuleSummary[] {
	const files = new Map<string, Set<string>>();
	const chunks = new Map<string, number>();
	const pure = new Map<string, number>();
	const impure = new Map<string, number>();
	const unknown = new Map<string, number>();
	const effects = new Map<string, Set<string>>();
	const maxChain = new Map<string, number>();

	const bump = (m: Map<string, number>, mod: string): void => {
		m.set(mod, (m.get(mod) ?? 0) + 1);
	};

	for (const v of verdicts) {
		const parts = v.chunk.file.split("/");
		const mod =
			parts.length > depth
				? parts.slice(0, depth).join("/")
				: parts.slice(0, -1).join("/") || "<root>";
		bump(chunks, mod);
		if (v.purity === 0) bump(pure, mod);
		else if (v.purity === 1) bump(unknown, mod);
		else bump(impure, mod);
		const ef = effects.get(mod) ?? new Set<string>();
		for (const e of v.effects) ef.add(e);
		effects.set(mod, ef);
		const c = v.chain === Infinity ? 0 : (v.chain ?? 0);
		maxChain.set(mod, Math.max(maxChain.get(mod) ?? 0, c));
		const fs = files.get(mod) ?? new Set<string>();
		fs.add(v.chunk.file);
		files.set(mod, fs);
	}

	const out: ModuleSummary[] = [];
	for (const [mod, n] of chunks) {
		const p = pure.get(mod) ?? 0;
		const i = impure.get(mod) ?? 0;
		const u = unknown.get(mod) ?? 0;
		out.push({
			module: mod,
			files: files.get(mod)?.size ?? 0,
			chunks: n,
			pure: p,
			impure: i,
			unknown: u,
			effects: [...(effects.get(mod) ?? [])].sort((a, b) => a.localeCompare(b)),
			maxChain: maxChain.get(mod) ?? 0,
			unknownRate: n === 0 ? 0 : u / n,
		});
	}
	return out.sort((a, b) => b.chunks - a.chunks);
}
