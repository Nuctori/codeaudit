// 分析 InitDeity 基线报告：unknown 形态分布 / 效应源 top / 假纯候选
// 用法: node scripts/analyze-id-report.cjs <report.json>
const fs = require("fs");
let r;
try {
  r = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
} catch (e) {
  console.error("cannot read report:", e.message);
  process.exit(1);
}
const by = (key) => r.verdicts.filter((v) => v.purity === key);
const PURE = 0, UNKNOWN = 1, IMPURE = 2;

console.log("=== 1. UNKNOWN 形态分布（top 15，按 unknownCalls attr 组合） ===");
const unk = by(UNKNOWN);
const byShape = {};
for (const v of unk) {
  const s = (v.chunk.unknownCalls ?? []).map((c) => c.attr).slice(0, 2).join("+") || "no-sites";
  byShape[s] = (byShape[s] ?? 0) + 1;
}
console.log("UNKNOWN chunks:", unk.length);
Object.entries(byShape).sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([k, n]) => console.log(`  ${n}  ${k}`));

console.log("\n=== 2. 效应源 top 12（IMPURE + chain=0 + direct 非空） ===");
const srcs = by(IMPURE)
  .filter((v) => v.chain === 0 && v.chunk.direct.size > 0)
  .sort((a, b) => b.chunk.calls.size - a.chunk.calls.size)
  .slice(0, 12);
for (const v of srcs) {
  console.log(`  ${String(v.chunk.calls.size).padStart(4)}  ${v.chunk.name}  [${[...v.effects].join(",")}]  ${v.chunk.file.split("/").slice(-2).join("/")}:${v.chunk.line}`);
}

console.log("\n=== 3. 假纯候选（PURE 但含可疑形态：直接调 io 库方法名） ===");
const ioMethods = new Set(["Console", "WriteLine", "Debug", "Log", "File", "ReadAllText", "WriteAllText", "HttpClient", "SendAsync", "GetAsync", "PostAsync", "PlayerPrefs", "SetInt", "SetString", "GetInt", "GetString", "DontDestroyOnLoad", "Application.OpenURL", "WWW", "UnityWebRequest", "Destroy", "Instantiate", "PlayerPrefs", "System.IO", "FileStream"]);
let fp = 0;
for (const v of by(PURE)) {
  for (const c of v.chunk.calls) {
    if (c === "?") continue;
    const last = String(c).split("::").pop();
    if ([...ioMethods].some((m) => last.includes(m))) {
      console.log(`  [FP?] ${v.chunk.name} calls ${last} @ ${v.chunk.file.split("/").slice(-2).join("/")}:${v.chunk.line}`);
      fp++;
      break;
    }
  }
}
console.log("假纯候选:", fp);
