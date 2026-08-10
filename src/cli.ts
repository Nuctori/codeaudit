#!/usr/bin/env node
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { scanProject } from "./index";
import { Purity, UNKNOWN_TARGET, type Verdict, type Chunk } from "./core/types";
import { annotationBudget, annotationCurve } from "./core/influence";
import { emptyCorpus, updateCorpus, priorFor, summarize, siteShapeInfo, isCorpus, PRIOR_THRESHOLD, type CorpusFile } from "./core/corpus";

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
  --top N              只显示前 N 条治理项（非纯；text 与 json 同语义）
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

/** 语料先验提示（建议置信度，非纯度判定；n 不足/分歧大时不提示）。0.65/0.35 与 PRIOR_THRESHOLD 同源。 */
function priorHint(corpus: CorpusFile, sites: Chunk["unknownCalls"]): string {
  const hints: string[] = [];
  for (const site of sites) {
    const p = priorFor(corpus, site);
    if (!p) continue;
    if (p.pPure >= PRIOR_THRESHOLD) hints.push(`「${site.attr}」形态历史 ≈${(p.pPure * 10).toFixed(0)} 成被标 PURE（n=${p.n}）`);
    else if (p.pPure <= 1 - PRIOR_THRESHOLD) hints.push(`「${site.attr}」形态历史 ≈${((1 - p.pPure) * 10).toFixed(0)} 成被标 IMPURE（n=${p.n}）`);
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
      // parse 前大小上限（与 cache.json 同款）：仓库自带 GB 级语料 → JSON.parse OOM
      if (statSync(corpusPath).size > 64 * 1024 * 1024) throw new Error("corpus too large");
      const parsed = JSON.parse(readFileSync(corpusPath, "utf8")) as unknown;
      if (!isCorpus(parsed)) corpus = emptyCorpus();
      else corpus = parsed;
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
          const tmp = corpusPath + ".tmp";
          writeFileSync(tmp, JSON.stringify(corpus, null, 2));
          renameSync(tmp, corpusPath); // 原子替换：防符号链接写穿/半写
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
    // --top 与 text 语义一致：先滤 PURE（治理项 = 非纯），再取前 N（schema 不变）
    const out = args.top !== null
      ? { ...report, verdicts: report.verdicts.filter((v) => v.purity !== Purity.PURE).slice(0, args.top) }
      : report;
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
      // 传染路径（可解释性）：效应源 → ... → 本 chunk
      if (v.chainPath.length > 1) {
        console.log(`      传染: ${v.chainPath.join(" → ")}`);
      }
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
    // 影响面排序：只导出自身含 `?` 的源（纯传播型 UNKNOWN 标它无意义）。
    // 键 = UNKNOWN 密集影响面（反向可达闭包内 UNKNOWN chunk 数，与曲线释放目标一致；
    // 总影响面作平手）。全闭包（含 PURE/IMPURE）影响面大 ≠ 解除 UNKNOWN 多（统计评审迭代2 #3）。
    const unknownKeys = new Set(
      report.verdicts.filter((v) => v.purity === Purity.UNKNOWN).map((v) => v.chunk.key),
    );
    const impact = (k: string): number => (budget.released.get(k) ?? []).filter((x) => unknownKeys.has(x)).length;
    const byImpact = (a: string, b: string): number =>
      impact(b) - impact(a) || (budget.influence.get(b) ?? 0) - (budget.influence.get(a) ?? 0);
    const unknowns = report.verdicts
      .filter((v) => v.purity === Purity.UNKNOWN && v.chunk.calls.has(UNKNOWN_TARGET))
      .sort((a, b) => byImpact(a.chunk.key, b.chunk.key))
      .map((v) => {
        const sp = siteShapeInfo(corpus, v.chunk.unknownCalls);
        return {
          id: v.chunk.id,
          symbol: v.chunk.name,
          file: v.chunk.file,
          line: v.chunk.line,
          parseError: v.chunk.parseError ?? false,
          influence: budget.influence.get(v.chunk.key) ?? 0,
          unknownSites: v.chunk.unknownSites,
          calls: v.chunk.unknownCalls,
          shape: sp.shape,
          prior: sp.prior ? { pPure: sp.prior.pPure, n: sp.prior.n } : null,
          batchable: sp.batchable,
          suggested_prompt:
            `函数 \`${v.chunk.name}\`（${v.chunk.file}:${v.chunk.line}）有 ${v.chunk.unknownSites} 个无法静态解析的调用点。` +
            (v.chunk.parseError
              ? "该文件解析失败，函数体可能不完整（tree-sitter 错误恢复）——PURE 标注会被忽略，请只标 IMPURE 或改源码后重扫。"
              : `请判断它是否执行 I/O 或副作用，回答 PURE / IMPURE / UNKNOWN 并给出一句话理由（PURE 需全部调用点确证）。`) +
            priorHint(corpus, v.chunk.unknownCalls),
        };
      });
    // 原子写（与语料/缓存同款 tmp+rename）：--unknowns 指向预置符号链接时不写穿
    try {
      mkdirSync(dirname(args.unknowns), { recursive: true });
      const tmp = args.unknowns + ".tmp";
      writeFileSync(tmp, JSON.stringify(unknowns, null, 2));
      renameSync(tmp, args.unknowns);
    } catch {
      console.error("codeaudit: 无法写入 " + args.unknowns);
      process.exit(2);
    }
    // 标注曲线：按 UNKNOWN 密集影响面启发序的精确剩余 UNKNOWN（"标到多少就够"的预算数学）。
    // order = 导出源集（UNKNOWN 且含 `?`）；IMPURE 带未知的源不在清单、不参与释放计数。
    // 注：启发序非边际最优（共享源 chunk 的边际释放 < 桶大小）——给定顺序曲线精确，最优性留待改进
    const order = report.verdicts
      .filter((v) => v.purity === Purity.UNKNOWN && v.chunk.calls.has(UNKNOWN_TARGET))
      .map((v) => v.chunk.key)
      .sort(byImpact);
    const curve = annotationCurve(budget, order, unknownKeys);
    const total = curve[0] ?? 0;
    const pts = [0, 0.1, 0.25, 0.5, 0.75, 1].map((p) => {
      const k = Math.min(order.length, Math.round(p * order.length));
      const rem = curve[k] ?? 0;
      return `标${k}条→${rem} (${((rem / report.stats.chunks) * 100).toFixed(1)}%)`;
    });
    console.error(`unknowns -> ${args.unknowns} (${unknowns.length} 条, 全标后 ${total}→${curve[curve.length - 1] ?? 0})`);
    // staleEdges>0 时悬垂边 UNKNOWN 不可标注释放（目标不存在，只能重扫修复）——曲线终值低于 stats.unknown 属此因
    console.error(`标注曲线(贪心序): ${pts.join(" | ")}${report.stats.staleEdges > 0 ? `（注：${report.stats.staleEdges} 条悬垂边 UNKNOWN 只能重扫修复，不参与释放）` : ""}`);
  }

  if (args.strict && report.stats.impure > 0) process.exitCode = 1;
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("codeaudit: " + trimRootPath(msg));
  process.exitCode = 2; // 自然退出：process.exit 与 wasm 句柄关闭竞态会使退出码变 127
});
