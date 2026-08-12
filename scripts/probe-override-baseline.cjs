// 对照组：无 override 扫描，对比 NetCall 判定（验证注入确实改变判定）
// 用法: node scripts/probe-override-baseline.cjs <项目根>
const { scanProject } = require("../dist/index.js");

async function main() {
  const root = process.argv[2];
  if (!root) { console.error("用法: node scripts/probe-override-baseline.cjs <项目根>"); process.exit(1); }
  const report = await scanProject(root, { useCache: false });
  const netCall = report.verdicts.filter((v) => v.chunk.name.includes("NetCall"));
  console.log(`无 override: NetCall 相关 chunks ${netCall.length}`);
  for (const v of netCall.slice(0, 3)) {
    console.log(`  ${v.chunk.name} → purity ${v.purity} effects [${[...v.effects].join(",")}]`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
