#!/usr/bin/env node
import {
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { scanProject, renderTechdebtHtml } from "./index";
import { loadEffectOverrides, type EffectTables } from "./lang/effectOverride";
import { riskOfChange, gateExit } from "./core/risk";
import { graphMetrics } from "./core/topology";
import { bridgesOf, dependencySkeleton } from "./core/skeleton";
import { stateCouplingOf, type StateCouplingEntry } from "./core/state";
import { moduleSummary } from "./core/module";
import { outDepsOf, inDepsOf } from "./core/filedeps";
import { sourceSnippet } from "./core/snippet";
import {
	Purity,
	UNKNOWN_TARGET,
	type Verdict,
	type Chunk,
	type Effect,
	type Provenance,
	type ScanReport,
	type ScanStats,
} from "./core/types";

/** Effect 闭合联合的字符串集合（recheck 形状校验用——scan 模式内部保证，recheck 的 JSON 不可信）。 */
const EFFECT_SET: ReadonlySet<string> = new Set([
	"io",
	"net",
	"fs",
	"db",
	"random",
	"clock",
	"state",
]);
import {
	annotationBudget,
	annotationCurve,
	annotationCompare,
	unknownKeysOf,
	compareReports,
} from "./core/influence";
import {
	emptyCorpus,
	updateCorpus,
	priorFor,
	summarize,
	siteShapeInfo,
	isCorpus,
	PRIOR_THRESHOLD,
	type CorpusFile,
} from "./core/corpus";

interface CliArgs {
	dir: string;
	format: "text" | "json";
	top: number | null;
	unknowns: string | null;
	annotations: string | null;
	corpus: string | null;
	/** 效应表注入（--effect-table；迭代29 F16 CLI 补全——JSON { 语言: { 表名: 值 } }）。 */
	effectTable: string | null;
	noCache: boolean;
	strict: boolean;
	/** 合入门禁（--gate；与 --changed 联用：grade ≥ high → exit 1）。 */
	gate: boolean;
	modules: boolean;
	/** 圈复杂度 top（--complexity；迭代44-r4：重构复杂函数识别）。 */
	complexity: boolean;
	/** 文件依赖（--deps <file>；迭代44-r4：拆分决策——入/出边文件清单）。 */
	deps: string | null;
	/** 重构前后对比（--compare <before.json>；迭代44-r4：复用 compareReports 库 API）。 */
	compare: string | null;
	/** 技术债 HTML 可视化输出（--html <file>；迭代49 插件化——renderTechdebtHtml 库 API 的 CLI 入口）。 */
	html: string | null;
	/** 重算模式（recheck <json>；iter54-r3：加载 --json 输出重算全部视图——验证回路秒级，
	 * 会话实证：改工具后每次重扫 10-20min + 手写脚本解析 216MB JSON）。 */
	recheck: string | null;
	/** 状态耦合图（--state；迭代23 D-127：写方按读者数排序，全图耦合链）。 */
	state: boolean;
	/** 回归风险分析：改动文件集（--changed a.ts,b.py）。 */
	changed: string[] | null;
	/** 拓扑健康度（--topology；迭代14 视角 3）。 */
	topology: boolean;
	/** 效应源清单（--sources；chain=0 IMPURE——直接调 io/net/random/state 的"背锅者"，迭代16）。 */
	sources: boolean;
	/** 效应表补表候选详情（--table-usage；迭代21 T8——missSlots top 15）。 */
	tableUsage: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = {
		dir: ".",
		format: "text",
		top: null,
		unknowns: null,
		annotations: null,
		corpus: null,
		effectTable: null,
		noCache: false,
		strict: false,
		gate: false,
		state: false,
		changed: null,
		topology: false,
		sources: false,
		tableUsage: false,
		modules: false,
		complexity: false,
		deps: null,
		compare: null,
		html: null,
		recheck: null,
	};
	const rest = argv.slice(2);
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i]!;
		if (a === "scan") continue;
		if (a === "recheck") {
			const val = rest[++i];
			if (val === undefined)
				throw new Error("recheck 需要 <json> 参数（--json 输出文件）");
			args.recheck = val;
			continue;
		}
		if (a === "--format") args.format = rest[++i] === "json" ? "json" : "text";
		else if (a === "--json") args.format = "json";
		else if (a === "--top") {
			const n = parseInt(rest[++i] ?? "", 10);
			args.top = Number.isFinite(n) && n > 0 ? n : null;
		} else if (a === "--unknowns") args.unknowns = rest[++i]!;
		else if (a === "--annotations") args.annotations = rest[++i]!;
		else if (a === "--effect-table") args.effectTable = rest[++i]!;
		else if (a === "--corpus") args.corpus = rest[++i]!;
		else if (a === "--no-cache") args.noCache = true;
		else if (a === "--strict") args.strict = true;
		else if (a === "--gate") args.gate = true;
		else if (a === "--topology") args.topology = true;
		else if (a === "--sources") args.sources = true;
		else if (a === "--state") args.state = true;
		else if (a === "--table-usage") args.tableUsage = true;
		else if (a === "--modules") args.modules = true;
		else if (a === "--complexity") args.complexity = true;
		else if (a === "--deps") {
			const val = rest[++i];
			if (val === undefined) throw new Error("--deps 需要参数 <json>"); // 缺值静默失效（undefined !== null 误触发视图抑制）→ 显式报错 exit 2
			args.deps = val;
		} else if (a === "--compare") {
			const val = rest[++i];
			if (val === undefined) throw new Error("--compare 需要参数 <json>");
			args.compare = val;
		} else if (a === "--html") {
			const val = rest[++i];
			if (val === undefined) throw new Error("--html 需要参数 <file>");
			args.html = val;
		} else if (a === "--changed")
			args.changed = (rest[++i] ?? "")
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean);
		else if (a === "--help" || a === "-h") {
			printHelp();
			process.exit(0);
		} else if (a === "--version" || a === "-v") {
			console.log(VERSION);
			process.exit(0);
		} else if (a.startsWith("-")) {
			throw new Error("未知选项 " + a); // main().catch → exitCode 2
		} else if (!a.startsWith("-")) args.dir = a;
	}
	// --gate 依赖 --changed：静默失效的门禁 = 安全剧场（CI 以为在门禁、实际 no-op）——报错 exit 2
	if (args.gate && (args.changed === null || args.changed.length === 0)) {
		throw new Error(
			"--gate 需要 --changed <files>（门禁依赖改动文件集评估回归风险）",
		);
	}
	return args;
}

