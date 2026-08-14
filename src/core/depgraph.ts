// 模块级聚合有向图（迭代58：全项目有向边可视化——逆行边/环内边红色高亮，一眼看懂依赖反向）
// 聚合口径：chunk 级调用边 → 模块级（目录前缀）；模块键从 chunk.file 提取。
// 逆行边 = 聚合图 SCC>1 环内边（同分量内互相依赖——真实逆向依赖）+ 自环单列计数。
// 纯函数：verdicts → SVG 字符串；零依赖（复用 core/tarjan.ts）。
import type { Verdict } from "./types";
import { tarjan } from "./tarjan";

/** 模块键：文件路径 → 聚合模块。第一方按 Assets/<一级>/<二级>，第三方按顶层。 */
export function moduleKeyOf(file: string): string {
	const norm = file.replace(/\\/g, "/");
	const parts = norm.split("/");
	if (parts.length < 2) return norm;
	const p0 = parts[0]!, p1 = parts[1]!;
	if (p0 === "Assets") {
		if (p1 === "InitDeity") {
			if (parts.length < 3) return "InitDeity";
			const p2 = parts[2]!;
			// 直接挂 InitDeity 根的文件（xx.cs）归 InitDeity 本体
			if (p2.includes(".")) return "InitDeity";
			// 测试并入统一桶（避免 Tests/Editor 与 Tests/PlayMode 碎片化）
			if (p2 === "Tests") return "InitDeity/Tests";
			return `InitDeity/${p2}`;
		}
		if (p1 === "Plugins") return parts.length >= 3 ? `Plugins/${parts[2]!}` : "Plugins";
		return p1; // ChillyRoomSdkClient / CosmosBootstrap / CosmosFramework / Editor / Resources …
	}
	if (p0 === "LocalPackages") return parts.length >= 2 ? `LocalPackages/${parts[1]!}` : "LocalPackages";
	return p0; // Tools / Tests / Packages …
}

export interface ModNode {
	readonly id: string;
	readonly label: string;
	readonly chunks: number;
	readonly inDeg: number;
	readonly outDeg: number;
	/** 模块内部自调用数（self 边单列，不画线避免噪点） */
	readonly selfCalls: number;
}

export interface ModEdge {
	readonly from: string;
	readonly to: string;
	readonly count: number;
	/** 逆行边：聚合图环内边（SCC>1 成员间） */
	readonly reverse: boolean;
}

export interface ModuleGraph {
	readonly nodes: ModNode[];
	readonly edges: ModEdge[];
	/** 聚合图上的环（SCC>1）——逆行边来源 */
	readonly sccs: string[][];
}

const moduleOfKey = (key: string, idx: Map<string, string>): string | null => {
	// key 形态：file::hash[#n]——未知目标（?）或未收录 key 跳过
	const i = key.indexOf("::");
	if (i < 0) return null;
	return idx.get(key) ?? null;
};

