import type { LangPack } from "../pack";
import {
  extractEsmImports,
  resolveEsmModule,
  typescriptPack,
} from "./typescript";

/**
 * JavaScript 语言包：与 TS 共享数据表和 import 行为，
 * 差异仅在文件扩展名、wasm 语法与模块解析的扩展名候选。
 */
export const javascriptPack: LangPack = {
  ...typescriptPack,
  name: "javascript",
  extensions: [".js", ".jsx", ".mjs", ".cjs"],
  wasm: "tree-sitter-javascript.wasm",
  extractImports: extractEsmImports,
  resolveModule: (module, fromFile, projectFiles) =>
    resolveEsmModule(module, fromFile, projectFiles, [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]),
};
