// 效应源 top（direct 是数组——json Set 序列化） + 假纯候选精确扫描
// 用法: node scripts/diag-id3.cjs <report.json>
const fs = require("fs");
let r;
try {
	r = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
} catch (e) {
	console.error(e.message);
	process.exit(1);
}
const IMPURE = 2,
	PURE = 0,
	UNKNOWN = 1;

console.log("=== 效应源 top 15（IMPURE chain=0 direct 非空，按 calls 数） ===");
const srcs = r.verdicts
	.filter(
		(v) =>
			v.purity === IMPURE && v.chain === 0 && (v.chunk.direct ?? []).length > 0,
	)
	.sort((a, b) => (b.chunk.calls ?? []).length - (a.chunk.calls ?? []).length)
	.slice(0, 15);
for (const v of srcs) {
	console.log(
		`  ${String((v.chunk.calls ?? []).length).padStart(4)}  ${v.chunk.name}  direct=[${v.chunk.direct}]  ${v.chunk.file.split("/").slice(-2).join("/")}:${v.chunk.line}`,
	);
}

console.log("\n=== direct 空但 chain=0 的 IMPURE 数（纯传递型） ===");
const noDirect = r.verdicts.filter(
	(v) =>
		v.purity === IMPURE && v.chain === 0 && (v.chunk.direct ?? []).length === 0,
);
console.log(noDirect.length);

console.log(
	"\n=== UNKNOWN 且 unknownSites=0 但 calls 含 ? 的 chunk（记账可疑） ===",
);
const weird = r.verdicts.filter(
	(v) => v.purity === UNKNOWN && (v.chunk.unknownSites ?? 0) === 0,
);
console.log("UNKNOWN + unknownSites=0:", weird.length);
// 这些是 has-calls 无 ? 的传递未知？看一个
const w = weird.find((v) => !v.chunk.parseError);
if (w)
	console.log(
		"样本:",
		w.chunk.name,
		"calls",
		JSON.stringify((w.chunk.calls ?? []).slice(0, 3)),
		"eff",
		[...w.effects],
		w.chunk.file.split("/").slice(-2).join("/"),
	);
