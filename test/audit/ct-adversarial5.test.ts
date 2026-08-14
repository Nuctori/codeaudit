import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { proofCompleteness } from "../../src/core/proof";
import { annotationBudget, annotationCompare } from "../../src/core/influence";
import { csharpPack } from "../../src/lang/packs/csharp";
import { initParser, loadLanguage } from "../../src/loader";
import {
	Purity,
	UNKNOWN_TARGET,
	type Verdict,
	type Chunk,
} from "../../src/core/types";

/**
 * 第五轮范畴律对抗性审计：证明系统 / DSL / langpack 极小性（第二层——第四轮未触及）。
 *
 * - law:minimality      extractor 规则吞噬：propertyReadSkipMorphs 的 parent 形态检查把「赋值 RHS
 *                       成员读」也吞掉（`r = this.Status` / `r = o.secret`——C# 项目 getter 假纯 S1、
 *                       TS/JS 动态属性读漏报）；catchDeclNodes 机制全语言无生产者（C# 类型化 catch
 *                       坍缩 "*" → throwsTypes 过度减法，方向不安全）；compileTimeOps 死条目
 *                       （typeof/default 非 invocation_expression 形态——门不可达）；memberNameNodes
 *                       漏 JS field_definition（JS 类字段读 UNKNOWN vs TS PURE 同族不一致）
 * - law:minimality      表项可达性实证：python/TS/JS 代表表项逐条 fixture 命中（效应类 + 表族 hit 可见）
 * - law:edge-case       公理3 chainCertain 语义逐字核对（区间非零 ⟹ 不确信；区间零 + 未知可达 ⟹ 确信——
 *                       判定不依赖未知时不得误报不确信）
 * - law:idempotence     Θ 与曲线口径（θ = 1 − curve[last]/total；budgetToTarget = 曲线逆，单调）
 * - law:functoriality   公理4 内容寻址（同文本跨文件同 id 异 key；module id = module@file）
 * - law:poset-monotonicity 不变量机检（效应单调 + 链三角）+ 公理5 报告排序
 * - law:determinism     标注序平手 tiebreak（影响面/释放数全等 → key 字典序，与输入序无关）
 */

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-ct5-"));
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

function byName(r: {
	verdicts: { chunk: { name: string }; purity: number }[];
}): Map<string, (typeof r.verdicts)[number]> {
	return new Map(r.verdicts.map((v) => [v.chunk.name, v]));
}