function printHelp(): void {
	console.log(`codeaudit — 跨语言代码纯度审计（传染链分析）

用法: codeaudit scan [目录] [选项]

选项:
  --format text|json   输出格式（默认 text）
  --top N              只显示前 N 条治理项（非纯；text 与 json 同语义；--sources 共用此上限）
  --unknowns <file>    导出未解析符号清单（按影响面排序，含 id 锚点，供 AI 标注）
  --annotations <file> 回读 AI 标注（[{id, verdict:"PURE"|"IMPURE"}]，按 chunk.id 匹配，减少未知）
  --effect-table <json> 效应表注入（{ 语言: { 表名: 值 } }；键只增不删、数组并集；读文件/校验失败 exit 2）
  --corpus <file>      标注语料文件（默认 .codeaudit/corpus.json；累积先验供 suggested_prompt）
  --no-cache           禁用增量缓存
  --topology           拓扑健康度：密度/环/深度/自环/多入口纠缠环/桥/割点 + 人类解读（json 顶层加 topology 字段）
  --sources            效应源清单：chain=0 IMPURE——直接调 io/net/random/state 的源头（背锅者，按调用点排序）
  --state              状态耦合图：写方按读者数排序（json 模式顶层加 stateCoupling；默认 top 50、硬上限 500——大项目防序列化超限）
  --strict             存在 IMPURE chunk 时退出码为 1
  --gate               与 --changed 联用：grade ≥ high（风险≥35）时退出码 1（合入门禁；invalid 不放行）
  --changed <files>    回归风险分析：改动文件（逗号分隔）→ riskOfChange（L×C 模型）
  --html <file>        技术债 HTML 可视化（自包含单文件：健康度卡片/模块分段/治理清单/复杂度/未知形态/效应源）
  recheck <json>       重算模式：加载 --json 输出重算全部视图（改工具后秒级验证，免 10-20min 重扫）
  -h, --help           显示帮助

示例:
  codeaudit scan . --topology          # 扫描当前目录 + 拓扑健康度
  codeaudit scan src --html report.html  # 技术债 HTML 报告
  codeaudit scan . --unknowns u.json --annotations a.json  # 标注闭环（导出→AI 标注→回读）
  codeaudit scan . --changed a.ts,b.py --gate  # 改动回归风险 + 合入门禁
  codeaudit scan . --json out.json --topology  # 导出 JSON（供 recheck/对比）
  codeaudit recheck out.json --topology --html r.html  # 重载 JSON 秒级重算视图
`);
}

function fmtChain(v: Verdict): string {
	if (v.chain === Infinity) return "   -";
	const s = String(v.chain).padStart(4);
	// 不确定链显示区间 [audit, dev]：如 0?→3（标注后可能翻案到 3）
	return v.chainCertain
		? s
		: `${s}?→${v.chainDev === Infinity ? "-" : v.chainDev}`;
}

function fmtEffects(v: Verdict): string {
	const parts = [...v.effects].sort();
	if (v.purity === Purity.UNKNOWN) parts.push("?");
	return "{" + parts.join(",") + "}";
}

let cliRoot = "";

/** 版本号：从 package.json 读（硬编码会随 bump 漂移）；读取失败回退占位。 */
const VERSION = (() => {
	try {
		return (
			(
				JSON.parse(
					readFileSync(join(__dirname, "../package.json"), "utf8"),
				) as { version?: string }
			).version ?? "0.0.0"
		);
	} catch {
		return "0.0.0";
	}
})();

/** 递归找 dir 下最新 .ts 文件 mtime（目录 mtime 只在直接子项变化时更新——`src/core/x.ts` 改动
 * 不会碰 `src/` 目录 mtime，直接比较会漏报；src 体量小（~1 万行），启动遍历成本可忽略）。 */
function newestTsMtime(dir: string): number {
	let max = 0;
	try {
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, e.name);
			if (e.isDirectory()) max = Math.max(max, newestTsMtime(p));
			else if (e.isFile() && e.name.endsWith(".ts")) {
				try {
					max = Math.max(max, statSync(p).mtimeMs);
				} catch {
					/* 单文件 stat 失败忽略 */
				}
			}
		}
	} catch {
		/* 目录不可读 → 0（视同无 src） */
	}
	return max;
}

/** dev 场景 stale-dist 检测：仓库内运行（src 存在）且 src 核心文件比 dist 产物新 → 警告。
 * 会话实证（InitDeity 重构）：src 已支持 `scan` 子命令、dist 未重建——agent 在旧二进制上排查
 * "scandir '.'" 十余轮才意识到是构建过期。安装版（无 src）静默跳过。 */
function warnIfStaleDist(): void {
	try {
		const distEntry = join(__dirname, "cli.js");
		const srcDir = join(__dirname, "..", "src");
		const distStat = statSync(distEntry);
		if (newestTsMtime(srcDir) > distStat.mtimeMs + 1000) {
			console.error(
				"codeaudit: ⚠ src/ 比 dist/ 新——当前运行的是旧构建，结果可能不反映源码；运行 npm run build 后重试",
			);
		}
	} catch {
		// stat 失败（缺文件）→ 不提示，避免噪音
	}
}

/** 错误消息中的绝对路径前缀裁剪为 "."（段边界：仅当下个字符不是路径延续字符；root 为空/不出现则原样）。
 * 仅裁剪展示（防完整绝对路径泄露）；失败点定位由 catch 里的相对路径附加承担。 */
function trimRootPath(msg: string): string {
	if (!cliRoot || !msg.includes(cliRoot)) return msg;
	const i = msg.indexOf(cliRoot);
	const after = msg[i + cliRoot.length];
	if (after !== undefined && /[A-Za-z0-9_.~-]/.test(after)) return msg; // D:\proj2 不裁剪；引号/分隔符/结尾则裁剪
	return msg.slice(0, i) + "." + msg.slice(i + cliRoot.length);
}

/** 反序列化 --json 输出（Set→数组、Infinity→"Infinity" 序列化）→ 可复用视图的 ScanReport。
 * 验证回路核心（iter54-r3）：改工具逻辑后对旧数据重算全部视图，不用重扫（10-20min → 秒级）。
 * 会话实证：18:21 agent 手写 _rings.cjs 解析 216MB JSON 重算环；19:40 脚本 120s 超时。 */
