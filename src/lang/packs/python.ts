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
  "reversed", "isinstance", "issubclass", "sum", "min", "max", "abs", "round",
  "type", "id", "any", "all", "super", "property", "staticmethod",
  "classmethod", "ord", "chr", "hex", "bin", "oct", "pow", "divmod",
  "callable", "bytes", "bytearray", "slice", "object",
  // 协议分派内建（对任意对象调 __repr__/__format__/__hash__/__getattr__/__iter__ 等，可带 io）已移除：
  // repr/format/hash/iter/next/getattr/setattr/hasattr/vars/dir → 落未知（与 builtinTypeEffects 协议表外纪律一致）
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
  // 时钟读取（与 time.time 判 io 同源）：datetime.now/utcnow/today/fromtimestamp/utcfromtimestamp
  datetime: ["now", "today", "utcnow", "fromtimestamp", "utcfromtimestamp"],
  // 写 stderr：warnings.warn、traceback.print_exc/print_tb
  warnings: ["warn"], traceback: ["print_exc", "print_tb"],
};

const pureModules = new Set([
  "math", "re", "functools", "itertools", "typing", "dataclasses",
  "collections", "abc", "enum", "string", "textwrap", "copy", "operator",
  "numbers", "decimal", "fractions", "statistics", "heapq", "bisect",
  "array", "struct", "codecs", "unicodedata", "calendar",
  "contextlib", "types", "weakref",
  // 已移出（时钟读取/写 stderr/状态读写）：datetime → impureModules 成员表、warnings/traceback 同上
]);

// 会调用其函数实参的内建/模块成员：map/filter/sorted/max/min（key=）、functools.reduce
const hofCallsArgs = new Set(["map", "filter", "sorted", "max", "min", "reduce"]);
// 无条件调用函数实参的子集：实参未解析时记未知（防假纯）
const hofAlwaysArgs = new Set(["map", "filter", "reduce"]);

// 字面量接收者 → 内建类型（只收字面量形态；bytes 与 f-string 同节点，前缀判定见 extractor）
const literalReceivers: Record<string, string> = {
  string: "str", concatenated_string: "str", integer: "int", float: "float",
  true: "bool", false: "bool", bytes: "bytes", list: "list", dictionary: "dict", set: "set",
};

// 内建类型方法效应：只放硬纯（无参数协议分派——不含 format/join/translate（__format__/__iter__）、
// list.index/count（__eq__）、dict.get（__hash__）等）；表外 → ?（F9）
const builtinTypeEffects: Record<string, Record<string, "pure" | "hof">> = {
  str: {
    strip: "pure", lstrip: "pure", rstrip: "pure", lower: "pure", upper: "pure",
    title: "pure", capitalize: "pure", casefold: "pure", swapcase: "pure",
    split: "pure", rsplit: "pure", splitlines: "pure",
    removeprefix: "pure", removesuffix: "pure",
    startswith: "pure", endswith: "pure",
    find: "pure", rfind: "pure", index: "pure", rindex: "pure", count: "pure",
    replace: "pure", isalpha: "pure", isdigit: "pure", isalnum: "pure",
    isspace: "pure", isupper: "pure", islower: "pure", istitle: "pure", isnumeric: "pure",
  },
  list: {
    append: "pure", pop: "pure", reverse: "pure", clear: "pure",
    sort: "hof", // key= 回调
  },
  dict: {
    keys: "pure", values: "pure", items: "pure", clear: "pure", popitem: "pure", copy: "pure",
  },
  bytes: {
    decode: "pure", hex: "pure", lower: "pure", upper: "pure",
  },
  int: { bit_length: "pure", to_bytes: "pure" },
  float: { as_integer_ratio: "pure", is_integer: "pure" },
  bool: {},
  set: { copy: "pure", clear: "pure" },
};

// 内建方法返回类型（链式接收者解析）：只放非空固定返回（语言事实）；返回 None/bool/可变 → 链断
const builtinMethodReturns: Record<string, Record<string, string>> = {
  str: { strip: "str", lstrip: "str", rstrip: "str", lower: "str", upper: "str", title: "str", capitalize: "str",
    casefold: "str", swapcase: "str", split: "list", rsplit: "list", splitlines: "list", removeprefix: "str",
    removesuffix: "str", replace: "str" }, // is* 系列返回 bool → 不设（链断）
  list: { copy: "list" }, // reverse/clear 返回 None → 不设（链断）
  bytes: { decode: "str", hex: "str", lower: "bytes", upper: "bytes" },
  int: { to_bytes: "bytes" },
  float: { as_integer_ratio: "tuple" },
  set: { copy: "set" }, // clear 返回 None → 不设（链断）
};

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
  hofAlwaysArgs,
  assignmentTargets: ["assignment", "augmented_assignment", "for_statement", "named_expression"],
  literalReceivers,
  builtinTypeEffects,
  builtinMethodReturns,
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