/** 最小 Verdict（proofCompleteness/annotationBudget 派生视图输入，ct3/ct4 同款）。 */
function mkV(key: string, purity: number, calls: string[] = []): Verdict {
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
// law:minimality —— extractor 规则吞噬（规则被更早的 parent 形态检查吞掉 / 机制无生产者 / 门不可达）
// ---------------------------------------------------------------------------
describe("law:minimality（extractor 规则吞噬——赋值 RHS 属性读）", () => {
	it("TS/JS 赋值 RHS 成员读不被形态排除吞掉（r = o.secret 判 ? 与 return o.secret 同判——动态属性读诚实）", async () => {
		const root = project("js-rhs", {
			"a.js": [
				"export function f(o) {",
				"  let r;",
				"  r = o.secret;",
				"  return r;",
				"}",
				"export function g(o) { return o.secret; }",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		// 修复前：f PURE（parent=assignment_expression ∈ propertyReadSkipMorphs 整类吞掉 RHS——
		// 与同文件 g（parent=return_statement）UNKNOWN 不一致，且动态属性读可执行 getter → S1 方向）。
		expect(by.get("f")!.purity, "r = o.secret 必须是运行时读（miss 落 ?）").toBe(
			Purity.UNKNOWN,
		);
		expect(by.get("g")!.purity).toBe(Purity.UNKNOWN); // 控制组：return o.secret
	});

	it("C# 赋值 RHS 项目 getter 读建边（r = this.Status → getter io 传播——S1 假纯洞）", async () => {
		const root = project("cs-rhs", {
			"T.cs": [
				"public class T {",
				'    public string Status { get { System.Console.WriteLine("x"); return "a"; } }',
				"    public string f() { string r; r = this.Status; return r; }",
				"    public string g() { return this.Status; }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		// 修复前：T.f PURE（赋值 RHS 被吞）而 T.g IMPURE——同一 getter 读两种判定，且 f 是假纯。
		expect(by.get("T.f")!.purity, "getter 读必须传播 io").toBe(Purity.IMPURE);
		expect([...by.get("T.f")!.effects]).toContain("io");
		expect(by.get("T.g")!.purity).toBe(Purity.IMPURE); // 控制组
	});
});

describe("law:minimality（死机制 / 死条目）", () => {
	it("C# 类型化 catch 精确类型——catchDeclNodes 机制必须有生产者（catch (IOException e) 不得坍缩 *）", async () => {
		const root = project("cs-catch", {
			"U.cs": [
				"public class U {",
				"    public void Safe() { try { G(); } catch (System.IO.IOException e) { } }",
				"    public void G() { throw new System.InvalidOperationException(); }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		const safe = by.get("U.Safe")!;
		const g = by.get("U.G")!;
		// 机制层：typed catch 的捕获类型必须是声明的类型（不是 "*"）
		expect(safe.chunk.catches, "catch (IOException e) → [IOException]").toEqual([
			"IOException",
		]);
		// 语义层：G 抛出的（"*"——throw-new 形态未剥壳，保守）未被 IOException 覆盖 → 必须保留。
		// 修复前：catches=["*"] → coveredBy 全吞 → Safe.throwsTypes=[]（方向不安全过度减法——
		// "只减明确覆盖" 公理破坏：IOException 捕获被当 catch-all）。
		expect(safe.throwsTypes, "未覆盖异常必须保留（保守）").toEqual(["*"]);
		expect(g.throwsTypes).toEqual(["*"]);
	});

	it("compileTimeOps 每条目必须在其门（invocation_expression + identifier fn）可达——typeof/default 死条目", async () => {
		// 门的形态契约（extractor visit）：node.type === "invocation_expression" ∧ fn 是 identifier ∧
		// fn.text ∈ compileTimeOps。typeof(T) 是 type_of_expression、default(T) 是 default_expression
		// （探针实证）——门对它们不可达 → 死条目（实参抑制已由 propertyReadSkipParents 承接）。
		const ParserCtor = await initParser();
		const lang = await loadLanguage(csharpPack);
		const parser = new ParserCtor();
		parser.setLanguage(lang);
		for (const op of csharpPack.compileTimeOps ?? []) {
			const tree = parser.parse(
				`class T { void M() { var x = ${op}(T); } }`,
			);
			let reachable = false;
			const walk = (n: { type: string; children: unknown[]; childForFieldName(f: string): unknown }): void => {
				if (n.type === "invocation_expression") {
					const fn = (n.childForFieldName("function") ?? n.children[0]) as
						| { type: string; text: string }
						| undefined;
					if (fn && fn.type === "identifier" && fn.text === op)
						reachable = true;
				}
				for (const c of n.children) walk(c as never);
			};
			walk(tree.rootNode as never);
			expect(
				reachable,
				`compileTimeOps 条目 "${op}" 必须以 invocation_expression 形态到达门（否则死条目）`,
			).toBe(true);
		}
		// 语义锚点：三种编译期操作都不把类型实参泄漏为裸名调用
		const root = project("cs-cop", {
			"C.cs": [
				"public class C {",
				'    public string A() { return nameof(C); }',
				'    public string B() { return typeof(C).ToString(); }',
				"    public C D() { return default(C); }",
				"}",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		for (const n of ["C.A", "C.B", "C.D"]) {
			expect(by.get(n)!.purity, n).toBe(Purity.PURE);
			expect((by.get(n) as { chunk: { unknownSites: number } }).chunk.unknownSites).toBe(0);
		}
	});

	it("JS 类字段读判纯与 TS 同族（field_definition ∈ memberNameNodes——static x 读 C.x 判纯）", async () => {
		const root = project("js-fields", {
			"c.js": [
				"export class C { static x = 1; }",
				"export function jsh() { return C.x; }",
				"",
			].join("\n"),
			"d.ts": [
				"export class D { static x = 1; }",
				"export function tsh(): number { return D.x; }",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		// 修复前：JS field_definition 未提取 → memberNameExists 恒 false → jsh UNKNOWN；
		// TS public_field_definition 已提取 → tsh PURE——同一语言族字段读判定分叉。
		expect(by.get("jsh")!.purity, "JS 类字段读（无 getter 声明）判纯").toBe(
			Purity.PURE,
		);
		expect(by.get("tsh")!.purity).toBe(Purity.PURE);
		// 语义锚点：JS 实例字段 + this 读同样纯（selfPropReadIsPure 通道在）
		const root2 = project("js-fields2", {
			"e.js": [
				"export class E { y = 1; read() { return this.y; } }",
				"",
			].join("\n"),
		});
		const r2 = await scanProject(root2, { useCache: false });
		expect(byName(r2).get("E.read")!.purity).toBe(Purity.PURE);
	});
});

// ---------------------------------------------------------------------------
// law:minimality —— 表项可达性实证（代表性条目逐条 fixture 命中）
// ---------------------------------------------------------------------------
describe("law:minimality（表项可达性实证——python）", () => {
	it("python 代表表项 fixture 可达（os:io/fs、time:clock、random、json:p、math:pure、datetime:clock、open/print/len）", async () => {
		const root = project("py-tbl", {
			"t.py": [
				"import os",
				"from math import sqrt",
				"from json import dumps",
				"from time import sleep",
				"from random import random",
				"import datetime",
				"def a():",
				"    os.system('ls')",
				"def b():",
				"    return os.getcwd()",
				"def c():",
				"    sleep(0.1)",
				"def d():",
				"    return random()",
				"def e():",
				"    return dumps({'a': 1})",
				"def f():",
				"    return sqrt(4)",
				"def g():",
				"    return datetime.datetime.now()",
				"def h():",
				"    return open('/tmp/x')",
				"def i():",
				"    print('x')",
				"def j():",
				"    return len('ab')",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		const expectEff = (n: string, eff: string | null) => {
			const v = by.get(n)!;
			if (eff === null) {
				expect(v.purity, n).toBe(Purity.PURE);
			} else {
				expect(v.purity, n).toBe(Purity.IMPURE);
				expect([...v.effects], n).toContain(eff);
			}
		};
		expectEff("a", "io"); // os.system
		expectEff("b", "fs"); // os.getcwd:fs
		expectEff("c", "clock"); // time.sleep:clock
		expectEff("d", "random"); // random
		expectEff("e", null); // json.dumps:p
		expectEff("f", null); // math（pureModules）
		expectEff("g", "clock"); // datetime.datetime.now:clock
		expectEff("h", "fs"); // open（impureBuiltins）
		expectEff("i", "io"); // print
		expectEff("j", null); // len（pureBuiltins）
		// 表族 hit 可见性（第四轮修复的 Set 枚举盲区）：pureModules 命中必须出现在 effectTableUsage
		const usage = r.stats.effectTableUsage?.find((u) => u.pack === "python");
		expect(usage).toBeDefined();
		const math = usage!.entries.find(
			(e) => e.table === "pureModules" && e.key === "math",
		);
		expect(math, "pureModules math 必须可见且 hit").toBeDefined();
		expect(math!.status).toBe("hit");
		const os = usage!.entries.find(
			(e) => e.table === "impureModules" && e.key === "os",
		);
		expect(os!.status).toBe("hit");
	});
});

describe("law:minimality（表项可达性实证——TS/JS）", () => {
	it("TS 代表表项 fixture 可达（fetch:net、console:io、process:io、Math.random:random、Date.now:clock、JSON/path:pure、fs:fs、eval:io、parseInt:pure、setTimeout:io）", async () => {
		const root = project("ts-tbl", {
			"t.ts": [
				'import * as fs from "node:fs";',
				'import * as path from "node:path";',
				'export function a(): Promise<unknown> { return fetch("http://x"); }',
				'export function b(): void { console.log("x"); }',
				"export function c(): string | undefined { return process.env.HOME; }",
				"export function d(): number { return Math.random(); }",
				"export function e(): number { return Date.now(); }",
				'export function f(): string { return JSON.stringify({a: 1}); }',
				'export function g(): string { return path.join("a", "b"); }',
				'export function h(): void { fs.readFileSync("x"); }',
				'export function i(): number { return eval("1+1"); }',
				'export function j(): number { return parseInt("1", 10); }',
				"export function k(): void { setTimeout(() => {}, 1); }",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		const expectEff = (n: string, eff: string | null) => {
			const v = by.get(n)!;
			if (eff === null) {
				expect(v.purity, n).toBe(Purity.PURE);
			} else {
				expect(v.purity, n).toBe(Purity.IMPURE);
				expect([...v.effects], n).toContain(eff);
			}
		};
		expectEff("a", "net");
		expectEff("b", "io");
		expectEff("c", "io"); // process（prop 读形态）
		expectEff("d", "random");
		expectEff("e", "clock");
		expectEff("f", null); // JSON（pureGlobals）
		expectEff("g", null); // path（pureModules）
		expectEff("h", "fs");
		expectEff("i", "io"); // eval
		expectEff("j", null); // parseInt
		expectEff("k", "io"); // setTimeout
	});

	it("JS 共享表族同判（Math.random:random、console:io、process:io、eval:io、parseInt:pure、require('fs'):fs、URL:pure）", async () => {
		const root = project("js-tbl", {
			"b.js": [
				'const fs = require("fs");',
				"export function d() { return Math.random(); }",
				'export function b() { console.log("x"); }',
				"export function c() { return process.env.HOME; }",
				'export function i() { return eval("1+1"); }',
				'export function j() { return parseInt("1", 10); }',
				'export function h() { fs.readFileSync("x"); }',
				'export function u() { return new URL("http://x"); }',
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		expect(by.get("d")!.purity).toBe(Purity.IMPURE);
		expect([...by.get("d")!.effects]).toContain("random");
		expect(by.get("b")!.purity).toBe(Purity.IMPURE);
		expect(by.get("c")!.purity).toBe(Purity.IMPURE);
		expect([...by.get("c")!.effects]).toContain("io");
		expect(by.get("i")!.purity).toBe(Purity.IMPURE);
		expect(by.get("j")!.purity).toBe(Purity.PURE);
		expect(by.get("h")!.purity).toBe(Purity.IMPURE);
		expect([...by.get("h")!.effects]).toContain("fs");
		// URL ∈ pureGlobals（obj 形态 URL.x）；裸构造 new URL() 无 pureCtor（TS/JS trustedCtor=false）→ ? 诚实
		expect(by.get("u")!.purity).toBe(Purity.UNKNOWN);
	});
});

// ---------------------------------------------------------------------------
// 公理 ↔ 实现逐条核对（axioms.md ↔ analyze.ts/proof.ts）
// ---------------------------------------------------------------------------
describe("law:edge-case（公理3 chainCertain 语义逐字核对）", () => {
	it("区间非零 ⟹ chainCertain=false；区间零 + 未知可达 ⟹ certain（判定不依赖未知）", async () => {
		const root = project("axiom3", {
			"t.js": [
				"export function pureFn() { return 1; }",
				"export function unkFn() { return missingGlobal(); }",
				'export function mixedFn() { console.log("x"); return unkFn(); }',
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const by = byName(r);
		const pureFn = by.get("pureFn")!;
		const unkFn = by.get("unkFn")!;
		const mixedFn = by.get("mixedFn")!;
		expect(pureFn.purity).toBe(Purity.PURE);
		expect(pureFn.chainCertain).toBe(true);
		// 未知是唯一可达源：audit 链 0（? 构成效应源）vs dev 链 ∞ → 区间非零 → 不确信
		expect(unkFn.purity).toBe(Purity.UNKNOWN);
		expect(unkFn.chainCertain).toBe(false);
		expect(unkFn.chain).toBe(0);
		expect(unkFn.chainDev).toBe(Infinity);
		// 区间零 + 未知可达：判定（IMPURE/io）不依赖未知 → 确信（axioms.md「反向不成立」——
		// 不得把「有未知可达」误报为「判定不确定」）
		expect(mixedFn.purity).toBe(Purity.IMPURE);
		expect([...mixedFn.effects]).toContain("io");
		expect(mixedFn.chainCertain, "判定不依赖未知时不得误报不确信").toBe(true);
	});
});

describe("law:idempotence（Θ 与曲线口径——axioms.md 四·七 挂曲线精确值）", () => {
	it("theta = 1 − curve[last]/total；curve[0] = total；budgetToTarget 是曲线逆且单调", () => {
		const vs: Verdict[] = [];
		for (let i = 0; i < 3; i++) vs.push(mkV("w" + i, Purity.UNKNOWN, ["u0", "u1"]));
		vs.push(mkV("u0", Purity.UNKNOWN, [UNKNOWN_TARGET]));
		vs.push(mkV("u1", Purity.UNKNOWN, [UNKNOWN_TARGET]));
		vs.push(mkV("stale", Purity.UNKNOWN, [])); // deps=0：永不释放，finalRem=1
		const total = vs.length; // 6
		const p = proofCompleteness(vs);
		expect(p.curve[0]).toBe(total); // 初值 = 全量 UNKNOWN 计数
		expect(p.theta).toBeCloseTo(1 - p.curve[p.curve.length - 1]! / total, 12);
		// 曲线逆：target → 最小 k 使 curve[k] ≤ total·(1−target)（含容差）
		const inv = (t: number): number | null => {
			const limit = total * (1 - t);
			const tol = 1e-9 * total;
			for (let k = 0; k < p.curve.length; k++)
				if (p.curve[k]! <= limit + tol) return k;
			return null;
		};
		expect(
			proofCompleteness(vs, { targetTheta: p.theta }).budgetToTarget,
		).toBe(inv(p.theta));
		// 幂等/单调：target 升序 → 预算不减（曲线逆的格单调性）
		let prev = -1;
		for (const t of [0.2, 0.5, p.theta - 1e-6, p.theta, p.theta + 1e-6, 1]) {
			const b = proofCompleteness(vs, { targetTheta: t }).budgetToTarget;
			const k = b === null ? Infinity : b;
			expect(k).toBeGreaterThanOrEqual(prev);
			prev = k;
		}
		// 锚点：全部可释放源（u0,u1 两条）标完即达 θ；stale 不可释放 → 目标=1 不可达
		expect(
			proofCompleteness(vs, { targetTheta: p.theta }).budgetToTarget,
		).toBe(2);
		expect(proofCompleteness(vs, { targetTheta: 1 }).budgetToTarget).toBeNull();
	});
});

describe("law:functoriality（公理4 内容寻址）", () => {
	it("同文本跨文件同 id 异 key；module 伪 chunk id = module@file", async () => {
		const root = project("axiom4", {
			"x.ts": "export function same() { return 1; }\n",
			"y.ts": "export function same() { return 1; }\n",
		});
		const r = await scanProject(root, { useCache: false });
		const xs = r.verdicts.filter((v) => v.chunk.file === "x.ts");
		const ys = r.verdicts.filter((v) => v.chunk.file === "y.ts");
		const xSame = xs.find((v) => v.chunk.name === "same")!;
		const ySame = ys.find((v) => v.chunk.name === "same")!;
		expect(xSame.chunk.id).toBe(ySame.chunk.id); // 内容身份
		expect(xSame.chunk.key).not.toBe(ySame.chunk.key); // 图键文件限定
		expect(xSame.chunk.key.startsWith("x.ts::")).toBe(true);
		// 公理4 模块例外（证据层正当性）：module 伪 chunk 的 id 是文件限定，防跨文件标注泄漏
		const xm = xs.find((v) => v.chunk.name === "<module>")!;
		expect(xm.chunk.id).toBe("module@x.ts");
	});
});

describe("law:poset-monotonicity（不变量机检 + 公理5 报告排序）", () => {
	it("含环 + 未知 + 不纯图：invariantViolations = 0（效应单调 + 链三角）且报告满足排序契约", async () => {
		const root = project("inv", {
			"t.js": [
				"export function a() { return b(); }",
				"export function b() { return a() + c(); }",
				"export function c() { return missing(); }",
				'export function d() { console.log("x"); }',
				"export function e() { return d() + c(); }",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(r.stats.invariantViolations).toBe(0);
		// 公理5：purity 降序 → chain 降序（∞ 在前）→ nesting 降序 → key 升序
		const cmp = (x: number, y: number): number =>
			y === Infinity ? (x === Infinity ? 0 : 1) : x === Infinity ? -1 : y - x;
		const order = r.verdicts;
		for (let i = 1; i < order.length; i++) {
			const x = order[i - 1]!;
			const y = order[i]!;
			if (x.purity !== y.purity) {
				expect(x.purity).toBeGreaterThan(y.purity);
				continue;
			}
			const cx = cmp(x.chain, y.chain);
			if (cx !== 0) {
				expect(cx).toBeLessThan(0);
				continue;
			}
			if (x.chunk.nesting !== y.chunk.nesting) {
				expect(x.chunk.nesting).toBeGreaterThan(y.chunk.nesting);
				continue;
			}
			expect(x.chunk.key < y.chunk.key).toBe(true);
		}
		// 语义锚点：环内 a/b UNKNOWN（c 的未知经环传导）、d IMPURE、e IMPURE
		const by = byName(r);
		expect(by.get("a")!.purity).toBe(Purity.UNKNOWN);
		expect(by.get("b")!.purity).toBe(Purity.UNKNOWN);
		expect(by.get("d")!.purity).toBe(Purity.IMPURE);
		expect(by.get("e")!.purity).toBe(Purity.IMPURE);
	});
});

// ---------------------------------------------------------------------------
// law:determinism —— 标注序平手 tiebreak（公理5）
// ---------------------------------------------------------------------------
describe("law:determinism（标注序平手 tiebreak）", () => {
	it("影响面/释放数全等的两个源 → key 字典序，且与输入序无关", () => {
		const mk = (order: string[]): readonly string[] => {
			const vs: Verdict[] = [];
			const byK = new Map<string, Verdict>();
			for (const k of order) {
				const v =
					k === "w0"
						? mkV(k, Purity.UNKNOWN, ["s1", "s2"])
						: mkV(k, Purity.UNKNOWN, [UNKNOWN_TARGET]);
				vs.push(v);
				byK.set(k, v);
			}
			const budget = annotationBudget(vs.map((v) => v.chunk));
			const unknown = new Set(vs.map((v) => v.chunk.key));
			return [...unknown].sort(annotationCompare(budget, unknown));
		};
		// s1/s2 影响面与释放数全等（都释放 {自身, w0}）→ 平手 → key 升序
		const o1 = mk(["s1", "s2", "w0"]);
		const o2 = mk(["w0", "s2", "s1"]); // 输入序翻转
		expect(o1[0]).toBe("s1");
		expect(o1[1]).toBe("s2");
		expect(o1).toEqual(o2); // 与输入序无关
		// 非平手：影响面更大的源在前（w0 释放数 2 > s1 的 1 —— 全等时才看 key）
		const budget = annotationBudget(
			["s1", "s2", "w0"].map((k) =>
				k === "w0"
					? (mkV(k, Purity.UNKNOWN, ["s1", "s2"]).chunk as Chunk)
					: (mkV(k, Purity.UNKNOWN, [UNKNOWN_TARGET]).chunk as Chunk),
			),
		);
		const unknown = new Set(["s1", "s2", "w0"]);
		const o3 = [...unknown].sort(annotationCompare(budget, unknown));
		// w0 非源（无 ?）→ 释放数 0 排最后（仍在 order——标注它是 no-op）；s1/s2 平手 → key 升序
		expect(o3).toEqual(["s1", "s2", "w0"]);
	});
});
