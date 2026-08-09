import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, normalize, extname } from "node:path";
import type Parser from "web-tree-sitter";
import type { LangPack, RawFileFacts, TreeSitterLanguage } from "../lang/pack";
import { Extractor } from "../lang/extractor";
import { link } from "./link";
import { analyze } from "../core/analyze";
import { Purity, type ScanReport, UNKNOWN_TARGET } from "../core/types";

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

const CACHE_VERSION = 2;

interface CacheFile {
  version: typeof CACHE_VERSION;
  files: Record<string, { contentHash: string; facts: RawFileFacts }>;
}

/** 递归发现源文件（稳定排序保证确定性）。 */
export function discoverFiles(root: string, packs: readonly LangPack[]): Map<string, LangPack> {
  const byExt = new Map<string, LangPack>();
  for (const p of packs) for (const e of p.extensions) byExt.set(e, p);
  const found = new Map<string, LangPack>();

  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) walk(full);
      } else if (ent.isFile()) {
        const pack = byExt.get(extname(ent.name));
        if (pack) found.set(normalize(relative(root, full)), pack);
      }
    }
  };
  walk(root);
  return found;
}

export async function scan(opts: ScanOptions): Promise<ScanReport> {
  const root = normalize(opts.root);
  const fileMap = discoverFiles(root, opts.packs);

  let cache: CacheFile = { version: CACHE_VERSION, files: {} };
  const cachePath = opts.cacheDir ? join(opts.cacheDir, "cache.json") : null;
  if (opts.useCache && cachePath) {
    try {
      const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as CacheFile;
      // facts 结构随版本演进（normText 等）；版本不符即全量重扫，防陈旧复用
      if (parsed && parsed.version === CACHE_VERSION) cache = parsed;
    } catch {
      cache = { version: CACHE_VERSION, files: {} };
    }
  }
  const nextCache: CacheFile = { version: CACHE_VERSION, files: {} };
  let cachedFiles = 0;

  const extractors = new Map<string, Extractor>();
  const facts: RawFileFacts[] = [];

  const sortedFiles = [...fileMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [file, pack] of sortedFiles) {
    let source: string;
    try {
      source = readFileSync(join(root, file), "utf8");
    } catch {
      continue; // 读取失败（权限/竞态删除）：跳过
    }
    const contentHash = createHash("sha256").update(source, "utf8").digest("hex");

    const hit = cache.files[file];
    // 缓存的 facts 必须来自当前已知的语言包（防版本漂移污染）
    if (
      opts.useCache && hit && hit.contentHash === contentHash &&
      opts.packs.some((p) => p.name === hit.facts.lang)
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
      f = ex.extract(source, file);
    } catch {
      f = {
        file, lang: pack.name, contentHash,
        chunks: [], imports: [], defaultExport: null, parseError: true,
      };
    }
    facts.push(f);
    nextCache.files[file] = { contentHash, facts: f };
  }

  if (opts.useCache && cachePath && opts.cacheDir) {
    try {
      mkdirSync(opts.cacheDir, { recursive: true });
      writeFileSync(cachePath, JSON.stringify(nextCache));
    } catch {
      // 缓存写失败不影响扫描结果
    }
  }

  const packsByName = new Map(opts.packs.map((p) => [p.name, p]));
  const { chunks } = link(facts, packsByName);
  // 标注回读：证据注入源头（公理3 闭环）。PURE → 移除该 chunk 自己的 `?`；
  // IMPURE → 加直接 io 效应。id 不匹配（内容已变）的条目静默忽略。
  const ann = opts.annotations;
  const analyzedChunks =
    ann && ann.size > 0
      ? chunks.map((c) => {
          const v = ann.get(c.id);
          if (v === undefined) return c;
          if (v === "IMPURE") {
            if (c.direct.has("io")) return c;
            return { ...c, direct: new Set([...c.direct, "io"]) };
          }
          if (!c.calls.has(UNKNOWN_TARGET)) return c;
          const calls = new Set(c.calls);
          calls.delete(UNKNOWN_TARGET);
          return { ...c, calls };
        })
      : chunks;
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
