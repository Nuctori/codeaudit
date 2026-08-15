import type { SyntaxNode } from "../pack";
import type { LangPack, RawImport } from "../pack";
import type { Effect } from "../../core/types";
import { dirname, join, normalize } from "node:path";

/** 统一 / 分隔（projectFiles 在 discoverFiles 已是 / 分隔；Windows 候选路径需同款）。 */
const posix = (p: string): string => p.replace(/\\/g, "/");

/**
 * Go 语言包（种子版——真实项目 hugo 驱动迭代，迭代 19 C# 同款模式）。
 *
 * 已知限制（诚实未知，标注工作流覆盖，非假纯）：
 * - 方法内 receiver 调用（s.save()）→ ?：Go 无 this，receiver 参数名用户自定，无法枚举。
 * - 包级 var 在函数内被赋值：assignmentScopesLocals=true 判局部（Go 惯例函数内赋值即局部，
 *   包级可变变量写为已知残余）。
 * - dot import（. "strings"）不绑定局部名（Go 社区禁用惯例，罕见）。
 * - 同名兄弟目录跨包误连（过近似连边方向安全，非假纯）。
 * 效应表未列成员落 ?（方向安全）；纯成员 :p、io 成员带效应类。
 */
const impureBuiltins: Record<string, Effect> = {
	// Go 内建调试输出（对标 Python print/TS console）
	print: "io",
	println: "io",
};

const pureBuiltins = new Set([
	"len",
	"cap",
	"append",
	"copy",
	"delete",
	"make",
	"new",
	"complex",
	"real",
	"imag",
	"min", // Go 1.21+
	"max", // Go 1.21+
	"clear", // Go 1.21+
	// Go 预声明类型名：调用位置 = 类型转换（int(x)/string(b)/rune(r)）——纯转换。
	// 可被用户函数遮蔽（预声明标识符规则），极罕见，风险与 Python str/int 判纯同款先例。
	"int",
	"int8",
	"int16",
	"int32",
	"int64",
	"uint",
	"uint8",
	"uint16",
	"uint32",
	"uint64",
	"uintptr",
	"byte",
	"rune",
	"string",
	"bool",
	"float32",
	"float64",
	"complex64",
	"complex128",
	"any",
]);

const impureModules: Record<string, Effect | readonly string[]> = {
	// os 拆表：io 成员（文件/目录/进程/环境）+ 纯判定 :p（IsNotExist 等错误处理惯例——
	// 整体标 fs 会让全库错误处理点判 IMPURE 毒化判别力）；未列成员落 ?（方向安全）
	os: [
		"ReadFile:fs",
		"WriteFile:fs",
		"Open:fs",
		"OpenFile:fs",
		"Create:fs",
		"CreateTemp:fs",
		"MkdirTemp:fs",
		"Remove:fs",
		"RemoveAll:fs",
		"Rename:fs",
		"RenameAll:fs",
		"Mkdir:fs",
		"MkdirAll:fs",
		"ReadDir:fs",
		"Stat:fs",
		"Lstat:fs",
		"Getwd:fs",
		"Chdir:fs",
		"Chmod:fs",
		"Chown:fs",
		"Chtimes:fs",
		"Link:fs",
		"Symlink:fs",
		"Readlink:fs",
		"Truncate:fs",
		"WriteString:fs",
		"Close:fs",
		"Read:fs",
		"OpenInRoot:fs",
		"Getenv:io",
		"LookupEnv:io",
		"Setenv:io",
		"Unsetenv:io",
		"Environ:io",
		"Clearenv:io",
		"ExpandEnv:io",
		"Exec:io",
		"StartProcess:io",
		"FindProcess:io",
		"Exit:io",
		"Getpid:io",
		"Getppid:io",
		"Getuid:io",
		"Geteuid:io",
		"Getgid:io",
		"Getegid:io",
		"Getgroups:io",
		"Hostname:io",
		"UserCacheDir:io",
		"UserConfigDir:io",
		"UserHomeDir:io",
		"TempDir:io",
		"IsNotExist:p",
		"IsExist:p",
		"IsPermission:p",
		"IsTimeout:p",
		"IsPathSeparator:p",
		"Expand:p",
	],
	"os/exec": "io",
	"os/signal": "io",
	"os/user": "io",
	// fmt 拆表：stdout 输出 io，字符串格式化/错误构造纯
	fmt: [
		"Println:io",
		"Print:io",
		"Printf:io",
		"Fprintln:io",
		"Fprint:io",
		"Fprintf:io",
		"Fscanf:io",
		"Fscan:io",
		"Fscanln:io",
		"Scan:io",
		"Scanf:io",
		"Scanln:io",
		"Sprintf:p",
		"Sprint:p",
		"Sprintln:p",
		"Sscanf:p",
		"Sscan:p",
		"Sscanln:p",
		"Errorf:p",
	],
	io: "fs",
	"io/fs": "fs",
	"io/ioutil": "fs",
	bufio: "fs",
	net: "net",
	"net/http": "net",
	"net/rpc": "net",
	"net/smtp": "net",
	"net/http/cgi": "net",
	"net/http/fcgi": "net",
	"net/http/httptest": "net",
	"net/http/httputil": "net",
	"database/sql": "db",
	"github.com/lib/pq": "db",
	"github.com/go-sql-driver/mysql": "db",
	"github.com/mattn/go-sqlite3": "db",
	"github.com/jmoiron/sqlx": "db",
	log: "io",
	"log/slog": "io",
	"log/syslog": "io",
	// time 拆表：时钟读取（clock 类，与 Python time.time 同源）+ 纯转换 :p
	time: [
		"Now:clock",
		"Since:clock",
		"Until:clock",
		"Sleep:clock",
		"After:clock",
		"Tick:clock",
		"NewTimer:clock",
		"NewTicker:clock",
		"NewAfterFunc:clock",
		"LoadLocation:fs", // 读时区数据库文件
		"Parse:p",
		"ParseInLocation:p",
		"ParseDuration:p",
		"Date:p",
		"Unix:p",
		"UnixMilli:p",
		"UnixMicro:p",
		"UnixNano:p",
		"FixedZone:p",
	],
	"math/rand": "random",
	"math/rand/v2": "random",
	"crypto/rand": "random",
	"crypto/tls": "net",
	"crypto/x509": ["SystemCertPool:fs", "LoadCertPool:fs"],
	syscall: "io",
	flag: "io", // 读进程参数
	testing: "io", // 测试输出
	// path/filepath 拆表：目录遍历/绝对化读 fs；路径计算纯
	"path/filepath": [
		"Walk:fs",
		"WalkDir:fs",
		"Glob:fs",
		"Abs:fs",
		"EvalSymlinks:fs",
		"Match:p",
		"Rel:p",
		"Join:p",
		"Base:p",
		"Dir:p",
		"Ext:p",
		"Clean:p",
		"Split:p",
		"IsAbs:p",
		"VolumeName:p",
		"ToSlash:p",
		"FromSlash:p",
		"Separator:p",
		"ListSeparator:p",
	],
};

