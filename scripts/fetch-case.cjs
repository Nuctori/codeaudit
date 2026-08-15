#!/usr/bin/env node
/**
 * 真实项目用例矩阵（复现脚本 + 产物快照）。
 *
 * 用法：
 *   node scripts/fetch-case.cjs            # 全部用例：clone（manifest 记录的 ref）→ 扫描 → 产物快照
 *   node scripts/fetch-case.cjs --update   # 全部用例刷新到各自默认分支最新 HEAD
 *   node scripts/fetch-case.cjs <name> [--update]   # 单用例
 *
 * 产物：
 *   examples/cases/<name>/report.txt      # 全视图文本快照（入 git，确定性）
 *   examples/cases/<name>/report.html     # 技术债 HTML 报告（本地生成——含本地绝对路径，.gitignore 排除）
 *   examples/cases/<name>/manifest.json   # repo/ref/统计（入 git，全确定性——无时间戳字段）
 *
 * 设计：
 * - 默认用 manifest 记录的 pinned ref 复现（确定性）；--update 漂移到默认分支 HEAD
 * - clone 到系统临时目录（不入库）；prune 非目标语言/测试文件（静态扫描无需编译，
 *   go:embed 等嵌入资源删除不影响扫描语义）
 * - html 报告时间戳归一化为固定值（htmlreport scannedAt ?? new Date()）——CI 漂移检测
 *   （git diff --exit-code）要求复现逐字节一致
 * - 完整 JSON（可达 68MB）不入库——文档注明本地生成命令
 */
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const CASES_DIR = path.join(ROOT, "examples", "cases");
const CLI = path.join(ROOT, "dist", "cli.js");
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "codeaudit-case-"));

const CASES = {
	opencode: {
		repo: "https://github.com/anomalyco/opencode.git",
		ref: "4643e65ad6334de3e4e68dedc201d5fbb828c9fe", // dev@2026-08-15（首次实测）
		lang: "typescript",
		scanDir: "packages",
		prune: [
			"**/*.test.ts",
			"**/*.test.tsx",
			"**/*.test.js",
			"**/*.spec.ts",
			"**/test/**",
			"**/tests/**",
			"**/__tests__/**",
		], // 测试文件/目录（与 hugo/express 一致的聚焦策略）
		note: "AI coding agent（TS/TSX monorepo，32 包）——TS/TSX 语言支持验证",
	},
	express: {
		repo: "https://github.com/expressjs/express.git",
		ref: null, // 首次跑取默认分支 HEAD
		lang: "javascript",
		scanDir: ".",
		prune: ["**/test/**"], // mocha 测试
		note: "Node.js Web 框架（纯 JS，ESM+require 双形态）——JavaScript 语言支持验证",
	},
	hugo: {
		repo: "https://github.com/gohugoio/hugo.git",
		ref: "0805c734a41b75403e3970e0070227916b6845d2", // @2026-08-15（首次实测）
		lang: "go",
		scanDir: ".",
		prune: ["**/*.js", "**/*.mjs", "**/*.cjs", "**/*_test.go"], // 嵌入资源 + 测试
		note: "静态站点生成器（纯 Go，~500 文件）——Go 语言支持验证（驱动 Go pack 迭代）",
	},
	flask: {
		repo: "https://github.com/pallets/flask.git",
		ref: null,
		lang: "python",
		scanDir: "src",
		prune: [],
		note: "Python Web 框架（装饰器/类视图/蓝图）——Python 语言支持验证",
	},
	ocelot: {
		repo: "https://github.com/ThreeMammals/Ocelot.git",
		ref: "78c983d895e274e25becfee9d256f17b1908e15c", // @2026-08-15（首次实测）
		lang: "csharp",
		scanDir: "src",
		prune: [],
		note: "API 网关（纯 C#，~380 文件）——C# 语言支持验证（暴露 C# 12 集合表达式盲区）",
	},
};

