import { mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, normalize, extname, sep } from "node:path";
import type Parser from "web-tree-sitter";
import type { LangPack, RawFileFacts, TreeSitterLanguage } from "../lang/pack";
import { Extractor } from "../lang/extractor";
import { link } from "./link";
import { analyze } from "../core/analyze";
import { Purity, type ScanReport, UNKNOWN_TARGET, type Effect } from "../core/types";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".venv", "venv",
  "__pycache__", ".mypy_cache", ".pytest_cache", "vendor", "target",
  ".next", ".nuxt", "coverage", ".codeaudit",
]);

export interface ScanOptions {
  readonly root: string;
  readonly cacheDir?: string | undefined;
  readonly useCache?: boolean;
  readonly packs: readonly LangPack[];
  readonly loadLanguage: (pack: LangPack) => Promise<TreeSitterLanguage>;
  readonly ParserCtor: typeof Parser;
  /** 人工/AI 标注回读：chunk.id → 判定。PURE 移除该 chunk 自身 `?`；IMPURE 加直接 io 效应。 */
  readonly annotations?: ReadonlyMap<string, "PURE" | "IMPURE">;
}

const CACHE_VERSION = 6; // v6：stateWrites 布尔→数组 + stateReads 新增（旧 v5 缓存拒 → 全量重扫） // v5：schema 通道；提取行为变更走自动指纹（computeFingerprint），不再手动 bump

/** 目录递归深度上限（8000 层目录会栈溢出；超限跳过）。 */
const MAX_DEPTH = 512;
/** 单文件大小上限（10MB：超限跳过，防 OOM）。 */
const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * 行为指纹：哈希一切能改变 RawFileFacts 的输入——提取器源码（lang/ 含 extractor 模块级函数
 * 与 extractImports 行为）+ 语法包版本（wasm 升级改变解析）。link 期效应表（impureModules 等）
 * 不缓存、每次扫描重跑，故不参与指纹（加表不应失效缓存）。哈希失败降级为常量（与现状同级安全）。
 */
function computeFingerprint(): string {
  const h = createHash("sha256");
  try {
    const base = join(__dirname, "..", "lang");
    const files: string[] = [];
    for (const f of readdirSync(base)) if (f.endsWith(".js") || f.endsWith(".ts")) files.push(f);
    for (const f of readdirSync(join(base, "packs"))) if (f.endsWith(".js") || f.endsWith(".ts")) files.push("packs/" + f);
    files.sort();
    for (const f of files) h.update(f).update(readFileSync(join(base, f)));
    try {
      h.update(readFileSync("node_modules/tree-sitter-wasms/package.json"));
    } catch { /* 语法包缺失 → 不参与 */ }
  } catch {
    return "const:" + CACHE_VERSION;
  }
  return h.digest("hex");
}

interface CacheFile {
  version: typeof CACHE_VERSION;
  fingerprint: string;
  files: Record<string, { contentHash: string; facts: RawFileFacts }>;
}

/** 投毒防护：facts 形状下探到 chunk/import 字段（chunks:[{}] 可穿透仅数组校验）。 */
const MAX_CACHE_CHUNKS = 50_000; // 单文件 50k 函数（10MB 上限内实际不可达，纯预算护栏）
const MAX_CACHE_CALLS = 200_000;
const MAX_CACHE_FILE_BYTES = 64 * 1024 * 1024; // cache.json 大小上限：parse 前检查（防 OOM DoS）
const MAX_CACHE_NORMTEXT = 1024 * 1024; // 单 chunk normText 字节上限（数量预算之外的字节预算）
function validFacts(f: RawFileFacts | undefined): f is RawFileFacts {
  if (!f || typeof f.lang !== "string" || !Array.isArray(f.chunks) || !Array.isArray(f.imports)) return false;
  if (f.moduleBindings !== undefined && (typeof f.moduleBindings !== "object" || f.moduleBindings === null)) return false;
  if (f.chunks.length > MAX_CACHE_CHUNKS) return false; // 超预算整包拒绝 → 全量重扫（防 316MB 缓存放大 DoS）
  if (!f.chunks.some((c) => c?.name === "<module>")) return false; // 真文件必有 <module> 伪块：chunks:[] 空包穿透防护
  let totalCalls = 0;
  for (const c of f.chunks) {
    if (!c || typeof c.name !== "string" || typeof c.normText !== "string" ||
        typeof c.line !== "number" || !Array.isArray(c.calls) || !Array.isArray(c.assigned)) return false;
    if (c.normText.length > MAX_CACHE_NORMTEXT) return false; // 巨型 normText 被哈希+常驻内存（字节预算）
    // v6 形状：stateWrites/stateReads 数组（v5 boolean stateWrites 拒 → 防静默漏报 state 效应）
    if (!Array.isArray(c.stateWrites) || !Array.isArray(c.stateReads)) return false;
    totalCalls += c.calls.length;
    if (totalCalls > MAX_CACHE_CALLS) return false;
  }
  for (const i of f.imports) {
    if (!i || typeof i.local !== "string" || typeof i.module !== "string") return false;
  }
  for (const c of f.chunks) {
    for (const call of c.calls) {
      if (!call || typeof call.attr !== "string" ||
          (call.obj !== null && typeof call.obj !== "string") ||
          (call.receiver !== null && typeof call.receiver !== "string")) return false;
    }
  }
  return true;
}