const pureModules = new Set([
	"strings",
	"strconv",
	"bytes",
	"sort",
	"math",
	"math/big",
	"math/cmplx",
	"math/bits",
	"unicode",
	"unicode/utf8",
	"unicode/utf16",
	"regexp",
	"path",
	"reflect",
	"sync",
	"sync/atomic",
	"atomic",
	"context",
	"container/heap",
	"container/list",
	"container/ring",
	"errors",
	"slices",
	"maps",
	"cmp",
	"iter",
	"weak",
	"unique",
	"text/template",
	"text/tabwriter",
	"text/scanner",
	"html",
	"html/template",
	"mime",
	"mime/multipart",
	"mime/quotedprintable",
	"net/url",
	"net/mail",
	"net/textproto",
	"index/suffixarray",
	"encoding/json",
	"encoding/xml",
	"encoding/csv",
	"encoding/base64",
	"encoding/hex",
	"encoding/binary",
	"encoding/gob",
	"encoding/pem",
	"encoding/ascii85",
	"hash",
	"hash/adler32",
	"hash/crc32",
	"hash/crc64",
	"hash/fnv",
	"hash/maphash",
	"compress/gzip",
	"compress/zlib",
	"compress/flate",
	"compress/bzip2",
	"compress/lzw",
	"compress/zstd",
	"archive/tar",
	"archive/zip",
	"go/ast",
	"go/parser",
	"go/token",
	"go/format",
	"go/printer",
	"go/scanner",
	"go/types",
	"go/doc",
	"go/constant",
	"crypto/sha256",
	"crypto/sha512",
	"crypto/sha1",
	"crypto/md5",
	"crypto/aes",
	"crypto/cipher",
	"crypto/hmac",
	"crypto/subtle",
	"crypto/ecdsa",
	"crypto/ed25519",
	"crypto/rsa",
	"crypto/elliptic",
	"crypto/dsa",
	"crypto/rc4",
	"crypto/des",
]);

