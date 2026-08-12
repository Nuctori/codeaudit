// 标注工作流模拟：导出 → 标注 3 条 → 回读验证闭环
// 用法: node scripts/probe-annotate.cjs <项目根> <unknowns.json>
const { scanProject } = require("../dist/index.js");
const fs = require("fs");

async function main() {
	const root = process.argv[2];
	let unknowns;
	try {
		unknowns = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
	} catch (e) {
		console.error("cannot read unknowns:", e.message);
		process.exit(1);
	}
	// 模拟 AI 标注：取 3 条有建议的标注 PURE（演示回读）
	const ann = unknowns.slice(0, 3).map((u) => ({ id: u.id, verdict: "PURE" }));
	console.log("标注", ann.length, "条");
	const report = await scanProject(root, {
		useCache: false,
		annotations: new Map(ann.map((a) => [a.id, a.verdict])),
	});
	const s = report.stats;
	console.log(
		`回读后: pure ${s.pure} | impure ${s.impure} | unknown ${s.unknown}`,
	);
	console.log(`annotationRejected: ${s.annotationRejected.length} 条`);
	for (const r of s.annotationRejected.slice(0, 3)) {
		console.log(`  拒: ${r.file} (${r.reason})`);
	}
	// 验证标注确实生效（unknown 应下降）
	const dropped = 5103 - s.unknown;
	console.log(
		`unknown 变化: ${dropped > 0 ? `-${dropped} (标注生效)` : "无变化 (标注全被拒)"}`,
	);
}
main().catch((e) => {
	console.error(e);
	process.exit(1);
});
