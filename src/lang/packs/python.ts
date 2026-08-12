import type { SyntaxNode } from "../pack";
import type { LangPack, RawImport } from "../pack";
import type { Effect } from "../../core/types";
import { dirname, join, normalize } from "node:path";

/** 统一 / 分隔（projectFiles 在 discoverFiles 已是 / 分隔；Windows 候选路径需同款）。 */
const posix = (p: string): string => p.replace(/\\/g, "/");

const impureBuiltins: Record<string, Effect> = {
  open: "fs", print: "io", input: "io", exec: "io", eval: "io", __import__: "io", breakpoint: "io",
};

const pureBuiltins = new Set([
  "len", "str", "int", "float", "bool", "list", "dict", "set", "tuple",
  "frozenset", "range", "enumerate", "zip", "map", "filter", "sorted",
  "reversed", "isinstance", "issubclass", "sum", "min", "max", "abs", "round",
  "type", "id", "any", "all", "super", "property", "staticmethod",
  "classmethod", "ord", "chr", "hex", "bin", "oct", "pow", "divmod",
  "callable", "bytes", "bytearray", "slice", "object",
  // 协议分派内建（对任意对象调 __repr__/__format__/__hash__/__getattr__/__iter__ 等，可带 io）已移除：
  // repr/format/hash/iter/next/getattr/setattr/hasattr/vars/dir → 落未知（与 builtinTypeEffects 协议表外纪律一致）
  // 边界声明（有意范围）：len/str/int/float/bool 等强制转换内建保留判纯——对内置容器/字面量安全；
  // 对用户对象仍会分派 __len__/__str__/__int__（可带 io），接受此残余（若移除，高频内建使 unknown-rate 爆炸，
  // 工具不可用；风险方向为假纯但频率-风险比低，与实例状态写同列已知限制）
]);

