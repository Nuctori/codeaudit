// 诊断效应源与 no-sites UNKNOWN
// 用法: node scripts/diag-id.cjs <report.json>
const fs = require("fs");
let r;
try { r = JSON.parse(fs.readFileSync(process.argv[2], "utf8")); } catch (e) { console.error(e.message); process.exit(1); }
const IMPURE = 2, UNKNOWN = 1;

const impure = r.verdicts.filter((v) => v.purity === IMPURE);
console.log("IMPURE total:", impure.length);
const chain0 = impure.filter((v) => v.chain === 0);
console.log("chain=0 IMPURE:", chain0.length);
const withDirect = chain0.filter((v) => v.chunk.direct && v.chunk.direct.size > 0);
console.log("chain=0 + direct>0:", withDirect.length);
// 看一个样本结构
const sample = withDirect[0];
if (sample) {
  console.log("sample:", sample.chunk.name, "effects", [...sample.effects], "direct", [...sample.chunk.direct], "calls size", sample.chunk.calls.size, "file", sample.chunk.file);
}
// 按效应类型聚合 chain=0 IMPURE
const byEff = {};
for (const v of chain0) for (const e of v.effects) byEff[e] = (byEff[e] ?? 0) + 1;
console.log("chain=0 效应分布:", JSON.stringify(byEff));

// no-sites UNKNOWN
const unk = r.verdicts.filter((v) => v.purity === UNKNOWN && (!v.chunk.unknownCalls || v.chunk.unknownCalls.length === 0));
console.log("\nno-sites UNKNOWN:", unk.length);
// 抽样看这些 chunk 的形态
const shapes = {};
for (const v of unk.slice(0, 200)) {
  const k = v.chunk.parseError ? "parseError" : (v.chunk.calls.has("?") ? "has?" : (v.chunk.calls.size === 0 ? "no-calls" : "has-calls"));
  shapes[k] = (shapes[k] ?? 0) + 1;
}
console.log("no-sites 形态:", JSON.stringify(shapes));
for (const v of unk.slice(0, 8)) {
  console.log(`  ${v.chunk.name} parseError=${v.chunk.parseError} calls=[${[...v.chunk.calls].slice(0, 4)}] eff=[${[...v.effects]}] ${v.chunk.file.split("/").slice(-2).join("/")}:${v.chunk.line}`);
}
