import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { proofCompleteness } from "../../src/core/proof";
import { validateEffectOverride, applyEffectOverrides } from "../../src/lang/effectOverride";
import { type LangPack } from "../../src/lang/pack";
import { pythonPack } from "../../src/lang/packs/python";
import { typescriptPack, tsxPack } from "../../src/lang/packs/typescript";
import { javascriptPack } from "../../src/lang/packs/javascript";
import { csharpPack } from "../../src/lang/packs/csharp";
import { Purity, UNKNOWN_TARGET, type Verdict } from "../../src/core/types";

/**
 * 第四轮范畴律对抗性审计：证明系统 / DSL / langpack 的极小性（minimality）
 * + 既有范畴律纪律在 DSL-merge 与证明系统上的延续。
 *
 * - law:minimality      DSL 危险键纪律闭环（frameworkPure 类型键/成员键、builtinTypeEffects
 *                       成员键——validate 与 merge 两级）；frameworkIo ":" 永不命中前缀拒绝；
 *                       csharp pureBuiltins 死条目（compileTimeOps 提取侧吸收 → 链接侧零咨询）；
 *                       js/tsx 包 spread 差集契约；四语言包非空表族全部有真实语料命中
 * - law:edge-case       budgetToTarget 可达性判定与曲线扫描的容差必须同量纲（1e-9 固定容差在
 *                       (1e-9, 1e-9·|U|] 残差窗内 reachable=true 但 budgetToTarget=null 的翻案）
 * - law:associativity   override 数组并集合并是交换幺半群（任意置换合并结果集合相等）
 * - law:functoriality   注入函子成员并集保持 base 语义（并集不丢内置条目；新增成员生效；
 *                       未列成员仍诚实 ?）
 */

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-ct4-"));
});
afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

function project(name: string, files: Record<string, string>): string {
	const root = join(dir, name);
	for (const [f, content] of Object.entries(files)) {
		const p = join(root, f);
		mkdirSync(join(p, ".."), { recursive: true });
		writeFileSync(p, content);
	}
	return root;
}

/** 最小 Verdict（proofCompleteness 派生视图输入，ct3 同款）。 */
function mkV(
	key: string,
	purity: number,
	calls: string[] = [],
): Verdict {
	return {
		chunk: {
			id: "id-" + key,
			key,
			name: key,
			file: "f.ts",
			line: 1,
			endLine: 2,
			nesting: 0,
			direct: new Set(),
			calls: new Set(calls),
			unknownSites: calls.includes(UNKNOWN_TARGET) ? 1 : 0,
			unknownCalls: [],
			thrownTypes: [],
			catches: [],
			stateWrites: [],
			stateReads: [],
		},
		purity,
		effects: new Set(),
		chain: purity === Purity.PURE ? Infinity : 0,
		chainDev: Infinity,
		chainCertain: true,
		chainPath: [],
		throwsTypes: [],
		stateDeps: [],
		provenance: "static",
	};
}

