import Parser from "web-tree-sitter";
import type { LangPack, TreeSitterLanguage } from "./lang/pack";

/** 初始化 web-tree-sitter 运行时（进程内一次）。 */
export async function initParser(): Promise<typeof Parser> {
  await Parser.init();
  return Parser;
}

/** 从 tree-sitter-wasms 加载指定语言的 wasm 语法。 */
export async function loadLanguage(pack: LangPack): Promise<TreeSitterLanguage> {
  const wasmPath = require.resolve(`tree-sitter-wasms/out/${pack.wasm}`);
  return Parser.Language.load(wasmPath);
}
