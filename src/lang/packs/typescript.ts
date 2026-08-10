import type { SyntaxNode } from "../pack";
import type { LangPack, RawImport } from "../pack";
import { dirname, join, normalize } from "node:path";

/** TS/JS 共享的 import 提取行为（含再导出与 require）。 */
export function extractEsmImports(root: SyntaxNode): RawImport[] {
  const out: RawImport[] = [];
  const strip = (s: string): string => s.replace(/^['"]|['"]$/g, "");

  const readSpecifier = (spec: SyntaxNode, module: string): void => {
    const ids = spec.children.filter(
      (x) => x.type === "identifier" || x.type === "property_identifier",
    );
    if (ids.length === 1) {
      out.push({ local: ids[0]!.text, module, imported: ids[0]!.text });
    } else if (ids.length >= 2) {
      out.push({ local: ids[ids.length - 1]!.text, module, imported: ids[0]!.text });
    }
  };

  const readClause = (clause: SyntaxNode | null, module: string): void => {
    if (!clause) return;
    for (const c of clause.children) {
      if (c.type === "identifier") {
        // 默认导入: import X from "m"
        out.push({ local: c.text, module, imported: "default" });
      } else if (c.type === "namespace_import") {
        // import * as ns from "m"
        const id = c.children[c.children.length - 1];
        if (id && id.type === "identifier") {
          out.push({ local: id.text, module, imported: null });
        }
      } else if (c.type === "named_imports" || c.type === "export_clause") {
        // 容器节点（import 侧多包一层 named_imports）
        for (const spec of c.children) {
          if (spec.type === "import_specifier" || spec.type === "export_specifier") {
            readSpecifier(spec, module);
          }
        }
      } else if (c.type === "import_specifier" || c.type === "export_specifier") {
        // export_clause 的说明符是直接子节点
        readSpecifier(c, module);
      }
    }
  };

  const visit = (n: SyntaxNode): void => {
    if (n.type === "import_statement") {
      const src = n.childForFieldName("source");
      if (src) {
        const module = strip(src.text);
        readClause(findChild(n, "import_clause"), module);
      }
    } else if (n.type === "export_statement") {
      const src = n.childForFieldName("source");
      if (src) {
        const module = strip(src.text);
        // export * as ns from "./x"：命名空间再导出，绑定 local=ns（tree-sitter 包在 namespace_export 节点里）
        const nsexp = n.children.find((c) => c.type === "namespace_export");
        if (nsexp) {
          const nsNode = nsexp.children.find((c) => c.type === "identifier" || c.type === "property_identifier");
          if (nsNode) out.push({ local: nsNode.text, module, imported: null });
        } else if (n.children.some((c) => c.type === "*")) {
          out.push({ local: "*", module, imported: "*" });
        }
        // export { a, b as c } from "./x"
        readClause(findChild(n, "export_clause"), module);
      }
    } else if (n.type === "variable_declarator") {
      // CommonJS: const x = require("./m") / const { go, run: renamed } = require("./m")
      const value = n.childForFieldName("value");
      const nameNode = n.childForFieldName("name") ?? n.children[0];
      if (value && value.type === "call_expression" && nameNode) {
        const fn = value.childForFieldName("function");
        if (fn && fn.text === "require") {
          const args = value.childForFieldName("arguments");
          const str = args?.children.find((c) => c.type === "string");
          if (str) {
            const module = strip(str.text);
            if (nameNode.type === "identifier") {
              out.push({ local: nameNode.text, module, imported: null });
            } else if (nameNode.type === "object_pattern") {
              // 解构绑定：{go} → from-import 语义（local=go, imported=go）；{go: run} 重命名同源
              for (const prop of nameNode.children) {
                if (prop.type === "shorthand_property_identifier_pattern") {
                  out.push({ local: prop.text, module, imported: prop.text });
                } else if (prop.type === "pair_pattern") {
                  const key = prop.childForFieldName("key") ?? prop.children[0];
                  const val = prop.childForFieldName("value") ?? prop.children[1];
                  if (key && val && (val.type === "identifier" || val.type === "property_identifier")) {
                    out.push({ local: val.text, module, imported: key.text });
                  }
                }
              }
            }
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
  const posix = (p: string): string => p.replace(/\\/g, "/");
  const base = posix(normalize(join(dirname(fromFile), module)));
  const candidates: string[] = [base]; // 带扩展名说明符：./b.js 直接命中（不再生成 b.js.js）
  for (const ext of extensions) candidates.push(base + ext);
  for (const ext of extensions) candidates.push(posix(normalize(join(base, "index" + ext))));
  for (const c of candidates) {
    if (projectFiles.has(c)) return c;
  }
  return null;
}

const impureBuiltins = new Set(["fetch", "eval", "require", "alert", "prompt", "XMLHttpRequest",
  // 调度/定时（与 Python time.sleep 判 io 同源——阻塞/调度可观测）；queueMicrotask 同上
  "setTimeout", "setInterval", "clearTimeout", "clearInterval", "queueMicrotask"]);

const pureBuiltins = new Set([
  "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
  "decodeURIComponent", "encodeURI", "decodeURI", "String", "Number",
  "Boolean", "Array", "Object", "Symbol", "BigInt", "Error", "TypeError",
  "RangeError", "Promise", "Set", "Map", "WeakMap", "WeakSet", "Proxy",
  "Reflect", "RegExp",
  // Date 已移出：裸 Date() 与 new Date() 是时钟读取（判 io 的 now 同源）→ 落 UNKNOWN；
  // Date.parse/UTC 等静态纯方法经 pureGlobals（obj=Date）仍判纯
]);

const impureModules: Record<string, "*" | readonly string[]> = {
  fs: "*", "fs/promises": "*", http: "*", https: "*", net: "*",
  child_process: "*", cluster: "*", dgram: "*", dns: "*", readline: "*",
  axios: "*", got: "*", undici: "*", "node-fetch": "*", superagent: "*",
  pg: "*", mysql: "*", mysql2: "*", redis: "*", ioredis: "*", mongodb: "*",
  mongoose: "*", typeorm: "*", sequelize: "*", knex: "*",
  "@prisma/client": "*", ws: "*", "socket.io": "*",
  winston: "*", pino: "*", bunyan: "*",
  // 熵读取（与 Python random 判 io 同源）：crypto.randomBytes 等同步阻塞读系统熵
  crypto: ["randomBytes", "randomFill", "randomFillSync", "randomInt",
    "generateKey", "generateKeySync", "generateKeyPair", "generateKeyPairSync",
    "getRandomValues", "webcrypto"],
  // uuid.v4/v1 底层调 randomBytes/getRandomValues
  uuid: ["v4", "v1", "v7"],
};

const pureModules = new Set([
  "path", "url", "querystring", "util", "events", "buffer", "stream",
  "assert", "lodash", "lodash-es", "ramda", "date-fns",
  "dayjs", "moment", "zod", "yup", "joi", "immutable", "rxjs",
  "reselect", "classnames", "prop-types",
  // 已移出（熵读取/io 成员）：crypto/uuid → impureModules 成员表
]);

const impureGlobals: Record<string, "*" | readonly string[]> = {
  console: "*",
  process: "*",
  localStorage: "*",
  sessionStorage: "*",
  document: "*",
  window: "*",
  navigator: "*",
  // 时钟读取（与 Python time.time 判 io 同源）
  Date: ["now"],
  performance: ["now"],
  // PRNG（与 Python random 判 io 同源——跨语言一致）：Math.random 结果可观测且种子不可控
  Math: ["random"],
};

const pureGlobals = new Set([
  "Math", "JSON", "Object", "Array", "Number", "String", "Boolean",
  "Reflect", "Promise", "Intl", "URL", "URLSearchParams", "TextEncoder",
  "TextDecoder", "structuredClone", "queueMicrotask", "Date",
]);

const builtinTypeEffects = {
    string: { trim: "pure", trimStart: "pure", trimEnd: "pure", toLowerCase: "pure", toUpperCase: "pure", toString: "pure", valueOf: "pure", charCodeAt: "pure", charAt: "pure", codePointAt: "pure", startsWith: "pure", endsWith: "pure", includes: "pure", indexOf: "pure", lastIndexOf: "pure", replace: "pure", split: "pure", substring: "pure", slice: "pure", padStart: "pure", padEnd: "pure" },
    array: {
      push: "pure", pop: "pure", shift: "pure", unshift: "pure", reverse: "pure",
      indexOf: "pure", includes: "pure", slice: "pure", concat: "pure", join: "pure",
      map: "hof", filter: "hof", forEach: "hof", reduce: "hof", reduceRight: "hof",
      some: "hof", every: "hof", find: "hof", findIndex: "hof", sort: "hof", flatMap: "hof",
    },
    number: { toString: "pure", toFixed: "pure", toPrecision: "pure", toExponential: "pure" },
    boolean: { toString: "pure", valueOf: "pure" },
    regex: { test: "pure", exec: "pure" },
    bigint: { toString: "pure", valueOf: "pure" },
} as const satisfies Record<string, Record<string, "pure" | "hof">>;
// 内建方法返回类型（链式接收者解析）：只放非空固定返回（语言事实）；返回可变/动态 → 链断
const builtinMethodReturns = {
  string: { trim: "string", trimStart: "string", trimEnd: "string", toLowerCase: "string", toUpperCase: "string", toString: "string", valueOf: "string" },
  array: { reverse: "array", slice: "array", concat: "array", map: "array", filter: "array", flatMap: "array" },
  number: { toString: "string", toFixed: "string", toPrecision: "string", toExponential: "string" },
  boolean: { toString: "string", valueOf: "boolean" },
  regex: {},
  bigint: { toString: "string", valueOf: "bigint" },
} as const satisfies Record<string, Record<string, string>>;

export const typescriptPack: LangPack = {
  name: "typescript",
  extensions: [".ts", ".mts", ".cts"],
  wasm: "tree-sitter-typescript.wasm",
  chunkNodes: [
    "function_declaration", "generator_function_declaration",
    "method_definition", "class_declaration", "variable_declarator",
  ],
  classNodes: ["class_declaration"],
  callNodes: ["call_expression", "new_expression"], // new_expression：构造器调用点（S1 TS 侧，迭代3 B1）
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
  // 数组方法中无条件调用实参的子集（Array.from 的 cb 可选 → 不入）；实参未解析时记未知
  hofAlwaysArgs: new Set(["map", "filter", "forEach", "reduce", "reduceRight", "some", "every", "find", "findIndex", "flatMap"]),
  assignmentTargets: ["variable_declarator", "assignment_expression", "for_in_statement", "for_of_statement"],
  // 字面量接收者：string/template（值恒为 string，插值副作用独立捕获）/number/bool/regex/array/bigint
  literalReceivers: {
    string: "string", template_string: "string", number: "number",
    true: "boolean", false: "boolean", regex: "regex", array: "array", bigint: "bigint",
  },
  // 硬纯：无参数协议分派。JS 带参方法做 ToPrimitive/ToString 强制（Symbol.toPrimitive）→ 表外；
  // array indexOf/includes 走 ===（无用户钩子）安全；array map/filter/... 为 hof（addArgEdges）
  builtinTypeEffects,
  builtinMethodReturns,

  // egg.js 惯例：ctx.model（sequelize DB）/ ctx.service（业务层）/ ctx.app —— 均为 io 边界
  frameworkIo: { ctx: ["model", "service", "app"] },
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
