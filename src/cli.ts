#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { scanProject } from "./index";
import { Purity, UNKNOWN_TARGET, type Verdict, type Chunk } from "./core/types";
import { annotationBudget, annotationCurve } from "./core/influence";
import { emptyCorpus, updateCorpus, priorFor, summarize, type CorpusFile } from "./core/corpus";

interface CliArgs {
  dir: string;
  format: "text" | "json";
  top: number | null;
  unknowns: string | null;
  annotations: string | null;
  corpus: string | null;
  noCache: boolean;
  strict: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    dir: ".", format: "text", top: null, unknowns: null, annotations: null, corpus: null,
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
    else if (a === "--annotations") args.annotations = rest[++i]!;
    else if (a === "--corpus") args.corpus = rest[++i]!;
    else if (a === "--no-cache") args.noCache = true;
    else if (a === "--strict") args.strict = true;
    else if (a === "--help" || a === "-h") { printHelp(); process.exit(0); }
    else if (a.startsWith("-")) {
      throw new Error("未知选项 " + a); // main().catch → exitCode 2
    }
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
  --annotations <file> 回读 AI 标注（[{id, verdict:"PURE"|"IMPURE"}]，按 chunk.id 匹配，减少未知）
  --corpus <file>      标注语料文件（默认 .codeaudit/corpus.json；累积先验供 suggested_prompt）
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

let cliRoot = "";

/** 版本号：从 package.json 读（硬编码会随 bump 漂移）；读取失败回退占位。 */
const VERSION = (() => {
  try {
    return (JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/** 错误消息中的绝对路径前缀裁剪为 "."（段边界：仅当下个字符不是路径延续字符；root 为空/不出现则原样）。 */
function trimRootPath(msg: string): string {
  if (!cliRoot || !msg.includes(cliRoot)) return msg;
  const i = msg.indexOf(cliRoot);
  const after = msg[i + cliRoot.length];
  if (after !== undefined && /[A-Za-z0-9_.~-]/.test(after)) return msg; // D:\proj2 不裁剪；引号/分隔符/结尾则裁剪
  return msg.slice(0, i) + "." + msg.slice(i + cliRoot.length);
}

/** 语料先验提示（建议置信度，非纯度判定；n 不足/分歧大时不提示）。 */
function priorHint(corpus: CorpusFile, sites: Chunk["unknownCalls"]): string {
  const hints: string[] = [];
  for (const site of sites) {
    const p = priorFor(corpus, site);
    if (!p) continue;
    if (p.pPure >= 0.65) hints.push(`「${site.attr}」形态历史 ≈${(p.pPure * 10).toFixed(0)} 成被标 PURE（n=${p.n}）`);
    else if (p.pPure <= 0.35) hints.push(`「${site.attr}」形态历史 ≈${((1 - p.pPure) * 10).toFixed(0)} 成被标 IMPURE（n=${p.n}）`);
  }
  return hints.length > 0
    ? " | " + hints.join("；") + " —— 语料先验为建议置信度，非纯度判定，请以函数体为准"
    : "";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const root = resolve(args.dir);
  cliRoot = root;

  let annotations: ReadonlyMap<string, "PURE" | "IMPURE"> | undefined;
  if (args.annotations) {
    try {
      const list = JSON.parse(readFileSync(args.annotations, "utf8")) as Array<{ id?: unknown; verdict?: unknown; file?: unknown }>;
      const m = new Map<string, "PURE" | "IMPURE">();
      for (const item of list) {
        if (item && typeof item.id === "string" && (item.verdict === "PURE" || item.verdict === "IMPURE")) {
          // 带 file 的标注锚定到具体实例（同内容跨文件判定可不同——import 上下文差异）；
          // 纯 id = 内容寻址（公理4 语义：同内容同判定，适用于全部同 id chunk）
          m.set(typeof item.file === "string" ? item.file + "\u0000" + item.id : item.id, item.verdict);
        }
      }
      annotations = m;
      console.error(`annotations -> ${args.annotations} (${m.size} 条生效)`);
    } catch {
      console.error("codeaudit: 无法读取标注文件 " + args.annotations);
      process.exit(2);
    }
  }

  const report = await scanProject(root, {
    useCache: !args.noCache,
    cacheDir: resolve(root, ".codeaudit"),
    annotations,
  });

  // 标注语料：加载（--corpus 或项目默认）→ 标注回读累积 → 保存（幂等去重）
  let corpus: CorpusFile = emptyCorpus();
  const corpusPath = args.corpus ?? (args.noCache ? null : join(resolve(root, ".codeaudit"), "corpus.json"));
  if (corpusPath) {
    try {
      corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as CorpusFile;
      if (!corpus || corpus.version !== 1) corpus = emptyCorpus();
    } catch {
      corpus = emptyCorpus();
    }
    if (annotations && annotations.size > 0) {
      const before = summarize(corpus);
      corpus = updateCorpus(corpus, report.verdicts.map((v) => v.chunk), annotations);
      const after = summarize(corpus);
      if (after.total > before.total) {
        try {
          mkdirSync(dirname(corpusPath), { recursive: true });
          writeFileSync(corpusPath, JSON.stringify(corpus, null, 2));
          console.error(`语料 -> ${corpusPath}（累计 ${after.pure} pure / ${after.impure} impure）`);
        } catch {
          // 语料写失败不影响扫描结果
        }
      }
    }
  }

  if (report.stats.invariantViolations > 0 || report.stats.staleEdges > 0) {
    console.error(
      `codeaudit: warning — ${report.stats.invariantViolations} invariant violations, ${report.stats.staleEdges} stale edges`,
    );
  }

  if (args.format === "json") {
    // --top 对 JSON 同样生效（只看前 N 条；schema 不变）
    const out = args.top !== null ? { ...report, verdicts: report.verdicts.slice(0, args.top) } : report;
    console.log(JSON.stringify(out, (k, v) =>
      v instanceof Set ? [...v] : v === Infinity ? "Infinity" : v, 2));
  } else {
    const s = report.stats;
    console.log(
      `codeaudit ${VERSION} — ${s.chunks} chunks, ${s.files} files, ` +
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
    const chunks = report.verdicts.map((v) => v.chunk);
    const budget = annotationBudget(chunks);
    const unknowns = report.verdicts
      .filter((v) => v.purity === Purity.UNKNOWN && v.chunk.calls.has(UNKNOWN_TARGET))
      .map((v) => ({
        id: v.chunk.id,
        symbol: v.chunk.name,
        file: v.chunk.file,
        line: v.chunk.line,
        influence: budget.influence.get(v.chunk.key) ?? 0,
        unknownSites: v.chunk.unknownSites,
        calls: v.chunk.unknownCalls,
        suggested_prompt:
          `函数 \`${v.chunk.name}\`（${v.chunk.file}:${v.chunk.line}）有 ${v.chunk.unknownSites} 个无法静态解析的调用点。` +
          `请判断它是否执行 I/O 或副作用，回答 PURE / IMPURE / UNKNOWN 并给出一句话理由（PURE 需全部调用点确证）。` +
          priorHint(corpus, v.chunk.unknownCalls),
      }))
      .sort((a, b) => b.influence - a.influence);
    writeFileSync(args.unknowns, JSON.stringify(unknowns, null, 2));
    // 标注曲线：按影响面贪心序的精确剩余 UNKNOWN（"标到多少就够"的预算数学）。
    // order = 导出源集（UNKNOWN 且含 `?`）；IMPURE 带未知的源不在清单、不参与释放计数
    const order = report.verdicts
      .filter((v) => v.purity === Purity.UNKNOWN && v.chunk.calls.has(UNKNOWN_TARGET))
      .map((v) => v.chunk.key)
      .sort((a, b) => (budget.influence.get(b) ?? 0) - (budget.influence.get(a) ?? 0));
    const unknownKeys = new Set(
      report.verdicts.filter((v) => v.purity === Purity.UNKNOWN).map((v) => v.chunk.key),
    );
    const curve = annotationCurve(budget, order, unknownKeys);
    const total = curve[0] ?? 0;
    const pts = [0, 0.1, 0.25, 0.5, 0.75, 1].map((p) => {
      const k = Math.min(order.length, Math.round(p * order.length));
      const rem = curve[k] ?? 0;
      return `标${k}条→${rem} (${((rem / report.stats.chunks) * 100).toFixed(1)}%)`;
    });
    console.error(`unknowns -> ${args.unknowns} (${unknowns.length} 条, 全标后 ${total}→${curve[curve.length - 1] ?? 0})`);
    console.error(`标注曲线(贪心序): ${pts.join(" | ")}`);
  }

  if (args.strict && report.stats.impure > 0) process.exitCode = 1;
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("codeaudit: " + trimRootPath(msg));
  process.exitCode = 2; // 自然退出：process.exit 与 wasm 句柄关闭竞态会使退出码变 127
});
