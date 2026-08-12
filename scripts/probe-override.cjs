// 验证 effectOverrides 端到端：InitDeity 场景（NetCall → net 效应）
// 用法: node scripts/probe-override.cjs
const {
	scanProject,
	loadEffectOverrides,
	validateEffectOverride,
	applyEffectOverrides,
	defaultPacks,
} = require("../dist/index.js");
const path = require("path");

async function main() {
	const overrides = loadEffectOverrides(
		path.join(__dirname, "../examples/initdeity-effect-override.json"),
	);
	const errs = validateEffectOverride(overrides, defaultPacks);
	if (errs.length > 0) {
		console.error("校验失败:", errs);
		process.exit(1);
	}
	const root = process.argv[2];
	if (!root) {
		console.error("用法: node scripts/probe-override.cjs <项目根>");
		process.exit(1);
	}
	const report = await scanProject(root, {
		useCache: false,
		effectOverrides: overrides,
	});
	const s = report.stats;
	console.log(
		`chunks ${s.chunks} | pure ${s.pure} | impure ${s.impure} | unknown ${s.unknown}`,
	);
	// NetCall 相关 chunk 应判 IMPURE（net）
	const netCall = report.verdicts.filter((v) =>
		v.chunk.name.includes("NetCall"),
	);
	console.log(`NetCall 相关 chunks: ${netCall.length}`);
	for (const v of netCall.slice(0, 3)) {
		console.log(
			`  ${v.chunk.name} → purity ${v.purity} effects [${[...v.effects].join(",")}]`,
		);
	}
}
main().catch((e) => {
	console.error(e);
	process.exit(1);
});
