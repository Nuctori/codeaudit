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
	const p0 = parts[0]!,
		p1 = parts[1]!;
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
		if (p1 === "Plugins")
			return parts.length >= 3 ? `Plugins/${parts[2]!}` : "Plugins";
		return p1; // ChillyRoomSdkClient / CosmosBootstrap / CosmosFramework / Editor / Resources …
	}
	if (p0 === "LocalPackages")
		return parts.length >= 2 ? `LocalPackages/${parts[1]!}` : "LocalPackages";
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
	opts?: { firstPartyOnly?: boolean },
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
	for (const v of verdicts)
		keyToMod.set(v.chunk.key, fold(moduleKeyOf(v.chunk.file)));

	const nodes = new Map<string, { chunks: number; selfCalls: number }>();
	const edgeAgg = new Map<string, { a2b: number; b2a: number }>(); // 规范键 "min\u0000max" -> 双向计数

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
			const [ka, kb] = from < to ? [from, to] : [to, from];
			const ek = `${ka}\u0000${kb}`;
			const e = edgeAgg.get(ek) ?? { a2b: 0, b2a: 0 };
			if (from === ka) e.a2b++;
			else e.b2a++;
			edgeAgg.set(ek, e);
		}
	}

	// 节点数上限：超 64 把最弱节点并入 "…其他"（保持图可读）
	const MIN_CHUNKS = 3;
	const all = [...nodes.entries()].sort((a, b) => b[1].chunks - a[1].chunks);
	const keep = new Set<string>(
		all
			.filter(([, v]) => v.chunks >= MIN_CHUNKS)
			.slice(0, 64)
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
		H = 1640,
		CX = W / 2;
	const pos = new Map<string, { x: number; y: number }>();

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
			pos.set(id, { x: CX + (i - (ids.length - 1) / 2) * slot, y });
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
		const stroke = e.reverse ? "#e5484d" : "#8b8f98";
		const backPct = e.b2a > 0 ? Math.round((e.b2a / e.count) * 100) : 0;
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
		const r = 6 + (node.chunks / maxChunks) * 16;
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
		nodeSvg += `<text x="${p.x.toFixed(1)}" y="${(p.y + r + 12).toFixed(1)}" text-anchor="middle" font-size="11" fill="var(--fg)"><title>${tip}</title>${esc(label)}</text>`;
	}

	return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;background:var(--panel);border-radius:8px;border:1px solid var(--br)" xmlns="http://www.w3.org/2000/svg">
<g>${layerLabels}</g>
<g>${edgeSvg}</g>
<g>${nodeSvg}</g>
</svg>`;
}

/** HTML 面板：有向边图 + 图例 + 环列表。 */
export function renderModuleGraphPanel(g: ModuleGraph): string {
	const ringList = g.sccs.length
		? g.sccs
				.map(
					(s) =>
						`<div class="bar-row"><div class="bar-label" style="width:44%">${s.length} 成员环</div><div class="bar-track ring">${s.map((m) => `<span class="chip" style="border-color:#e5484d">${esc(m)}</span>`).join(" ")}</div><div class="bar-val">逆行 ${s.length * (s.length - 1)} 边方向</div></div>`,
				)
				.join("")
		: '<div class="sub">无环——模块间无逆向依赖</div>';
	return `<div class="panel">
<h3>🗺 项目模块有向边图（第一方口径 · 聚合 ${g.nodes.length} 模块 · ${g.edges.length} 边——悬停看明细；第三方折叠为单节点）</h3>
${renderModuleGraphSvg(g)}
<div class="sub" style="margin-top:8px"><span style="color:#e5484d">● 红 = 逆行边：双向依赖 + 聚合环内（实线 = 主方向，虚线 = 反向——悬停看 ×N 与逆行强度 %）</span> · <span style="color:#d29922">● 黄 = 模块内部调用 &gt; 0</span> · <span style="color:#4c8dff">● 蓝 = 普通模块</span> · <span style="color:#6b7280">◌ 灰虚线 = 无跨模块边（静态盲区：未知调用 ?/反射/事件驱动，非真实孤立；或真实孤立）</span> · 箭头方向 = 调用方向（A→B 表示 A 调 B） · 线宽 = 调用边数</div>
<h3 style="margin-top:14px">模块级环（逆行边来源，聚合 ${g.nodes.length} 模块口径）</h3>
${ringList}
</div>`;
}