function sh(cmd, cwd) {
	execSync(cmd, { cwd, stdio: "inherit", shell: true });
}

function shOut(cmd, cwd) {
	return execSync(cmd, {
		cwd,
		encoding: "utf8",
		shell: true,
		maxBuffer: 64 * 1024 * 1024, // 大仓库全视图输出可超 1MB 默认上限
	}).trim();
}

/** 克隆（浅，blob:none）+ checkout 目标 ref。返回 clone 目录。 */
function cloneCase(name, cfg, update) {
	const dir = path.join(TMP_ROOT, name);
	sh(`git clone --depth 1 --filter=blob:none ${cfg.repo} ${dir}`);
	const manifest = manifestPath(name);
	const pinned = fs.existsSync(manifest)
		? JSON.parse(fs.readFileSync(manifest, "utf8")).ref
		: cfg.ref;
	if (!update && pinned) {
		// 复现模式：checkout manifest 记录的 pinned ref（浅 fetch 单 commit）
		sh(`git fetch --depth 1 origin ${pinned}`, dir);
		sh(`git checkout --detach ${pinned}`, dir);
	}
	return dir;
}

function manifestPath(name) {
	return path.join(CASES_DIR, name, "manifest.json");
}

/** prune：删除非目标语言/测试文件（git ls-files 过滤，跨平台 rm）。 */
function pruneFiles(dir, patterns) {
	if (patterns.length === 0) return;
	// `**/` 前缀/中段 → 可选目录（根目录文件也匹配）；裸 `**`（尾部）→ 任意余下路径。
	// 占位符防 `.*` 的 `*` 被后续步骤误替换。
	const re = patterns
		.map((p) =>
			p
				.replace(/\*\*\/?/g, (m) => (m.endsWith("/") ? "@@DIR@@" : "@@ANY@@"))
				.replace(/[.+^${}()|[\]\\]/g, "\\$&")
				.replace(/\*/g, "[^/]*")
				.replace(/@@DIR@@/g, "(?:.*/)?")
				.replace(/@@ANY@@/g, ".*"),
		)
		.join("|");
	const listed = shOut("git ls-files", dir).split("\n");
	let n = 0;
	for (const f of listed) {
		if (new RegExp("^" + re + "$").test(f)) {
			fs.rmSync(path.join(dir, f), { force: true });
			n++;
		}
	}
	console.log(`  [prune] ${n} 个文件（非目标语言/测试）`);
}

/** 扫描：全视图文本 + HTML 报告。返回 stats 行。 */
function scanCase(dir, cfg, name) {
	const target = path.join(dir, cfg.scanDir);
	const views = [
		"--topology",
		"--sources",
		"--state",
		"--dups",
		"--dead",
		"--complexity",
		"--test-coverage",
	];
	const txt = shOut(
		`node ${JSON.stringify(CLI)} scan ${JSON.stringify(target)} --no-cache ${views.join(" ")}`,
		ROOT,
	);
	const statLine = txt
		.split("\n")
		.find((l) => l.includes("codeaudit ") && l.includes("chunks"));
	const htmlPath = path.join(TMP_ROOT, "report.html");
	sh(
		`node ${JSON.stringify(CLI)} scan ${JSON.stringify(target)} --no-cache --html ${JSON.stringify(htmlPath)}`,
		ROOT,
	);
	// 确定性：html 头部含生成时间戳（htmlreport scannedAt ?? new Date()）——归一化为固定值，
	// 否则 CI 漂移检测（git diff --exit-code）每次复现必然失败。
	const html = fs
		.readFileSync(htmlPath, "utf8")
		.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, "2000-01-01T00:00:00");
	fs.writeFileSync(htmlPath, html);
	fs.copyFileSync(htmlPath, path.join(CASES_DIR, name, "report.html"));
	fs.writeFileSync(path.join(CASES_DIR, name, "report.txt"), txt);
	return { txt, statLine };
}

