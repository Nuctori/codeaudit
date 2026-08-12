// 诊断 chain 分布与 no-sites UNKNOWN（calls 是数组——json Set 序列化）
// 用法: node scripts/diag-id2.cjs <report.json>
const fs = require("fs");
let r;
try {
	r = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
} catch (e) {
	console.error(e.message);
	process.exit(1);
}
const IMPURE = 2,
	UNKNOWN = 1;

// chain 分布（IMPURE）
const chainDist = {};
for (const v of r.verdicts.filter((v) => v.purity === IMPURE)) {
	const c = v.chain === Infinity ? "inf" : String(v.chain);
	chainDist[c] = (chainDist[c] ?? 0) + 1;
}
console.log("IMPURE chain 分布:", JSON.stringify(chainDist));

// direct 字段样本——chain=0 IMPURE 看一个
const c0 = r.verdicts.find((v) => v.purity === IMPURE && v.chain === 0);
if (c0) {
	console.log(
		"chain=0 样本:",
		c0.chunk.name,
		"direct",
		JSON.stringify(c0.chunk.direct),
		"effects",
		[...c0.effects],
		"calls",
		JSON.stringify([...c0.chunk.calls].slice(0, 6)),
		"unknownSites",
		c0.chunk.unknownSites,
	);
}

// no-sites UNKNOWN：calls 数组
const unk = r.verdicts.filter(
	(v) =>
		v.purity === UNKNOWN &&
		(!v.chunk.unknownCalls || v.chunk.unknownCalls.length === 0),
);
console.log("\nno-sites UNKNOWN:", unk.length);
const shapes = {};
for (const v of unk) {
	const calls = v.chunk.calls ?? [];
	const k = v.chunk.parseError
		? "parseError"
		: calls.includes("?")
			? "has?"
			: calls.length === 0
				? "no-calls"
				: "has-calls";
	shapes[k] = (shapes[k] ?? 0) + 1;
}
console.log("no-sites 形态:", JSON.stringify(shapes));
for (const v of unk.slice(0, 10)) {
	console.log(
		`  ${v.chunk.name} parseError=${v.chunk.parseError} calls=[${(v.chunk.calls ?? []).slice(0, 4)}] eff=[${[...v.effects]}] ${v.chunk.file.split("/").slice(-2).join("/")}:${v.chunk.line}`,
	);
}
