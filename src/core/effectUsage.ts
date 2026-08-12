import type { LangPack } from "../lang/pack";

/**
 * 效应表使用率（迭代21 数学解 B——设计经交叉审计：触发率=0 ⟹ 死 不成立）。
 * 三分类：provably-dead（结构性死条目，静态可证）/ corpus-inactive（语料未咨询——非死）/
 * consulted-but-miss（咨询未中槽位 = 补表候选——降 unknown-rate 正路）。
 */
export interface EffectTableUsage {
	readonly pack: string;
	readonly summary: {
		readonly entries: number;
		readonly hits: number;
		readonly corpusInactive: number;
		readonly consultedButMiss: number;
		readonly provablyDead: number;
		readonly missSites: number;
	};
	readonly entries: ReadonlyArray<{
		readonly table: string;
		readonly key: string;
		readonly consulted: number;
		readonly hits: number;
		readonly miss: number;
		readonly status:
			| "provably-dead"
			| "hit"
			| "consulted-but-miss"
			| "corpus-inactive";
		readonly evidence?: string;
	}>;
	readonly missSlots: ReadonlyArray<{
		readonly slot: string;
		readonly miss: number;
	}>;
}

/** provably-dead 判定（P1-P4——锁定查找码现状，单测防漂移）：
 *  P1 遮蔽：同类别 impure 键为 string 效应且 pure 同键 → pure 不可达（effectFromModule/branch4 先查 impure return）。
 *  P2 node: 前缀不可达（effectFromModule 先 replace(/^node:/,"")——该键永不命中）。
 *  P3 形态不可达：builtinTypeEffects 类型键 ∉ literalReceivers 值域。
 *  P4 相对路径不可达：impureModules 键以 ./ ../ 开头（resolveModule 必命中项目文件，永不 consult 表）。 */
export function classifyUsage(
	packs: ReadonlyMap<string, LangPack>,
	hit: ReadonlyMap<string, number>,
	miss: ReadonlyMap<string, number>,
): EffectTableUsage[] {
	const out: EffectTableUsage[] = [];
	for (const [packName, pack] of packs) {
		const entries: Array<{
			table: string;
			key: string;
			consulted: number;
			hits: number;
			miss: number;
			status:
				| "provably-dead"
				| "hit"
				| "consulted-but-miss"
				| "corpus-inactive";
			evidence?: string;
		}> = [];
		// 枚举全部表键（module/global/builtin 三类条目）
		const keySets: Array<[string, string]> = [];
		for (const k of Object.keys(pack.impureModules))
			keySets.push(["impureModules", k]);
		for (const k of Object.keys(pack.pureModules))
			keySets.push(["pureModules", k]);
		for (const k of Object.keys(pack.impureGlobals))
			keySets.push(["impureGlobals", k]);
		for (const k of pack.pureGlobals) keySets.push(["pureGlobals", k]);
		for (const k of Object.keys(pack.impureBuiltins))
			keySets.push(["impureBuiltins", k]);
		for (const k of pack.pureBuiltins) keySets.push(["pureBuiltins", k]);
		// frameworkPure 成员级白名单（迭代32）：纯侧命中槽位 pure:<obj>.<member>——纳入枚举使使用率报告可见命中
		for (const [obj, memberMap] of Object.entries(pack.frameworkPure ?? {}))
			for (const [member] of Object.entries(memberMap))
				keySets.push(["frameworkPure", `${obj}.${member}`]);

		let hits = 0;
		let corpusInactive = 0;
		let consultedButMiss = 0;
		let provablyDead = 0;
		for (const [table, key] of keySets) {
			const slot =
				table === "frameworkPure"
					? `pure:${key}` // 迭代30：纯前缀命中槽位 pure:<obj>.<prefix>
					: table.startsWith("impureModules") || table.startsWith("pureModules")
						? `module:${key.replace(/^node:/, "")}`
						: table.includes("Globals") || table.includes("Builtins")
							? `${table.includes("Globals") ? "global" : "builtin"}:${key}`
							: `module:${key}`;
			const h = hit.get(`${packName}\u0000${slot}`) ?? 0; // 迭代33 TP4：分语言记账（link.ts pack 前缀键）
			const m = miss.get(`${packName}\u0000${slot}`) ?? 0;
			const consulted = h + m;
			// provably-dead 判定
			let evidence: string | undefined;
			if (
				table === "pureModules" ||
				table === "pureGlobals" ||
				table === "pureBuiltins"
			) {
				const impureSide =
					table === "pureModules"
						? pack.impureModules
						: table === "pureGlobals"
							? pack.impureGlobals
							: pack.impureBuiltins;
				const r = impureSide[key as never];
				if (typeof r === "string") evidence = "P1"; // 同键 impure 为 string 效应 → pure 不可达
			}
			if (
				!evidence &&
				(table === "impureModules" || table === "pureModules") &&
				/^(\.\/|\.\.\/|node:)/.test(key)
			) {
				evidence = /^node:/.test(key) ? "P2" : "P4";
			}
			if (h > 0) {
				hits++;
				entries.push({
					table,
					key,
					consulted,
					hits: h,
					miss: m,
					status: "hit",
				});
			} else if (evidence) {
				provablyDead++;
				entries.push({
					table,
					key,
					consulted,
					hits: 0,
					miss: m,
					status: "provably-dead",
					evidence,
				});
			} else if (m > 0) {
				consultedButMiss++;
				entries.push({
					table,
					key,
					consulted,
					hits: 0,
					miss: m,
					status: "consulted-but-miss",
				});
			} else {
				corpusInactive++;
				entries.push({
					table,
					key,
					consulted: 0,
					hits: 0,
					miss: 0,
					status: "corpus-inactive",
				});
			}
		}
		// missSlots（咨询未中槽位——绝大多数非表条目 = 补表候选）
		// 迭代33 TP4：miss 键带 pack 前缀（link.ts `${pk}\u0000${slot}`）——必须按当前 pack 过滤，
		// 否则每个 pack 行都显示全部语言的 miss（纯 C# 语料下 python 行也显示 36041 误导）。
		const prefix = `${packName}\u0000`;
		// 迭代34 独立审计 Low：旧 `module:... === ""` 恒假死逻辑已删除——保留全部未中槽位为补表候选
		// （原"排除已枚举键"意图会误伤：miss 键可能与枚举槽位同名但形态不同，宁多不少）。
		const missSlots = [...miss.entries()]
			.filter(([slot]) => slot.startsWith(prefix))
			.map(([slot, n]) => ({ slot: slot.slice(prefix.length), miss: n }))
			.filter((item) => item.miss > 0)
			.sort((a, b) => b.miss - a.miss);
		const missSites = missSlots.reduce((s, x) => s + x.miss, 0);
		out.push({
			pack: packName,
			summary: {
				entries: entries.length,
				hits,
				corpusInactive,
				consultedButMiss,
				provablyDead,
				missSites,
			},
			entries,
			missSlots,
		});
	}
	return out;
}
