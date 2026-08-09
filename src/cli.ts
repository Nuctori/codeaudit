#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { scanProject } from "./index";
import { Purity, UNKNOWN_TARGET, type Verdict } from "./core/types";
import { influenceAnalysis } from "./core/influence";

interface CliArgs {
  dir: string;
  format: "text" | "json";
  top: number | null;
  unknowns: string | null;
  noCache: boolean;
  strict: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dir: ".", format: "text", top: null, unknowns: null,
    noCache: false, strict: false,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "scan") continue;
    if (a === "--format") args.format = rest[++i] === "json" ? "json" : "text";
    else if (a === "--json") args.format = "json";
    else if (a === "--top") {
      const n = parseInt(rest[++i] ?? "", 10);
      args.top = Number.isFinite(n) && n > 0 ? n : null;
    }
    else if (a === "--unknowns") args.unknowns = rest[++i]!;
    else if (a === "--no-cache") args.noCache = true;
    else if (a === "--strict") args.strict = true;
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else if (!a.startsWith("-")) args.dir = a;
  }
  return args;
}

function printHelp(): void {
  console.log(`codeaudit — 跨语言代码纯度审计（传染链分析）

用法: codeaudit scan [目录] [选项]

选项:
  --format text|json   输出格式（默认 text）
  --top N              只显示前 N 条
  --unknowns <file>    导出未解析符号清单（按影响面排序，含 id 锚点，供 AI 标注）
  --no-cache           禁用增量缓存
  --strict             存在 IMPURE chunk 时退出码为 1
  -h, --help           显示帮助
`);
}

function fmtChain(v: Verdict): string {
  if (v.chain === Infinity) return "   -";
  const s = String(v.chain).padStart(4);
  // 不确定链显示区间 [audit, dev]：如 0?→3（标注后可能翻案到 3）
  return v.chainCertain ? s : `${s}?→${v.chainDev === Infinity ? "-" : v.chainDev}`;
}

function fmtEffects(v: Verdict): string {
  const parts = [...v.effects].sort();
  if (v.purity === Purity.UNKNOWN) parts.push("?");
  return "{" + parts.join(",") + "}";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const root = resolve(args.dir);
  const report = await scanProject(root, {
    useCache: !args.noCache,
    cacheDir: resolve(root, ".codeaudit"),
  });

  if (report.stats.invariantViolations > 0 || report.stats.staleEdges > 0) {
    console.error(
      `codeaudit: warning — ${report.stats.invariantViolations} invariant violations, ${report.stats.staleEdges} stale edges`,
    );
  }

  if (args.format === "json") {
    console.log(JSON.stringify(report, (k, v) =>
      v instanceof Set ? [...v] : v === Infinity ? "Infinity" : v, 2));
  } else {
    const s = report.stats;
    console.log(
      `codeaudit 0.1.0 — ${s.chunks} chunks, ${s.files} files, ` +
      `unknown-rate ${(s.unknownRate * 100).toFixed(1)}%, cycles ${s.cycles}` +
      (s.cachedFiles > 0 ? `, cached ${s.cachedFiles}` : "") +
      (s.parseErrors > 0 ? `, parse-errors ${s.parseErrors}` : ""),
    );
    let shown = report.verdicts.filter((v) => v.purity !== Purity.PURE);
    if (args.top !== null) shown = shown.slice(0, args.top);
    let lastGroup = "";
    for (const v of shown) {
      const group = v.purity === Purity.IMPURE ? "IMPURE" : "UNKNOWN (audit 假设为不纯)";
      if (group !== lastGroup) { console.log("\n" + group); lastGroup = group; }
      console.log(
        `  chain=${fmtChain(v)}  ${fmtEffects(v).padEnd(10)} ` +
        `${v.chunk.name.padEnd(28)} ${v.chunk.file}:${v.chunk.line}`,
      );
    }
    console.log(
      `\nSTATS: pure ${s.pure}, impure ${s.impure}, unknown ${s.unknown}`,
    );
  }

  if (args.unknowns) {
    // 影响面排序：只导出自身含 `?` 的源（纯传播型 UNKNOWN 标它无意义）；
    // 影响面 = 该符号反向可达闭包内的 chunk 数（一次标注解除的 UNKNOWN 量）
    const influence = influenceAnalysis(report.verdicts.map((v) => v.chunk));
    const unknowns = report.verdicts
      .filter((v) => v.purity === Purity.UNKNOWN && v.chunk.calls.has(UNKNOWN_TARGET))
      .map((v) => ({
        id: v.chunk.id,
        symbol: v.chunk.name,
        file: v.chunk.file,
        line: v.chunk.line,
        influence: influence.get(v.chunk.key) ?? 0,
        suggested_prompt:
          `函数 \`${v.chunk.name}\`（${v.chunk.file}:${v.chunk.line}）调用了无法静态解析的符号。` +
          `请判断它是否执行 I/O 或副作用，回答 PURE / IMPURE / UNKNOWN 并给出一句话理由。`,
      }))
      .sort((a, b) => b.influence - a.influence);
    writeFileSync(args.unknowns, JSON.stringify(unknowns, null, 2));
    console.error(`unknowns -> ${args.unknowns} (${unknowns.length} 条)`);
  }

  if (args.strict && report.stats.impure > 0) process.exit(1);
}

main().catch((err) => {
  console.error("codeaudit: " + (err instanceof Error ? err.message : String(err)));
  process.exit(2);
});
