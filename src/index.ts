import { ScanOptions, scan } from "./engine/scan";
import { pythonPack } from "./lang/packs/python";
import { typescriptPack, tsxPack } from "./lang/packs/typescript";
import { javascriptPack } from "./lang/packs/javascript";
import { initParser, loadLanguage } from "./loader";
import { changedImpact, type ChangeImpact } from "./core/influence";
import type { ScanReport } from "./core/types";

export const defaultPacks = [pythonPack, typescriptPack, tsxPack, javascriptPack];

/** 编程式 API：一行扫描。 */
export async function scanProject(
  root: string,
  opts?: {
    useCache?: boolean;
    cacheDir?: string;
    /** 标注回读：chunk.id → PURE/IMPURE（AI 标注闭环的注入端）。 */
    annotations?: ReadonlyMap<string, "PURE" | "IMPURE">;
  },
): Promise<ScanReport> {
  const ParserCtor = await initParser();
  const options: ScanOptions = {
    root,
    useCache: opts?.useCache ?? false,
    cacheDir: opts?.cacheDir,
    packs: defaultPacks,
    loadLanguage,
    ParserCtor,
    annotations: opts?.annotations,
  };
  return scan(options);
}

/**
 * diff 影响面（库 API）：扫描项目并返回改动文件集的反向可达闭包——
 * 改动 N 个文件/函数，直接与传递影响哪些调用者（含影响路径首跳 via）。
 * 供 AI/CI 直接分析变更影响范围；等价于 scanProject + changedImpact(verdicts, changedFiles)。
 */
export async function analyzeChange(
  root: string,
  changedFiles: readonly string[],
  opts?: { useCache?: boolean; cacheDir?: string },
): Promise<ChangeImpact> {
  const report = await scanProject(root, opts);
  return changedImpact(report.verdicts, new Set(changedFiles));
}

export { Purity, UNKNOWN_TARGET } from "./core/types";
export type { Chunk, Verdict, ScanReport, ScanStats } from "./core/types";
export type { LangPack, RawFileFacts, RawChunk, RawCall, RawImport } from "./lang/pack";
export { pythonPack, typescriptPack, tsxPack, javascriptPack };
export { changedImpact, annotationBudget, annotationCurve, influenceAnalysis } from "./core/influence";
export type { ChangeImpact, ImpactedChunk, AnnotationBudget } from "./core/influence";
