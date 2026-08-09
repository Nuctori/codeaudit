import { ScanOptions, scan } from "./engine/scan";
import { pythonPack } from "./lang/packs/python";
import { typescriptPack, tsxPack } from "./lang/packs/typescript";
import { javascriptPack } from "./lang/packs/javascript";
import { initParser, loadLanguage } from "./loader";
import type { ScanReport } from "./core/types";

export const defaultPacks = [pythonPack, typescriptPack, tsxPack, javascriptPack];

/** 编程式 API：一行扫描。 */
export async function scanProject(
  root: string,
  opts?: { useCache?: boolean; cacheDir?: string },
): Promise<ScanReport> {
  const ParserCtor = await initParser();
  const options: ScanOptions = {
    root,
    useCache: opts?.useCache ?? false,
    cacheDir: opts?.cacheDir,
    packs: defaultPacks,
    loadLanguage,
    ParserCtor,
  };
  return scan(options);
}

export { Purity, UNKNOWN_TARGET } from "./core/types";
export type { Chunk, Verdict, ScanReport, ScanStats } from "./core/types";
export type { LangPack, RawFileFacts, RawChunk, RawCall, RawImport } from "./lang/pack";
export { pythonPack, typescriptPack, tsxPack, javascriptPack };
