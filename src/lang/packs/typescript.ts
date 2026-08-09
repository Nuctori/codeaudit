import type { SyntaxNode } from "../pack";
import type { LangPack, RawImport } from "../pack";
import { dirname, join, normalize } from "node:path";

/** TS/JS 共享的 import 提取行为（含再导出与 require）。 */
export function extractEsmImports(root: SyntaxNode): RawImport[] {
  const out: RawImport[] = [];
  const strip = (s: string): string => s.replace(/^['"]|['"]$/g, "");

  const readSpecifier = (spec: SyntaxNode, module: string, reexport: boolean): void => {
    const ids = spec.children.filter(
      (x) => x.type === "identifier" || x.type === "property_identifier",
    );
    if (ids.length === 1) {
      out.push({ local: ids[0]!.text, module, imported: ids[0]!.text, reexport });
    } else if (ids.length >= 2) {
      out.push({ local: ids[ids.length - 1]!.text, module, imported: ids[0]!.text, reexport });
    }
  };

  const readClause = (clause: SyntaxNode | null, module: string, reexport: boolean): void => {
    if (!clause) return;
    for (const c of clause.children) {
      if (c.type === "identifier") {
        // 默认导入: import X from "m"
        out.push({ local: c.text, module, imported: "default", reexport });
      } else if (c.type === "namespace_import") {
        // import * as ns from "m"
        const id = c.children[c.children.length - 1];
        if (id && id.type === "identifier") {
          out.push({ local: id.text, module, imported: null, reexport });
        }
      } else if (c.type === "named_imports" || c.type === "export_clause") {
        // 容器节点（import 侧多包一层 named_imports）
        for (const spec of c.children) {
          if (spec.type === "import_specifier" || spec.type === "export_specifier") {
            readSpecifier(spec, module, reexport);
          }
        }
      } else if (c.type === "import_specifier" || c.type === "export_specifier") {
        // export_clause 的说明符是直接子节点
        readSpecifier(c, module, reexport);
      }
    }
  };

  const visit = (n: SyntaxNode): void => {
    if (n.type === "import_statement") {
      const src = n.childForFieldName("source");
      if (src) {
        const module = strip(src.text);
        readClause(findChild(n, "import_clause"), module, false);
      }
    } else if (n.type === "export_statement") {
      const src = n.childForFieldName("source");
      if (src) {
        const module = strip(src.text);
        // export * as ns from "./x"：命名空间再导出，绑定 local=ns（tree-sitter 包在 namespace_export 节点里）
        const nsexp = n.children.find((c) => c.type === "namespace_export");
        if (nsexp) {
          const nsNode = nsexp.children.find((c) => c.type === "identifier" || c.type === "property_identifier");
          if (nsNode) out.push({ local: nsNode.text, module, imported: null, reexport: true });
        } else if (n.children.some((c) => c.type === "*")) {
          out.push({ local: "*", module, imported: "*", reexport: true });
        }
        // export { a, b as c } from "./x"
        readClause(findChild(n, "export_clause"), module, true);
      }
    } else if (n.type === "variable_declarator") {
      // CommonJS: const x = require("./m")
      const value = n.childForFieldName("value");
      const nameNode = n.childForFieldName("name") ?? n.children[0];
      if (
        value && value.type === "call_expression" && nameNode &&
        nameNode.type === "identifier"
      ) {
        const fn = value.childForFieldName("function");
        if (fn && fn.text === "require") {
          const args = value.childForFieldName("arguments");
          const str = args?.children.find((c) => c.type === "string");
          if (str) {
            out.push({ local: nameNode.text, module: strip(str.text), imported: null, reexport: false });
          }
        }
      }
    }
    for (const c of n.children) visit(c);
  };
  visit(root);
  return out;
}

function findChild(n: SyntaxNode, type: string): SyntaxNode | null {
  for (const c of n.children) if (c.type === type) return c;
  return null;
}

/** TS/JS 共享的相对模块解析。 */
export function resolveEsmModule(
  module: string,
  fromFile: string,
  projectFiles: ReadonlySet<string>,
  extensions: readonly string[],
): string | null {
  if (!module.startsWith(".")) return null; // 外部包
  const base = normalize(join(dirname(fromFile), module));
  const candidates: string[] = [];
  for (const ext of extensions) candidates.push(base + ext);
  for (const ext of extensions) candidates.push(normalize(join(base, "index" + ext)));
  for (const c of candidates) {
    if (projectFiles.has(c)) return c;
  }
  return null;
}

const impureBuiltins = new Set(["fetch", "eval", "require", "alert", "prompt", "XMLHttpRequest"]);

const pureBuiltins = new Set([
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
  "decodeURIComponent", "encodeURI", "decodeURI", "String", "Number",
  "Boolean", "Array", "Object", "Symbol", "BigInt", "Error", "TypeError",
  "RangeError", "Promise", "Set", "Map", "WeakMap", "WeakSet", "Proxy",
  "Reflect", "Date", "RegExp",
]);

const impureModules: Record<string, "*" | readonly string[]> = {
  fs: "*", "fs/promises": "*", http: "*", https: "*", net: "*",
  child_process: "*", cluster: "*", dgram: "*", dns: "*", readline: "*",
  axios: "*", got: "*", undici: "*", "node-fetch": "*", superagent: "*",
  pg: "*", mysql: "*", mysql2: "*", redis: "*", ioredis: "*", mongodb: "*",
  mongoose: "*", typeorm: "*", sequelize: "*", knex: "*",
  "@prisma/client": "*", ws: "*", "socket.io": "*",
  winston: "*", pino: "*", bunyan: "*",
};

const pureModules = new Set([
  "path", "url", "querystring", "util", "events", "buffer", "stream",
  "crypto", "zlib", "assert", "lodash", "lodash-es", "ramda", "date-fns",
  "dayjs", "moment", "uuid", "zod", "yup", "joi", "immutable", "rxjs",
  "reselect", "classnames", "prop-types",
]);

const impureGlobals: Record<string, "*" | readonly string[]> = {
  console: "*",
  process: "*",
  localStorage: "*",
  sessionStorage: "*",
  document: "*",
  window: "*",
  navigator: "*",
};

const pureGlobals = new Set([
  "Math", "JSON", "Object", "Array", "Number", "String", "Boolean",
  "Reflect", "Promise", "Intl", "URL", "URLSearchParams", "TextEncoder",
  "TextDecoder", "structuredClone", "queueMicrotask",
]);

export const typescriptPack: LangPack = {
  name: "typescript",
  extensions: [".ts", ".mts", ".cts"],
  wasm: "tree-sitter-typescript.wasm",
  chunkNodes: [
    "function_declaration", "generator_function_declaration",
    "method_definition", "class_declaration", "variable_declarator",
  ],
  classNodes: ["class_declaration"],
  callNodes: ["call_expression"],
  nestingNodes: [
    "if_statement", "for_statement", "for_in_statement", "while_statement",
    "do_statement", "try_statement", "switch_statement",
    "function_declaration", "generator_function_declaration",
    "method_definition", "arrow_function", "class_declaration",
  ],
  selfNames: ["this"],
  impureBuiltins,
  pureBuiltins,
  impureModules,
  pureModules,
  impureGlobals,
  pureGlobals,
  hofCallsArgs: new Set(["from"]), // Array.from(xs, cb) 会调用 cb
  assignmentTargets: ["variable_declarator", "assignment_expression", "for_in_statement", "for_of_statement"],
  extractImports: extractEsmImports,
  resolveModule: (module, fromFile, projectFiles) =>
    resolveEsmModule(module, fromFile, projectFiles, [".ts", ".tsx", ".js", ".jsx"]),
};

/** TSX 语言包：与 TS 共享全部数据与行为，仅语法文件不同（JSX 支持）。 */
export const tsxPack: LangPack = {
  ...typescriptPack,
  name: "tsx",
  extensions: [".tsx"],
  wasm: "tree-sitter-tsx.wasm",
};
