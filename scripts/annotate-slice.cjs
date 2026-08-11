#!/usr/bin/env node
/**
 * 标注分片（迭代21 工作流优化）：verdicts（--json 扫描输出）+ 现有 annotations → N 片。
 *
 * 用法：
 *   node scripts/annotate-slice.cjs <report.json> <out-dir> [N] [annotations.json]
 *   - report.json：codeaudit scan --format json 输出（含 verdicts）
 *   - out-dir：分片输出目录（slice-0.json … slice-N-1.json + annotations-current.json）
 *   - N：分片数（默认 4）
 *   - annotations.json：可选，已有标注（已标 id 排除分片）
 *
 * 分片逻辑：未标注 UNKNOWN chunk 按影响面（calls.size + unknownSites）降序轮询分发，
 * 保证每片工作量近似且高影响面优先处理。
 */
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const HELP = `用法: node scripts/annotate-slice.cjs <report.json> <out-dir> [N] [annotations.json]
  report.json     codeaudit scan --format json 输出
  out-dir         分片输出目录
  N               分片数（默认 4）
  annotations.json 已有标注（可选，已标 id 排除）`;

function main() {
  const argv = process.argv.slice(2);
  if (argv.length < 2 || argv[0] === "-h" || argv[0] === "--help") {
    console.log(HELP);
    process.exit(argv.length >= 2 && argv[0] !== "-h" && argv[0] !== "--help" ? 0 : 0);
  }
  const [reportPath, outDir, nRaw, annPath] = argv;
  const N = nRaw ? Math.max(1, Number.parseInt(nRaw, 10) || 4) : 4;
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const verdicts = report.verdicts;
  if (!Array.isArray(verdicts)) {
    console.error("report.json 缺少 verdicts 数组");
    process.exit(1);
  }
  let have = new Set();
  if (annPath) {
    const ann = JSON.parse(fs.readFileSync(annPath, "utf8"));
    have = new Set(ann.map((a) => a.id));
  }
  // 未标注 UNKNOWN chunk（purity === 1）
  const targets = verdicts
    .filter((v) => v.purity === 1 && !have.has(v.chunk.id))
    .sort((a, b) => (b.chunk.calls.size + b.chunk.unknownSites) - (a.chunk.calls.size + a.chunk.unknownSites));
  const slices = Array.from({ length: N }, () => []);
  targets.forEach((v, i) => slices[i % N].push(v));
  fs.mkdirSync(outDir, { recursive: true });
  slices.forEach((slice, i) => {
    const data = slice.map((v) => ({
      id: v.chunk.id,
      key: v.chunk.key,
      name: v.chunk.name,
      file: v.chunk.file,
      startLine: v.chunk.startLine,
      endLine: v.chunk.endLine,
      calls: v.chunk.calls.size,
      unknownSites: v.chunk.unknownSites,
    }));
    fs.writeFileSync(path.join(outDir, `slice-${i}.json`), JSON.stringify(data, null, 1));
  });
  // 校验报告元数据写入
  fs.writeFileSync(
    path.join(outDir, "meta.json"),
    JSON.stringify({ n: N, total: targets.length, perSlice: slices.map((s) => s.length), createdAt: new Date().toISOString() }, null, 1),
  );
  if (annPath) {
    fs.copyFileSync(annPath, path.join(outDir, "annotations-current.json"));
  }
  console.log(`分片完成: ${targets.length} 条 → ${N} 片（${slices.map((s) => s.length).join("/")}）→ ${outDir}`);
}

main();
