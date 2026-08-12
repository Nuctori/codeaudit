// 提取扫描报告 purity 分布（工具脚本）
const fs = require("fs");
const p = process.argv[2];
let r;
try {
  r = JSON.parse(fs.readFileSync(p, "utf8"));
} catch (e) {
  console.error("cannot read report:", e.message);
  process.exit(1);
}
const s = r.stats;
let pure = 0, impure = 0, unknown = 0;
for (const v of r.verdicts) {
  if (v.purity === 0) pure++;
  else if (v.purity === 2) impure++;
  else unknown++;
}
console.log(
  `chunks ${s.chunks} | pure ${pure} | impure ${impure} | unknown ${unknown} | purityUnknownRate ${(unknown / s.chunks * 100).toFixed(1)}% | stats.unknown ${s.unknown ?? "n/a"} | unknownRate ${((s.unknownRate ?? 0) * 100).toFixed(1)}%`,
);
