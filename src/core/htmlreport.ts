import type { Verdict, ScanStats } from "./types";
import { UNKNOWN_TARGET } from "./types";
import { graphMetrics, reverseDepCounts } from "./topology";
import { dependencySkeleton, bridgesOf } from "./skeleton";
import { moduleSummary } from "./module";
import { tarjan } from "./tarjan";
import { proofCompleteness } from "./proof";
import { duplicateGroups, testCoverage, deadChunks } from "./gov";
import { stateCouplingOf } from "./state";
import { moduleGraph, renderModuleGraphPanel } from "./depgraph";

/**
 * 技术债 HTML 可视化（迭代49 插件化：通用报告渲染器；迭代50 全量纲补全；
 * 迭代57 接入治理派生能力：证明完整度/测试盲区/重复代码/死代码/状态耦合 + stats 元数据）。
 * 纯函数：verdicts + stats → 自包含单文件 HTML（零依赖、无 CDN、数据内嵌）。
 * 全部量纲独立可视化（迭代48 纪律：量纲不混合，各视图各自排序）：
 *   健康度卡片 / 拓扑健康度（密度/深度/自环/层分布/链分布/图完整度）/ 模块级 /
 *   治理清单 / 纠缠环（可规约性）/ 桥与割点（模块边界）/ 骨架差异（最小化）/
 *   圈复杂度 / 未知形态 / 效应源 / 证明完整度（Θ/标注预算序）/ 治理派生三视图
 *   （测试盲区/重复代码/疑似死代码）/ 状态耦合。
 */
