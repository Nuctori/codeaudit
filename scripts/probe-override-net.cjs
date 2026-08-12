// 验证注入后 effects 含 net 的 chunk（NetCall → net 注入生效的直接证据）
// 用法: node scripts/probe-override-net.cjs <项目根>
const { scanProject, loadEffectOverrides, validateEffectOverride, defaultPacks } = require("../dist/index.js");
const path = require("path");

async function main() {
  const overrides = loadEffectOverrides(path.join(__dirname, "../examples/initdeity-effect-override.json"));
  const errs = validateEffectOverride(overrides, defaultPacks);
  if (errs.length > 0) { console.error("校验失败:", errs); process.exit(1); }
  const root = process.argv[2];
  const report = await scanProject(root, { useCache: false, effectOverrides: overrides });
  const withNet = report.verdicts.filter((v) => v.effects.has("net"));
  console.log(`注入后 effects 含 net 的 chunks: ${withNet.length}`);
  for (const v of withNet.slice(0, 5)) {
    console.log(`  ${v.chunk.name} → ${v.chunk.file} effects [${[...v.effects].join(",")}]`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
