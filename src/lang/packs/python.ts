import type { SyntaxNode } from "../pack";
import type { LangPack, RawImport } from "../pack";
import { dirname, join, normalize } from "node:path";

/** 统一 / 分隔（projectFiles 在 discoverFiles 已是 / 分隔；Windows 候选路径需同款）。 */
const posix = (p: string): string => p.replace(/\\/g, "/");

const impureBuiltins = new Set([
  "open", "print", "input", "exec", "eval", "__import__", "breakpoint",
]);

const pureBuiltins = new Set([
  "len", "str", "int", "float", "bool", "list", "dict", "set", "tuple",
  "frozenset", "range", "enumerate", "zip", "map", "filter", "sorted",
  "reversed", "isinstance", "issubclass", "hasattr", "getattr", "setattr",
  "sum", "min", "max", "abs", "round", "repr", "format", "type", "id",
  "hash", "iter", "next", "any", "all", "super", "property", "staticmethod",
  "classmethod", "ord", "chr", "hex", "bin", "oct", "pow", "divmod",
  "callable", "vars", "dir", "bytes", "bytearray", "slice", "object",
]);

const impureModules: Record<string, "*" | readonly string[]> = {
  os: "*", sys: "*", io: "*", socket: "*", subprocess: "*", shutil: "*",
  sqlite3: "*", urllib: "*", http: "*", smtplib: "*", ftplib: "*",
  requests: "*", httpx: "*", aiohttp: "*", psycopg2: "*", pymysql: "*",
  pymongo: "*", redis: "*", boto3: "*", paramiko: "*",
  pickle: ["load", "dump"], json: ["load", "dump"], csv: "*",
  logging: "*", time: ["sleep", "time", "monotonic"], random: "*",
  tempfile: "*", glob: "*", pathlib: "*", multiprocessing: "*",
  threading: "*", asyncio: "*", select: "*", signal: "*",
};

const pureModules = new Set([
  "math", "re", "functools", "itertools", "typing", "dataclasses",
  "collections", "abc", "enum", "string", "textwrap", "copy", "operator",
  "numbers", "decimal", "fractions", "statistics", "heapq", "bisect",
  "array", "struct", "codecs", "unicodedata", "datetime", "calendar",
  "contextlib", "warnings", "traceback", "types", "weakref",
]);

// 会调用其函数实参的内建/模块成员：map/filter/sorted/max/min（key=）、functools.reduce
const hofCallsArgs = new Set(["map", "filter", "sorted", "max", "min", "reduce"]);

export const pythonPack: LangPack = {
  name: "python",
  extensions: [".py", ".pyw"],
  wasm: "tree-sitter-python.wasm",
  chunkNodes: ["function_definition", "class_definition"],
  classNodes: ["class_definition"],
  callNodes: ["call"],
  nestingNodes: [
    "if_statement", "for_statement", "while_statement", "try_statement",
    "with_statement", "match_statement", "function_definition",
    "class_definition",
  ],
  selfNames: ["self", "cls"],
  impureBuiltins,
  pureBuiltins,
  impureModules,
  pureModules,
  impureGlobals: {},
  pureGlobals: new Set(),
  hofCallsArgs,
  assignmentTargets: ["assignment", "augmented_assignment", "for_statement", "named_expression"],
  frameworkIo: {},

  extractImports(root: SyntaxNode): RawImport[] {
    const out: RawImport[] = [];
    const visit = (n: SyntaxNode): void => {
      if (n.type === "import_statement") {
        // import a.b / import a.b as c
        for (const c of n.children) {
          if (c.type === "dotted_name") {
            // import a.b 绑定的名字是首段 a
            out.push({ local: c.text.split(".")[0]!, module: c.text, imported: null, reexport: false });
          } else if (c.type === "aliased_import") {
            const mod = c.childForFieldName("name") ?? c.children[0];
            const alias = c.childForFieldName("alias") ?? c.children[c.children.length - 1];
            if (mod && alias) {
              out.push({ local: alias.text, module: mod.text, imported: null, reexport: false });
            }
          }
        }
      } else if (n.type === "import_from_statement") {
        // from X import a, b as c / from .rel import a
        let seenImportKw = false;
        let module = "";
        for (const c of n.children) {
          if (c.type === "from") continue;
          if (c.type === "import") { seenImportKw = true; continue; }
          if (!seenImportKw) {
            if (c.type === "dotted_name" || c.type === "relative_import") {
              module = c.text;
            }
            continue;
          }
          if (c.type === "dotted_name") {
            out.push({ local: c.text, module, imported: c.text, reexport: false });
          } else if (c.type === "aliased_import") {
            const name = c.childForFieldName("name") ?? c.children[0];
            const alias = c.childForFieldName("alias") ?? c.children[c.children.length - 1];
            if (name && alias) {
              out.push({ local: alias.text, module, imported: name.text, reexport: false });
            }
          } else if (c.type === "wildcard_import" || c.text === "*") {
            out.push({ local: "*", module, imported: "*", reexport: false });
          }
        }
      }
      for (const c of n.children) visit(c);
    };
    visit(root);
    return out;
  },

  resolveModule(
    module: string,
    fromFile: string,
    projectFiles: ReadonlySet<string>,
  ): string | null {
    let modPath: string;
    if (module.startsWith(".")) {
      const dots = module.match(/^\.+/)![0].length;
      const rest = module.slice(dots).replace(/\./g, "/");
      let base = posix(normalize(dirname(fromFile)));
      for (let i = 1; i < dots; i++) base = posix(normalize(dirname(base)));
      modPath = rest ? posix(join(base, rest)) : base;
    } else {
      modPath = module.replace(/\./g, "/");
    }
    const suffixes = [posix(normalize(modPath + ".py")), posix(normalize(join(modPath, "__init__.py")))];
    for (const suf of suffixes) {
      if (projectFiles.has(suf)) return suf;
    }
    // 绝对导入：在项目中找以该模块路径结尾的文件（取最短者 = 最贴近根）
    const matches: string[] = [];
    for (const f of projectFiles) {
      for (const suf of suffixes) {
        if (f === suf || f.endsWith("/" + suf)) matches.push(f);
      }
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return matches[0]!;
  },
};
