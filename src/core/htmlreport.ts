import type { Verdict } from "./types";
import { UNKNOWN_TARGET } from "./types";
import { graphMetrics } from "./topology";
import { dependencySkeleton, bridgesOf } from "./skeleton";
import { moduleSummary } from "./module";

/**
 * 技术债 HTML 可视化（迭代49 插件化：通用报告渲染器）。
 * 纯函数：verdicts + stats → 自包含单文件 HTML（零依赖、无 CDN、数据内嵌）。
 * 与 graphMetrics/riskOfChange 同构（verdicts 输入、不可变输出）——任意项目可复用，
 * 非 InitDeity 专用。量纲独立排序不混合（迭代48 纪律）。
 */
export function renderTechdebtHtml(
	verdicts: readonly Verdict[],
	stats: { files: number; cycles: number },
	opts: { title?: string; sub?: string } = {},
): string {
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
	const shapeTop = [...shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
	const shapeMax = shapeTop[0]?.[1] ?? 1;
	const govMax = Math.max(...gov.map((v) => inDeg.get(v.chunk.key) ?? 0), 1);
	const cMax = Math.max(...complex.map((v) => v.chunk.complexity ?? 0), 1);
	const n = verdicts.length;
	const pure = verdicts.filter((v) => v.purity === 0).length;
	const impure = verdicts.filter((v) => v.purity === 2).length;
	const unknown = n - pure - impure;

	const esc = (s: string): string =>
		String(s)
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");

	const bar = (label: string, value: number, max: number, color: string): string => {
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
	const card = (label: string, value: number | string, sub: string, color: string): string =>
		`<div class="card"><div class="card-label">${label}</div><div class="card-val" style="color:${color}">${value}</div><div class="card-sub">${sub}</div></div>`;

	const sources = verdicts
		.filter((v) => v.purity === 2 && v.chain === 0 && (v.chunk.direct?.size ?? 0) > 0)
		.sort((a, b) => b.chunk.calls.size - a.chunk.calls.size)
		.slice(0, 15);

	return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title ?? "codeaudit 技术债报告")}</title>
<style>
:root{--bg:#0f1419;--panel:#1a2129;--panel2:#222c36;--fg:#e6edf3;--dim:#8b98a5;--pure:#3fb950;--unk:#d29922;--imp:#f85149;--acc:#58a6ff;--br:#303a44}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:14px/1.5 -apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;padding:24px;max-width:1100px;margin:0 auto}
h1{font-size:20px;margin-bottom:4px}h2{font-size:15px;margin:28px 0 10px;color:var(--acc);border-bottom:1px solid var(--br);padding-bottom:6px}
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
</style></head><body>
<h1>${esc(opts.title ?? "codeaudit 技术债报告")}</h1>
<div class="sub">${esc(opts.sub ?? "")} · ${n} chunks · ${stats.files} 文件 · ${stats.cycles} 环 · ${new Date().toISOString().slice(0, 19)}</div>

<div class="grid">
${card("Chunks", n, "可判定单元", "var(--fg)")}
${card("PURE", pure, `${((pure / n) * 100).toFixed(1)}%`, "var(--pure)")}
${card("IMPURE", impure, `${((impure / n) * 100).toFixed(1)}% 有确定副作用`, "var(--imp)")}
${card("UNKNOWN", unknown, `${((unknown / n) * 100).toFixed(1)}% 无法判定`, "var(--unk)")}
${card("环 SCC", g.cyclicComponents, `${g.multiEntryScc} 多入口纠缠(${Math.round((g.multiEntryScc / Math.max(g.cyclicComponents, 1)) * 100)}%)`, "var(--acc)")}
${card("桥边", br.bridges.length, "模块唯一通道", "var(--acc)")}
${card("割点", br.articulationPoints.length, "必经枢纽", "var(--acc)")}
${card("骨架边", sk.length, "真直接依赖", "var(--acc)")}
</div>

<h2>模块级（PURE/UNKNOWN/IMPURE 分段 · top 10）</h2>
<div class="panel">
${mods.slice(0, 10).map((m) => seg(m.module, [m.pure, m.unknown, m.impure], m.chunks)).join("")}
<div class="legend"><span><i class="dot" style="background:var(--pure)"></i>PURE</span><span><i class="dot" style="background:var(--unk)"></i>UNKNOWN</span><span><i class="dot" style="background:var(--imp)"></i>IMPURE</span></div>
</div>

<h2>治理清单 top 25（量纲：直接调用者数——被最多人引用的非纯优先）</h2>
<div class="panel">
${gov.map((v) => bar(`${esc(v.chunk.name)} <span style="color:var(--dim)">· ${esc(v.chunk.file.split("/").pop() ?? "")}:${v.chunk.line}</span>`, inDeg.get(v.chunk.key) ?? 0, govMax, v.purity === 2 ? "var(--imp)" : "var(--unk)")).join("")}
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
<div class="sub" style="margin-top:24px">codeaudit renderTechdebtHtml · 量纲独立排序不混合 · 数据内嵌零外部依赖</div>
</body></html>`;
}