export function renderTechdebtHtml(
	verdicts: readonly Verdict[],
	stats: { files: number; cycles: number } & Partial<
		Pick<
			ScanStats,
			| "skippedFiles"
			| "parseErrors"
			| "annotationRejected"
			| "annotationUnmatched"
			| "impureApplied"
			| "staleEdges"
			| "invariantViolations"
			| "provenance"
		>
	>,
	opts: {
		title?: string;
		sub?: string;
		/** 扫描元数据（会话实证：报告头部用 new Date() 显示生成时间而非扫描时间，
		 * agent 无法分辨多份报告哪次扫描——root/时间/版本/缓存命中应随报告固化）。 */
		scannedAt?: string;
		version?: string;
		cachedFiles?: number;
	} = {},
): string {
	const esc = (s: string): string =>
		String(s)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	const g = graphMetrics(verdicts);
	const sk = dependencySkeleton(verdicts);
	const br = bridgesOf(verdicts);
	const mods = moduleSummary(verdicts);

	// 治理 top（限定名聚合——迭代53 审计：并集边 P1-3 下同一限定名的重载共享同一批调用点，
	// 逐 chunk 计数会把 `new ApiException(...)` 的 414 个调用者重复计到每个重载上，展示成
	// 6+1 行同值噪音（InitDeity 实证 7/25 槽位同一构造器）。聚合键 = 限定名，计数 = 引用
	// 该名的调用者数（去重：一个调用者同时命中族内多候选只计 1）。
	const qOf = new Map<string, string>();
	for (const v of verdicts) qOf.set(v.chunk.key, v.chunk.name);
	const inDeg = new Map<string, number>();
	for (const v of verdicts)
		for (const t of v.chunk.calls)
			if (t !== UNKNOWN_TARGET) inDeg.set(t, (inDeg.get(t) ?? 0) + 1);
	const inDegQ = new Map<string, number>();
	for (const v of verdicts) {
		const seen = new Set<string>();
		for (const t of v.chunk.calls) {
			if (t === UNKNOWN_TARGET) continue;
			const q = qOf.get(t);
			if (q && !seen.has(q)) {
				seen.add(q);
				inDegQ.set(q, (inDegQ.get(q) ?? 0) + 1);
			}
		}
	}
	// 迭代55：per-chunk 逆向依赖边（与主方向相反的路径——环内边+自环），组内取 max（与 CLI 治理排序同键）
	const revQ = new Map<string, number>();
	const rev = reverseDepCounts(verdicts);
	for (const v of verdicts) {
		const q = qOf.get(v.chunk.key)!;
		const r = rev.get(v.chunk.key) ?? 0;
		if (r > 0) revQ.set(q, Math.max(revQ.get(q) ?? 0, r));
	}
	const govGroups = new Map<
		string,
		{ name: string; count: number; chain: number; files: Set<string> }
	>();
	// 先数全族大小（含 PURE——"重载数"标注应是族客观大小，不含则误导：Awaiter.GetResult
	// 10 个 chunk 中 4 个 PURE，治理只列非纯 6 个，标"6 重载"是错的）
	const famSize = new Map<string, number>();
	for (const v of verdicts) {
		const q = qOf.get(v.chunk.key)!;
		famSize.set(q, (famSize.get(q) ?? 0) + 1);
	}
	for (const v of verdicts) {
		if (v.purity === 0) continue;
		const q = qOf.get(v.chunk.key)!;
		const g = govGroups.get(q) ?? {
			name: q,
			count: famSize.get(q) ?? 1,
			chain: 0,
			files: new Set<string>(),
		};
		g.chain = Math.max(g.chain, v.chain === Infinity ? 0 : (v.chain ?? 0));
		g.files.add(v.chunk.file.split("/").pop() ?? v.chunk.file);
		govGroups.set(q, g);
	}
	const gov = [...govGroups.values()]
		.sort(
			(a, b) =>
				(revQ.get(b.name) ?? 0) - (revQ.get(a.name) ?? 0) || // 迭代55：逆向依赖优先（与 CLI 治理序一致）
				(inDegQ.get(b.name) ?? 0) - (inDegQ.get(a.name) ?? 0) ||
				b.chain - a.chain,
		)
		.slice(0, 25);

	const complex = verdicts
		.filter((v) => v.chunk.kind !== "class" && (v.chunk.complexity ?? 0) > 5)
		.sort((a, b) => (b.chunk.complexity ?? 0) - (a.chunk.complexity ?? 0))
		.slice(0, 20);

	const shapes = new Map<string, number>();
	for (const v of verdicts)
		for (const uc of v.chunk.unknownCalls ?? []) {
			const k = `${uc.attr}·${uc.root}`;
			shapes.set(k, (shapes.get(k) ?? 0) + 1);
		}
	const shapeTop = [...shapes.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 12);
	const shapeMax = shapeTop[0]?.[1] ?? 1;
	const govMax = Math.max(...gov.map((v) => inDegQ.get(v.name) ?? 0), 1);
	const cMax = Math.max(...complex.map((v) => v.chunk.complexity ?? 0), 1);
	const n = verdicts.length;
	const pure = verdicts.filter((v) => v.purity === 0).length;
	const impure = verdicts.filter((v) => v.purity === 2).length;
	const unknown = n - pure - impure;

	// —— 纠缠环（可规约性：多入口 SCC 成员）——
	const byKey = new Map(verdicts.map((v) => [v.chunk.key, v]));
	const edgeSet = new Map<string, ReadonlySet<string>>();
	for (const v of verdicts) {
		edgeSet.set(
			v.chunk.key,
			new Set(
				[...v.chunk.calls].filter((t) => {
					if (t === UNKNOWN_TARGET || t === v.chunk.key) return false;
					const tv = byKey.get(t);
					if (!tv) return false;
					// 迭代52：同名族（重载/同名重定义）内部调用 = 自环口径——重载星形委托
					// 的并集边自连不构成纠缠环（真实方法环不受影响：限定名不同）。
					const vn = v.chunk.name;
					if (typeof vn === "string" && vn.length > 0 && vn === tv.chunk.name)
						return false;
					return true;
				}),
			),
		);
	}
	const comps = tarjan(
		verdicts.map((v) => v.chunk.key),
		edgeSet,
	);
	const compOf = new Map<string, number>();
	comps.forEach((comp, c) => comp.forEach((k) => compOf.set(k, c)));
	// 多入口环：SCC>1 且外部调用者进入 >1 个不同成员。P1-1 修正（迭代51 审计）：
	// 保留全量成员用于影响计算（impact = entries × 全量长度），展示层再截断（避免排序键被截断污染）。
	const entangled: { comp: string[]; size: number; entries: number }[] = [];
	for (let c = 0; c < comps.length; c++) {
		const comp = comps[c]!;
		if (comp.length <= 1) continue;
		const members = new Set(comp);
		const extEntry = new Set<string>();
		for (const v of verdicts) {
			if (members.has(v.chunk.key)) continue;
			for (const t of v.chunk.calls) if (members.has(t)) extEntry.add(t);
		}
		if (extEntry.size > 1)
			entangled.push({
				comp: comp.slice(0, 6),
				size: comp.length,
				entries: extEntry.size,
			});
	}
	entangled.sort((a, b) => b.entries * b.size - a.entries * a.size);
	const nameOf = (k: string): string => byKey.get(k)?.chunk.name ?? k;

	// —— 真实传播深度（用户修正判据：chain 是"最近效应源最短距离"（源密集时恒小），
	// 真实治理优先级 = 效应源传染到最远调用者的深度。方向：k 调用 tc ⇒ tc 效应传 k，
	// depth[k] = max(1 + depth[tc]) over tc ∈ succ[k]（被调用者先算——tarjan 契约 callee 下标更小）——
	const succ: Set<number>[] = comps.map(() => new Set());
	comps.forEach((s, k) => {
		for (const i of s)
			for (const t of edgeSet.get(i)!) {
				const tc = compOf.get(t)!;
				if (tc !== k) succ[k]!.add(tc);
			}
	});
	// 效应源分量 = **直接效应**（direct 非空）——传播深度语义：真实副作用从产生点传染多远。
	// 注意：不含 audit ? 源（calls 含 UNKNOWN_TARGET）——`?` 是知识缺失（公理3 悲观判定用），
	// 不是效应产生点；若计入，12087 个含未知调用的 chunk 全成源，传播链被截浅（用户质疑实证：
	// 含 ? 源 max=3，仅 direct 源 max=6）。
	const isSource = new Array<boolean>(comps.length).fill(false);
	for (const v of verdicts) {
		const k = compOf.get(v.chunk.key)!;
		if ((v.chunk.direct?.size ?? 0) > 0) isSource[k] = true;
	}
	// depth[c] = 效应源传染到 c 的最大深度（-1 = 不可达/纯）；via[c] = 深度来源分量（路径重构）
	// P1-2 修正（迭代51 审计）：源分量**不跳过**传播——副作用函数调用副作用函数是常态
	//（src1(io)→src2(io)→X 真深度 3），isSource 强制 0 会把源→源链截断成「不经过中间源的
	// 最长源距」。depth[k] = max(0, 1 + max depth[callee])——源自身至少 0，经源链继续累加。
	const depth = new Array<number>(comps.length).fill(-1);
	const via = new Array<number>(comps.length).fill(-1);
	for (let k = 0; k < comps.length; k++) {
		if (isSource[k]) depth[k] = 0; // 源自身深度 0（传播起点）
	}
	for (let k = 0; k < comps.length; k++) {
		let best = -1;
		let bestK2 = -1;
		for (const k2 of succ[k]!) {
			if (depth[k2]! >= 0 && 1 + depth[k2]! > best) {
				best = 1 + depth[k2]!;
				bestK2 = k2;
			}
		}
		if (best >= 0 && best > depth[k]!) {
			depth[k] = best;
			via[k] = bestK2;
		}
	}
	// 最长传播链：按深度降序取 top；路径 = 源 → ... → 本 chunk（沿 via 回溯，源在前）
	const deepChainRows = verdicts
		.filter((v) => (depth[compOf.get(v.chunk.key)!] ?? -1) >= 0)
		.sort(
			(a, b) =>
				(depth[compOf.get(b.chunk.key)!] ?? -1) -
				(depth[compOf.get(a.chunk.key)!] ?? -1),
		)
		.slice(0, 15)
		.map((v) => {
			const chainKeys: string[] = [];
			let cur = compOf.get(v.chunk.key)!;
			const guard = new Set<number>();
			while (cur >= 0 && !guard.has(cur)) {
				guard.add(cur);
				chainKeys.unshift(comps[cur]![0]!);
				if (via[cur]! < 0) break;
				cur = via[cur]!;
			}
			const path = chainKeys.map((k) => nameOf(k)).join(" → ");
			const d = depth[compOf.get(v.chunk.key)!] ?? 0;
			return `<div class="bar-row"><div class="bar-label" style="width:34%">${esc(v.chunk.name)} <span style="color:var(--dim)">· ${esc(v.chunk.file.split("/").pop() ?? "")}</span></div>
  <div class="bar-track" style="background:transparent"><div class="chain-path">${esc(path)}</div></div>
  <div class="bar-val">${d} 跳</div></div>`;
		})
		.join("");
	const maxPropDepth = Math.max(
		...verdicts.map((v) => depth[compOf.get(v.chunk.key)!] ?? -1),
	);

	// —— 桥清单（模块边界：唯一通道 from→to 分量代表）——
	const bridgeRows = br.bridges
		.map((e) => ({
			from: nameOf(e.from),
			to: nameOf(e.to),
			impact: (inDeg.get(e.from) ?? 0) + (inDeg.get(e.to) ?? 0),
		}))
		.sort((a, b) => b.impact - a.impact)
		.slice(0, 15);
	// 割点枢纽按调用者数排序
	const artRows = br.articulationPoints
		.map((k) => ({ name: nameOf(k), callers: inDeg.get(k) ?? 0 }))
		.sort((a, b) => b.callers - a.callers)
		.slice(0, 15);

	// —— 拓扑治理优先级（三类结构热点各自按影响面排序 + 动作建议；量纲不混合）——
	// 模块级有向边图（迭代58：全项目聚合图——逆行边红色高亮）
	// 主图 = 第一方口径（第三方折叠为单桶，逆行边 = 第一方可解耦的真实环）；
	// 全量口径单独取逆行 top 列表（第三方互环只可升级不可重构）
	const modGraph = moduleGraph(verdicts, { firstPartyOnly: true });
	const modGraphAll = moduleGraph(verdicts);
	const modRevAll = modGraphAll.edges
		.filter((e) => e.reverse)
		.slice(0, 8)
		.map(
			(e) =>
				`<div class="bar-row"><div class="bar-label" style="width:44%">${esc(e.from)} ⇄ ${esc(e.to)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(Math.round((e.count / Math.max(...modGraphAll.edges.map((x) => x.count), 1)) * 100), 1)}%;background:var(--imp)"></div></div><div class="bar-val">×${e.count}</div></div>`,
		)
		.join("");
	// 纠缠环：影响 = 入口数 × 环成员数（解耦收益 = 打断多少个外部入口 × 环体量）
	const ringRows = entangled
		.map((e) => ({
			names: e.comp.map((k) => nameOf(k)),
			entries: e.entries,
			impact: e.entries * e.size, // P1-1：全量成员数（非展示截断后长度）
		}))
		.sort((a, b) => b.impact - a.impact)
		.slice(0, 10);
	const bridgeMax = Math.max(...bridgeRows.map((b) => b.impact), 1);
	const artMax = Math.max(...artRows.map((a) => a.callers), 1);

	// —— 骨架差异（最小化：全边 vs 骨架——传递冗余揭示）——
	const knownTotal = verdicts.reduce(
		(sum, v) =>
			sum + [...v.chunk.calls].filter((t) => t !== UNKNOWN_TARGET).length,
		0,
	);
	const redundant = Math.max(knownTotal - sk.length, 0);

	const bar = (
		label: string,
		value: number,
		max: number,
		color: string,
	): string => {
		const pct = max > 0 ? Math.round((value / max) * 100) : 0;
		return `<div class="bar-row"><div class="bar-label">${label}</div>
  <div class="bar-track"><div class="bar-fill" style="width:${Math.max(pct, 1)}%;background:${color}"></div></div>
  <div class="bar-val">${value}</div></div>`;
	};
	const seg = (
		label: string,
		parts: [number, number, number],
		total: number,
	): string => {
		const w = total > 0 ? Math.round((parts[0] / total) * 100) : 0;
		const wu = total > 0 ? Math.round((parts[1] / total) * 100) : 0;
		return `<div class="bar-row"><div class="bar-label">${esc(label)}</div>
  <div class="bar-track seg">
    <div class="seg-pure" style="width:${w}%"></div>
    <div class="seg-unk" style="width:${wu}%"></div>
    <div class="seg-imp" style="width:${Math.max(100 - w - wu, 0)}%"></div>
  </div><div class="bar-val">${parts[0]}/${parts[1]}/${parts[2]}</div></div>`;
	};
	const card = (
		label: string,
		value: number | string,
		sub: string,
		color: string,
	): string =>
		`<div class="card"><div class="card-label">${label}</div><div class="card-val" style="color:${color}">${value}</div><div class="card-sub">${sub}</div></div>`;

	const sources = verdicts
		.filter(
			(v) => v.purity === 2 && v.chain === 0 && (v.chunk.direct?.size ?? 0) > 0,
		)
		.sort((a, b) => b.chunk.calls.size - a.chunk.calls.size)
		.slice(0, 15);

	// —— 迭代57 接入治理派生能力（全部复用 verdicts 数据，零新增扫描）——
	// 标注证明完整度：非加权 = annotationCurve 同口径 O(n) 廉价（加权需对每个 UNKNOWN
	// chunk 跑 forwardClosure，大项目开销高，报告不启用）。
	const proof = proofCompleteness(verdicts, { targetTheta: 0.95 });
	const proofBudget =
		proof.budgetToTarget === null
			? "∞（不可达）"
			: `${proof.budgetToTarget} 个`;
	// 治理派生三视图（迭代56：测试盲区/重复代码/疑似死代码）
	const tc = testCoverage(verdicts);
	const dupsAll = duplicateGroups(verdicts);
	const dups = dupsAll.slice(0, 15);
	const deadAll = deadChunks(verdicts);
	// 展示序：高置信（静态图确定无引用）优先，再按文件/行——与 CLI 的文件序不同（HTML 是治理视角）
	const dead = [...deadAll]
		.sort(
			(a, b) =>
				(a.confidence === "high" ? 0 : 1) - (b.confidence === "high" ? 0 : 1) ||
				a.file.localeCompare(b.file) ||
				a.line - b.line,
		)
		.slice(0, 15);
	// 状态耦合（迭代23 D-127：写方按读者数——"哪个写方扩散面最大"）
	const stateTop = stateCouplingOf(verdicts).slice(0, 15);
	const annotated = verdicts.filter((v) => v.provenance === "annotated").length;
	const derived = verdicts.filter((v) => v.provenance === "derived").length;
	const chainUncertain = verdicts.filter((v) => !v.chainCertain).length;
	const tcMax = Math.max(...tc.uncovered.map((u) => u.callers), 1);
	const scMax = Math.max(...stateTop.map((s) => s.readers), 1);

	// —— 预渲染新分区（避免 return 大模板内深层嵌套）——
	const warnItems: string[] = [];
	if (stats.parseErrors)
		warnItems.push(
			`${stats.parseErrors} 个文件解析失败（tree-sitter 错误恢复可能吞边）`,
		);
	if (stats.skippedFiles)
		warnItems.push(`${stats.skippedFiles} 个文件跳过（大小超限/读取失败）`);
	if (stats.staleEdges)
		warnItems.push(`${stats.staleEdges} 条陈旧调用边（缓存漂移——图不完整）`);
	if (stats.invariantViolations)
		warnItems.push(`${stats.invariantViolations} 处传播不变量违规`);
	if ((stats.annotationRejected ?? []).length > 0)
		warnItems.push(
			`${stats.annotationRejected!.length} 条标注被拒（PURE 标注未生效）`,
		);
	if ((stats.annotationUnmatched ?? []).length > 0)
		warnItems.push(
			`${stats.annotationUnmatched!.length} 条标注未匹配（内容已变/拼写错误）`,
		);
	const warnPanel =
		warnItems.length === 0
			? ""
			: `<div class="panel" style="border-color:var(--imp);margin-top:10px"><h3 style="color:var(--imp)">⚠ 扫描警告</h3>${warnItems
					.map((w) => `<div class="sub">· ${esc(w)}</div>`)
					.join("")}</div>`;

	const proofSection = `<h2>标注证明完整度（Θ = 1 − 剩余 UNKNOWN/总数——会计层可验证性）</h2>
<div class="panel">
<h3>标注优先序 top 15（未知 chunk 按影响面贪心序——次模近似，非最小集）</h3>
${
	proof.order
		.slice(0, 15)
		.map((k) => `<span class="chip">${esc(nameOf(k))}</span>`)
		.join(" ") || '<div class="sub">无未知 chunk——全部已判定</div>'
}
<div class="sub" style="margin-top:8px">达到目标 Θ=0.95 需标注 ${proofBudget}；优先序 = 释放的 UNKNOWN 依赖数降序 → 影响面降序（公理5 确定性 tiebreak）。</div>
</div>`;

	const uncoveredRows = tc.uncovered
		.slice(0, 15)
		.map((u) =>
			bar(
				`${esc(u.name)} <span style="color:var(--dim)">· ${esc(u.file.split("/").pop() ?? "")}</span>`,
				u.callers,
				tcMax,
				"var(--acc)",
			),
		)
		.join("");
	const dupRows = dups
		.map(
			(d) =>
				`<tr><td>${esc(d.name)}</td><td>${esc(d.file)}${d.line ? `:${d.line}` : ""}</td><td>${d.instances}</td><td>${d.sites
					.slice(0, 4)
					.map(
						(s) =>
							`<span class="chip">${esc(s.file.split("/").pop() ?? s.file)}:${s.line}</span>`,
					)
					.join(
						" ",
					)}${d.sites.length > 4 ? ` <span style="color:var(--dim)">…${d.sites.length - 4}</span>` : ""}</td></tr>`,
		)
		.join("");
	const deadRows = dead
		.map(
			(d) =>
				`<tr><td><span class="badge" style="${d.confidence === "high" ? "background:#3a1f1f;color:#f85149" : "background:#2f2a1f;color:#d29922"}">${d.confidence === "high" ? "高" : "疑"}</span></td><td>${esc(d.name)}</td><td>${esc(d.file)}${d.line ? `:${d.line}` : ""}</td></tr>`,
		)
		.join("");
	const stateRows = stateTop
		.map((s) =>
			bar(
				`${esc(s.name)} <span style="color:var(--dim)">· ${esc(s.file.split("/").pop() ?? "")}</span> <span style="color:var(--dim)">写 ${esc(s.writes.join(", "))}</span>`,
				s.readers,
				scMax,
				"var(--imp)",
			),
		)
		.join("");
	const tcCoverage =
		tc.production > 0
			? `${(tc.coverage * 100).toFixed(1)}%（${tc.covered}/${tc.production}）`
			: "无生产 chunk";

	const govDerivedSection = `<h2>治理派生视图（复用 verdicts 数据 · 零新增扫描）</h2>
<div class="panel">
<h3>🧪 测试盲区（生产 chunk 未被 Tests/ 引用——覆盖 ${tcCoverage}；测试链间接引用也算覆盖）</h3>
${uncoveredRows || '<div class="sub">生产代码全部被测试链覆盖</div>'}
<div class="sub" style="margin-top:8px">动作：从调用者最多的盲区开始补测试。</div>
</div>
<div class="panel">
<h3>📋 重复代码 top 15（同内容哈希多实例 = 复制粘贴 · 公理4 · 共 ${dupsAll.length} 组）</h3>
${dups.length === 0 ? '<div class="sub">无重复代码组</div>' : `<table><tr><th>代表实例</th><th>位置</th><th>实例数</th><th>全部站点</th></tr>${dupRows}</table>`}
<div class="sub" style="margin-top:8px">动作：实例数最高的组优先合并（复制粘贴是缺陷放大因子——修一处漏 N 处）。</div>
</div>
<div class="panel">
<h3>🗑 疑似死代码 top 15（零调用者 · 共 ${deadAll.length} 条）</h3>
${dead.length === 0 ? '<div class="sub">无零调用者 chunk</div>' : `<table><tr><th>置信</th><th>函数</th><th>位置</th></tr>${deadRows}</table>`}
<div class="sub" style="margin-top:8px">high = 非 public 零调用者（静态图内确定无引用，可删）；suspected = public 零调用者（反射/外部可能引用）。已排除 Unity 生命周期/特性入口误报。</div>
</div>`;

	const stateSection = `<h2>状态耦合 top 15（写方 → 读者数——哪个写方扩散面最大）</h2>
<div class="panel">
${stateRows || '<div class="sub">无跨 chunk 状态读写链</div>'}
<div class="sub" style="margin-top:8px">盲区只漏报不假报（下标写/调用结果写不可见）；零读者写方不列。动作：读者最多的写方改造成不可变/局部状态。</div>
</div>`;

	// 拓扑健康度：层分布/链分布/入口分布条形
	const layerMax = Math.max(
		1,
		...g.layerHistogram.filter((x): x is number => typeof x === "number"),
	); // filter 去稀疏洞（reviewer L1：Math.max(...稀疏)=NaN）
	const layerRows = g.layerHistogram
		.map((c, i) => bar(`层 ${i}`, c, layerMax, "var(--acc)"))
		.filter((_, i) => g.layerHistogram[i]! > 0)
		.join("");
	const chainMax = Math.max(
		1,
		...g.chainHistogram.filter((x): x is number => typeof x === "number"),
		g.chainInf,
	);
	const chainRows =
		g.chainHistogram
			.map((c, i) => bar(`chain=${i}`, c, chainMax, "var(--fg)"))
			.join("") + bar("chain=∞(PURE)", g.chainInf, chainMax, "var(--pure)");
	const entryMax = Math.max(
		1,
		...g.sccEntryHistogram.filter((x): x is number => typeof x === "number"),
	);
	const entryRows = g.sccEntryHistogram
		.map((c, i) => bar(`入口 ${i}`, c ?? 0, entryMax, "var(--unk)"))
		.join("");

	return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title ?? "codeaudit 技术债报告")}</title>