/** 递归发现源文件（稳定排序保证确定性；路径统一 / 分隔——跨平台一致）。 */
export function discoverFiles(root: string, packs: readonly LangPack[]): Map<string, LangPack> {
  const byExt = new Map<string, LangPack>();
  for (const p of packs) for (const e of p.extensions) byExt.set(e, p);
  const found = new Map<string, LangPack>();

  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_DEPTH) return; // 深度上限：防栈溢出
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (err) {
      if (depth === 0) throw err; // 根目录不存在/不可读 → 报错退出 2（main().catch）
      return; // 子目录不可读（EACCES）：跳过，不中断扫描
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(full, depth + 1);
      } else if (ent.isFile()) {
        const pack = byExt.get(extname(ent.name));
        if (pack) found.set(relative(root, full).split(sep).join("/"), pack);
      }
    }
  };
  walk(root, 0);
  return found;
}

export async function scan(opts: ScanOptions): Promise<ScanReport> {
  // 正斜杠统一（与 chunk.file/discoverFiles 一致）：Windows 上 root 不混用反斜杠
  const root = normalize(opts.root).split(sep).join("/");
  const fileMap = discoverFiles(root, opts.packs);
  const fingerprint = opts.useCache ? computeFingerprint() : "";

  let cache: CacheFile = { version: CACHE_VERSION, fingerprint, files: {} };
  const cachePath = opts.cacheDir ? join(opts.cacheDir, "cache.json") : null;
  if (opts.useCache && cachePath) {
    try {
      // parse 前大小上限：恶意仓库自带 GB 级 cache.json → JSON.parse OOM（V8 堆耗尽不可捕获）
      if (statSync(cachePath).size > MAX_CACHE_FILE_BYTES) throw new Error("cache too large");
      const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as CacheFile;
      // 版本 + 行为指纹 + 结构三重校验（陈旧/畸形/投毒缓存 → 全量重扫）
      if (parsed && parsed.version === CACHE_VERSION && parsed.fingerprint === fingerprint &&
          parsed.files && typeof parsed.files === "object") {
        cache = parsed;
      }
    } catch {
      cache = { version: CACHE_VERSION, fingerprint, files: {} };
    }
  }
  const nextCache: CacheFile = { version: CACHE_VERSION, fingerprint, files: {} };
  let cachedFiles = 0;
  let skippedFiles = 0;

  const extractors = new Map<string, Extractor>();
  const facts: RawFileFacts[] = [];
  const parseErrFiles = new Set<string>();

  const sortedFiles = [...fileMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [file, pack] of sortedFiles) {
    // 超限文件跳过（防 OOM）
    try {
      if (statSync(join(root, file)).size > MAX_FILE_SIZE) {
        skippedFiles++;
        continue;
      }
    } catch {
      skippedFiles++;
      continue;
    }
    let source: string;
    try {
      source = readFileSync(join(root, file), "utf8");
    } catch {
      skippedFiles++; // 读取失败（权限/竞态删除）：跳过并计数，用户知情
      continue;
    }
    const contentHash = createHash("sha256").update(source, "utf8").digest("hex");

    const hit = cache.files[file];
    // 缓存命中需内容 + 字段级结构双重校验（投毒防护：facts 形状必须完整）
    if (
      opts.useCache && hit && hit.contentHash === contentHash &&
      validFacts(hit.facts) && hit.facts.file === file && // 键即身份：缓存条目不得伪造 facts.file 指向兄弟文件
      opts.packs.some((p) => p.name === hit.facts!.lang)
    ) {
      facts.push(hit.facts);
      nextCache.files[file] = hit;
      cachedFiles++;
      continue;
    }

    let ex = extractors.get(pack.name);
    if (!ex) {
      const lang = await opts.loadLanguage(pack);
      ex = new Extractor(opts.ParserCtor, pack, lang);
      extractors.set(pack.name, ex);
    }
    // 单文件失败（病态代码/深递归/语法损毁）不得中断整体扫描
    let f: RawFileFacts;
    try {
      f = ex.extract(source, file, contentHash); // 透传已算的 contentHash：免双 sha256（M2 性能）
    } catch {
      f = {
        file, lang: pack.name, contentHash,
        chunks: [], imports: [], defaultExport: null, moduleBindings: {}, parseError: true,
      };
    }
    facts.push(f);
    // parseError 占位不写缓存（瞬时失败不得永久化——下次扫描重试）
    if (f.parseError) parseErrFiles.add(file);
    else nextCache.files[file] = { contentHash, facts: f };
  }

  if (opts.useCache && cachePath && opts.cacheDir) {
    try {
      mkdirSync(opts.cacheDir, { recursive: true });
      const tmp = cachePath + ".tmp";
      writeFileSync(tmp, JSON.stringify(nextCache));
      renameSync(tmp, cachePath); // 原子替换：防半写/符号链接劫持
    } catch {
      // 缓存写失败不影响扫描结果
    }
  }

  const packsByName = new Map(opts.packs.map((p) => [p.name, p]));
  const { chunks } = link(facts, packsByName);
  // H1：parseError 文件（hasError 或 extract 异常）chunk 内容不可信——tree-sitter 错误恢复可能吞掉
  // 真实调用（未闭合字符串把后续 import/调用吸进字符串节点）→ 整体降级 UNKNOWN（"?" 经 eff 集传导给调用者）
  const chunks2 = parseErrFiles.size === 0 ? chunks : chunks.map((c) =>
    parseErrFiles.has(c.file) && !c.calls.has(UNKNOWN_TARGET)
      ? { ...c, parseError: true, calls: new Set([...c.calls, UNKNOWN_TARGET]) }
      : (parseErrFiles.has(c.file) ? { ...c, parseError: true } : c),
  );
  // 标注回读：证据注入源头（公理3 闭环）。PURE → 移除该 chunk 自己的 `?`；
  // IMPURE → 加直接 io 效应。id 不匹配（内容已变）的条目静默忽略。
  const ann = opts.annotations;
  const analyzedChunks =
    ann && ann.size > 0
      ? chunks2.map((c) => {
          // 标注匹配：优先 (file, id) 实例锚定（显式实例覆写胜过内容寻址）；无 file 锚定则裸 id（迭代3 #4）
          const v = ann.get(`${c.file}\u0000${c.id}`) ?? ann.get(c.id);
          if (v === undefined) return c;
          if (v === "IMPURE") {
            if (c.direct.has("io")) return c;
            return { ...c, direct: new Set([...c.direct, "io" as Effect]) };
          }
          // H1 守卫（迭代3 #1，迭代4 F2 放宽）：parseError chunk 的 `?` 是内容信任标记（body 可能被
          // 错误恢复吞边），标注协议以函数体为准——而 body 本身不可信 → PURE 标注不可撤销降级；
          // IMPURE 标注是保守方向（只增 io）→ 仍放行
          if (parseErrFiles.has(c.file)) return c;
          if (!c.calls.has(UNKNOWN_TARGET)) return c;
          const calls = new Set(c.calls);
          calls.delete(UNKNOWN_TARGET);
          // 迭代18（标注工作流驱动）：移除 ? 必须同步减 unknownSites——否则 graphMetrics.unknownEdges /
          // evidence.missingSiteRate 在标注后失真（真实项目实测：标注后 unknownEdges 不变）
          return { ...c, calls, unknownSites: Math.max(0, c.unknownSites - 1) };
        })
      : chunks2;
  const { verdicts, cycleCount, staleEdges, invariantViolations } = analyze(analyzedChunks);

  const impure = verdicts.filter((v) => v.purity === Purity.IMPURE).length;
  const unknown = verdicts.filter((v) => v.purity === Purity.UNKNOWN).length;
  const uncertain = verdicts.filter((v) => !v.chainCertain).length;

  return {
    root,
    mode: "audit",
    verdicts,
    stats: {
      files: facts.length,
      skippedFiles,
      parseErrors: facts.filter((f) => f.parseError).length,
      chunks: verdicts.length,
      pure: verdicts.length - impure - unknown,
      impure,
      unknown,
      unknownRate: verdicts.length === 0 ? 0 : uncertain / verdicts.length,
      cycles: cycleCount,
      cachedFiles,
      staleEdges,
      invariantViolations,
    },
  };
}
