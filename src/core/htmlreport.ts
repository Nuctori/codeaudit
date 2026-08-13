import type { Verdict } from "./types";
import { UNKNOWN_TARGET } from "./types";
import { graphMetrics } from "./topology";
import { dependencySkeleton, bridgesOf } from "./skeleton";
import { moduleSummary } from "./module";
import { tarjan } from "./tarjan";

/**
 * 技术债 HTML 可视化（迭代49 插件化：通用报告渲染器；迭代50 全量纲补全）。
 * 纯函数：verdicts + stats → 自包含单文件 HTML（零依赖、无 CDN、数据内嵌）。
 * 全部量纲独立可视化（迭代48 纪律：量纲不混合，各视图各自排序）：
 *   健康度卡片 / 拓扑健康度（密度/深度/自环/层分布/链分布/图完整度）/ 模块级 /
 *   治理清单 / 纠缠环（可规约性）/ 桥与割点（模块边界）/ 骨架差异（最小化）/
 *   圈复杂度 / 未知形态 / 效应源。
 */
export function renderTechdebtHtml(
	verdicts: readonly Verdict[],
	stats: { files: number; cycles: number },
	opts: { title?: string; sub?: string } = {},
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

	// 治理 top（直接调用者数降序——迭代48 量纲内排序）
	const inDeg = new Map<string, number>();
	for (const v of verdicts)
		for (const t of v.chunk.calls)
			if (t !== UNKNOWN_TARGET) inDeg.set(t, (inDeg.get(t) ?? 0) + 1);
	const gov = verdicts
		.filter((v) => v.purity !== 0)
		.sort((a, b) => {
			const da = inDeg.get(a.chunk.key) ?? 0;
			const db = inDeg.get(b.chunk.key) ?? 0;
			if (db !== da) return db - da;
			return (b.chain ?? 0) - (a.chain ?? 0);
		})
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
	const govMax = Math.max(...gov.map((v) => inDeg.get(v.chunk.key) ?? 0), 1);
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
				[...v.chunk.calls].filter(
					(t) => t !== UNKNOWN_TARGET && t !== v.chunk.key && byKey.has(t),
				),
			),
		);
	}
	const comps = tarjan(
		verdicts.map((v) => v.chunk.key),
		edgeSet,
	);
	const compOf = new Map<string, number>();
	comps.forEach((comp, c) => comp.forEach((k) => compOf.set(k, c)));
	// 多入口环：SCC>1 且外部调用者进入 >1 个不同成员
	const entangled: { comp: string[]; entries: number }[] = [];
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
			entangled.push({ comp: comp.slice(0, 6), entries: extEntry.size });
	}
	entangled.sort((a, b) => b.entries - a.entries);
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
	const depth = new Array<number>(comps.length).fill(-1);
	const via = new Array<number>(comps.length).fill(-1);
	comps.forEach((_, k) => {
		if (isSource[k]) depth[k] = 0;
	});
	for (let k = 0; k < comps.length; k++) {
		if (isSource[k]) continue;
		let best = -1;
		let bestK2 = -1;
		for (const k2 of succ[k]!) {
			if (depth[k2]! >= 0 && 1 + depth[k2]! > best) {
				best = 1 + depth[k2]!;
				bestK2 = k2;
			}
		}
		depth[k] = best;
		via[k] = bestK2;
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
	// 纠缠环：影响 = 入口数 × 环成员数（解耦收益 = 打断多少个外部入口 × 环体量）
	const ringRows = entangled
		.map((e) => ({
			names: e.comp.map((k) => nameOf(k)),
			entries: e.entries,
			impact: e.entries * e.comp.length,
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

	// 拓扑健康度：层分布/链分布/入口分布条形
	const layerMax = Math.max(...g.layerHistogram, 1);
	const layerRows = g.layerHistogram
		.map((c, i) => bar(`层 ${i}`, c, layerMax, "var(--acc)"))
		.filter((_, i) => g.layerHistogram[i]! > 0)
		.join("");
	const chainMax = Math.max(...g.chainHistogram, g.chainInf, 1);
	const chainRows =
		g.chainHistogram
			.map((c, i) => bar(`chain=${i}`, c, chainMax, "var(--fg)"))
			.join("") + bar("chain=∞(PURE)", g.chainInf, chainMax, "var(--pure)");
	const entryMax = Math.max(...g.sccEntryHistogram, 1);
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
<div class="sub">${esc(opts.sub ?? "")} · ${n} chunks · ${stats.files} 文件 · ${stats.cycles} 环 · ${new Date().toISOString().slice(0, 19)}</div>

<h2>健康度总览</h2>
<div class="grid">
${card("Chunks", n, "可判定单元", "var(--fg)")}
${card("PURE", pure, `${((pure / n) * 100).toFixed(1)}%`, "var(--pure)")}
${card("IMPURE", impure, `${((impure / n) * 100).toFixed(1)}% 有确定副作用`, "var(--imp)")}
${card("UNKNOWN", unknown, `${((unknown / n) * 100).toFixed(1)}% 无法判定`, "var(--unk)")}
${card("图完整度", `${(100 * (1 - g.evidence.missingSiteRate)).toFixed(1)}%`, `未知站点 ${g.unknownEdges}`, "var(--acc)")}
${card("结构形态", (() => { const r = g.knownEdges > 0 ? br.bridges.length / g.knownEdges : 1; return r > 0.7 ? "近树" : r < 0.3 ? "网状" : "混合"; })(), `桥比例 ${(g.knownEdges > 0 ? ((br.bridges.length / g.knownEdges) * 100).toFixed(0) : "100")}%（唯一通道占比——树=100%，低=多替代路径）`, "var(--acc)")}
${card("深度", g.dagDepth, "凝聚 DAG 最长路径", "var(--acc)")}
${card("自递归", g.selfLoopCount, "自我调用 chunk", "var(--acc)")}
</div>

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

<h2>治理清单 top 25（量纲：直接调用者数——被最多人引用的非纯优先）</h2>
<div class="panel">
${gov.map((v) => bar(`${esc(v.chunk.name)} <span style="color:var(--dim)">· ${esc(v.chunk.file.split("/").pop() ?? "")}:${v.chunk.line}</span>`, inDeg.get(v.chunk.key) ?? 0, govMax, v.purity === 2 ? "var(--imp)" : "var(--unk)")).join("")}
</div>

<h2>拓扑治理优先级（结构热点 → 动作清单 · 量纲各自排序不混合）</h2>
<div class="panel">
<h3>🔗 纠缠环优先解耦序（影响 = 外部入口数 × 环成员数——打断哪个环收益最大）</h3>
${
	ringRows.length === 0
		? '<div class="sub">无多入口纠缠环</div>'
		: ringRows
				.map(
					(r) =>
						`<div class="bar-row"><div class="bar-label" style="width:44%">${r.entries} 入口 × ${r.names.length} 成员</div><div class="bar-track" style="background:transparent">${r.names.map((nm) => `<span class="chip">${esc(nm)}</span>`).join("")}</div><div class="bar-val">影响 ${r.impact}</div></div>`,
				)
				.join("")
}
<div class="sub" style="margin-top:8px">动作：从影响最大的环开始解耦——收敛为单入口（结构化递归）或打断环。</div>
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

<h2>纠缠环成员（可规约性热点——重构雷区详情）</h2>
<div class="panel">
${
	entangled.length === 0
		? '<div class="sub">无多入口纠缠环</div>'
		: entangled
				.slice(0, 8)
				.map(
					(e) =>
						`<div class="bar-row"><div class="bar-label">${e.entries} 入口</div><div class="bar-track" style="background:transparent">${e.comp.map((k) => `<span class="chip">${esc(nameOf(k))}</span>`).join("")}</div><div class="bar-val"></div></div>`,
				)
				.join("")
}
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
<table><tr><th>函数</th><th>位置</th><th>效应</th><th>调用点</th></tr>
${sources.map((v) => `<tr><td>${esc(v.chunk.name)}</td><td>${esc(v.chunk.file)}</td><td>${[...v.effects].map((e) => `<span class="badge b-${e}">${e}</span>`).join("")}</td><td>${v.chunk.calls.size}</td></tr>`).join("")}
</table>
</div>
<div class="sub" style="margin-top:24px">codeaudit renderTechdebtHtml · 全量纲独立可视化不混合 · 数据内嵌零外部依赖</div>
</body></html>`;
}