/** 解析 stats 行 → manifest stats 对象。 */
function parseStats(statLine) {
	if (!statLine) return {};
	const m = statLine.match(
		/codeaudit [\d.]+ — (\d+) chunks, (\d+) files, unknown-rate ([\d.]+)%, cycles (\d+)(?:, parse-errors (\d+))?/,
	);
	if (!m) return {};
	return {
		chunks: Number(m[1]),
		files: Number(m[2]),
		unknownRate: Number(m[3]),
		cycles: Number(m[4]),
		parseErrors: m[5] ? Number(m[5]) : 0,
	};
}

function runCase(name, update) {
	const cfg = CASES[name];
	if (!cfg) {
		console.error(
			`未知用例: ${name}（可用: ${Object.keys(CASES).join(", ")}）`,
		);
		process.exit(2);
	}
	console.log(`\n=== ${name}（${cfg.lang}）===\n${cfg.note}`);
	fs.mkdirSync(path.join(CASES_DIR, name), { recursive: true });
	const dir = cloneCase(name, cfg, update);
	pruneFiles(dir, cfg.prune);

	const { statLine } = scanCase(dir, cfg, name);

	const ref =
		update || !fs.existsSync(manifestPath(name))
			? shOut("git rev-parse HEAD", dir)
			: JSON.parse(fs.readFileSync(manifestPath(name), "utf8")).ref;
	// manifest 全确定性（无 scannedAt/elapsedSec——时间戳会让 CI 漂移检测每次复现必失败）；
	// 版本信息由 ref 标识，统计由 stats 承载。
	const stats = parseStats(statLine);
	if (Object.keys(stats).length === 0 && statLine) {
		// reviewer Note：CLI 输出格式漂移时静默 {} 会污染 manifest——失败可见化
		console.warn(`  ⚠ stats 解析失败（CLI 输出格式漂移？）: ${statLine}`);
	}
	const manifest = {
		repo: cfg.repo,
		ref,
		lang: cfg.lang,
		scanDir: cfg.scanDir,
		prune: cfg.prune,
		stats,
	};
	fs.writeFileSync(
		manifestPath(name),
		JSON.stringify(manifest, null, 2) + "\n",
	);
	console.log(`  统计: ${statLine ?? "（无 stats 行）"}`);
	console.log(
		`  产物: ${path.join(CASES_DIR, name)}（${manifest.ref.slice(0, 12)}）`,
	);
}

// ---- main ----
const args = process.argv.slice(2);
const update = args.includes("--update");
const names = args.filter((a) => !a.startsWith("--"));
const targets = names.length > 0 ? names : Object.keys(CASES);

/** dist 新鲜度：dist/cli.js 的 mtime ≥ src/ 下最新 .ts 文件（reviewer Medium-2：拉新代码后
 *  直接跑 cases 会静默用旧引擎产出漂移快照——硬门禁而非仅警告）。 */
function distFresh() {
	const cli = fs.statSync(CLI).mtimeMs;
	const latest = (dir) => {
		let max = 0;
		for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, f.name);
			if (f.isDirectory()) max = Math.max(max, latest(p));
			else if (f.name.endsWith(".ts"))
				max = Math.max(max, fs.statSync(p).mtimeMs);
		}
		return max;
	};
	return cli >= latest(path.join(ROOT, "src"));
}

if (!fs.existsSync(CLI) || !distFresh()) {
	console.error("dist/cli.js 不存在或过期（src/ 更新于其后）——先 npm run build");
	process.exit(2);
}
try {
	for (const n of targets) runCase(n, update);
} finally {
	// 无论成功/崩溃都清理临时 clone（reviewer 注记：脚本失败时 TMP 残留）
	fs.rmSync(TMP_ROOT, { recursive: true, force: true });
}
console.log(
	"\n完成。产物快照已写入 examples/cases/<name>/；完整 JSON 如需本地生成：",
);
console.log("  node dist/cli.js scan <clone> --no-cache --json out.json");