// ---------------------------------------------------------------------------
// law:minimality —— DSL 危险键纪律闭环（frameworkPure 类型键 / 成员键两级）
// ---------------------------------------------------------------------------
describe("law:minimality（DSL 危险键纪律——类型键/成员键两级）", () => {
	it("validateEffectOverride 拒绝 frameworkPure 类型键危险键（ns 级之外的第二级）", () => {
		const cases: Array<Record<string, unknown>> = [
			// 类型键级：round-2 只覆盖 ns 级——类型键 "__proto__" 此前直通
			{ frameworkPure: { NS: { ["__proto__"]: { polluted: "pure" } } } },
			{ frameworkPure: { NS: { ["constructor"]: { m: "hof" } } } },
			{ frameworkPure: { NS: { ["prototype"]: "pure" } } },
			// 成员键级（异质成员表）
			{ frameworkPure: { NS: { T: { ["__proto__"]: "pure" } } } },
			{ frameworkPure: { NS: { T: { ["constructor"]: "hof" } } } },
		];
		for (const tables of cases) {
			const errs = validateEffectOverride({ python: tables }, [pythonPack]);
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

	it("validateEffectOverride 拒绝 builtinTypeEffects 成员键危险键（方法名级）", () => {
		const errs = validateEffectOverride(
			{ python: { builtinTypeEffects: { str: { ["__proto__"]: "pure" } } } },
			[pythonPack],
		);
		expect(
			errs.some((e) => e.includes("__proto__")),
			errs.join("; "),
		).toBe(true);
	});

	it("applyEffectOverrides 直调 frameworkPure 类型键 __proto__ 不突变原型（纵深防御，类型键级）", () => {
		const merged = applyEffectOverrides(pythonPack, {
			frameworkPure: { NS: { ["__proto__"]: { polluted: "pure" } } },
		} as never);
		const ns = merged.frameworkPure?.NS as
			| Record<string, unknown>
			| undefined;
		expect(ns).toBeDefined();
		// 表对象原型不得被注入对象替换（修复前：getPrototypeOf(ns) === {polluted:"pure"}）
		expect(Object.getPrototypeOf(ns!)).toBe(Object.prototype);
		// 原型链不得泄漏进查表（无 own 键 + 直访无命中）
		expect(Object.keys(ns!)).toEqual([]);
		expect(ns!["polluted"]).toBeUndefined();
		expect(ns!["anyMissingKey"]).toBeUndefined();
	});

	it("validateEffectOverride 拒绝 frameworkIo 含 ':' 的永不命中前缀", () => {
		// frameworkIo 前缀匹配 call.attr === p || startsWith(p + ".")——标识符链不含 ':'，
		// "client:io" 形态永远不命中（用户误用 record-array 标签语法）→ 拒绝而非静默吞入死条目
		const errs = validateEffectOverride(
			{ python: { frameworkIo: { self: ["client:io"] } } },
			[pythonPack],
		);
		expect(errs.length, errs.join("; ")).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// law:edge-case —— budgetToTarget 可达性与曲线扫描的容差量纲一致
// ---------------------------------------------------------------------------
describe("law:edge-case（budgetToTarget 容差量纲）", () => {
	it("target 落在 θ 上方 (1e-9, 1e-9·|U|] 残差窗内：reachable=true 时 budgetToTarget 不得为 null", () => {
		const vs: Verdict[] = [];
		for (let i = 0; i < 99; i++) vs.push(mkV("w" + i, Purity.UNKNOWN, ["u0"]));
		vs.push(mkV("u0", Purity.UNKNOWN, [UNKNOWN_TARGET]));
		vs.push(mkV("stale", Purity.UNKNOWN, [])); // deps=0：永不释放，finalRem=1
		const total = vs.length; // 101
		const theta = proofCompleteness(vs).theta; // 1 - 1/101
		// δ ∈ (1e-9, 1e-9·total]：可达性谓词（θ+1e-9）成立，但固定 1e-9 容差的曲线扫描 miss
		const target = 1 - (1 - 5e-8) / total;
		expect(target <= theta + 1e-9).toBe(true); // 实现的可达性谓词
		const p = proofCompleteness(vs, { targetTheta: target });
		expect(p.budgetToTarget, "reachable=true 时 budgetToTarget 必须非 null").not.toBeNull();
		// 语义锚点：所有可释放源都标完（1 条）即达目标——剩余只有 stale 的 1/101
		expect(p.budgetToTarget).toBe(1);
		// 对照：θ 上方超出容差 → 不可达 → null（两向都要一致）
		const p2 = proofCompleteness(vs, { targetTheta: theta + 2e-9 });
		expect(p2.budgetToTarget).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// law:minimality —— langpack 死条目（compileTimeOps 提取侧吸收 → 链接侧零咨询）
// ---------------------------------------------------------------------------
describe("law:minimality（langpack 死条目）", () => {
	it("各注册包 pureBuiltins/impureBuiltins ∩ compileTimeOps = ∅（提取侧吸收 = 链接侧死条目）", () => {
		const packs = [pythonPack, typescriptPack, tsxPack, javascriptPack, csharpPack];
		for (const p of packs) {
			const ops = p.compileTimeOps ?? [];
			if (ops.length === 0) continue;
			const dead = [...p.pureBuiltins].filter((b) => ops.includes(b));
			expect(dead, `${p.name} pureBuiltins 被 compileTimeOps 吸收`).toEqual([]);
			const dead2 = Object.keys(p.impureBuiltins).filter((b) => ops.includes(b));
			expect(dead2, `${p.name} impureBuiltins 被 compileTimeOps 吸收`).toEqual([]);
		}
	});

	it("C# nameof 站点：compileTimeOps 全吸收 → 链接侧 pureBuiltins 零条目（死条目已删）", async () => {
		const root = project("nameof", {
			"T.cs": "public class T {\n    public string N() { return nameof(T); }\n}\n",
		});
		const r = await scanProject(root, { useCache: false });
		const row = (r.stats.effectTableUsage ?? []).find((u) => u.pack === "csharp");
		expect(row).toBeDefined();
		// 修复前：pureBuiltins 含 nameof（corpus-inactive，永不咨询）；修复后：空表零条目
		expect(row!.entries.filter((e) => e.table === "pureBuiltins")).toEqual([]);
		// 判定正确：nameof 站点判纯（编译期常量，无调用点）
		const v = r.verdicts.find((x) => x.chunk.name === "T.N");
		expect(v!.purity).toBe(Purity.PURE);
	});
});

// ---------------------------------------------------------------------------
// law:minimality —— js/tsx 包 spread 差集契约（极小性构造不变式）
// ---------------------------------------------------------------------------
describe("law:minimality（js/tsx 包 spread 差集契约）", () => {
	it("javascriptPack ≡ typescriptPack ⊕ {name,extensions,wasm,resolveModule}（其余字段同引用）", () => {
		const deltas = new Set(["name", "extensions", "wasm", "resolveModule"]);
		for (const key of Object.keys(typescriptPack)) {
			if (deltas.has(key)) continue;
			expect(
				(javascriptPack as unknown as Record<string, unknown>)[key],
				`javascript.${key} 必须与 typescript 同引用（无独立漂移面）`,
			).toBe((typescriptPack as unknown as Record<string, unknown>)[key]);
		}
		// 四个差异字段都有定义且语义正确（js 包不吞 ts 扩展名）
		expect(javascriptPack.name).toBe("javascript");
		expect(javascriptPack.wasm).toBe("tree-sitter-javascript.wasm");
		for (const ext of [".js", ".jsx", ".mjs", ".cjs"])
			expect(javascriptPack.extensions).toContain(ext);
		expect(javascriptPack.extensions).not.toContain(".ts");
	});

	it("tsxPack ≡ typescriptPack ⊕ {name,extensions,wasm}（resolveModule/extractImports 同引用）", () => {
		const deltas = new Set(["name", "extensions", "wasm"]);
		for (const key of Object.keys(typescriptPack)) {
			if (deltas.has(key)) continue;
			expect(
				(tsxPack as unknown as Record<string, unknown>)[key],
				`tsx.${key} 必须与 typescript 同引用`,
			).toBe((typescriptPack as unknown as Record<string, unknown>)[key]);
		}
		expect(tsxPack.resolveModule).toBe(typescriptPack.resolveModule);
		expect(tsxPack.extractImports).toBe(typescriptPack.extractImports);
		expect(tsxPack.name).toBe("tsx");
		expect(tsxPack.extensions).toEqual([".tsx"]);
	});
});

// ---------------------------------------------------------------------------
// law:associativity —— override 合并是交换幺半群（数组并集语义）
// ---------------------------------------------------------------------------
describe("law:associativity（override 合并幺半群）", () => {
	it("三个数组型 override 任意置换合并 → 并集相等（结合 + 交换）", () => {
		const A = {
			impureModules: { os: ["aa"], sys: ["bb"] },
			impureGlobals: { G: ["x"] },
		} as never;
		const B = { impureModules: { os: ["cc"] }, pureGlobals: ["GG"] } as never;
		const C = {
			impureModules: { sys: ["dd"], os: ["aa"] },
			frameworkIo: { self: ["zz"] },
		} as never;
		const perms: Array<Array<never>> = [
			[A, B, C],
			[A, C, B],
			[B, A, C],
			[B, C, A],
			[C, A, B],
			[C, B, A],
		];
		const snap = (p: LangPack): string =>
			[
				[...(p.impureModules.os as readonly string[])].sort().join(","),
				[...(p.impureModules.sys as readonly string[])].sort().join(","),
				[...(p.impureGlobals.G as readonly string[])].sort().join(","),
				[...p.pureGlobals].sort().join(","),
				[...(p.frameworkIo.self as readonly string[])].sort().join(","),
			].join("|");
		const sigs = perms.map((ps) =>
			snap(ps.reduce((p, o) => applyEffectOverrides(p, o), pythonPack)),
		);
		for (const s of sigs)
			expect(s, "并集合并必须与置换序无关").toBe(sigs[0]!);
		// 语义锚点：base 成员全部保留（并集不丢内置）
		expect(sigs[0]).toContain("system");
		expect(sigs[0]).toContain("path.join:p");
		expect(sigs[0]).toContain("aa");
		expect(sigs[0]).toContain("cc");
		expect(sigs[0]).toContain("dd");
	});
});

// ---------------------------------------------------------------------------
// law:functoriality —— 注入函子成员并集保持 base 语义
// ---------------------------------------------------------------------------
describe("law:functoriality（注入函子成员并集）", () => {
	it("merge 后 os 表保留全部 base 成员（表级）", () => {
		const merged = applyEffectOverrides(pythonPack, {
			impureModules: { os: ["mycustom:io"] },
		} as never);
		const os = merged.impureModules.os as readonly string[];
		expect(os).toContain("mycustom:io");
		expect(os).toContain("system");
		expect(os).toContain("path.join:p");
		expect(os).toContain("urandom:random");
		// 其它表不受波及（键级浅合并不动无关键）
		expect(merged.impureModules.sys).toBe("io");
	});

	it("扫描函子：新增成员生效 / base 成员语义保持 / 未列成员仍诚实 ?", async () => {
		const root = project("fx", {
			"t.py": [
				"import os",
				"",
				"def f():",
				"    os.mycustom()",
				"",
				"def g():",
				"    return os.path.join('a', 'b')",
				"",
				"def h():",
				"    os.nope_not_listed()",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, {
			useCache: false,
			effectOverrides: { python: { impureModules: { os: ["mycustom:io"] } } },
		});
		const byName = new Map(r.verdicts.map((v) => [v.chunk.name, v]));
		expect(byName.get("f")!.purity).toBe(Purity.IMPURE);
		expect([...byName.get("f")!.effects]).toContain("io");
		expect(byName.get("g")!.purity).toBe(Purity.PURE); // base 条目 path.join:p 存活
		expect(byName.get("h")!.purity).toBe(Purity.UNKNOWN); // 未列成员不因并集变纯
	});
});

// ---------------------------------------------------------------------------
// law:minimality —— 表族可达性（非空表族全部有真实语料命中）
// ---------------------------------------------------------------------------
describe("law:minimality（表族可达性）", () => {
	it("四语言包：非空表族全部有 hit 条目（fixture 触达全部链接侧族）", async () => {
		const root = project("reach", {
			"t.py": [
				"import os",
				"from math import sqrt",
				"def logit():",
				"    print('x')",
				"    return len('ab')",
				"def run():",
				"    os.system('ls')",
				"    return sqrt(4)",
				"",
			].join("\n"),
			"a.ts": [
				'import * as fs from "node:fs";',
				'import * as path from "node:path";',
				'export function logit(): string { console.log("x"); return JSON.stringify({a:1}); }',
				'export function run(): string { fs.readFileSync("x"); return path.join("a","b"); }',
				'export function net(): Promise<unknown> { return fetch("http://x"); }',
				'export function num(): number { return parseInt("1", 10); }',
				"",
			].join("\n"),
			"b.js": [
				'const fs = require("fs");',
				'const path = require("path");',
				'export function logit() { console.log("x"); return JSON.stringify({a:1}); }',
				'export function run() { fs.readFileSync("x"); return path.join("a","b"); }',
				'export function ev() { return eval("1+1"); }',
				'export function num() { return parseInt("1", 10); }',
				"",
			].join("\n"),
			"T.cs": [
				"using System;",
				"using UnityEngine;",
				"public class T : MonoBehaviour {",
				'    public void a() { Console.WriteLine("x"); }',
				'    public void b() { System.Uri.EscapeDataString("http://x"); }',
				"    public void c() { System.Math.Max(1, 2); }",
				'    public void d() { File.ReadAllText("x"); }',
				"    public void e() { Destroy(gameObject); }",
				"    public void f() { Math.Max(1, 2); }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const usage = new Map(
			(r.stats.effectTableUsage ?? []).map((u) => [u.pack, u]),
		);
		const packs: Record<string, LangPack> = {
			python: pythonPack,
			typescript: typescriptPack,
			javascript: javascriptPack,
			csharp: csharpPack,
		};
		// 每包 fixture 可触达的表族（未列入族必须为空/不存在，或显式声明不可触达）
		const EXPECTED: Record<string, readonly string[]> = {
			python: ["impureBuiltins", "pureBuiltins", "impureModules", "pureModules"],
			typescript: [
				"impureBuiltins",
				"pureBuiltins",
				"impureModules",
				"pureModules",
				"impureGlobals",
				"pureGlobals",
			],
			javascript: [
				"impureBuiltins",
				"pureBuiltins",
				"impureModules",
				"pureModules",
				"impureGlobals",
				"pureGlobals",
			],
			csharp: ["impureBuiltins", "impureGlobals", "pureGlobals", "frameworkPure"],
		};
		// using 别名通道：命名空间别名不产 module 咨询（探针实证）——fixture 不可触达，显式声明
		const DECLARED_UNREACHABLE = new Set(["csharp::pureModules"]);
		for (const [lang, pack] of Object.entries(packs)) {
			const row = usage.get(lang);
			expect(row, `${lang} effectTableUsage 行`).toBeDefined();
			const hits = new Set(
				row!.entries.filter((e) => e.status === "hit").map((e) => e.table),
			);
			for (const fam of EXPECTED[lang]!) {
				const tbl = (pack as unknown as Record<string, unknown>)[fam];
				const nonEmpty =
					tbl !== undefined &&
					tbl !== null &&
					((tbl as { size?: number }).size ??
						Object.keys(tbl as object).length) > 0;
				if (!nonEmpty) continue;
				expect(
					hits.has(fam),
					`${lang}.${fam} 非空表族必须有 hit（fixture 可达性）`,
				).toBe(true);
			}
			// 白名单诚实性：未列入族必须为空/不存在（否则表族覆盖契约不完整）
			for (const fam of [
				"impureBuiltins",
				"pureBuiltins",
				"impureModules",
				"pureModules",
				"impureGlobals",
				"pureGlobals",
				"frameworkPure",
			]) {
				if (EXPECTED[lang]!.includes(fam)) continue;
				if (DECLARED_UNREACHABLE.has(`${lang}::${fam}`)) continue;
				const tbl = (pack as unknown as Record<string, unknown>)[fam];
				const nonEmpty =
					tbl !== undefined &&
					tbl !== null &&
					((tbl as { size?: number }).size ??
						Object.keys(tbl as object).length) > 0;
				expect(
					nonEmpty,
					`${lang}.${fam} 未列入但非空——表族覆盖契约不完整`,
				).toBe(false);
			}
		}
	});
});
