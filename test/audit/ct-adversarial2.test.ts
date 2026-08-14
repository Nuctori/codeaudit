import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import {
	applyEffectOverrides,
	validateEffectOverride,
} from "../../src/lang/effectOverride";
import { classifyUsage } from "../../src/core/effectUsage";
import { graphMetrics, reverseDepCounts } from "../../src/core/topology";
import { dependencySkeleton, bridgesOf } from "../../src/core/skeleton";
import { changedImpact } from "../../src/core/influence";
import { moduleSummary } from "../../src/core/module";
import { outDepsOf, inDepsOf } from "../../src/core/filedeps";
import { renderTechdebtHtml } from "../../src/core/htmlreport";
import { forwardClosure, riskOfChange } from "../../src/core/risk";
import { stateCouplingOf } from "../../src/core/state";
import {
	mergeCorpus,
	emptyCorpus,
	updateCorpus,
} from "../../src/core/corpus";
import {
	Purity,
	UNKNOWN_TARGET,
	type Verdict,
	type Chunk,
} from "../../src/core/types";
import { pythonPack as pyPack, typescriptPack as tsPack } from "../../src/index";

/**
 * 第二轮范畴律对抗性审计（函数式范畴论视角）——第一轮（ct-adversarial.test.ts）未覆盖子系统：
 * scan/link 管线、effectOverride 注入、corpus 合并代数、classifyUsage、skeleton/bridges、
 * moduleSummary/filedeps 派生视图、changedImpact 证据路径、缓存文件写幂等、CLI 渲染层。
 *
 * - law:functoriality   scan∘cache == scan；link 全局命名空间下的组合性偏差；耦合图可分性
 * - law:associativity   mergeCorpus 结合律/交换律/幺元
 * - law:idempotence     缓存文件逐字节写幂等；override 不动点；带标注扫描重跑；classifyUsage 幂等
 * - law:determinism     派生视图输入乱序不变（skeleton/bridges/changedImpact/moduleSummary/filedeps）
 * - law:poset-monotonicity  效应表注入经 scan/link 函子保格；退化矩阵 D 格保序
 * - law:edge-case       幽灵 seed / 空目录扫描 / parseError 标注守卫
 * - 信任边界：效应表注入的 __proto__ 原型污染（validate 拒绝 + merge 纵深防御）
 */

// ---- 工具 ----

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-ct2-"));
});
afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** Set → 排序数组、Infinity 文本化的逐字节签名（determinism 断言用）。 */
const sig = (vs: readonly Verdict[]): string =>
	JSON.stringify(
		vs.map((v) => ({ ...v, chunk: { ...v.chunk } })),
		(_k, val) =>
			val instanceof Set ? [...val].sort() : val === Infinity ? "Infinity" : val,
	);

const statsSig = (s: Record<string, unknown>): string => {
	const { scannedAt: _s, ...rest } = s;
	return JSON.stringify(rest);
};

/** 最小 Verdict（risk.test.ts 同款构造——派生视图输入）。 */
function mkV(
	key: string,
	opts: {
		purity?: number;
		chain?: number;
		calls?: string[];
		file?: string;
		direct?: string[];
		stateWrites?: string[];
		stateDeps?: string[];
	} = {},
): Verdict {
	const purity = opts.purity ?? Purity.PURE;
	return {
		chunk: {
			id: key,
			key,
			name: key,
			file: opts.file ?? "f.ts",
			line: 1,
			endLine: 2,
			nesting: 0,
			direct: new Set(opts.direct ?? []),
			calls: new Set(opts.calls ?? []),
			unknownSites: 0,
			unknownCalls: [],
			thrownTypes: [],
			catches: [],
			stateWrites: opts.stateWrites ?? [],
			stateReads: [],
		},
		purity,
		effects: new Set(opts.direct ?? []),
		chain: opts.chain ?? (purity === Purity.PURE ? Infinity : 0),
		chainDev: opts.chain ?? Infinity,
		chainCertain: true,
		chainPath: [],
		throwsTypes: [],
		stateDeps: opts.stateDeps ?? [],
		provenance: "static",
	};
}

