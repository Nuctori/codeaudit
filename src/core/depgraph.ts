// 模块级聚合有向图（迭代58：全项目有向边可视化——逆行边/环内边红色高亮，一眼看懂依赖反向）
// 聚合口径：chunk 级调用边 → 模块级（目录前缀）；模块键从 chunk.file 提取。
// 逆行边 = 聚合图 SCC>1 环内边（同分量内互相依赖——真实逆向依赖）+ 自环单列计数。
// 纯函数：verdicts → SVG 字符串；零依赖（复用 core/tarjan.ts）。
import type { Verdict } from "./types";
import { tarjan } from "./tarjan";

/** 模块键：文件路径 → 聚合模块（深度参数化——depth=2 目录级 / depth=3 模块级）。
 *  规则：Assets 为容器前缀（跳过）；LocalPackages/Tools/Tests 本身是一级目录（保留）；
 *  取前 depth 段非文件路径段。 */
export function moduleKeyOf(file: string, depth = 2): string {
	const parts = file.replace(/\\/g, "/").split("/");
	const segs = parts[0] === "Assets" ? parts.slice(1) : parts;
	const mod: string[] = [];
	for (const s of segs) {
		if (mod.length >= depth) break;
		if (
			/\.(cs|ts|js|py|json|md|txt|prefab|asset|mat|shader|asmdef|asmref|csproj|meta|png|xml|dll|so|unity)$/i.test(
				s,
			)
		)
			break; // 文件段（带扩展名）终止——目录名可含点（com.cysharp.unitask）
		mod.push(s);
	}
	return mod.join("/") || segs[0] || file;
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
	/** 主方向起点（两个方向计数较大者） */
	readonly from: string;
	/** 主方向终点 */
	readonly to: string;
	/** 主方向调用数（from→to） */
	readonly a2b: number;
	/** 反向调用数（to→from）——逆行强度：占比越大越是真实纠缠 */
	readonly b2a: number;
	/** 双向合计（渲染线宽/入出度用） */
	readonly count: number;
	/** 逆行边：双向依赖且聚合图环内（SCC>1 成员间） */
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

export function moduleGraph(
	verdicts: readonly Verdict[],
	opts?: { firstPartyOnly?: boolean; scope?: string; minChunks?: number },
): ModuleGraph {
	// 第三方折叠桶：firstPartyOnly 时非第一方白名单模块并入单节点
	// （第三方互环不可治理——折叠后逆行边只留第一方真实可解耦的环）
	// 白名单反推：Assets 下未列入的目录（UltimateSafeArea/Samples 等插件）一律第三方——防漏网
	const THIRD = "第三方";
	const FIRST_PARTY_TOP = new Set([
		"InitDeity",
		"ChillyRoomSdkClient",
		"CosmosBootstrap",
		"CosmosFramework",
		"CosmosEditor",
		"Editor",
		"Resources",
		"StreamingAssets",
		"Tools",
		"Tests",
	]);
	const thirdParty = (m: string): boolean => {
		if (
			m === "InitDeity/Generated" ||
			m.startsWith("LocalPackages/") ||
			m.startsWith("Plugins/") ||
			m.startsWith("Packages")
		)
			return true;
		return !FIRST_PARTY_TOP.has(m.split("/")[0]!);
	};
	const fold = opts?.firstPartyOnly
		? (m: string) => (thirdParty(m) ? THIRD : m)
		: (m: string) => m;

	const keyToMod = new Map<string, string>();
	// 粒度：主图（无 scope）= 目录级；scope 模式 = 该目录的模块级子图（scope 外折叠为"外部"桶）
	const key3 = (file: string): string => moduleKeyOf(file, 3);
	const aggKey = (file: string): string => {
		if (opts?.scope) {
			return moduleKeyOf(file, 2) === opts.scope ? key3(file) : "外部";
		}
		return fold(moduleKeyOf(file, 2));
	};
	for (const v of verdicts) keyToMod.set(v.chunk.key, aggKey(v.chunk.file));

	const nodes = new Map<string, { chunks: number; selfCalls: number }>();
	const edgeAgg = new Map<string, { a2b: number; b2a: number }>(); // 规范键 "min\u0000max" -> 双向计数

	for (const v of verdicts) {
		const from = aggKey(v.chunk.file);
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
			const [ka, kb] = from < to ? [from, to] : [to, from];
			const ek = `${ka}\u0000${kb}`;
			const e = edgeAgg.get(ek) ?? { a2b: 0, b2a: 0 };
			if (from === ka) e.a2b++;
			else e.b2a++;
			edgeAgg.set(ek, e);
		}
	}

	// 节点数上限：超 80 把最弱节点并入 "…其他"（保持图可读；子图模式 minChunks 提高防挤爆）
	const MIN_CHUNKS = opts?.minChunks ?? 3;
	const all = [...nodes.entries()].sort((a, b) => b[1].chunks - a[1].chunks);
	const keep = new Set<string>(
		all
			.filter(([, v]) => v.chunks >= MIN_CHUNKS)
			.slice(0, 80)
			.map(([k]) => k),
	);
	const other: { chunks: number; selfCalls: number } = {
		chunks: 0,
		selfCalls: 0,
	};
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

	// 聚合边（跳过落入 dropped 的端点；规范键 min\u0000max 存双向计数）
	const edges: Array<{ from: string; to: string; a2b: number; b2a: number }> =
		[];
	for (const [ek, e] of edgeAgg) {
		const [rawA, rawB] = ek.split("\u0000");
		const a = rawA ?? "",
			b = rawB ?? "";
		if (dropped.has(a) || dropped.has(b)) continue;
		// 主方向 = 计数大者；相等时字典序（确定性 tiebreak）
		const forward = e.a2b >= e.b2a;
		edges.push({
			from: forward ? a : b,
			to: forward ? b : a,
			a2b: Math.max(e.a2b, e.b2a),
			b2a: Math.min(e.a2b, e.b2a),
		});
	}

	// 聚合图 SCC——环内边 = 逆行边（双向时两个方向都入图，否则环检测丢反向）
	const succ = new Map<string, Set<string>>();
	for (const e of edges) {
		const s = succ.get(e.from) ?? new Set<string>();
		s.add(e.to);
		succ.set(e.from, s);
		if (e.b2a > 0) {
			const r = succ.get(e.to) ?? new Set<string>();
			r.add(e.from);
			succ.set(e.to, r);
		}
	}
	const sccs = tarjan(nodeIds, succ).filter((s) => s.length > 1);
	const inRing = new Set<string>();
	for (const s of sccs) for (const m of s) inRing.add(m);

	const finalEdges: ModEdge[] = edges
		.filter((e) => e.from !== e.to)
		.map((e) => ({
			...e,
			count: e.a2b + e.b2a,
			reverse: inRing.has(e.from) && inRing.has(e.to) && e.b2a > 0,
		}))
		.sort((a, b) => Number(b.reverse) - Number(a.reverse) || b.count - a.count);

	const inDeg = new Map<string, number>();
	const outDeg = new Map<string, number>();
	for (const e of finalEdges) {
		outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + e.count);
		inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + e.count);
	}

	const nodeList: ModNode[] = nodeIds.map((id) => {
		const v = nodes.get(id)!;
		return {
			id,
			label: id,
			chunks: v.chunks,
			selfCalls: v.selfCalls,
			inDeg: inDeg.get(id) ?? 0,
			outDeg: outDeg.get(id) ?? 0,
		};
	});

	return { nodes: nodeList, edges: finalEdges, sccs };
}

