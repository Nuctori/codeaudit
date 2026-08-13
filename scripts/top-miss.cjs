// 候选4：InitDeity per-pack top-100 missSlots（一次性数据收集）
const { scanProject } = require("../dist/index.js");

async function main() {
	const r = await scanProject("J:/旧宇宙/代码仓库/InitDeity/Assets", {
		useCache: false,
	});
	const usage = r.effectTableUsage ?? r.stats?.effectTableUsage;
	if (!usage) {
		console.log("no effectTableUsage in report; keys:", Object.keys(r));
		return;
	}
	console.log("csharp missSlots top 100:");
	const cs = usage.find((u) => u.pack === "csharp") ?? usage.csharp;
	const slots = cs?.missSlots ?? cs?.misses ?? [];
	const sorted = Array.isArray(slots) ? slots : Object.entries(slots);
	sorted
		.sort((a, b) => (Array.isArray(a) ? b[1] - a[1] : b.count - a.count))
		.slice(0, 100)
		.forEach((s) => {
			const [k, c] = Array.isArray(s) ? s : [s.slot, s.count];
			console.log(`${c}\t${k}`);
		});
}
main().catch((e) => console.error("ERR", e));