const impureModules: Record<string, Effect | readonly string[]> = {
  // os 拆表：io 成员全集（保守列举，宁可多列）+ os.path 纯计算子模块（:p）；未列成员落 UNKNOWN（方向安全）
  os: ["system", "popen", "spawnv", "spawnve", "spawnl", "spawnle", "spawnlp", "spawnlpe",
    "spawnvp", "spawnvpe", "fork", "forkpty", "execv", "execve", "execvp", "execl", "execlp",
    "execle", "execvpe", "kill", "killpg", "remove:fs", "unlink:fs", "rename:fs", "renames:fs", "replace:fs",
    "rmdir:fs", "removedirs:fs", "mkdir:fs", "makedirs:fs", "chdir:fs", "fchdir:fs", "chmod:fs", "chown:fs", "lchown:fs",
    "link:fs", "symlink:fs", "readlink:fs", "listdir:fs", "scandir:fs", "walk:fs", "stat:fs", "lstat:fs", "fstat:fs",
    "statvfs:fs", "pathconf:fs", "fpathconf:fs", "getcwd:fs", "getcwdb:fs", "chroot:fs", "getpid", "getppid",
    "getuid", "geteuid", "getgid", "getegid", "getgroups", "getlogin", "getenv", "putenv",
    "unsetenv", "setuid", "seteuid", "setgid", "setegid", "setgroups", "umask", "getumask",
    "urandom:random", "getrandom:random", "open:fs", "fdopen:fs", "pipe:fs", "dup:fs", "dup2:fs", "close:fs", "closerange:fs",
    "read:fs", "write:fs", "fsync:fs", "fdatasync:fs", "truncate:fs", "ftruncate:fs", "mknod:fs", "mkfifo:fs",
    "utime:fs", "access:fs", "openpty:fs", "getloadavg", "ttyname:fs", "isatty:fs", "nice", "abort",
    "environ", "get_terminal_size", "register_at_fork", "get_exec_path", "confstr", "sysconf",
    // os.path 纯计算（join/basename 等）；读 fs 状态的（getsize/exists/isdir…）不在列 → UNKNOWN
    "path.join:p", "path.basename:p", "path.dirname:p", "path.split:p", "path.splitext:p",
    "path.normpath:p", "path.normcase:p", "path.isabs:p", "path.commonpath:p", "path.commonprefix:p",
    "path.splitdrive:p", "path.splitunc:p", "path.curdir:p", "path.pardir:p", "path.sep:p"],
  // from os.path import join 的别名表（与 os 表的 path: 项一致）
  "os.path": ["join:p", "basename:p", "dirname:p", "split:p", "splitext:p", "normpath:p",
    "normcase:p", "isabs:p", "commonpath:p", "commonprefix:p", "splitdrive:p", "splitunc:p"],
  sys: "io", io: "fs", socket: "net", subprocess: "io", shutil: "fs",
  sqlite3: "db", urllib: "net", http: "net", smtplib: "net", ftplib: "net",
  requests: "net", httpx: "net", aiohttp: "net", psycopg2: "db", pymysql: "db",
  pymongo: "db", redis: "db", boto3: "db", paramiko: "io",
  pickle: ["load:fs", "dump:fs"], json: ["load:fs", "dump:fs", "dumps:p", "loads:p"], csv: "fs",
  logging: "io",
  // time：时钟读取（clock 类）+ 纯转换（:p，仅限必须传参的 mktime/strptime）。
  // localtime/gmtime/ctime/asctime/strftime 的 :p 已移除——无参形式读当前时钟（迭代6 B1，假纯）
  time: ["sleep:clock", "time:clock", "monotonic:clock", "perf_counter:clock", "process_time:clock",
    "thread_time:clock", "monotonic_ns:clock", "time_ns:clock", "perf_counter_ns:clock",
    "process_time_ns:clock", "thread_time_ns:clock", "mktime:p", "strptime:p"],
  random: "random",
  tempfile: "fs", glob: "fs", multiprocessing: "io",
  // pathlib 拆表（迭代21 F19——发散发现：整个模块标 fs 让纯路径操作（Path.name/parent/suffix）
  // 判 IMPURE 毒化判别力）：纯成员 :p，io 成员 fs；未列成员落 ?（诚实）
  pathlib: ["Path:p", "PurePath:p", "PurePosixPath:p", "PureWindowsPath:p", "PosixPath:p", "WindowsPath:p",
    "Path.name:p", "Path.parent:p", "Path.parents:p", "Path.suffix:p", "Path.suffixes:p", "Path.stem:p",
    "Path.parts:p", "Path.joinpath:p", "Path.with_name:p", "Path.with_suffix:p", "Path.relative_to:p",
    "Path.resolve:p", "Path.absolute:p",
    "Path.cwd:fs", "Path.home:fs", // 读进程工作目录/HOME 环境（F20：非纯——S1 通道）
    "Path.read_text:fs", "Path.read_bytes:fs", "Path.write_text:fs", "Path.write_bytes:fs",
    "Path.unlink:fs", "Path.rmdir:fs", "Path.mkdir:fs", "Path.rename:fs", "Path.replace:fs",
    "Path.stat:fs", "Path.exists:fs", "Path.is_file:fs", "Path.is_dir:fs", "Path.open:fs",
    "Path.iterdir:fs", "Path.glob:fs",
    "Path.touch:fs", "Path.symlink_to:fs", "Path.hardlink_to:fs", "Path.chmod:fs", "Path.readlink:fs"],
  threading: "io", asyncio: "io", select: "io", signal: "io",
  // 时钟读取（clock 类，与 time.time 判 io 同源）：datetime.now/utcnow/today/fromtimestamp/utcfromtimestamp
  datetime: ["now:clock", "today:clock", "utcnow:clock", "fromtimestamp:clock", "utcfromtimestamp:clock",
    // 点连形态（import datetime; datetime.datetime.now()）：全名命中前末段回退，此处点连变体补齐
    "datetime.now:clock", "datetime.today:clock", "datetime.utcnow:clock", "datetime.utcfromtimestamp:clock",
    "datetime.fromtimestamp:clock", "datetime.combine:p", "datetime.strptime:p", "datetime.strftime:p",
    "date.today:clock", "date.fromtimestamp:clock", "date.fromordinal:p", "time.utcfromtimestamp:clock",
    // ":p" = 纯转换成员（不触时钟/io）
    "combine:p", "fromisoformat:p", "strftime:p", "strptime:p", "isoformat:p", "timestamp:p"],
  // 写 stderr：warnings.warn、traceback.print_exc/print_tb
  warnings: ["warn"], traceback: ["print_exc", "print_tb"],
  // 熵读取（os.urandom 之上，与 random/TS crypto 判 io 同源）
  secrets: "random",
  // uuid4/uuid1 底层 os.urandom（与 TS uuid.v4 判 io 同源——跨语言一致）
  uuid: ["uuid1:random", "uuid4:random"],
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
    append: "pure", pop: "pure", reverse: "pure", clear: "pure", copy: "pure",
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

/** 迭代38 B：参数共享容器方法变异 → state 效应（与参数下标写 d[0]=1 同语义统一，iter36 §b-7）。
 *  sort 同时在 builtinTypeEffects 标 hof（key= 回调义务保留，规则5）。 */
const builtinMutators: Record<string, ReadonlySet<string>> = {
	list: new Set(["append", "pop", "reverse", "clear", "sort"]),
	dict: new Set(["clear", "popitem"]),
	set: new Set(["clear"]),
};

// 内建方法返回类型（链式接收者解析）：只放非空固定返回（语言事实）；返回 None/bool/可变 → 链断
const builtinMethodReturns: Record<string, Record<string, string>> = {
  str: { strip: "str", lstrip: "str", rstrip: "str", lower: "str", upper: "str", title: "str", capitalize: "str",
    casefold: "str", swapcase: "str", split: "list", rsplit: "list", splitlines: "list", removeprefix: "str",
    removesuffix: "str", replace: "str" }, // is* 系列返回 bool → 不设（链断）
  list: { copy: "list" }, // reverse/clear 返回 None → 不设（链断）
  dict: { copy: "dict" },
  bytes: { decode: "str", hex: "str", lower: "bytes", upper: "bytes" },
  int: { to_bytes: "bytes" },
  float: { as_integer_ratio: "tuple" },
  set: { copy: "set" }, // clear 返回 None → 不设（链断）
};

export const pythonPack: LangPack = {
  name: "python",
  extensions: [".py", ".pyw"],
  wasm: "tree-sitter-python.wasm",
  chunkNodes: ["function_definition", "class_definition", "lambda"],
  classNodes: ["class_definition"],
  callNodes: ["call"],
  // ponytail(已解决): 赋值 RHS 的 lambda 已提为命名 chunk（handler = lambda: ... 不再假 IMPURE module）；
  // 实参/其他位置 lambda 不提 chunk（体调用归外层——map(lambda, ...) 模块级仍正确判 IMPURE）
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
  implicitThis: false,
  assignmentScopesLocals: true, // Python：函数内赋值即局部定义（迭代37 P0-2）
	bareNameMeansThisInMethod: false,
	trustedCtor: true, // Python C() 必返回实例或抛（__new__ 逃逸 = 文档化残余，迭代38 规则7）
	builtinMutators,
  frameworkIo: {
    // Locust 压测客户端（迭代18 旧宇宙驱动）：self.client.get/post/... → net（段级前缀——
    // call.obj 是首段 "self"、attr 是剩余链 "client.post"；2.5 分支 startsWith 匹配）。
    // ApiClient 包装 user.client 也命中（其 client 确为 HTTP 客户端，方向安全）
    "self": ["client", "session", "http"],
  },

  extractImports(root: SyntaxNode): RawImport[] {
    const out: RawImport[] = [];
    const visit = (n: SyntaxNode): void => {
      if (n.type === "import_statement") {
        // import a.b / import a.b as c
        for (const c of n.children) {
          if (c.type === "dotted_name") {
            // import a.b 绑定的名字是首段 a
            out.push({ local: c.text.split(".")[0]!, module: c.text, imported: null });
          } else if (c.type === "aliased_import") {
            const mod = c.childForFieldName("name") ?? c.children[0];
            const alias = c.childForFieldName("alias") ?? c.children[c.children.length - 1];
            if (mod && alias) {
              out.push({ local: alias.text, module: mod.text, imported: null });
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
            out.push({ local: c.text, module, imported: c.text });
          } else if (c.type === "aliased_import") {
            const name = c.childForFieldName("name") ?? c.children[0];
            const alias = c.childForFieldName("alias") ?? c.children[c.children.length - 1];
            if (name && alias) {
              out.push({ local: alias.text, module, imported: name.text });
            }
          } else if (c.type === "wildcard_import" || c.text === "*") {
            out.push({ local: "*", module, imported: "*" });
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
    byLast?: ReadonlyMap<string, string[]>,
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
    // 绝对导入：在项目中找以该模块路径结尾的文件（取最短者 = 最贴近根）。
    // 走末段索引（byLast）：候选 = 末段与后缀末段相同的文件，再 endsWith 精筛——O(F) → O(候选数)
    const matches: string[] = [];
    const candidates: string[] = [];
    for (const suf of suffixes) {
      const last = suf.slice(suf.lastIndexOf("/") + 1);
      const bySeg = byLast?.get(last);
      if (bySeg) for (const f of bySeg) candidates.push(f);
    }
    for (const f of candidates) {
      for (const suf of suffixes) {
        if (f === suf || f.endsWith("/" + suf)) matches.push(f);
      }
    }
    if (matches.length === 0) return null;
    matches.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return matches[0]!;
  },
};