export function moduleGraph(verdicts: readonly Verdict[], opts?: { firstPartyOnly?: boolean }): ModuleGraph {
	// 第三方折叠桶：firstPartyOnly 时 LocalPackages/Plugins/Packages/生成代码并入单节点
	// （第三方互环不可治理——折叠后逆行边只留第一方真实可解耦的环）
	const THIRD = "第三方";
	const thirdParty = (m: string): boolean =>
		m === "InitDeity/Generated" || m.startsWith("LocalPackages/") || m.startsWith("Plugins/") || m.startsWith("Packages");
	const fold = opts?.firstPartyOnly ? (m: string) => (thirdParty(m) ? THIRD : m) : (m: string) => m;

	const keyToMod = new Map<string, string>();
	for (const v of verdicts) keyToMod.set(v.chunk.key, fold(moduleKeyOf(v.chunk.file)));

	const nodes = new Map<string, { chunks: number; selfCalls: number }>();
	const edgeAgg = new Map<string, { count: number }>(); // "from\u0000to" -> count

	for (const v of verdicts) {
		const from = fold(moduleKeyOf(v.chunk.file));
		const n = nodes.get(from) ?? { chunks: 0, selfCalls: 0 };
		n.chunks++;
		nodes.set(from, n);
		const seen = new Set<string>();
		for (const c of v.chunk.calls) {
			if (seen.has(c)) continue;
			seen.add(c);
			const to = moduleOfKey(c, keyToMod);
			if (to === null || to === from) {
				if (to === from) n.selfCalls++;
				continue;
			}
			const ek = `${from}\u0000${to}`;
			const e = edgeAgg.get(ek) ?? { count: 0 };
			e.count++;
			edgeAgg.set(ek, e);
		}
	}

	// 节点数上限：超 64 把最弱节点并入 "…其他"（保持图可读）
	const MIN_CHUNKS = 3;
	const all = [...nodes.entries()].sort((a, b) => b[1].chunks - a[1].chunks);
	const keep = new Set<string>(all.filter(([, v]) => v.chunks >= MIN_CHUNKS).slice(0, 64).map(([k]) => k));
	const other: { chunks: number; selfCalls: number } = { chunks: 0, selfCalls: 0 };
	const dropped = new Set<string>();
	for (const [k, v] of nodes) {
		if (keep.has(k)) continue;
		dropped.add(k);
		other.chunks += v.chunks;
		other.selfCalls += v.selfCalls;
	}
	const nodeIds = [...keep];
	if (other.chunks > 0) {
		nodeIds.push("…其他");
		nodes.set("…其他", other);
		keyToMod.set("…其他", "…其他");
	}

	// 聚合边（跳过落入 dropped 的端点）
	const edges: Array<{ from: string; to: string; count: number }> = [];
	for (const [ek, e] of edgeAgg) {
		const [rawFrom, rawTo] = ek.split("\u0000");
		const from = rawFrom ?? "", to = rawTo ?? "";
		if (dropped.has(from) || dropped.has(to)) continue;
		edges.push({ from, to, count: e.count });
	}

	// 聚合图 SCC——环内边 = 逆行边
	const succ = new Map<string, Set<string>>();
	for (const e of edges) {
		const s = succ.get(e.from) ?? new Set<string>();
		s.add(e.to);
		succ.set(e.from, s);
	}
	const sccs = tarjan(nodeIds, succ).filter((s) => s.length > 1);
	const inRing = new Set<string>();
	for (const s of sccs) for (const m of s) inRing.add(m);

	const finalEdges = edges
		.filter((e) => e.from !== e.to)
		.map((e) => ({ ...e, reverse: inRing.has(e.from) && inRing.has(e.to) }))
		.sort((a, b) => Number(b.reverse) - Number(a.reverse) || b.count - a.count);

	const inDeg = new Map<string, number>();
	const outDeg = new Map<string, number>();
	for (const e of finalEdges) {
		outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + e.count);
		inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + e.count);
	}

	const nodeList: ModNode[] = nodeIds.map((id) => {
		const v = nodes.get(id)!;
		return { id, label: id, chunks: v.chunks, selfCalls: v.selfCalls, inDeg: inDeg.get(id) ?? 0, outDeg: outDeg.get(id) ?? 0 };
	});

	return { nodes: nodeList, edges: finalEdges, sccs };
}

const esc = (s: string): string =>
	String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** SVG 渲染：环形布局 + 贝塞尔弧线；逆行边红色粗线，正向边灰色；悬停显示明细。 */
