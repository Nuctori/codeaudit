const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
// D-079 纪律门禁：README 声称测试数 == vitest 实测（本地校验；CI 用 bash 脚本版）
// CI 实证（2026-08-14 连续 5 次红）：GitHub runner 上 vitest 输出带 ANSI 色码，
// 色码插在 "Tests" 与数字之间导致裸正则匹配失败——先剥 ANSI 再匹配。
const out = execFileSync("node", ["node_modules/vitest/vitest.mjs", "run"], {
	encoding: "utf8",
	maxBuffer: 32 * 1024 * 1024,
});
const plain = out.replace(/\x1b\[[0-9;]*m/g, "");
const m = plain.match(/Tests\s+(\d+)\s+passed/);
if (!m) {
	// 失败时吐出诊断尾部，避免 CI 上再次盲猜
	console.error("cannot parse vitest output; tail:");
	console.error(plain.slice(-2000));
	process.exit(1);
}
const actual = Number(m[1]);
const readme = fs.readFileSync("README.md", "utf8");
const claims = [...readme.matchAll(/(?:# |^)(\d+) 个测试/g)].map((x) =>
	Number(x[1]),
);
for (const c of claims) {
	if (c !== actual) {
		console.error(
			`README claims ${c} tests but actual is ${actual} (D-079 discipline)`,
		);
		process.exit(1);
	}
}
console.log(`README test count OK: ${actual}`);