function loadReport(file: string): ScanReport {
	let raw: {
		root: string;
		mode: "audit";
		stats: ScanStats;
		verdicts: Array<{
			chunk: Omit<Chunk, "direct" | "calls"> & {
				direct: Effect[];
				calls: string[];
			};
			purity: number;
			effects: string[];
			chain: number | "Infinity";
			chainDev: number | "Infinity";
			chainPath: string[];
			throwsTypes: string[];
			stateDeps: string[];
			chainCertain: boolean;
			provenance: Provenance;
		}>;
	};
	try {
		// iter54-r8（reviewer L2）：JSON.parse 前大小上限——与 cache.json/corpus 同款守卫
		// （V8 堆耗尽不可捕获；recheck 输入是第三方/历史产物，GB 级文件会 OOM 全进程）
		if (statSync(file).size > 64 * 1024 * 1024)
			throw new Error("recheck 输入过大（>64MB）");
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch {
		throw new Error(`recheck: 无法解析 ${file}（需 --json 输出文件）`);
	}
	// 形状校验：合法 JSON 但缺 verdicts/stats（误传 HTML/compare 输出/截断文件）→ 友好报错
	// 而非 TypeError 崩溃（recheck 自审计 iter54-r4）
	if (!raw || typeof raw !== "object" || !Array.isArray(raw.verdicts)) {
		throw new Error(
			`recheck: ${file} 缺少 verdicts 数组（需 codeaudit scan --json 的完整输出）`,
		);
	}
	// 截断检测（iter54-r7，reviewer 4d40012e Low）：`scan --json --top N` 截断 verdicts——
	// recheck 该文件会静默计算不完整视图；stats.chunks 是全量数，verdicts.length 是截断后数，
	// 不等即不完整 → 警告（不阻断——可能是用户刻意 --top 截断，但视图数字会与 stats 矛盾）
	if (
		raw.stats &&
		typeof raw.stats.chunks === "number" &&
		raw.verdicts.length < raw.stats.chunks
	) {
		console.error(
			`codeaudit: ⚠ recheck 输入 ${file} 的 verdicts（${raw.verdicts.length}）少于 stats.chunks（${raw.stats.chunks}）——可能来自 --top 截断，视图为不完整计算`,
		);
	}
	if (
		!raw.stats ||
		typeof raw.stats !== "object" ||
		typeof raw.stats.files !== "number"
	) {
		throw new Error(
			`recheck: ${file} 缺少 stats（需 codeaudit scan --json 的完整输出）`,
		);
	}
	// 元素级形状校验：verdicts 元素缺 chunk.calls/direct 会静默变空 Set（new Set(undefined)=空）——
	// 判定失真不可见；显式报错（iter54-r5 自审计）
	for (const [i, v] of raw.verdicts.entries()) {
		if (
			!v ||
			typeof v !== "object" ||
			!v.chunk ||
			typeof v.chunk !== "object" ||
			!Array.isArray(v.chunk.calls) ||
			!Array.isArray(v.chunk.direct)
		) {
			throw new Error(
				`recheck: ${file} 第 ${i} 条 verdict 缺 chunk.calls/direct 数组（需完整 --json 输出）`,
			);
		}
		// iter54-r8（reviewer M1 stored XSS 纵深防御）：effects 元素必须 ∈ Effect 闭合联合
		// （scan 模式内部保证；recheck 的 JSON 是第三方/历史产物，不可信——非闭合值会直通
		// htmlreport badge 插值，虽有 esc() 兜底但形状校验让污染在源头失败）
		if (v.effects !== undefined) {
			if (!Array.isArray(v.effects)) {
				throw new Error(`recheck: ${file} 第 ${i} 条 verdict 的 effects 应为数组`);
			}
			for (const e of v.effects) {
				if (typeof e !== "string" || !EFFECT_SET.has(e)) {
					throw new Error(
						`recheck: ${file} 第 ${i} 条 verdict 的 effects 含非法值 ${JSON.stringify(e)}（须 ∈ {io,net,fs,db,random,clock,state}）`,
					);
				}
			}
		}
	}
	const verdicts: Verdict[] = raw.verdicts.map((v) => ({
		...v,
		chunk: {
			...v.chunk,
			direct: new Set(v.chunk.direct),
			calls: new Set(v.chunk.calls),
		},
		effects: new Set(v.effects),
		chain: v.chain === "Infinity" ? Infinity : v.chain,
		chainDev: v.chainDev === "Infinity" ? Infinity : v.chainDev,
	}));
	return { root: raw.root, mode: raw.mode, verdicts, stats: raw.stats };
}

/** 语料先验提示（建议置信度，非纯度判定；n 不足/分歧大时不提示）。0.65/0.35 与 PRIOR_THRESHOLD 同源。 */
function priorHint(corpus: CorpusFile, sites: Chunk["unknownCalls"]): string {
	const hints: string[] = [];
	for (const site of sites) {
		const p = priorFor(corpus, site);
		if (!p) continue;
		if (p.pPure >= PRIOR_THRESHOLD)
			hints.push(
				`「${site.attr}」形态历史 ≈${(p.pPure * 10).toFixed(0)} 成被标 PURE（n=${p.n}）`,
			);
		else if (p.pPure <= 1 - PRIOR_THRESHOLD)
			hints.push(
				`「${site.attr}」形态历史 ≈${((1 - p.pPure) * 10).toFixed(0)} 成被标 IMPURE（n=${p.n}）`,
			);
	}
	return hints.length > 0
		? " | " +
				hints.join("；") +
				" —— 语料先验为建议置信度，非纯度判定，请以函数体为准"
		: "";
}

/**
 * 迭代36 §b-2 落地：--state 序列化长度工程上界。500 写方硬上限是实测调参值非数学上界
 * （500 写方 × 平均 >1.3 万读者仍可超 V8 上限）。每写方条目 compact 序列化长度前缀和
 * （非负 → 单调）+ 二分找最大满足预算的前缀。
 * 注意（迭代38 数学评审降级）：前缀和是单条目长度和，非数组序列化长度（少 [ ] 与 lo-1 个逗号，
 * ≤~500 字符可忽略）；compact → pretty 膨胀无数学界（短 key 实测可达 2.5-3×）——安全性靠
 * 64M ≪ V8 上限 536M 的 ≈8× 余量，非证明。
 * 单条目超预算（单写方海量读者）→ 输出空数组（JSON 合法不崩；按读者数截断该条目为升级路径）。
 */
function capStateCoupling(
	entries: StateCouplingEntry[],
	cap: number,
	budget = 64 * 1024 * 1024,
): StateCouplingEntry[] {
	const slice = entries.slice(0, cap);
	const prefix = new Array<number>(slice.length + 1);
	prefix[0] = 0;
	for (let i = 0; i < slice.length; i++)
		prefix[i + 1] = prefix[i]! + JSON.stringify(slice[i]).length;
	if (prefix[slice.length]! <= budget) return slice;
	let lo = 0;
	let hi = slice.length;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (prefix[mid]! <= budget) lo = mid;
		else hi = mid - 1;
	}
	return slice.slice(0, lo);
}
async function main(): Promise<void> {
	const startedAt = Date.now();
	const args = parseArgs(process.argv);
	let root = resolve(args.dir);
	cliRoot = root;

	warnIfStaleDist(); // dev 场景（仓库内运行）：src 比 dist 新 → 警告（会话实证：stale dist 无 `scan` 子命令支持，误导排查多轮）

	let annotations: ReadonlyMap<string, "PURE" | "IMPURE"> | undefined;
	if (args.annotations) {
		try {
			const list = JSON.parse(readFileSync(args.annotations, "utf8")) as Array<{
				id?: unknown;
				verdict?: unknown;
				file?: unknown;
			}>;
			const m = new Map<string, "PURE" | "IMPURE">();
			for (const item of list) {
				if (
					item &&
					typeof item.id === "string" &&
					(item.verdict === "PURE" || item.verdict === "IMPURE")
				) {
					// 带 file 的标注锚定到具体实例（同内容跨文件判定可不同——import 上下文差异）；
					// 纯 id = 内容寻址（公理4 语义：同内容同判定，适用于全部同 id chunk）
					m.set(
						typeof item.file === "string"
							? item.file + "\u0000" + item.id
							: item.id,
						item.verdict,
					);
				}
			}
			annotations = m;
			console.error(`annotations -> ${args.annotations} (${m.size} 条生效)`);
		} catch {
			console.error("codeaudit: 无法读取标注文件 " + args.annotations);
			process.exit(2);
		}
	}
	let effectOverrides:
		| Readonly<Record<string, Partial<EffectTables>>>
		| undefined;
	if (args.effectTable) {
		try {
			effectOverrides = loadEffectOverrides(args.effectTable) as Readonly<
				Record<string, Partial<EffectTables>>
			>;
			console.error(`effect table -> ${args.effectTable}`);
		} catch {
			console.error("codeaudit: 无法读取效应表文件 " + args.effectTable);
			process.exit(2);
		}
	}

	let report: ScanReport;
	if (args.recheck) {
		// 重算模式：加载 --json 输出，跳过扫描/缓存/标注注入（verdicts 已含最终判定）——
		// 改工具视图逻辑后对旧数据秒级重算（iter54-r3；会话实证 10-20min 重扫 + 手写脚本）
		report = loadReport(args.recheck);
		root = report.root; // 视图用 root（HTML title/--changed 相对解析）对齐 JSON 内的扫描根
		console.error(
			`recheck ${args.recheck}（${report.verdicts.length} verdicts，${report.stats.files} 文件）`,
		);
	} else {
		// 开始信号 + 缓存状态（会话实证：agent 无法区分重扫是增量还是全量——缓存命中数从未输出，
		// 误判"无缓存 → 全量 10min"干等；scanProject 内部已统计 cachedFiles 但从未暴露到 CLI）
		console.error(`扫描开始（${args.noCache ? "缓存禁用" : "增量缓存"}）…`);
		report = await scanProject(root, {
			useCache: !args.noCache,
			cacheDir: resolve(root, ".codeaudit"),
			annotations,
			effectOverrides,
		});
	}
	const s = report.stats;
	if (!args.recheck) {
		console.error(
			`扫描完成: ${s.files} 文件 / ${s.chunks} chunks / 缓存命中 ${s.cachedFiles} / 跳过 ${s.skippedFiles} / 解析错误 ${s.parseErrors} / ${((Date.now() - startedAt) / 1000).toFixed(0)}s`,
		);
	}

	// 回归风险分析（--changed）：L×C 模型，六因子从扫描数据推导
	if (args.changed !== null && args.changed.length > 0) {
		// 路径语义：git diff 输出相对 cwd，chunk.file 相对 root——统一转相对 root
		const changedPaths = args.changed.map((p) =>
			relative(root, resolve(p)).split(sep).join("/"),
		);
		const r = riskOfChange(report.verdicts, new Set(changedPaths));
		// json 模式下走 stderr（避免与 JSON 输出混合流破坏 parse；迭代12 交叉复审修复）
		const out = (msg: string): void =>
			args.format === "json" ? console.error(msg) : console.log(msg);
		if (r.grade === "invalid") {
			console.error(
				`codeaudit: 回归风险不可评估——${r.unmatchedFiles} 个改动文件未匹配任何 chunk（路径形态/无源码）`,
			);
			process.exitCode = 1; // 与 --strict 门禁一致：不静默放行（终裁 A1）
		} else {
			const f = r.factors;
			out(
				`回归风险 ${r.risk.toFixed(1)}/100 [${r.grade.toUpperCase()}]  ` +
					`（影响 ${f.impact.toFixed(2)} 纯度 ${f.purity.toFixed(2)} 环 ${f.cycle.toFixed(2)} ` +
					`深度 ${f.depth.toFixed(2)} 迷雾 ${f.fog.toFixed(2)} 状态 ${f.state.toFixed(2)}）`,
			);
			out(
				`  改动 ${r.changedChunks} chunk / 受影响调用者 ${r.affectedChunks} / L=${r.likelihood.toFixed(2)} C=${r.consequence.toFixed(2)}`,
			);
			out(
				`  证据质量：未知率 ${(r.evidence.unknownRate * 100).toFixed(1)}% / parseError ${(r.evidence.parseErrorRate * 100).toFixed(1)}% / 未解析站点 ${(r.evidence.missingSiteRate * 100).toFixed(1)}%`,
			);
			// 可解释性（迭代15）：grade 该做什么 + 证据质量置信度提示（视角 4 文本修正）
			const gradeAction: Record<string, string> = {
				low: "低风险（<15）可合入——非零风险，留意影响面内调用者",
				medium: "建议先查受影响调用者（反向闭包）再合入",
				high: "需检查状态耦合与调用者行为；合入前人工复核",
				critical:
					"高爆裂半径改动；建议阻止自动合入（无门禁，需流水线/人工执行），需全链路验证",
			};
			const action = gradeAction[r.grade] ?? "";
			out(`  ➜ ${action}`);
			if (r.evidence.unknownRate > 0.5)
				out(`  ⚠ 未知率过高——判定覆盖面不足，建议先标注再作结论`);
			if (r.evidence.parseErrorRate > 0)
				out(
					`  ⚠ ${(r.evidence.parseErrorRate * 100).toFixed(1)}% 文件解析失败——指标低估结构复杂度`,
				);
			if (r.evidence.missingSiteRate > 0.5)
				out(`  ⚠ 未解析站点过半——图指标是下界，实际影响面可能更大`);
			// 合入门禁（F5）：grade ≥ high → exit 1（与 --strict 可共存，Math.max 保序——任一拒绝即 1）
			if (args.gate) {
				const g = gateExit(r.grade);
				out(
					`  [gate] ${r.grade.toUpperCase()} → ${g === 1 ? "拒绝合入 (exit 1)" : "放行"}`,
				);
				process.exitCode = Math.max(
					typeof process.exitCode === "number" ? process.exitCode : 0,
					g,
				);
			}
		}
	}

	// 标注语料：加载（--corpus 或项目默认）→ 标注回读累积 → 保存（幂等去重）
	let corpus: CorpusFile = emptyCorpus();
	const corpusPath =
		args.corpus ??
		(args.noCache ? null : join(resolve(root, ".codeaudit"), "corpus.json"));
	if (corpusPath) {
		try {
			// parse 前大小上限（与 cache.json 同款）：仓库自带 GB 级语料 → JSON.parse OOM
			if (statSync(corpusPath).size > 64 * 1024 * 1024)
				throw new Error("corpus too large");
			const parsed = JSON.parse(readFileSync(corpusPath, "utf8")) as unknown;
			if (!isCorpus(parsed)) corpus = emptyCorpus();
			else corpus = parsed;
		} catch {
			corpus = emptyCorpus();
		}
		if (annotations && annotations.size > 0) {
			const before = summarize(corpus);
			// 语料防污染（迭代21 数学解 A）：被拒标注（annotationRejected）不得写入语料——
			// PURE 落在工具已证 IMPURE 的 chunk 是 no-op+矛盾标签，priorFor 会据矛盾标签给错误先验
			const rejectedIds = new Set(
				report.stats.annotationRejected.map((r) => r.id),
			);
			const acceptedAnn = new Map<string, "PURE" | "IMPURE">();
			for (const [k, v] of annotations) {
				const id = k.split("\u0000")[1] ?? k;
				if (!rejectedIds.has(id)) acceptedAnn.set(k, v);
			}
			if (acceptedAnn.size > 0) {
				corpus = updateCorpus(
					corpus,
					report.verdicts.map((v) => v.chunk),
					acceptedAnn,
				);
			}
			if (report.stats.annotationRejected.length > 0) {
				console.error(
					`codeaudit: ${report.stats.annotationRejected.length} 条标注被拒（未生效/矛盾——不写入语料）：` +
						report.stats.annotationRejected
							.slice(0, 5)
							.map((r) => `${r.file}（${r.reason}）`)
							.join("；") +
						(report.stats.annotationRejected.length > 5 ? `…` : ""),
				);
			}
			// 迭代44-r3（标注运营痛点1）：id 未匹配回显——内容已变/工具修复后 chunk 消失/拼写错误，
			// 此前静默忽略（标注者不知道白做了）。
			if ((report.stats.annotationUnmatched?.length ?? 0) > 0) {
				console.error(
					`codeaudit: ${report.stats.annotationUnmatched.length} 条标注未匹配（id 在本次扫描 chunks 中无对应——内容已变/工具修复/拼写错误，标注无效）：` +
						report.stats.annotationUnmatched
							.slice(0, 5)
							.map((u) => `${u.file ?? "(无file)"}::${u.id.slice(0, 12)}`)
							.join("；") +
						(report.stats.annotationUnmatched.length > 5 ? `…` : ""),
				);
			}
			const after = summarize(corpus);
			if (after.total > before.total) {
				try {
					mkdirSync(dirname(corpusPath), { recursive: true });
					const tmp = corpusPath + ".tmp";
					writeFileSync(tmp, JSON.stringify(corpus, null, 2));
					renameSync(tmp, corpusPath); // 原子替换：防符号链接写穿/半写
					console.error(
						`语料 -> ${corpusPath}（累计 ${after.pure} pure / ${after.impure} impure）`,
					);
				} catch {
					// 语料写失败不影响扫描结果
				}
			}
		}
	}

	if (report.stats.invariantViolations > 0 || report.stats.staleEdges > 0) {
		console.error(
			`codeaudit: warning — ${report.stats.invariantViolations} invariant violations, ${report.stats.staleEdges} stale edges`,
		);
	}

	// 迭代49 插件化：--html <file>——技术债 HTML 可视化（renderTechdebtHtml 库 API 的 CLI 入口，
	// 通用任意项目；独立于 format，不影响 text/json 主输出）
	if (args.html) {
		try {
			const html = renderTechdebtHtml(report.verdicts, report.stats, {
				title: `codeaudit 技术债报告 — ${root}`,
				scannedAt: report.stats.scannedAt,
				version: VERSION,
				cachedFiles: report.stats.cachedFiles,
			});
			writeFileSync(args.html, html);
			console.error(
				`HTML -> ${args.html}（${(html.length / 1024).toFixed(0)} KB）`,
			);
		} catch (e) {
			throw new Error(`--html 写入失败：${(e as Error).message}`);
		}
	}

	if (args.format === "json") {
		// --top 与 text 语义一致（P1-3 迭代51 审计修正）：滤 PURE → in-degree 治理排序 → 取前 N。
		// 此前 json 直接 slice 扫描序——json 消费方（AI/CI）拿不到治理序，与 text 分歧。
		const out =
			args.top !== null
				? {
						...report,
						verdicts: (() => {
							const inDeg = new Map<string, number>();
							for (const v of report.verdicts)
								for (const t of v.chunk.calls)
									if (t !== UNKNOWN_TARGET)
										inDeg.set(t, (inDeg.get(t) ?? 0) + 1);
							return report.verdicts
								.filter((v) => v.purity !== Purity.PURE)
								.sort((a, b) => {
									const da = inDeg.get(a.chunk.key) ?? 0;
									const db = inDeg.get(b.chunk.key) ?? 0;
									if (db !== da) return db - da;
									return (b.chain ?? 0) - (a.chain ?? 0);
								})
								.slice(0, args.top);
						})(),
					}
				: report;
		// --topology：json 顶层加拓扑字段（additive，现有 schema 消费者不受影响；迭代14 视角 3）
		const payload = args.topology
			? { ...out, topology: graphMetrics(report.verdicts) }
			: out;
		// --sources：json 顶层加效应源字段（R2-1：与 topology 同款 additive；否则 json 模式静默忽略）
		// 迭代17 视角 1 修正：direct.size>0 守卫——chain=0 IMPURE 含悲观未知源（direct=[]，如 Extractor.visit
		// 的 ? 归零链），非"直接调 io/net/random/state 的源头"
		const payload2 = args.sources
			? {
					...payload,
					sources: report.verdicts
						.filter(
							(v) =>
								v.purity === Purity.IMPURE &&
								v.chain === 0 &&
								v.chunk.direct.size > 0,
						)
						.sort(
							(a, b) =>
								b.chunk.calls.size - a.chunk.calls.size ||
								(a.chunk.key < b.chunk.key ? -1 : 1),
						)
						.map((v) => ({
							name: v.chunk.name,
							file: v.chunk.file,
							line: v.chunk.line,
							calls: v.chunk.calls.size,
						})),
				}
			: payload;
		// --state：json 顶层加状态耦合链（迭代23 D-127；与 sources/topology 同款 additive——
		// 迭代33 崩溃修复：全量计算（避免 --top 预滤 verdicts 导致耦合失真）但输出截断——
		// InitDeity 6591 写方 × readerKeys 跨积超 V8 字符串上限（Invalid string length 实证）。
		// 默认 top 50（覆盖热点）；**硬上限 500**（迭代34 独立审计 Low：用户 --state --top 5000
		// 在 InitDeity 规模仍会复现崩溃——截断必须封顶，不能完全交给 --top）。
		// 迭代36 §b-2 落地：500 是实测调参值非数学上界（500 写方 × 平均 >1.3 万读者仍超限）——
		// 序列化前按条目真实 compact 长度前缀和二分收缩，保证 stateCoupling 字段序列化 < 64M 字符
		// （V8 上限 2^29-24 ≈ 536M；compact 精确、pretty 缩进膨胀有界 ≲2×，64M 留足余量）。
		const payload3 = args.state
			? {
					...payload2,
					stateCoupling: capStateCoupling(
						stateCouplingOf(report.verdicts),
						Math.min(args.top ?? 50, 500),
					),
				}
			: payload2;
		console.log(
			JSON.stringify(
				payload3,
				(_k, v) =>
					v instanceof Set ? [...v] : v === Infinity ? "Infinity" : v,
				2,
			),
		);
	} else {
		const s = report.stats;
		// 迭代44-r4 权重调整：核心汇总先行（STATS），视图其次，明细清单最后
		console.log(
			`STATS: pure ${s.pure}, impure ${s.impure}, unknown ${s.unknown}`,
		);
		if (args.topology) {
			// 拓扑摘要（--topology text 模式；迭代14 视角 3）+ 可解释性解读（迭代15）+ 可规约性/骨架（迭代46）
			const t = graphMetrics(report.verdicts);
			const brTopo = bridgesOf(report.verdicts);
			// 迭代50-r3 修正（用户判据）：density 在稀疏图上恒小无判别力（28060 节点 100 万边也 <0.05）——
			// 结构形态判据 = 桥比例（桥边/总边）：树=100% 边是唯一通道；低桥比例 = 多数边有替代路径 = 网状。
			const bridgeRatio =
				t.knownEdges > 0 ? brTopo.bridges.length / t.knownEdges : 1;
			console.log(
				`拓扑：${t.nodes} nodes / ${t.knownEdges} edges / ` +
					`桥比例 ${(bridgeRatio * 100).toFixed(0)}% / ` +
					`自环 ${t.selfLoopCount} / 环 ${t.cyclicComponents} / 深度 ${t.dagDepth} / ` +
					`未知边 ${t.unknownEdges}`,
			);
			if (bridgeRatio > 0.7)
				console.log(
					`  ➜ 近树结构（${(bridgeRatio * 100).toFixed(0)}% 边是唯一通道——模块间松耦合，改动局部化）`,
				);
			else if (bridgeRatio < 0.3)
				console.log(
					`  ➜ 网状结构（仅 ${(bridgeRatio * 100).toFixed(0)}% 边是唯一通道——多数边有替代路径，环化度高；${t.unknownEdges} 条未知边未计入）`,
				);
			else
				console.log(
					`  ➜ 混合结构（桥比例 ${(bridgeRatio * 100).toFixed(0)}%——部分模块松耦合、部分网状）`,
				);
			if (t.selfLoopCount > 0)
				console.log(
					`  ➜ ${t.selfLoopCount} 个自递归 chunk（自我调用——重构时注意终止性）`,
				);
			if (t.cyclicComponents > 0)
				console.log(
					`  ➜ ${t.cyclicComponents} 个循环依赖（SCC>1——初始化/销毁顺序风险）`,
				);
			// 有向形态（迭代55）：源/汇 + 回边（同 SCC 内边——每条都在某个环上；自环已在首行单列）
			console.log(
				`  ➜ 有向形态：源 ${t.inDegreeHistogram[0] ?? 0} 个 / 汇 ${t.outDegreeHistogram[0] ?? 0} 个 / ` +
					`回边 ${t.backEdges}（同 SCC 内边，环内冗余）`,
			);
			// 迭代46 C：可规约性（Hecht-Ullman——单入口=结构化递归、多入口=纠缠递归）
			if (t.multiEntryScc > 0)
				console.log(
					`  ➜ 其中 ${t.multiEntryScc} 个多入口纠缠环（多个调用者从不同节点进环——重构雷区，优先解耦）`,
				);
			// 迭代46 桥/割点：模块边界（无向化凝聚图唯一通道/必经枢纽）
			const br = bridgesOf(report.verdicts);
			if (br.bridges.length > 0)
				console.log(
					`  ➜ ${br.bridges.length} 条桥边（模块间唯一连通通道——契约测试/版本兼容必保接口）`,
				);
			if (br.articulationPoints.length > 0)
				console.log(
					`  ➜ ${br.articulationPoints.length} 个割点枢纽（必经分量——改动影响面最大，评审从严）`,
				);
			if (t.dagDepth > 0)
				console.log(
					`  ➜ 调用图最深路径 ${t.dagDepth} 层（结构深度；真实效应传播深度看 HTML 长传播链——chain 只是最近源距离）`,
				);
		}
		if (args.sources) {
			// 效应源清单（迭代16 --sources；迭代17 视角 1 修正）：chain=0 IMPURE **且 direct 非空**——
			// 直接调 io/net/random/state 的源头（"背锅者"）；排除悲观未知源（? 归零链但 direct=[]）。
			// 按出度（已解析调用点）降序 = 源头的直接调用负载；扩散面（调用者反向闭包）看 --changed 的 impact
			const srcs = report.verdicts
				.filter(
					(v) =>
						v.purity === Purity.IMPURE &&
						v.chain === 0 &&
						v.chunk.direct.size > 0,
				)
				.sort(
					(a, b) =>
						b.chunk.calls.size - a.chunk.calls.size ||
						(a.chunk.key < b.chunk.key ? -1 : 1),
				);
			console.log(
				`\n效应源（chain=0 IMPURE，直接调 io/net/random/state 的源头；${srcs.length} 个）：`,
			);
			for (const v of srcs.slice(0, args.top ?? 15)) {
				console.log(
					`  ${String(v.chunk.calls.size).padStart(3)} 调用  ${v.chunk.name.padEnd(36)} ${v.chunk.file}:${v.chunk.line}`,
				);
			}
			if (srcs.length > (args.top ?? 15))
				console.log(`  … 共 ${srcs.length} 个（--top N 查看更多）`);
		}
		if (args.state) {
			// 状态耦合图（迭代23 D-127）：写方按读者数降序，top 15——架构热点"谁写、谁读、哪个写方扩散面最大"
			const couplings = stateCouplingOf(report.verdicts);
			if (couplings.length === 0) {
				console.log(`\n状态耦合：无（无项目内写方或读者）`);
			} else {
				// 读者 chunk key → file:line（示例路径展示用）
				const locByKey = new Map(
					report.verdicts.map((v) => [
						v.chunk.key,
						`${v.chunk.file}:${v.chunk.line}`,
					]),
				);
				const top = args.top ?? 15;
				console.log(`\n状态耦合（写方按读者数降序；top ${top}）：`);
				for (const e of couplings.slice(0, top)) {
					const first = e.readerKeys[0] ?? "";
					const loc = locByKey.get(first) ?? first;
					console.log(
						`  ${String(e.readers).padStart(3)} 读者  ${e.name.padEnd(36)} ${e.writes.join(",").padEnd(28)} ${e.file}:${e.line}  ← 示例读者 ${loc}` +
							(e.readerKeys.length > 1
								? `（等 ${e.readerKeys.length} 个）`
								: ""),
					);
				}
				if (couplings.length > top)
					console.log(`  … 共 ${couplings.length} 个写方（--top N 查看更多）`);
				// ⊤ 降级注记（防静默欠报纪律；json 原样含 "⊤" 不加字段）
				const topWriters = couplings.filter((e) =>
					e.writes.some((w) => w.includes("⊤")),
				).length;
				if (topWriters > 0)
					console.log(
						`  （注：${topWriters} 个写方含 ⊤ 降级匹配——近似耦合，见 README 已知限制）`,
					);
			}
		}
		if (args.modules) {
			// 迭代44-r4：模块级聚合（重构范围决策视图）——目录前缀聚合 purity/效应面/链深
			const mods = moduleSummary(report.verdicts);
			console.log(`\n模块聚合（按 chunk 数降序；top ${args.top ?? 15}）：`);
			for (const m of mods.slice(0, args.top ?? 15)) {
				console.log(
					`  ${String(m.chunks).padStart(5)} chunks  P=${m.pure} U=${m.unknown} I=${m.impure}  ${(m.unknownRate * 100).toFixed(1)}%?  C=${String(m.maxComplexity).padStart(3)}  chain=${m.maxChain}  [${m.effects.join(",") || "-"}]  ${m.module}`,
				);
			}
		}
		if (args.complexity) {
			// 迭代44-r4：圈复杂度 top（重构复杂函数识别）——函数/方法级（排除类 chunk——
			// MCCabe 是函数级度量；类级 = 方法之和属噪音）
			const complex = report.verdicts
				.filter(
					(v) => v.chunk.kind !== "class" && (v.chunk.complexity ?? 0) > 5,
				)
				.sort((a, b) => (b.chunk.complexity ?? 0) - (a.chunk.complexity ?? 0));
			console.log(
				`\n圈复杂度 top（>5；共 ${complex.length} 个；top ${args.top ?? 15}）：`,
			);
			for (const v of complex.slice(0, args.top ?? 15))
				console.log(
					`  C=${String(v.chunk.complexity).padStart(3)}  n=${String(v.chunk.nesting).padStart(2)}  ${v.chunk.name.padEnd(40)} ${v.chunk.file}:${v.chunk.line}`,
				);
		}
		if (args.deps) {
			// 迭代44-r4：文件依赖（拆分决策）——入/出边文件清单
			const outDeps = outDepsOf(report.verdicts, args.deps);
			const inDeps = inDepsOf(report.verdicts, args.deps);
			console.log(`\n依赖 ${args.deps}：`);
			console.log(`  出边（它调用谁，top 10）：`);
			for (const d of outDeps.slice(0, 10))
				console.log(`    ${String(d.edges).padStart(4)}  ${d.file}`);
			if (outDeps.length === 0) console.log(`    （无出边——纯叶/孤立）`);
			console.log(`  入边（谁调用它，top 10）：`);
			for (const d of inDeps.slice(0, 10))
				console.log(`    ${String(d.edges).padStart(4)}  ${d.file}`);
			if (inDeps.length === 0) console.log(`    （无入边——无消费者）`);
			// 迭代46 A：依赖骨架（凝聚 DAG 传递约简）——文件级聚合：骨架边指向该 chunk 所在文件
			const sk = dependencySkeleton(report.verdicts);
			const chunkFile = new Map(
				report.verdicts.map((v) => [v.chunk.key, v.chunk.file]),
			);
			const skFiles = new Map<string, number>(); // 目标文件 → 骨架边数
			for (const e of sk) {
				const f = chunkFile.get(e.to);
				if (f && f !== args.deps) skFiles.set(f, (skFiles.get(f) ?? 0) + 1);
			}
			if (skFiles.size > 0) {
				console.log(`  骨架（传递去重后真直接依赖，top 10）：`);
				for (const [f, n] of [...skFiles.entries()]
					.sort((a, b) => b[1] - a[1])
					.slice(0, 10))
					console.log(`    ${String(n).padStart(4)}  ${f}`);
			}
		}
		if (args.compare) {
			// 迭代44-r4：重构前后对比（复用 compareReports 库 API）——判定翻转 + unknown 变化摘要
			try {
				// iter54-r8（reviewer L2）：JSON.parse 前大小上限（与 cache/corpus/recheck 同款）
				if (statSync(args.compare).size > 64 * 1024 * 1024)
					throw new Error("compare 输入过大（>64MB）");
				const before = JSON.parse(readFileSync(args.compare, "utf8")) as {
					verdicts: Array<{
						chunk: { key: string; file: string; name: string };
						purity: number;
						chain: number;
						effects: string[];
					}>;
				};
				const toView = (x: (typeof before.verdicts)[number]): Verdict => ({
					purity: x.purity as Verdict["purity"],
					chain: x.chain,
					chainCertain: true,
					effects: new Set(x.effects),
					chunk: x.chunk as Verdict["chunk"],
					provenance: "static" as const,
					chainDev: x.chain,
					chainPath: [],
					throwsTypes: [],
					stateDeps: [],
				});
				const deltas = compareReports(
					before.verdicts.map(toView),
					report.verdicts,
				);
				const flipped = deltas.filter((d) => d.purityFrom !== d.purityTo);
				const beforeU = before.verdicts.filter((v) => v.purity === 1).length;
				console.log(
					`\n对比 ${args.compare}：unknown ${beforeU}→${report.stats.unknown}；判定翻转 ${flipped.length} 条`,
				);
				for (const d of flipped.slice(0, args.top ?? 10))
					console.log(`  ${d.file}:${d.name} ${d.purityFrom}→${d.purityTo}`);
				if (flipped.length > (args.top ?? 10))
					console.log(`  … 共 ${flipped.length} 条（--top N 查看更多）`);
			} catch (e) {
				console.error(
					"codeaudit: --compare 读取失败 " +
						(e instanceof Error ? e.message : String(e)),
				);
			}
		}
		console.log(
			`codeaudit ${VERSION} — ${s.chunks} chunks, ${s.files} files, ` +
				`unknown-rate ${(s.unknownRate * 100).toFixed(1)}%, cycles ${s.cycles}` +
				(s.cachedFiles > 0 ? `, cached ${s.cachedFiles}` : "") +
				(s.parseErrors > 0 ? `, parse-errors ${s.parseErrors}` : ""),
		);
		// 证明义务台账（provenance）：仅标注场景显示（无标注时全部 static，平凡事实不占输出）
		if (s.provenance.annotated + s.provenance.derived > 0) {
			console.log(
				`  证明台账：${s.pure - s.provenance.annotated - s.provenance.derived} 静态证明 / ${s.provenance.annotated} 标注 / ${s.provenance.derived} 释放` +
					`（static=机器证明 A6-inner；annotated=标注生效；derived=依赖标注传播）` +
					(s.impureApplied > 0
						? `；${s.impureApplied} IMPURE 标注生效（加 io）`
						: ""),
			);
		}
		// 调用图完整度（发散 F21）：未知站点占比——用户投入标注前先知道"图的完整度"
		const totalSites = report.verdicts.reduce(
			(sum, v) => sum + v.chunk.calls.size + v.chunk.unknownSites,
			0,
		);
		const missSites = report.verdicts.reduce(
			(sum, v) => sum + v.chunk.unknownSites,
			0,
		);
		if (totalSites > 0) {
			console.log(
				`  图完整度：${(100 * (1 - missSites / totalSites)).toFixed(1)}% 调用点已解析（${missSites} 未知站点）`,
			);
		}
		// 迭代44-r4：--topology/--modules/--deps 模式抑制默认清单（健康度/聚合视图不被 IMPURE 列表淹没）
		// 迭代48：默认治理清单按量纲内优先级排序——传播面（直接调用者数 in-degree，O(E) 单遍）
		// ——「先改哪个」= 被最多人直接调用的非纯 chunk 优先；量纲不混合（与 --complexity/--sources
		// 等视图各自独立排序，各回答各的量纲问题）。平手 chain 降序（传染更深优先）。
		let shown =
			args.topology || args.modules || args.deps !== null || args.complexity
				? []
				: report.verdicts.filter((v) => v.purity !== Purity.PURE);
		const inDeg = new Map<string, number>(); // 迭代48：量纲内传播面排序键（直接调用者数）
		for (const v of report.verdicts) {
			for (const t of v.chunk.calls) {
				if (t === UNKNOWN_TARGET) continue;
				inDeg.set(t, (inDeg.get(t) ?? 0) + 1);
			}
		}
		if (shown.length > 1) {
			shown = [...shown].sort((a, b) => {
				const da = inDeg.get(a.chunk.key) ?? 0;
				const db = inDeg.get(b.chunk.key) ?? 0;
				if (db !== da) return db - da;
				return (b.chain ?? 0) - (a.chain ?? 0);
			});
		}
		if (args.top !== null) shown = shown.slice(0, args.top);
		// 迭代51 审计修正（组头交错噪音）：先按纯度分组（IMPURE → UNKNOWN），组内保持 in-degree
		// 治理序——此前 in-degree 跨组排序导致组头 IMPURE/UNKNOWN 交替，首屏噪音。
		const groups: Array<[string, typeof shown]> = [
			["IMPURE", shown.filter((v) => v.purity === Purity.IMPURE)],
			[
				"UNKNOWN (audit 假设为不纯)",
				shown.filter((v) => v.purity !== Purity.IMPURE),
			],
		];
		for (const [group, vs] of groups) {
			if (vs.length === 0) continue;
			console.log("\n" + group);
			for (const v of vs) {
				console.log(
					`  chain=${fmtChain(v)}  ${fmtEffects(v).padEnd(10)} ` +
						`callers=${String(inDeg.get(v.chunk.key) ?? 0).padStart(3)}  ` +
						`${v.chunk.name.padEnd(28)} ${v.chunk.file}:${v.chunk.line}`,
				);
				// 传染路径（可解释性）：效应源 → ... → 本 chunk
				if (v.chainPath.length > 1) {
					console.log(`      传染: ${v.chainPath.join(" → ")}`);
				}
			}
		}
		// 效应表使用率摘要（迭代21 数学解 B——additive 一行，详情看 json stats.effectTableUsage）
		if (s.effectTableUsage) {
			for (const p of s.effectTableUsage) {
				const sm = p.summary;
				console.log(
					`效应表[${p.pack}]: ${sm.entries} 条目 / 命中 ${sm.hits} / corpus-inactive ${sm.corpusInactive}` +
						(sm.missSites > 0
							? ` / 咨询未中 ${sm.missSites} 站点（补表候选）`
							: "") +
						(sm.provablyDead > 0 ? ` / 结构性死条目 ${sm.provablyDead}` : ""),
				);
				// --table-usage 详情（迭代21 T8：补表候选 top 15——降 unknown-rate 正路）
				if (args.tableUsage && p.missSlots.length > 0) {
					console.log(`  补表候选 top 15（module 未中 1:1 对应未知站点）:`);
					for (const m of p.missSlots.slice(0, 15)) {
						console.log(`    miss ${String(m.miss).padStart(5)} ${m.slot}`);
					}
				}
			}
		}
	}

	if (args.unknowns) {
		// 影响面排序：只导出自身含 `?` 的源（纯传播型 UNKNOWN 标它无意义）；
		// 影响面 = 该符号反向可达闭包内的 chunk 数（一次标注解除的 UNKNOWN 量）
		const chunks = report.verdicts.map((v) => v.chunk);
		const budget = annotationBudget(chunks);
		// 影响面排序：只导出自身含 `?` 的源（纯传播型 UNKNOWN 标它无意义）。
		// 键 = UNKNOWN 密集影响面（反向可达闭包内 UNKNOWN chunk 数，与曲线释放目标一致；
		// 总影响面作平手）。全闭包（含 PURE/IMPURE）影响面大 ≠ 解除 UNKNOWN 多（统计评审迭代2 #3）。
		const unknownKeys = unknownKeysOf(report.verdicts);
		const byImpact = annotationCompare(budget, unknownKeys);
		const unknowns = report.verdicts
			.filter(
				(v) => v.purity === Purity.UNKNOWN && v.chunk.calls.has(UNKNOWN_TARGET),
			)
			.sort((a, b) => byImpact(a.chunk.key, b.chunk.key))
			.map((v) => {
				const sp = siteShapeInfo(corpus, v.chunk.unknownCalls);
				return {
					id: v.chunk.id,
					symbol: v.chunk.name,
					file: v.chunk.file,
					line: v.chunk.line,
					parseError: v.chunk.parseError ?? false,
					// 可标注性分类（迭代21 数学解 C-缺口1）：stale-edge（悬垂边致 UNKNOWN——标 PURE 会被拒）
					// / 传播型（无自身 ?——纯下游传导——应标上游）——提示避免白费人工
					annotatable: v.chunk.parseError
						? false
						: v.chunk.calls.has(UNKNOWN_TARGET) && v.chunk.unknownSites > 0,
					influence: budget.influence.get(v.chunk.key) ?? 0,
					unknownSites: v.chunk.unknownSites,
					calls: v.chunk.unknownCalls,
					shape: sp.shape,
					prior: sp.prior ? { pPure: sp.prior.pPure, n: sp.prior.n } : null,
					batchable: sp.batchable,
					suggested_prompt:
						`函数 \`${v.chunk.name}\`（${v.chunk.file}:${v.chunk.line}）有 ${v.chunk.unknownSites} 个无法静态解析的调用点。` +
						(v.chunk.parseError
							? "该文件解析失败，函数体可能不完整（tree-sitter 错误恢复）——PURE 标注会被忽略，请只标 IMPURE 或改源码后重扫。"
							: `请判断它是否执行 I/O 或副作用，回答 PURE / IMPURE / UNKNOWN 并给出一句话理由（PURE 需全部调用点确证）。`) +
						priorHint(corpus, v.chunk.unknownCalls),
					// 迭代44-r3（工作台痛点3）：chunk 源码片段——标注者无需打开文件即可裁决
					//（unknownCalls 已在 calls 字段——此字段补齐代码上下文）。
					code: sourceSnippet(args.dir, v.chunk),
				};
			});
		// 原子写（与语料/缓存同款 tmp+rename）：--unknowns 指向预置符号链接时不写穿
		try {
			mkdirSync(dirname(args.unknowns), { recursive: true });
			const tmp = args.unknowns + ".tmp";
			writeFileSync(tmp, JSON.stringify(unknowns, null, 2));
			renameSync(tmp, args.unknowns);
		} catch {
			console.error("codeaudit: 无法写入 " + args.unknowns);
			process.exit(2);
		}
		// 标注曲线：按 UNKNOWN 密集影响面启发序的精确剩余 UNKNOWN（"标到多少就够"的预算数学）。
		// order = 导出源集（UNKNOWN 且含 `?`）；IMPURE 带未知的源不在清单、不参与释放计数。
		// 注：启发序非边际最优（共享源 chunk 的边际释放 < 桶大小）——给定顺序曲线精确，最优性留待改进
		const order = report.verdicts
			.filter(
				(v) => v.purity === Purity.UNKNOWN && v.chunk.calls.has(UNKNOWN_TARGET),
			)
			.map((v) => v.chunk.key)
			.sort(byImpact);
		const curve = annotationCurve(budget, order, unknownKeys);
		const total = curve[0] ?? 0;
		const u = unknownKeys.size;
		const pts = [0, 0.1, 0.25, 0.5, 0.75, 1].map((p) => {
			const k = Math.min(order.length, Math.round(p * order.length));
			const rem = curve[k] ?? 0;
			// 分母 = 全部 UNKNOWN |U|（迭代15 分母统一——对齐 proof Θ 语义：标 k 条 → rem/|U|，
			// 与 Θ(k) = 1−rem/|U| 同源；chunks 基是两倍分母、语义不同已被视角 5 裁决废除）。
			// 悬垂边/parseError 在 |U| 内 → 终值 >0 显示正确（与 staleEdges 注记自洽）。
			return `标${k}条→${rem} (${u > 0 ? ((rem / u) * 100).toFixed(1) : "0.0"}%)`;
		});
		console.error(
			`unknowns -> ${args.unknowns} (${unknowns.length} 条, 全标后 ${total}→${curve[curve.length - 1] ?? 0})`,
		);
		// staleEdges>0 时悬垂边 UNKNOWN 不可标注释放（目标不存在，只能重扫修复）——曲线终值低于 stats.unknown 属此因
		console.error(
			`标注曲线(贪心序): ${pts.join(" | ")}${report.stats.staleEdges > 0 ? `（注：${report.stats.staleEdges} 条悬垂边 UNKNOWN 只能重扫修复，不参与释放）` : ""}`,
		);
	}

	if (args.strict && report.stats.impure > 0) process.exitCode = 1;
}

main().catch((err) => {
	const msg = err instanceof Error ? err.message : String(err);
	// 裁剪绝对路径前缀（防完整 root 泄露——既有契约 robustness「错误消息裁剪绝对路径前缀」），
	// 但附加相对 root 的失败子路径：会话实证（InitDeity 重构）"scandir '.'" 因丢失真实失败点
	// 让排查者误判为 cwd/路径问题，浪费十余轮——相对路径既可定位又不泄露完整绝对路径。
	let display = trimRootPath(msg);
	const m = msg.match(/scandir '([^']+)'/);
	const failPath = m?.[1];
	if (failPath && cliRoot && failPath.startsWith(cliRoot)) {
		const rel = relative(cliRoot, failPath).split(sep).join("/");
		// rel 为空 = 失败点就是扫描根本身——此时裁剪后只剩 "scandir '.'"，与会话痛点同形
		// （agent 误判为 cwd/路径问题）；显式点明根目录不可访问
		display += rel ? `（失败点: ${rel}）` : "（扫描根目录不存在或不可访问）";
	}
	console.error("codeaudit: " + display);
	process.exitCode = 2; // 自然退出：process.exit 与 wasm 句柄关闭竞态会使退出码变 127
});