<style>
:root{--bg:#0f1419;--panel:#1a2129;--panel2:#222c36;--fg:#e6edf3;--dim:#8b98a5;--pure:#3fb950;--unk:#d29922;--imp:#f85149;--acc:#58a6ff;--br:#303a44}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;padding:24px;max-width:1100px;margin:0 auto}
h1{font-size:20px;margin-bottom:4px}h2{font-size:15px;margin:28px 0 10px;color:var(--acc);border-bottom:1px solid var(--br);padding-bottom:6px}
h3{font-size:13px;margin:16px 0 6px;color:var(--fg)}
.sub{color:var(--dim);font-size:12px;margin-bottom:18px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.card{background:var(--panel);border:1px solid var(--br);border-radius:8px;padding:12px 14px}
.card-label{color:var(--dim);font-size:11px;text-transform:uppercase;letter-spacing:.5px}
.card-val{font-size:26px;font-weight:700;margin:4px 0 2px}
.card-sub{color:var(--dim);font-size:11px}
.panel{background:var(--panel);border:1px solid var(--br);border-radius:8px;padding:14px 16px;margin-top:10px}
.bar-row{display:flex;align-items:center;gap:10px;margin:6px 0}
.bar-label{width:38%;font-size:12px;color:var(--fg);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-track{flex:1;background:var(--panel2);border-radius:4px;height:14px;overflow:hidden}
.bar-track.ring{height:auto;overflow:visible;background:transparent;display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:2px 0}
.bar-fill{height:100%;border-radius:4px}
.bar-val{width:70px;text-align:right;font-size:12px;color:var(--dim);white-space:nowrap}
.seg{display:flex}.seg-pure{background:var(--pure);height:100%}.seg-unk{background:var(--unk);height:100%}.seg-imp{background:var(--imp);height:100%}
table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}
th{color:var(--dim);text-align:left;font-weight:600;padding:6px 8px;border-bottom:1px solid var(--br);font-size:11px;text-transform:uppercase}
td{padding:6px 8px;border-bottom:1px solid var(--br);color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:340px}
.badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;margin-right:4px}
.b-io{background:#1f3a5f;color:#79c0ff}.b-state{background:#3a2f1f;color:#e3b341}.b-net{background:#2f3a1f;color:#a3d977}
.b-clock{background:#3a1f2f;color:#f778ba}.b-fs{background:#2f243a;color:#d2a8ff}.b-random{background:#333;color:#bbb}
.pure{color:var(--pure)}.unk{color:var(--unk)}.imp{color:var(--imp)}
.legend{display:flex;gap:16px;color:var(--dim);font-size:12px;margin-top:8px}
.legend span{display:flex;align-items:center;gap:5px}.dot{width:10px;height:10px;border-radius:2px;display:inline-block}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:16px}
@media(max-width:800px){.two-col{grid-template-columns:1fr}}
.chip{display:inline-block;background:var(--panel2);border:1px solid var(--br);border-radius:4px;padding:2px 8px;margin:3px;font-size:11px;color:var(--fg)}
.chain-path{font-size:11px;color:var(--dim);font-family:ui-monospace,Consolas,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body>
<h1>${esc(opts.title ?? "codeaudit 技术债报告")}</h1>
<div class="sub">${esc(opts.sub ?? "")} · ${n} chunks · ${stats.files} 文件 · ${esc(String(stats.cycles))} 环 · ${esc(opts.scannedAt ?? new Date().toISOString().slice(0, 19))}${opts.version ? ` · v${esc(opts.version)}` : ""}${opts.cachedFiles !== undefined ? ` · 缓存命中 ${esc(String(opts.cachedFiles))} 文件` : ""}</div>

<h2>健康度总览</h2>
<div class="grid">
${card("Chunks", n, "可判定单元", "var(--fg)")}
${card("PURE", pure, `${((pure / n) * 100).toFixed(1)}%`, "var(--pure)")}
${card("IMPURE", impure, `${((impure / n) * 100).toFixed(1)}% 有确定副作用`, "var(--imp)")}
${card("UNKNOWN", unknown, `${((unknown / n) * 100).toFixed(1)}% 无法判定`, "var(--unk)")}
${card("图完整度", `${(100 * (1 - g.evidence.missingSiteRate)).toFixed(1)}%`, `未知站点 ${g.unknownEdges}`, "var(--acc)")}
${card(
	"结构形态",
	(() => {
		const r = g.knownEdges > 0 ? br.bridges.length / g.knownEdges : 1;
		return r > 0.7 ? "近树" : r < 0.3 ? "网状" : "混合";
	})(),
	`桥比例 ${g.knownEdges > 0 ? ((br.bridges.length / g.knownEdges) * 100).toFixed(0) : "100"}%（唯一通道占比——树=100%，低=多替代路径）`,
	"var(--acc)",
)}
${card("深度", g.dagDepth, "凝聚 DAG 最长路径", "var(--acc)")}
${card("自递归", g.selfLoopCount, "自我调用 chunk", "var(--acc)")}
${card("证明完整度 Θ", `${(proof.theta * 100).toFixed(1)}%`, `达到 95% 还需 ${proofBudget}`, "var(--pure)")}
${card("标注台账", `${annotated} 生效 / ${derived} 派生`, "PURE 判定来源（其余为 static 机器证明）", "var(--acc)")}
${card("链不确定", chainUncertain, "结论依赖未知符号——标注工作输入", "var(--unk)")}
</div>
${warnPanel}

<h2>拓扑健康度</h2>
<div class="panel">
<div class="grid" style="margin-bottom:12px">
${card("环 SCC", g.cyclicComponents, `${g.multiEntryScc} 多入口纠缠(${Math.round((g.multiEntryScc / Math.max(g.cyclicComponents, 1)) * 100)}%)`, "var(--acc)")}
${card("桥边", br.bridges.length, "模块唯一通道", "var(--acc)")}
${card("割点", br.articulationPoints.length, "必经枢纽", "var(--acc)")}
${card("骨架边", sk.length, `全边 ${knownTotal} − 传递冗余 ${redundant}`, "var(--acc)")}
</div>
<div class="two-col">
<div><h3>层分布（调用深度）</h3>${layerRows}</div>
<div><h3>效应链分布（chain）</h3>${chainRows}</div>
</div>
<h3>SCC 入口分布（可规约性——入口=1 结构化递归，>1 纠缠递归）</h3>
${entryRows}
</div>

<h2>模块级（PURE/UNKNOWN/IMPURE 分段 · top 10）</h2>
<div class="panel">
${mods
	.slice(0, 10)
	.map((m) => seg(m.module, [m.pure, m.unknown, m.impure], m.chunks))
	.join("")}
<div class="legend"><span><i class="dot" style="background:var(--pure)"></i>PURE</span><span><i class="dot" style="background:var(--unk)"></i>UNKNOWN</span><span><i class="dot" style="background:var(--imp)"></i>IMPURE</span></div>
</div>
<h2>长传播链 top 15（治理最优先——效应源传染到最远调用者的深度，项目最大 ${maxPropDepth} 跳；chain 只是"最近源距离"非传播深度）</h2>
<div class="panel">
${deepChainRows.length === 0 ? '<div class="sub">无非纯传播链</div>' : deepChainRows}
</div>

<h2>治理清单 top 25（量纲：直接调用者数（限定名聚合——同名重载族计一次，去重引用）——被最多人引用的非纯优先）</h2>
<div class="panel">
${gov.map((v) => bar(`${esc(v.name)} ${v.count > 1 ? `<span style="color:var(--dim)">· ${v.count} 重载</span>` : ""} <span style="color:var(--dim)">· ${esc([...v.files].slice(0, 2).join(", "))}</span> <span style="color:var(--dim)">· 最近源 ${v.chain} 跳</span>`, inDegQ.get(v.name) ?? 0, govMax, "var(--imp)")).join("")}
</div>

${renderModuleGraphPanel(modGraph)}
${modRevAll ? `<div class="panel"><h3>全量口径逆行边 top（含第三方——只可升级不可重构，解耦价值低）</h3>${modRevAll}</div>` : ""}

<h2>拓扑治理优先级（结构热点 → 动作清单 · 量纲各自排序不混合）</h2>

<h2>拓扑治理优先级（结构热点 → 动作清单 · 量纲各自排序不混合）</h2>
<div class="panel">
<h3>🔗 纠缠环优先解耦序（影响 = 外部入口数 × 环成员数——打断哪个环收益最大）</h3>
${
	ringRows.length === 0
		? '<div class="sub">无多入口纠缠环</div>'
		: ringRows
				.map(
					(r) =>
						`<div class="bar-row"><div class="bar-label" style="width:44%">${r.entries} 入口 × ${r.names.length} 成员</div><div class="bar-track ring">${r.names.map((nm) => `<span class="chip">${esc(nm)}</span>`).join(" ")}</div><div class="bar-val">影响 ${r.impact}</div></div>`,
				)
				.join("")
}
<div class="sub" style="margin-top:8px">动作：从影响最大的环开始解耦——收敛为单入口（结构化递归）或打断环。（同名重载族/方法组实参边已过滤——iter52/53 伪影防护；此处为真实递归）</div>
</div>
<div class="panel">
<h3>🛡 桥边优先保护序（影响 = 两端调用者合计——哪个唯一通道断裂波及最大）</h3>
${
	bridgeRows.length === 0
		? '<div class="sub">无桥边</div>'
		: bridgeRows
				.map(
					(b) =>
						`<div class="bar-row"><div class="bar-label" style="width:44%">${esc(b.from)} → ${esc(b.to)}</div><div class="bar-track">${b.impact > 0 ? `<div class="bar-fill" style="width:${Math.max(Math.round((b.impact / bridgeMax) * 100), 1)}%;background:var(--acc)"></div>` : ""}</div><div class="bar-val">影响 ${b.impact}</div></div>`,
				)
				.join("")
}
<div class="sub" style="margin-top:8px">动作：从影响最大的桥开始补契约测试/版本兼容——改桥两端前先跑影响面（--changed）。</div>
</div>
<div class="panel">
<h3>🎯 割点优先评审序（按调用者数——哪个必经枢纽改动风险最大）</h3>
${
	artRows.length === 0
		? '<div class="sub">无割点</div>'
		: artRows
				.map(
					(a) =>
						`<div class="bar-row"><div class="bar-label" style="width:44%">${esc(a.name)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(Math.round((a.callers / artMax) * 100), 1)}%;background:var(--imp)"></div></div><div class="bar-val">${a.callers} callers</div></div>`,
				)
				.join("")
}
<div class="sub" style="margin-top:8px">动作：从调用者最多的割点开始——代码评审从严、改动跑全量回归。</div>
</div>

<h2>圈复杂度 top 20</h2>
<div class="panel">
${complex.map((v) => bar(`${esc(v.chunk.name)} <span style="color:var(--dim)">· ${esc(v.chunk.file.split("/").pop() ?? "")}</span>`, v.chunk.complexity ?? 0, cMax, v.purity === 2 ? "var(--imp)" : v.purity === 1 ? "var(--unk)" : "var(--pure)")).join("")}
</div>

<h2>未知点形态 top 12（标注工作流输入）</h2>
<div class="panel">
${shapeTop.map(([k, n2]) => bar(esc(k), n2, shapeMax, "var(--unk)")).join("")}
</div>

<h2>效应源（背锅者 top 15——chain=0 直接引入副作用）</h2>
<div class="panel">
<table><tr><th>函数</th><th>位置</th><th>效应</th><th>调用点</th><th>圈复杂度</th></tr>
${sources.map((v) => `<tr><td>${esc(v.chunk.name)}</td><td>${esc(v.chunk.file)}${v.chunk.line ? `:${v.chunk.line}` : ""}</td><td>${[...v.effects].map((e) => `<span class="badge b-${esc(e)}">${esc(e)}</span>`).join("")}</td><td>${v.chunk.calls.size}</td><td>${v.chunk.complexity ?? "—"}</td></tr>`).join("")}
</table>
</div>

${proofSection}

${govDerivedSection}

${stateSection}

<div class="sub" style="margin-top:24px">codeaudit renderTechdebtHtml · 全量纲独立可视化不混合 · 数据内嵌零外部依赖</div>
</body></html>`;
}
