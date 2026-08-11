const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
// D-079 纪律门禁：README 声称测试数 == vitest 实测（本地校验；CI 用 bash 脚本版）
const out = execFileSync("node", ["node_modules/vitest/vitest.mjs", "run"], { encoding: "utf8" });
const m = out.match(/Tests\s+(\d+)\s+passed/);
if (!m) { console.error("cannot parse vitest output"); process.exit(1); }
const actual = Number(m[1]);
const readme = fs.readFileSync("README.md", "utf8");
const claims = [...readme.matchAll(/(?:# |^)(\d+) 个测试/g)].map((x) => Number(x[1]));
for (const c of claims) {
  if (c !== actual) {
    console.error(`README claims ${c} tests but actual is ${actual} (D-079 discipline)`);
    process.exit(1);
  }
}
console.log(`README test count OK: ${actual}`);