const esc = (s: string): string =>
	String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

/** SVG 渲染：凝聚分层布局（Sugiyama longest-path 简化版）——SCC 缩为超节点分层，
 *  环内成员同层并列（逆行边同层回弯可见）；贝塞尔弧线；逆行边红色粗线，正向边灰色；悬停显示明细。 */
export function renderModuleGraphSvg(g: ModuleGraph): string {
	const n = g.nodes.length;
	if (n === 0) return '<div class="sub">无模块节点</div>';
	const W = 1500,
		H = 820,
		CX = W / 2;
	const pos = new Map<string, { x: number; y: number; slot: number }>();

	// 1. SCC 凝聚：环成员 → 代表（字典序最小）；非环成员自身为代表
	const rep = new Map<string, string>();
	for (const s of g.sccs) {
		const r = [...s].sort()[0]!;
		for (const m of s) rep.set(m, r);
	}
	const repOf = (id: string): string => rep.get(id) ?? id;
	// 2. 凝聚 DAG（去重，忽略自边）
	const dagSucc = new Map<string, Set<string>>();
	const dagPred = new Map<string, Set<string>>();
	for (const e of g.edges) {
		const a = repOf(e.from),
			b = repOf(e.to);
		if (a === b) continue;
		(dagSucc.get(a) ?? dagSucc.set(a, new Set()).get(a)!).add(b);
		(dagPred.get(b) ?? dagPred.set(b, new Set()).get(b)!).add(a);
	}
	// 3. longest-path 分层：layer[v] = 1 + max(layer[pred])，迭代至稳定（凝聚后 DAG，必终止）
	const reps = new Set([...g.nodes].map((x) => repOf(x.id)));
	const layerOf = new Map<string, number>();
	for (const r of reps) layerOf.set(r, 0);
	let changed = true;
	while (changed) {
		changed = false;
		for (const r of reps) {
			let l = 0;
			for (const p of dagPred.get(r) ?? [])
				l = Math.max(l, (layerOf.get(p) ?? 0) + 1);
			if (l !== (layerOf.get(r) ?? 0)) {
				layerOf.set(r, l);
				changed = true;
			}
		}
	}
	// 4. 坐标：层 → y（上=源/依赖方，下=被依赖基础设施）；层内 x 均分（环成员同层并列）
	const layerNodes = new Map<number, string[]>();
	for (const node of g.nodes) {
		const l = layerOf.get(repOf(node.id)) ?? 0;
		const arr = layerNodes.get(l) ?? [];
		arr.push(node.id);
		layerNodes.set(l, arr);
	}
	const maxL = Math.max(...layerNodes.keys());
	const rowH = maxL > 0 ? (H - 150) / maxL : 0;
	for (const [l, ids] of layerNodes) {
		const y = 95 + l * rowH;
		const slot = Math.min(170, (W - 240) / Math.max(ids.length, 1));
		ids.forEach((id, i) => {
			pos.set(id, { x: CX + (i - (ids.length - 1) / 2) * slot, y, slot });
		});
	}
	// 层数标注（右侧 y 轴提示）
	const layerLabels = [...layerNodes.keys()]
		.sort((a, b) => a - b)
		.map(
			(l) =>
				`<text x="${W - 30}" y="${(95 + l * rowH + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--dim)">L${l}</text>`,
		)
		.join("");

	const maxCount = Math.max(...g.edges.map((e) => e.count), 1);
	const maxChunks = Math.max(...g.nodes.map((x) => x.chunks), 1);
	// 边：主方向实线弧 + 反向虚线弧（双向依赖时）；控制点沿法线偏移避免重叠
	let edgeSvg = "";
	for (const e of g.edges) {
		const p1 = pos.get(e.from)!;
		const p2 = pos.get(e.to)!;
		const dx = p2.x - p1.x,
			dy = p2.y - p1.y;
		const mx = (p1.x + p2.x) / 2,
			my = (p1.y + p2.y) / 2;
		const len = Math.hypot(dx, dy) || 1;
		const off = (e.reverse ? 26 : 14) * (e.count / maxCount + 0.6);
		const side = e.from < e.to ? 1 : -1;
		// 同层（环内互连）：控制点大幅垂直弯折（上=主方向/下=反向，两条分离弧）；跨层：沿法线偏移
		const cx2 = Math.abs(dy) < 1 ? mx : mx + (-dy / len) * off * side;
		const cy2 = Math.abs(dy) < 1 ? my - 180 : my + (dx / len) * off * side;
		const w = 1 + (e.count / maxCount) * 4;
		const backPct = e.b2a > 0 ? Math.round((e.b2a / e.count) * 100) : 0;
		// 逆行强度分级：≥20% 深红（真实纠缠），<20% 浅红（单点回边）
		const stroke = e.reverse
			? backPct >= 20
				? "#e5484d"
				: "#e58a8d"
			: "#8b8f98";
		const tip = `${esc(e.from)} → ${esc(e.to)} × ${e.count}${e.b2a > 0 ? `（反向 ${e.b2a} 条 · 逆行强度 ${backPct}%）` : ""}${e.reverse ? "\n⚠ 逆行：双向依赖 + 聚合环内——解耦优先" : ""}`;
		const arrowEnd = `M${p2.x - (dx / len) * 10},${p2.y - (dy / len) * 10} L${p2.x - (dy / len) * 6},${p2.y + (dx / len) * 6} L${p2.x + (dy / len) * 6},${p2.y - (dx / len) * 6} Z`;
		edgeSvg += `<path d="M${p1.x.toFixed(1)},${p1.y.toFixed(1)} Q${cx2.toFixed(1)},${cy2.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${w.toFixed(1)}" opacity="0.55"><title>${tip}</title></path>`;
		edgeSvg += `<path d="${arrowEnd}" fill="${stroke}"><title>${tip}</title></path>`;
		// 反向弧线：虚线；同层向下弯（与主弧上弯分离成两条可见弧），跨层反向偏移
		if (e.b2a > 0) {
			const rOff = off * -0.9 * side;
			const rx2 = Math.abs(dy) < 1 ? mx : mx + (-dy / len) * rOff;
			const ry2 = Math.abs(dy) < 1 ? my + 180 : my + (dx / len) * rOff;
			const rTip = `${esc(e.to)} → ${esc(e.from)} × ${e.b2a}（反向——逆行方向）`;
			edgeSvg += `<path d="M${p2.x.toFixed(1)},${p2.y.toFixed(1)} Q${rx2.toFixed(1)},${ry2.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="${Math.max(w * 0.7, 1).toFixed(1)}" stroke-dasharray="6,4" opacity="0.45"><title>${rTip}</title></path>`;
		}
	}

	let nodeSvg = "";
	// 孤立节点：无任何跨模块边——静态盲区（? 未知调用不建边/反射驱动/真实孤立）用虚线区分
	const edgeNodes = new Set<string>();
	for (const e of g.edges) {
		edgeNodes.add(e.from);
		edgeNodes.add(e.to);
	}
	// 节点 hover 明细：top 调用去向 / 来源（各 3，按 count 降序）
	const outTop = new Map<string, Array<[string, number]>>();
	const inTop = new Map<string, Array<[string, number]>>();
	for (const e of g.edges) {
		const o = outTop.get(e.from) ?? [];
		o.push([e.to, e.count]);
		outTop.set(e.from, o);
		const i = inTop.get(e.to) ?? [];
		i.push([e.from, e.count]);
		inTop.set(e.to, i);
	}
	const topOf = (
		m: Map<string, Array<[string, number]>>,
		id: string,
		arrow: string,
	): string => {
		const l = (m.get(id) ?? []).sort((a, b) => b[1] - a[1]).slice(0, 3);
		return l.length
			? `\n${arrow} ${l.map(([n, c]) => `${esc(n)}×${c}`).join(" · ")}`
			: "";
	};
	const ringSet = new Set(g.sccs.flat());
	for (const node of g.nodes) {
		const p = pos.get(node.id)!;
		const r = 10 + (node.chunks / maxChunks) * 30;
		const ring = ringSet.has(node.id);
		const isolated = !edgeNodes.has(node.id);
		const fill = ring
			? "#e5484d"
			: isolated
				? "#6b7280"
				: node.selfCalls > 0
					? "#d29922"
					: "#4c8dff";
		const stroke = isolated ? "#9ca3af" : "#1a1b1e";
		const dash = isolated ? ' stroke-dasharray="5,4"' : "";
		const tip = `${esc(node.label)}\nchunks ${node.chunks} · 出→入 ${node.outDeg}→${node.inDeg} · 内部调用 ${node.selfCalls}${ring ? "（环内模块）" : ""}${topOf(outTop, node.id, "→")}${topOf(inTop, node.id, "←")}${isolated ? "\n⚠ 无跨模块边——静态盲区（未知调用 ?/反射/事件驱动）或真实孤立" : ""}`;
		nodeSvg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"${dash}><title>${tip}</title></circle>`;
		// 标签：节点下方，超出省略
		const label =
			node.label.length > 22 ? node.label.slice(0, 21) + "…" : node.label;
		nodeSvg += `<text x="${p.x.toFixed(1)}" y="${(p.y + r + 14).toFixed(1)}" text-anchor="middle" font-size="13" fill="var(--fg)"><title>${tip}</title>${esc(label)}</text>`;
	}

	return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:var(--panel);border-radius:8px;border:1px solid var(--br)" xmlns="http://www.w3.org/2000/svg">
<g>${layerLabels}</g>
<g>${edgeSvg}</g>
<g>${nodeSvg}</g>
</svg>`;
}

/** HTML 面板：有向边图 + 图例 + 环列表。 */
export function renderModuleGraphPanel(
	verdicts: readonly Verdict[],
	opts?: { firstPartyOnly?: boolean; expandChunks?: number },
): string {
	const firstPartyOnly = opts?.firstPartyOnly ?? true;
	// 子图阈值：默认所有节点（0 = 无阈值）——凡有子目录结构（内部节点 >1）即可下钻
	const EXPAND = opts?.expandChunks ?? 0;
	const g = moduleGraph(verdicts, { firstPartyOnly });
	// 子图数据：base 中 chunks ≥ EXPAND 且非桶节点 → scope 子图（模块级 + 外部桶）
	const children: Record<string, ModuleGraph> = {};
	for (const n of g.nodes) {
		if (n.chunks < EXPAND) continue;
		if (
			n.id === "第三方" ||
			n.id === "外部" ||
			n.id === "…其他" ||
			n.id === "InitDeity/Generated"
		)
			continue;
		const sub = moduleGraph(verdicts, {
			firstPartyOnly,
			scope: n.id,
			minChunks: 20,
		});
		// 无展开价值：内部节点 ≤ 1（无子目录结构）
		if (
			sub.nodes.filter((x) => x.id !== "外部" && x.id !== "…其他").length <= 1
		)
			continue;
		children[n.id] = sub;
	}
	const data = JSON.stringify({ base: g, children });

	const ringList = g.sccs.length
		? g.sccs
				.map(
					(s) =>
						`<div class="bar-row"><div class="bar-label" style="width:44%">${s.length} 成员环</div><div class="bar-track ring">${s.map((m) => `<span class="chip" style="border-color:#e5484d">${esc(m)}</span>`).join(" ")}</div><div class="bar-val">逆行 ${s.length * (s.length - 1)} 边方向</div></div>`,
				)
				.join("")
		: '<div class="sub">无环——模块间无逆向依赖</div>';
	const expandHint = Object.keys(children).length
		? ` · 可展开 ${Object.keys(children).length} 个目录（<b style="color:#fff">白描边节点</b>点击直接下钻）`
		: "";
	return `<div class="panel">
<h3>🗺 项目模块有向边图（第一方口径 · ${g.nodes.length} 模块 · ${g.edges.length} 边——悬停看明细；第三方折叠为单节点${expandHint}）</h3>
<div id="depgraph-holder"></div>
<script>
window.__DEPGRAPH_DATA = ${data};
window.__DEPGRAPH_STACK = [];
function depgraphRender(data, holder, path, parentPath) {
	var rep = {}, repOf = function(id) { return rep[id] || id; };
	(data.sccs || []).forEach(function(s) { var r = s.slice().sort()[0]; s.forEach(function(m) { rep[m] = r; }); });
	var preds = {};
	data.edges.forEach(function(e) {
		var a = repOf(e.from), b = repOf(e.to);
		if (a === b) return;
		(preds[b] = preds[b] || {})[a] = 1;
	});
	var reps = {}, layer = {};
	data.nodes.forEach(function(n) { reps[repOf(n.id)] = 1; });
	Object.keys(reps).forEach(function(r) { layer[r] = 0; });
	var changed = true;
	while (changed) {
		changed = false;
		Object.keys(reps).forEach(function(r) {
			var l = 0, p;
			for (p in (preds[r] || {})) l = Math.max(l, (layer[p] || 0) + 1);
			if (l !== (layer[r] || 0)) { layer[r] = l; changed = true; }
		});
	}
	var W = 1500, H = 820, CX = W / 2;
	var layerNodes = {};
	data.nodes.forEach(function(n) {
		var l = layer[repOf(n.id)] || 0;
		(layerNodes[l] = layerNodes[l] || []).push(n.id);
	});
	var maxL = 0;
	for (var k in layerNodes) maxL = Math.max(maxL, +k);
	var rowH = maxL > 0 ? (H - 150) / maxL : 0;
	var pos = {};
	for (var lk in layerNodes) {
		var ids = layerNodes[lk], y = 95 + (+lk) * rowH;
		var slot = Math.min(170, (W - 240) / Math.max(ids.length, 1));
		ids.forEach(function(id, ii) { pos[id] = { x: CX + (ii - (ids.length - 1) / 2) * slot, y: y, slot: slot }; });
	}
	var maxCount = 1, maxChunks = 1;
	data.edges.forEach(function(e) { maxCount = Math.max(maxCount, e.count); });
	data.nodes.forEach(function(n) { maxChunks = Math.max(maxChunks, n.chunks); });
	var svg = '<g>';
	data.edges.forEach(function(e) {
		var p1 = pos[e.from], p2 = pos[e.to];
		if (!p1 || !p2) return;
		var dx = p2.x - p1.x, dy = p2.y - p1.y, mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
		var len = Math.hypot(dx, dy) || 1;
		var off = (e.reverse ? 26 : 14) * (e.count / maxCount + 0.6);
		var side = e.from < e.to ? 1 : -1;
		var cx2 = Math.abs(dy) < 1 ? mx : mx + (-dy / len) * off * side;
		var cy2 = Math.abs(dy) < 1 ? my - 180 : my + (dx / len) * off * side;
		var backPct = e.b2a > 0 ? Math.round(e.b2a / e.count * 100) : 0;
		var stroke = e.reverse ? (backPct >= 20 ? '#e5484d' : '#e58a8d') : '#8b8f98';
		var tip = e.from + ' → ' + e.to + ' × ' + e.count + (e.b2a > 0 ? '（反向 ' + e.b2a + ' 条 · 逆行强度 ' + backPct + '%）' : '') + (e.reverse ? '\\n⚠ 逆行：双向依赖 + 聚合环内——解耦优先' : '');
		var w = 1 + (e.count / maxCount) * 4;
		svg += '<path d="M' + p1.x.toFixed(1) + ',' + p1.y.toFixed(1) + ' Q' + cx2.toFixed(1) + ',' + cy2.toFixed(1) + ' ' + p2.x.toFixed(1) + ',' + p2.y.toFixed(1) + '" fill="none" stroke="' + stroke + '" stroke-width="' + w.toFixed(1) + '" opacity="0.55"><title>' + tip + '</title></path>';
		var arr = 'M' + (p2.x - dx / len * 10).toFixed(1) + ',' + (p2.y - dy / len * 10).toFixed(1) + ' L' + (p2.x - dy / len * 6).toFixed(1) + ',' + (p2.y + dx / len * 6).toFixed(1) + ' L' + (p2.x + dy / len * 6).toFixed(1) + ',' + (p2.y - dx / len * 6).toFixed(1) + ' Z';
		svg += '<path d="' + arr + '" fill="' + stroke + '"><title>' + tip + '</title></path>';
		if (e.b2a > 0) {
			var rOff = off * -0.9 * side;
			var rx2 = Math.abs(dy) < 1 ? mx : mx + (-dy / len) * rOff;
			var ry2 = Math.abs(dy) < 1 ? my + 180 : my + (dx / len) * rOff;
			svg += '<path d="M' + p2.x.toFixed(1) + ',' + p2.y.toFixed(1) + ' Q' + rx2.toFixed(1) + ',' + ry2.toFixed(1) + ' ' + p1.x.toFixed(1) + ',' + p1.y.toFixed(1) + '" fill="none" stroke="' + stroke + '" stroke-width="' + Math.max(w * 0.7, 1).toFixed(1) + '" stroke-dasharray="6,4" opacity="0.45"><title>' + e.to + ' → ' + e.from + ' × ' + e.b2a + '（反向——逆行方向）</title></path>';
		}
	});
	svg += '</g><g>';
	var ringSet = {}, edgeNodes = {};
	(data.sccs || []).forEach(function(s) { s.forEach(function(m) { ringSet[m] = 1; }); });
	data.edges.forEach(function(e) { edgeNodes[e.from] = 1; edgeNodes[e.to] = 1; });
	data.nodes.forEach(function(n) {
		var p = pos[n.id];
		if (!p) return;
		var r0 = 10 + (n.chunks / maxChunks) * 30;
		var r = Math.min(r0, (p.slot || 170) * 0.45); // 密层收缩防重叠
		var ring = !!ringSet[n.id];
		var isolated = !edgeNodes[n.id];
		var fill = ring ? '#e5484d' : (isolated ? '#6b7280' : (n.selfCalls > 0 ? '#d29922' : '#4c8dff'));
		var stroke = isolated ? '#9ca3af' : '#1a1b1e';
		var dash = isolated ? ' stroke-dasharray="5,4"' : '';
		// 只有 base 级渲染可展开（子图内同名根节点不可再点——防无限自展开）
		var child = data === window.__DEPGRAPH_DATA.base
			? (window.__DEPGRAPH_DATA.children && window.__DEPGRAPH_DATA.children[n.id])
			: null;
		// 可展开节点：白色粗描边 + 手型光标 + 点击节点直接下钻（迭代58-r10：去掉 + 徽标，交互即节点本身）
		var click = child
			? ' style="cursor:pointer" onclick="depgraphNav(\\'' + n.id + '\\',\\'' + path + '\\')"'
			: '';
		var ringStroke = child ? '#fff' : stroke;
		var ringW = child ? 3 : 1.5;
		var tip = n.label + '\\nchunks ' + n.chunks + ' · 出→入 ' + n.outDeg + '→' + n.inDeg + ' · 内部调用 ' + n.selfCalls + (ring ? '（环内模块）' : '') + (isolated ? '\\n⚠ 无跨模块边——静态盲区（未知调用 ?/反射/事件驱动）或真实孤立' : '') + (child ? '\\n🖱 点击展开 ' + n.id + ' 的模块级子图' : '');
		svg += '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + r.toFixed(1) + '" fill="' + fill + '" stroke="' + ringStroke + '" stroke-width="' + ringW + '"' + dash + click + '><title>' + tip + '</title></circle>';
		var label0 = n.label.split('/').pop() || n.label;
		var label = label0.length > 16 ? label0.slice(0, 15) + '…' : label0;
		svg += '<text x="' + p.x.toFixed(1) + '" y="' + (p.y + r + 14).toFixed(1) + '" text-anchor="middle" font-size="13" fill="var(--fg)"><title>' + tip + '</title>' + label + '</text>';
	});
	svg += '</g>';
	var labels = '';
	for (var lk2 in layerNodes) {
		var ly = 95 + (+lk2) * rowH;
		labels += '<text x="' + (W - 30) + '" y="' + (ly + 4) + '" text-anchor="end" font-size="10" fill="var(--dim)">L' + lk2 + '</text>';
	}
	var crumb = parentPath ? '<a href="javascript:void(0)" onclick="depgraphBack()" style="color:var(--acc)">‹ 返回上级</a> · ' : '';
	holder.innerHTML = '<div style="margin-bottom:6px;font-size:12px">' + crumb + '<b>' + path + '</b></div><svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;background:var(--panel);border-radius:8px;border:1px solid var(--br)" xmlns="http://www.w3.org/2000/svg"><g>' + labels + '</g>' + svg + '</svg>';
}
function depgraphNav(id, parentPath) {
	window.__DEPGRAPH_STACK.push({ data: window.__DEPGRAPH_DATA.base, path: parentPath });
	window.__DEPGRAPH_DATA.current = window.__DEPGRAPH_DATA.children[id];
	depgraphRender(window.__DEPGRAPH_DATA.current, document.getElementById('depgraph-holder'), parentPath + ' / ' + id, parentPath);
}
function depgraphBack() {
	var prev = window.__DEPGRAPH_STACK.pop();
	window.__DEPGRAPH_DATA.current = prev.data;
	depgraphRender(prev.data, document.getElementById('depgraph-holder'), prev.path, null);
}
depgraphRender(window.__DEPGRAPH_DATA.base, document.getElementById('depgraph-holder'), '目录级', null);
</script>
<div class="sub" style="margin-top:8px"><span style="color:#e5484d">● 深红 = 逆行边（强度 ≥20% 真实纠缠）</span> · <span style="color:#e58a8d">● 浅红 = 逆行边（强度 &lt;20% 单点回边）</span>（实线 = 主方向，虚线 = 反向——悬停看 ×N 与逆行强度 %） · <span style="color:#d29922">● 黄 = 模块内部调用 &gt; 0</span> · <span style="color:#4c8dff">● 蓝 = 普通模块</span> · <span style="color:#6b7280">◌ 灰虚线 = 无跨模块边（静态盲区：未知调用 ?/反射/事件驱动，非真实孤立；或真实孤立）</span> · 箭头方向 = 调用方向（A→B 表示 A 调 B） · 线宽 = 调用边数 · <b style="color:#fff">白描边</b> = 可下钻目录（点击节点看模块级子图）</div>
<h3 style="margin-top:14px">模块级环（逆行边来源，聚合 ${g.nodes.length} 模块口径）</h3>
${ringList}
</div>`;
}
