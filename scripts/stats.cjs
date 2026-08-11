// 提取扫描报告 stats（工具脚本：失败即退出非零）
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
console.log(
  `chunks ${s.chunks} | files ${s.files} | pure ${s.pure} | impure ${s.impure} | unknown ${s.unknown} | unknownRate ${(s.unknownRate * 100).toFixed(1)}% | cycles ${s.cycles} | parseErrors ${s.parseErrors}`,
);