export function renderModuleGraphSvg(g: ModuleGraph): string {
	const n = g.nodes.length;
	if (n === 0) return '<div class="sub">无模块节点</div>';
	const W = 1100, H = 760, CX = W / 2, CY = H / 2 + 10, R = Math.min(CX, CY) - 90;
	const pos = new Map<string, { x: number; y: number }>();
	// 环内模块聚簇优先排同侧（视觉上逆行边聚集）；其余按入度降序环形排布
	const ringSet = new Set(g.sccs.flat());
	const ordered = [...g.nodes].sort((a, b) => {
		const ar = ringSet.has(a.id) ? 1 : 0, br = ringSet.has(b.id) ? 1 : 0;
		return br - ar || b.outDeg + b.inDeg - (a.outDeg + a.inDeg);
	});
	ordered.forEach((node, i) => {
		const a = (i / Math.max(ordered.length, 1)) * Math.PI * 2 - Math.PI / 2;
		pos.set(node.id, { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) });
	});

	const maxCount = Math.max(...g.edges.map((e) => e.count), 1);
	const maxChunks = Math.max(...g.nodes.map((x) => x.chunks), 1);
	// 边：贝塞尔弧线，控制点沿法线偏移（区分双向）
	let edgeSvg = "";
	for (const e of g.edges) {
		const p1 = pos.get(e.from)!;
		const p2 = pos.get(e.to)!;
		const dx = p2.x - p1.x, dy = p2.y - p1.y;
		const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
		const len = Math.hypot(dx, dy) || 1;
		const off = (e.reverse ? 26 : 14) * (e.count / maxCount + 0.6);
		// 双向对边反向偏移避免重叠
		const cx2 = mx + (-dy / len) * off * (e.from < e.to ? 1 : -1);
		const cy2 = my + (dx / len) * off * (e.from < e.to ? 1 : -1);
		const w = 1 + (e.count / maxCount) * 4;
		const stroke = e.reverse ? "#e5484d" : "#8b8f98";
		const tip = `from ${esc(e.from)} → to ${esc(e.to)} × ${e.count}${e.reverse ? "（逆行：环内互相依赖——解耦优先）" : ""}`;
		const arrowEnd = `M${p2.x - (dx / len) * 10},${p2.y - (dy / len) * 10} L${p2.x - (dy / len) * 6},${p2.y + (dx / len) * 6} L${p2.x + (dy / len) * 6},${p2.y - (dx / len) * 6} Z`;
		edgeSvg += `<path d="M${p1.x.toFixed(1)},${p1.y.toFixed(1)} Q${cx2.toFixed(1)},${cy2.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${w.toFixed(1)}" opacity="0.55"><title>${tip}</title></path>`;
		edgeSvg += `<path d="${arrowEnd}" fill="${stroke}"><title>${tip}</title></path>`;
	}

	let nodeSvg = "";
	for (const node of g.nodes) {
		const p = pos.get(node.id)!;
		const r = 6 + (node.chunks / maxChunks) * 16;
		const ring = ringSet.has(node.id);
		const fill = ring ? "#e5484d" : node.selfCalls > 0 ? "#d29922" : "#4c8dff";
		const deg = `${node.outDeg}→${node.inDeg}`;
		const tip = `${esc(node.label)}\nchunks ${node.chunks} · 出→入 ${deg} · 内部调用 ${node.selfCalls}${ring ? "（环内模块）" : ""}`;
		nodeSvg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" stroke="#1a1b1e" stroke-width="1.5"><title>${tip}</title></circle>`;
		// 标签：节点下方，超出省略
		const label = node.label.length > 22 ? node.label.slice(0, 21) + "…" : node.label;
		nodeSvg += `<text x="${p.x.toFixed(1)}" y="${(p.y + r + 12).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--fg)"><title>${tip}</title>${esc(label)}</text>`;
	}

	return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:var(--panel);border-radius:8px;border:1px solid var(--br)" xmlns="http://www.w3.org/2000/svg">
<g>${edgeSvg}</g>
<g>${nodeSvg}</g>
</svg>`;
}

/** HTML 面板：有向边图 + 图例 + 环列表。 */
export function renderModuleGraphPanel(g: ModuleGraph): string {
	const ringList = g.sccs.length
		? g.sccs
				.map((s) => `<div class="bar-row"><div class="bar-label" style="width:44%">${s.length} 成员环</div><div class="bar-track ring">${s.map((m) => `<span class="chip" style="border-color:#e5484d">${esc(m)}</span>`).join(" ")}</div><div class="bar-val">逆行 ${s.length * (s.length - 1)} 边方向</div></div>`)
				.join("")
		: '<div class="sub">无环——模块间无逆向依赖</div>';
	return `<div class="panel">
<h3>🗺 项目模块有向边图（第一方口径 · 聚合 ${g.nodes.length} 模块 · ${g.edges.length} 边——悬停看明细；第三方折叠为单节点）</h3>
${renderModuleGraphSvg(g)}
<div class="sub" style="margin-top:8px"><span style="color:#e5484d">● 红 = 逆行边（环内互相依赖——解耦优先）</span> · <span style="color:#d29922">● 黄 = 模块内部调用 &gt; 0</span> · <span style="color:#4c8dff">● 蓝 = 普通模块</span> · 箭头方向 = 调用方向（A→B 表示 A 调 B） · 线宽 = 调用边数</div>
<h3 style="margin-top:14px">模块级环（逆行边来源，聚合 ${g.nodes.length} 模块口径）</h3>
${ringList}
</div>`;
}
