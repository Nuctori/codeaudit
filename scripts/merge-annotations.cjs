#!/usr/bin/env node
/**
 * 标注合并（迭代21 工作流优化）：多片标注输出 → 合并去重 + 校验。
 *
 * 用法：
 *   node scripts/merge-annotations.cjs <ann-dir> <report.json> <out.json>
 *   - ann-dir：分片目录（slice-0-out.json … 每片标注输出 [{id, verdict}]）
 *   - report.json：codeaudit scan --format json 输出（校验 id 存在）
 *   - out.json：合并后的 annotations 文件（[{id, verdict}]）
 *
 * 校验逻辑：
 *   1. id 存在性：标注的 id 必须在 report.verdicts 中（stale 标注拒收）
 *   2. 矛盾双 verdict：同 id 出现在多片且 verdict 不同 → 标记（默认取 IMPURE——保守方向）
 *   3. 排序确定性：按 id 字典序输出
 */
const fs = require("node:fs");
const path = require("node:path");

const HELP = `用法: node scripts/merge-annotations.cjs <ann-dir> <report.json> <out.json>
  ann-dir  分片目录（slice-*-out.json）
  report.json  scan --format json 输出（id 校验）
  out.json  合并输出`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 3 || argv[0] === "-h" || argv[0] === "--help") {
    console.log(HELP);
    process.exit(0);
  }
  const [annDir, reportPath, outPath] = argv;
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const validIds = new Set(report.verdicts.map((v) => v.chunk.id));
  const files = fs.readdirSync(annDir).filter((f) => /^slice-\d+-out\.json$/.test(f)).sort();
  const merged = new Map(); // id -> verdict
  const conflicts = [];
  const stale = [];
  for (const f of files) {
    const entries = JSON.parse(fs.readFileSync(path.join(annDir, f), "utf8"));
    for (const a of entries) {
      if (!validIds.has(a.id)) { stale.push(a.id); continue; }
      const existing = merged.get(a.id);
      if (existing !== undefined && existing !== a.verdict) {
        conflicts.push({ id: a.id, first: existing, second: a.verdict });
        merged.set(a.id, "IMPURE"); // 保守方向
      } else {
        merged.set(a.id, a.verdict);
      }
    }
  }
  const out = [...merged.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([id, verdict]) => ({ id, verdict }));
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  console.log(`合并完成: ${files.length} 片 → ${out.length} 条（stale ${stale.length} / 冲突 ${conflicts.length}）→ ${outPath}`);
  if (conflicts.length > 0) {
    console.error(`  冲突（取 IMPURE 保守）: ${conflicts.map((c) => `${c.id}:${c.first}≠${c.second}`).slice(0, 5).join(", ")}${conflicts.length > 5 ? "…" : ""}`);
  }
  if (stale.length > 0) {
    console.error(`  stale id（不在本次扫描——已拒收）: ${stale.slice(0, 5).join(", ")}${stale.length > 5 ? "…" : ""}`);
  }
}

main();