export const goPack: LangPack = {
	name: "go",
	extensions: [".go"],
	wasm: "tree-sitter-go.wasm",
	chunkNodes: ["function_declaration", "method_declaration"],
	classNodes: [], // Go 无类；method_declaration 自带 receiver 即 chunk
	callNodes: ["call_expression"],
	nestingNodes: [
		"if_statement",
		"for_statement",
		"expression_switch_statement",
		"type_switch_statement",
		"select_statement",
		"function_declaration",
		"method_declaration",
		"func_literal",
	],
	selfNames: [], // Go 无 this/self；receiver 参数名用户自定（已知限制见文件头）
	impureBuiltins,
	pureBuiltins,
	impureModules,
	pureModules,
	impureGlobals: {},
	pureGlobals: new Set(),
	hofCallsArgs: new Set(), // Go 无内建 HOF（map/filter 是 slices 包函数，非回调语义）
	hofAlwaysArgs: new Set(),
	assignmentTargets: [
		"assignment_statement",
		"short_var_declaration",
		"var_declaration",
	],
	// 迭代39 P2-1：AST 形状投影（tree-sitter-go 节点名 dump 实证）
	astShapes: {
		writeStmts: [],
		writeAssigns: ["assignment_statement", "short_var_declaration"],
		writeUpdates: ["inc_statement"], // x++ 独立语句节点（Go 无表达式 ++）
		writeUnary: [],
		memberNodes: ["selector_expression"],
		memberWrapNodes: [],
		callShapes: ["call_expression"],
		ctorCallNodes: [], // Go 无 new 表达式（new(T) 是内建函数）
		paramNodes: ["parameter_declaration", "variadic_parameter_declaration"],
		throwNodes: [],
		catchNodes: [],
		heritageNodes: [],
		thisNodes: [],
		methodNodes: [],
		unwrapNodes: ["parenthesized_expression"],
		stmtWrapNodes: ["expression_statement"],
		bindAssigns: [
			"assignment_statement",
			"short_var_declaration",
			"var_declaration",
		],
		declNodes: ["var_declaration", "const_declaration"],
		initializerParentNodes: [],
		exportStmtNodes: [],
	},
	propertyReadNodes: ["selector_expression"], // 字段读取（静态语言：miss 判纯）
	propertyReadSkipMorphs: [
		"selector_expression", // 链中段（a.b.c 的 a.b）
		"call_expression", // 调用目标（fmt.Println 的 fmt）
		"assignment_statement", // 赋值左值（stateWritePos 通道）
		"short_var_declaration", // := 左值
		"inc_statement", // x++ 写形态
		"binary_expression", // channel send（s.pool <- 1 左值）
	],
	propMissIsPure: true, // 静态语言：字段/不存在成员读取不执行用户代码 → 纯
	literalReceivers: {}, // Go 字面量无方法调用（"x".M() 非法）
	builtinTypeEffects: {}, // Go 内建类型无方法（strings 包函数式）
	builtinMethodReturns: {},
	implicitThis: false,
	bareNamesCrossFile: true, // Go 包作用域：裸名可见于同目录全部文件
	assignmentScopesLocals: true, // 函数内赋值即局部（包级 var 写为已知残余，见文件头）
	bareNameMeansThisInMethod: false,
	paramListNodeTypes: ["parameter_list"],
	paramListField: "parameters",
	paramTypeField: "type",
	fnLiteralNodes: ["func_literal"],
	nestedFnBoundaryNodes: [
		"function_declaration",
		"method_declaration",
		"func_literal",
	],
	complexityNodes: [
		"if_statement",
		"for_statement",
		"expression_switch_statement",
		"type_switch_statement",
		"select_statement",
	],
	complexityOps: ["&&", "||"],
	frameworkIo: {},

	extractImports(root: SyntaxNode): RawImport[] {
		const out: RawImport[] = [];
		const findSpecs = (n: SyntaxNode): SyntaxNode[] => {
			// import_spec 可被 import_spec_list 包装（多导入形态，dump 实证）
			if (n.type === "import_spec") return [n];
			const found: SyntaxNode[] = [];
			for (const c of n.children) found.push(...findSpecs(c));
			return found;
		};
		const visit = (n: SyntaxNode): void => {
			if (n.type === "import_declaration") {
				for (const spec of findSpecs(n)) {
					const name = spec.childForFieldName("name");
					const path = spec.childForFieldName("path");
					if (!path) continue;
					const module = path.text.replace(/^["']|["']$/g, "");
					if (!name) {
						// 无别名：包名 = 导入路径末段（"net/http" → http；"x/y/v2" → y）
						const local = module.slice(module.lastIndexOf("/") + 1);
						out.push({ local, module, imported: null });
					} else if (name.type === "package_identifier") {
						out.push({ local: name.text, module, imported: null });
					}
					// dot（. "strings"）与 blank（_ "embed"）导入：不绑定局部名
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
		// 相对导入（Go 罕见但合法）：import "./config" → 相对目录（link 侧前缀匹配）
		if (module.startsWith(".")) {
			return posix(normalize(join(dirname(fromFile), module)));
		}
		// 绝对包路径：项目内包判定 = module 末段序列与某 .go 文件目录序列最长后缀匹配
		// （"github.com/gohugoio/hugo/tpl/collections" ↔ "tpl/collections"）。返回目录相对路径，
		// link 侧查该目录下全部文件（目录包多文件语义）。
		// 同名兄弟目录可能误连（过近似连边方向安全，非假纯）；标准库/第三方无匹配 → null
		// （效应表通道）。O(F) 每 module——resMemo 缓存（link.ts L89），仅首次全扫。
		const segs = module.split("/");
		for (const f of projectFiles) {
			if (!f.endsWith(".go")) continue;
			const dir = f.slice(0, f.lastIndexOf("/"));
			if (!dir) continue; // 根目录包（main）不可导入
			const dsegs = dir.split("/");
			if (dsegs.length > segs.length) continue;
			let ok = true;
			for (let i = 0; i < dsegs.length; i++) {
				if (segs[segs.length - 1 - i] !== dsegs[dsegs.length - 1 - i]) {
					ok = false;
					break;
				}
			}
			if (ok) return dir;
		}
		return null;
	},
};