// ---------------------------------------------------------------------------
// law:functoriality —— scan∘cache == scan；link 组合性边界；耦合图可分性
// ---------------------------------------------------------------------------
describe("law:functoriality", () => {
	it("缓存函子：useCache:false 扫描 == useCache:true 热扫（判定逐字段一致）", async () => {
		const root = join(dir, "f1-cache-functor");
		mkdirSync(root, { recursive: true });
		writeFileSync(
			join(root, "a.py"),
			[
				"class Store:",
				"    v = 0",
				"    def write(self, x):",
				"        self.v = x",
				"        return x",
				"    def read(self):",
				"        return self.v",
				"def pure(x):",
				"    return x * 2",
				"def top(x):",
				"    s = Store()",
				"    s.write(x)",
				"    return s.read() + pure(x)",
			].join("\n"),
		);
		const cacheDir = join(root, ".codeaudit");
		const noCache = await scanProject(root, { useCache: false });
		const warm1 = await scanProject(root, { useCache: true, cacheDir }); // 首次：暖缓存
		const warm2 = await scanProject(root, { useCache: true, cacheDir }); // 热扫
		expect(sig(warm2.verdicts)).toBe(sig(noCache.verdicts));
		expect(sig(warm1.verdicts)).toBe(sig(noCache.verdicts));
		expect(warm2.stats.cachedFiles).toBe(noCache.stats.files);
	});

	it.fails("同名类跨文件并集破坏不相交并图组合性（文档化偏差：link.ts globalClasses 是全项目命名空间——"
		+ "analysis(A∪B) ≠ analysis(A)∘analysis(B)；修复需 link 作用域语义变更，暂不修）", async () => {
		// 两个不相交项目，各自文件内都有 class Svc.save→helper——组合性要求分开判定不受对方影响
		const dirA = join(dir, "f2-a");
		const dirB = join(dir, "f2-b");
		mkdirSync(dirA, { recursive: true });
		mkdirSync(dirB, { recursive: true });
		writeFileSync(
			join(dirA, "a.py"),
			[
				"class Svc:",
				"    def save(self):",
				"        return self.helper()",
				"    def helper(self):",
				"        return 1",
			].join("\n"),
		);
		writeFileSync(
			join(dirB, "b.py"),
			[
				"class Svc:",
				"    def save(self):",
				"        return self.helper()",
				"    def helper(self):",
				"        print('x')",
			].join("\n"),
		);
		const rA = await scanProject(dirA);
		const rB = await scanProject(dirB);
		const joint = await scanProject(dirA); // 同目录再扫一遍做对照
		void joint;
		// 合并扫描：把 b.py 复制进 dirA 再扫（link 全局类索引跨文件同名合并）
		writeFileSync(join(dirA, "b.py"), readFileSync(join(dirB, "b.py"), "utf8"));
		const rJoint = await scanProject(dirA);
		const saveA = rJoint.verdicts.find(
			(v) => v.chunk.file === "a.py" && v.chunk.name === "Svc.save",
		)!;
		const saveAAlone = rA.verdicts.find((v) => v.chunk.name === "Svc.save")!;
		expect(saveA.purity).toBe(saveAAlone.purity); // 函子律：并集不改变 a.py 内判定
	});

	it("stateCouplingOf 不相交并图可分性：coupling(A∪B) == coupling(A) ∪ coupling(B)", () => {
		const g1 = [
			mkV("W1", { stateWrites: ["a.x"] }),
			mkV("R1", { stateDeps: ["a.x"] }),
		];
		const g2 = [
			mkV("W2", { stateWrites: ["b.y"] }),
			mkV("R2", { stateDeps: ["b.y"] }),
		];
		const joint = stateCouplingOf([...g1, ...g2]);
		const separate = [...stateCouplingOf(g1), ...stateCouplingOf(g2)].sort(
			(a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
		);
		expect(JSON.stringify(joint)).toBe(JSON.stringify(separate));
		expect(joint.length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// law:associativity —— 语料合并代数
// ---------------------------------------------------------------------------
describe("law:associativity", () => {
	it("mergeCorpus 结合律/交换律/幺元（merge 是效应代数上的并运算）", () => {
		const mk = (
			name: string,
			attr: string,
			verdict: "PURE" | "IMPURE",
		): { corpus: ReturnType<typeof emptyCorpus>; chunk: Chunk } => {
			const chunk: Chunk = {
				id: `id-${name}`,
				key: `${name}.ts::id-${name}`,
				name,
				file: `${name}.ts`,
				line: 1,
				endLine: 2,
				nesting: 0,
				direct: new Set(),
				calls: new Set(["?"]),
				unknownSites: 1,
				unknownCalls: [{ attr, obj: null, root: "bare" }],
				thrownTypes: [],
				catches: [],
				stateWrites: [],
				stateReads: [],
			};
			const corpus = updateCorpus(
				emptyCorpus(),
				[chunk],
				new Map([[chunk.id, verdict]]),
			);
			return { corpus, chunk };
		};
		const a = mk("A", "fetch", "PURE");
		const b = mk("B", "send", "IMPURE");
		const c = mk("C", "fetch", "PURE");
		const left = mergeCorpus(mergeCorpus(a.corpus, b.corpus), c.corpus);
		const right = mergeCorpus(a.corpus, mergeCorpus(b.corpus, c.corpus));
		expect(left).toEqual(right); // 结合律（对象键序无关深等）
		// 交换律（计数求和 + seen 并集均交换）
		expect(mergeCorpus(a.corpus, b.corpus)).toEqual(
			mergeCorpus(b.corpus, a.corpus),
		);
		// 幺元：merge(x, ∅) == x
		expect(mergeCorpus(a.corpus, emptyCorpus())).toEqual(a.corpus);
		expect(mergeCorpus(emptyCorpus(), a.corpus)).toEqual(a.corpus);
	});
});

// ---------------------------------------------------------------------------
// law:idempotence —— 缓存写/override 不动点/带标注扫描/使用率计数
// ---------------------------------------------------------------------------
describe("law:idempotence", () => {
	it("cache.json 二次扫描逐字节一致（缓存写幂等：跑两遍 == 跑一遍）", async () => {
		const root = join(dir, "i1-cache-bytes");
		mkdirSync(root, { recursive: true });
		writeFileSync(
			join(root, "a.ts"),
			[
				"export function helper(x: number) { return x + 1; }",
				"export function entry(x: number) { console.log(x); return helper(x); }",
			].join("\n"),
		);
		writeFileSync(
			join(root, "b.py"),
			[
				"def top(x):",
				"    return x * 2",
			].join("\n"),
		);
		const cacheDir = join(root, ".codeaudit");
		await scanProject(root, { useCache: true, cacheDir });
		const bytes1 = readFileSync(join(cacheDir, "cache.json"), "utf8");
		const r2 = await scanProject(root, { useCache: true, cacheDir });
		const bytes2 = readFileSync(join(cacheDir, "cache.json"), "utf8");
		expect(r2.stats.cachedFiles).toBeGreaterThan(0);
		expect(bytes2).toBe(bytes1);
	});

	it("applyEffectOverrides 不动点：apply∘apply == apply（合并是幂等算子）", () => {
		const ov = {
			impureModules: { evilmod: "io", os: ["extra:fs"] },
			pureGlobals: { helper_util: true },
			builtinTypeEffects: { str: { extra: "pure" } },
			frameworkPure: { Linq: { Enumerable: "pure" } },
			pureCtor: ["MyBox"],
		} as never;
		const once = applyEffectOverrides(pyPack, ov);
		const twice = applyEffectOverrides(once, ov);
		expect(JSON.stringify(once.impureModules)).toBe(
			JSON.stringify(twice.impureModules),
		);
		expect(JSON.stringify([...once.pureGlobals].sort())).toBe(
			JSON.stringify([...twice.pureGlobals].sort()),
		);
		expect(JSON.stringify(once.builtinTypeEffects)).toBe(
			JSON.stringify(twice.builtinTypeEffects),
		);
		expect(JSON.stringify(once.frameworkPure)).toBe(
			JSON.stringify(twice.frameworkPure),
		);
		expect(JSON.stringify([...once.pureCtor!].sort())).toBe(
			JSON.stringify([...twice.pureCtor!].sort()),
		);
		// 且不动点与单次一致（不只是两遍相同）
		expect(once.impureModules["evilmod"]).toBe("io");
	});

	it("带标注扫描重跑幂等（verdicts + stats 除 scannedAt 逐字段一致）", async () => {
		const root = join(dir, "i3-ann-idem");
		mkdirSync(root, { recursive: true });
		writeFileSync(
			join(root, "a.py"),
			[
				"def f():",
				"    ghost_fn()",
				"def g():",
				"    return 1",
			].join("\n"),
		);
		const base = await scanProject(root);
		const f = base.verdicts.find((v) => v.chunk.name === "f")!;
		const g = base.verdicts.find((v) => v.chunk.name === "g")!;
		expect(f.purity).toBe(Purity.UNKNOWN);
		const ann = new Map<string, "PURE" | "IMPURE">([
			[f.chunk.id, "PURE"],
			[g.chunk.id, "IMPURE"],
		]);
		const r1 = await scanProject(root, { annotations: ann });
		const r2 = await scanProject(root, { annotations: ann });
		expect(sig(r1.verdicts)).toBe(sig(r2.verdicts));
		expect(statsSig(r1.stats as unknown as Record<string, unknown>)).toBe(
			statsSig(r2.stats as unknown as Record<string, unknown>),
		);
		// 标注确实生效（台账可验证）：f PURE+annotated；g IMPURE（impureApplied=1）
		const f1 = r1.verdicts.find((v) => v.chunk.key === f.chunk.key)!;
		expect(f1.purity).toBe(Purity.PURE);
		expect(f1.provenance).toBe("annotated");
		const g1 = r1.verdicts.find((v) => v.chunk.key === g.chunk.key)!;
		expect(g1.purity).toBe(Purity.IMPURE);
		expect(r1.stats.impureApplied).toBe(1);
		expect(r1.stats.provenance.annotated).toBe(1);
	});

	it("classifyUsage 幂等（同一 hit/miss 两次输出一致）+ 计数守恒（hits 汇总 == Σ条目）", () => {
		const hit = new Map<string, number>([
			["python\u0000module:os", 3],
			["python\u0000builtin:print", 2],
		]);
		const miss = new Map<string, number>([["python\u0000module:zzz", 5]]);
		const packs = new Map([[pyPack.name, pyPack]]);
		const u1 = classifyUsage(packs, hit, miss);
		const u2 = classifyUsage(packs, hit, miss);
		expect(JSON.stringify(u1)).toBe(JSON.stringify(u2));
		const e = u1.find((x) => x.pack === "python")!;
		const hitEntries = e.entries.filter((x) => x.status === "hit");
		expect(e.summary.hits).toBe(hitEntries.length); // hits = 命中条目数（文档口径）
		const hitsSum = hitEntries.reduce((s, x) => s + x.hits, 0);
		expect(hitsSum).toBe(5); // 站点计数守恒：3 + 2
		expect(e.summary.missSites).toBe(5);
		expect(e.missSlots.find((s) => s.slot === "module:zzz")?.miss).toBe(5); // 表外咨询未中 → 补表候选
		expect(e.entries.length).toBe(e.summary.entries);
	});
});

// ---------------------------------------------------------------------------
// law:determinism —— 派生视图输入乱序不变（第一轮只验了 analyze 本体）
// ---------------------------------------------------------------------------
describe("law:determinism", () => {
	it("graphMetrics / reverseDepCounts 输入乱序不变（含环图）", () => {
		const base = [
			mkV("cycA", { calls: ["cycB"] }),
			mkV("cycB", { calls: ["cycA", "io1"] }),
			mkV("io1", { direct: ["io"], purity: Purity.IMPURE }),
			mkV("top", { calls: ["cycA", "iso"] }),
			mkV("iso", { calls: ["iso"] }), // 自环
		];
		const shuffled = [base[4]!, base[1]!, base[3]!, base[0]!, base[2]!];
		expect(JSON.stringify(graphMetrics(base))).toBe(
			JSON.stringify(graphMetrics(shuffled)),
		);
		// Map 内容逐条目相同（键集一致——entries 顺序随输入序是 Map 表示层，不比序）
		expect(new Map(reverseDepCounts(base))).toEqual(
			new Map(reverseDepCounts(shuffled)),
		);
	});

	it("dependencySkeleton / bridgesOf 输入乱序不变（分量代表键与输出序必须规范）", () => {
		const base = [
			mkV("A", { calls: ["B"] }),
			mkV("B", { calls: ["A", "Y"] }),
			mkV("X", { calls: ["A"] }),
			mkV("Y"),
		];
		const shuffled = [base[1]!, base[3]!, base[0]!, base[2]!]; // B 先于 A：SCC 成员发现序翻转
		expect(JSON.stringify(dependencySkeleton(base))).toBe(
			JSON.stringify(dependencySkeleton(shuffled)),
		);
		expect(JSON.stringify(bridgesOf(base))).toBe(
			JSON.stringify(bridgesOf(shuffled)),
		);
	});

	it("changedImpact via/viaName 输入乱序不变（证据路径不能依赖 BFS 首现序）", () => {
		const base = [
			mkV("A1", { file: "a1.ts" }),
			mkV("A2", { file: "a2.ts" }),
			mkV("X", { calls: ["A1", "A2"], file: "x.ts" }),
		];
		const changed = new Set(["a1.ts", "a2.ts"]);
		const r1 = changedImpact(base, changed);
		const r2 = changedImpact([base[1]!, base[2]!, base[0]!], changed);
		expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
		// 语义锚点：X 的 via 必须是某个改动 chunk（首跳证据存在且有定义）
		const x = r1.affected.find((a) => a.key === "X")!;
		expect(x.via).toBeTruthy();
	});

	it("moduleSummary 输入乱序不变（等 chunk 数平手必须按模块名 tiebreak）", () => {
		const base = [
			mkV("a1", { file: "src/a/m1.ts" }),
			mkV("b1", { file: "src/b/m1.ts" }),
			mkV("c1", { file: "src/a/m2.ts" }),
			mkV("b2", { file: "src/b/m2.ts" }),
		]; // src/a 与 src/b 各 2 chunk——排序平手，只能靠插入序
		const shuffled = [base[1]!, base[2]!, base[0]!, base[3]!];
		expect(JSON.stringify(moduleSummary(base))).toBe(
			JSON.stringify(moduleSummary(shuffled)),
		);
	});

	it("outDepsOf / inDepsOf 输入乱序不变（等边数平手必须按文件 tiebreak）", () => {
		const base = [
			mkV("c1", { calls: ["p.ts::f1"], file: "m.ts" }),
			mkV("c2", { calls: ["q.ts::f1"], file: "m.ts" }),
		];
		const shuffled = [base[1]!, base[0]!];
		expect(JSON.stringify(outDepsOf(base, "m.ts"))).toBe(
			JSON.stringify(outDepsOf(shuffled, "m.ts")),
		);
		expect(JSON.stringify(inDepsOf(base, "m.ts"))).toBe(
			JSON.stringify(inDepsOf(shuffled, "m.ts")),
		);
	});

	it("renderTechdebtHtml 同输入两次逐字节一致（含 scannedAt 时）", () => {
		const vs = [
			mkV("a", { calls: ["b"] }),
			mkV("b", { direct: ["io"], purity: Purity.IMPURE }),
			mkV("u", { calls: ["?"], purity: Purity.UNKNOWN }),
		];
		const stats = { files: 2, cycles: 1, skippedFiles: 0, parseErrors: 0 };
		const opts = {
			title: "t",
			scannedAt: "2026-01-01T00:00:00",
			version: "0.0.0-test",
			cachedFiles: 3,
		};
		const h1 = renderTechdebtHtml(vs, stats, opts);
		const h2 = renderTechdebtHtml(vs, stats, opts);
		expect(h2).toBe(h1);
	});
});

// ---------------------------------------------------------------------------
// law:poset-monotonicity —— 效应表注入经函子保格；D 矩阵格保序
// ---------------------------------------------------------------------------
describe("law:poset-monotonicity", () => {
	it("效应表注入经 scan/link 函子 → purity/effects 格单调（注入只增效应不反向）", async () => {
		const root = join(dir, "m1-override-monotone");
		mkdirSync(root, { recursive: true });
		writeFileSync(
			join(root, "evil.py"),
			[
				"import evilmod",
				"def top():",
				"    return evilmod.fetch()",
				"def purefn():",
				"    return 42",
			].join("\n"),
		);
		const rBase = await scanProject(root);
		const rOv = await scanProject(root, {
			effectOverrides: {
				python: { impureModules: { evilmod: "io" } },
			},
		});
		const base = new Map(rBase.verdicts.map((v) => [v.chunk.key, v]));
		const ov = new Map(rOv.verdicts.map((v) => [v.chunk.key, v]));
		for (const [k, a] of base) {
			const b = ov.get(k)!;
			expect(b.purity, `purity 单调 key=${k}`).toBeGreaterThanOrEqual(a.purity);
			for (const e of a.effects) expect(b.effects.has(e)).toBe(true);
		}
		// 语义锚点：evilmod.fetch 从 UNKNOWN（表外诚实 ?）升至 IMPURE（注入 io）
		const topBase = [...base.values()].find((v) => v.chunk.name === "top")!;
		const topOv = [...ov.values()].find((v) => v.chunk.name === "top")!;
		expect(topBase.purity).toBe(Purity.UNKNOWN);
		expect(topOv.purity).toBe(Purity.IMPURE);
		expect(topOv.effects.has("io")).toBe(true);
		const pf = [...ov.values()].find((v) => v.chunk.name === "purefn")!;
		expect(pf.purity).toBe(Purity.PURE); // 无效应注入不得波及纯函数
	});

	it("退化矩阵 D 随旧纯度格单调（越纯的旧判定背叛风险越高；现状映射随新纯度单调）", () => {
		const now = [mkV("a", { purity: Purity.IMPURE, file: "a.ts" })];
		const oldOf = (p: number): Verdict[] => [
			mkV("a", { purity: p, file: "a.ts" }),
		];
		const dPure = riskOfChange(now, new Set(["a.ts"]), {
			oldVerdicts: oldOf(Purity.PURE),
		});
		const dUnknown = riskOfChange(now, new Set(["a.ts"]), {
			oldVerdicts: oldOf(Purity.UNKNOWN),
		});
		const dImpure = riskOfChange(now, new Set(["a.ts"]), {
			oldVerdicts: oldOf(Purity.IMPURE),
		});
		// D(PURE→IMPURE)=1.0 ≥ D(UNKNOWN→IMPURE)=0.5 ≥ D(IMPURE→IMPURE)=0
		expect(dPure.factors.purity).toBeGreaterThanOrEqual(
			dUnknown.factors.purity,
		);
		expect(dUnknown.factors.purity).toBeGreaterThanOrEqual(
			dImpure.factors.purity,
		);
		expect(dImpure.factors.purity).toBe(0);
		// 现状映射（无 old）：CURRENT_PURITY_RISK 随新纯度单调不减
		const now2 = [mkV("a", { purity: Purity.PURE, file: "a.ts" })];
		const now3 = [mkV("a", { purity: Purity.UNKNOWN, file: "a.ts" })];
		const rPure = riskOfChange(now2, new Set(["a.ts"]));
		const rUnknown = riskOfChange(now3, new Set(["a.ts"]));
		const rImpure = riskOfChange(now, new Set(["a.ts"]));
		expect(rUnknown.factors.purity).toBeGreaterThanOrEqual(rPure.factors.purity);
		expect(rImpure.factors.purity).toBeGreaterThanOrEqual(
			rUnknown.factors.purity,
		);
	});
});

// ---------------------------------------------------------------------------
// law:edge-case —— 幽灵 seed / 空目录扫描 / parseError 标注守卫
// ---------------------------------------------------------------------------
describe("law:edge-case", () => {
	it("forwardClosure 幽灵 seed 的像有定义（不在图内的 seed → {seed:0}；空 seed → ∅）", () => {
		const vs = [
			mkV("a", { calls: ["b"] }),
			mkV("b", { calls: [UNKNOWN_TARGET] }),
		];
		const ghost = forwardClosure(vs, new Set(["ghost"]));
		expect([...ghost.entries()]).toEqual([["ghost", 0]]);
		expect([...forwardClosure(vs, new Set()).entries()]).toEqual([]);
		// 悬垂边（?）不扩展
		const f = forwardClosure(vs, new Set(["a"]));
		expect(f.get("a")).toBe(0);
		expect(f.has("b")).toBe(true);
		expect(f.size).toBe(2); // ? 不是 chunk key，不产生新条目
	});

	it("空目录扫描像有定义（verdicts=[] / stats 零值 / 缓存文件合法 / 重跑一致）", async () => {
		const root = join(dir, "e2-empty-scan");
		mkdirSync(root, { recursive: true });
		const cacheDir = join(root, ".codeaudit");
		const r1 = await scanProject(root, { useCache: true, cacheDir });
		expect(r1.verdicts).toEqual([]);
		expect(r1.stats.files).toBe(0);
		expect(r1.stats.chunks).toBe(0);
		expect(r1.stats.cachedFiles).toBe(0);
		expect(r1.stats.unknownRate).toBe(0);
		const cacheBytes = readFileSync(join(cacheDir, "cache.json"), "utf8");
		expect(JSON.parse(cacheBytes).files).toEqual({});
		const r2 = await scanProject(root, { useCache: true, cacheDir });
		expect(sig(r2.verdicts)).toBe(sig(r1.verdicts));
	});

	it("parseError chunk 的 PURE 标注被拒（H1 守卫：内容不可信，标注不可撤销降级）", async () => {
		const root = join(dir, "e3-parseerr-ann");
		mkdirSync(root, { recursive: true });
		writeFileSync(
			join(root, "broken.ts"),
			["export function broken( {", "  return 1;", "}", ""].join("\n"),
		);
		const base = await scanProject(root);
		expect(base.stats.parseErrors).toBeGreaterThan(0);
		const brokenChunks = base.verdicts.filter(
			(v) => v.chunk.file === "broken.ts" && v.chunk.parseError,
		);
		expect(brokenChunks.length).toBeGreaterThan(0);
		// 用扫描出的 id 标注 PURE——H1 守卫必须拒绝（不撤销降级）
		const ann = new Map(
			brokenChunks.map((v) => [v.chunk.id, "PURE" as const]),
		);
		const r2 = await scanProject(root, { annotations: ann });
		for (const v of brokenChunks) {
			const v2 = r2.verdicts.find((x) => x.chunk.key === v.chunk.key)!;
			expect(v2.chunk.parseError).toBe(true);
			expect(v2.purity).not.toBe(Purity.PURE); // 标注不生效：仍是 UNKNOWN
			expect(v2.provenance).toBe("static");
		}
		expect(r2.stats.annotationRejected.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// 信任边界：效应表注入的 __proto__ 原型污染（validate 承诺"JSON 输入必须验"）
// ---------------------------------------------------------------------------
describe("security:effectOverride __proto__ 注入", () => {
	it("validateEffectOverride 拒绝 __proto__/constructor/prototype 键（全部表形态）", () => {
		const cases: Array<Record<string, unknown>> = [
			{ builtinTypeEffects: { ["__proto__"]: { m: "pure" } } },
			{ frameworkPure: { ["__proto__"]: { T: "pure" } } },
			{ impureModules: { ["__proto__"]: "io" } },
			{ impureGlobals: { ["constructor"]: "io" } },
			{ pureBuiltins: { ["prototype"]: true } },
			{ impureBuiltins: { ["__proto__"]: "io" } },
		];
		for (const tables of cases) {
			const errs = validateEffectOverride({ python: tables }, [pyPack]);
			expect(
				errs.some(
					(e) =>
						e.includes("__proto__") ||
						e.includes("constructor") ||
						e.includes("prototype"),
				),
				JSON.stringify(tables) + " → " + errs.join("; "),
			).toBe(true);
		}
	});

	it("applyEffectOverrides 直调不污染 builtinTypeEffects/frameworkPure 原型（纵深防御）", () => {
		const merged = applyEffectOverrides(pyPack, {
			builtinTypeEffects: { ["__proto__"]: { m: "pure" } },
			frameworkPure: { ["__proto__"]: { Evil: "pure" } },
		} as never);
		// 无关类型查不到注入成员（原型链不得泄漏进查表）
		expect(merged.builtinTypeEffects["no_such_type_xyz"]).toBeUndefined();
		expect(
			Object.getPrototypeOf(merged.builtinTypeEffects),
		).not.toHaveProperty("m");
		expect(merged.frameworkPure?.["no_such_ns"]).toBeUndefined();
		expect(
			Object.getPrototypeOf(merged.frameworkPure ?? {}),
		).not.toHaveProperty("Evil");
		// 注入键自身不得成为查询命中（表语义：无此键——own 键不存在，__proto__ 读取的是原型对象）
		expect(Object.hasOwn(merged.builtinTypeEffects, "__proto__")).toBe(false);
		expect(Object.hasOwn(merged.frameworkPure ?? {}, "__proto__")).toBe(false);
	});
});
