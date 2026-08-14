import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { analyze } from "../../src/core/analyze";
import { proofCompleteness } from "../../src/core/proof";
import { riskOfChange } from "../../src/core/risk";
import { deadChunks, duplicateGroups, testCoverage } from "../../src/core/gov";
import { contentHash } from "../../src/core/hash";
import { sourceSnippet } from "../../src/core/snippet";
import { graphMetrics } from "../../src/core/topology";
import {
	Purity,
	UNKNOWN_TARGET,
	type Verdict,
	type Chunk,
} from "../../src/core/types";

/**
 * 第三轮范畴律对抗性审计（函数式范畴论视角）——前两轮未覆盖子系统：
 * proof/risk/gov/topology/hash/snippet/analyze 残余 + cli recheck 回路。
 *
 * - law:determinism   SCC 多链等长后继的 chainPath 源选择（prevComp 平手须与输入序解耦）；
 *                     riskOfChange 六因子聚合对 verdicts 乱序不变
 * - law:poset-monotonicity   gov 三视图比较器一致性（file 相等必须落到文档 tiebreak，
 *                     comparator 反自反/反对称——(a.file<b.file ? -1 : 1) 使 line/callers 平手失效）
 * - law:edge-case     proofCompleteness.maxFwd 字段契约（与 weighted 开关解耦）；
 *                     contentHash 单令牌变异雪崩（身份函子单射经验证）；
 *                     sourceSnippet 病态行号有定义像；graphMetrics 负 chain 无 NaN 泄漏
 * - law:idempotence   recheck 回路：同一 JSON 两次 recheck 输出逐字节一致
 * - 信任边界：recheck 恶意 chain（1e9）拒绝 exit 2 不崩溃
 */

// ---- 工具 ----

let dir: string;
let cliJs: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-ct3-"));
	// dist 已构建（npm run build 后）；spawn 用编译产物（recheck 路径不走 wasm）
	cliJs = join(process.cwd(), "dist", "cli.js");
});
afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** 最小 Chunk（analyze 直调输入）。 */
function mk(
	key: string,
	calls: string[] = [],
	direct: string[] = [],
	extra: Partial<Chunk> = {},
): Chunk {
	return {
		id: "id-" + key,
		key,
		name: key,
		file: "f.ts",
		line: 1,
		endLine: 2,
		nesting: 0,
		direct: new Set(direct),
		calls: new Set(calls),
		unknownSites: calls.includes(UNKNOWN_TARGET) ? 1 : 0,
		unknownCalls: [],
		thrownTypes: [],
		catches: [],
		stateWrites: [],
		stateReads: [],
		...extra,
	};
}

/** 最小 Verdict（派生视图输入，risk.test.ts 同款）。 */
function mkV(
	key: string,
	opts: {
		purity?: number;
		chain?: number;
		calls?: string[];
		file?: string;
		line?: number;
		id?: string;
		direct?: string[];
	} = {},
): Verdict {
	const purity = opts.purity ?? Purity.PURE;
	return {
		chunk: {
			id: opts.id ?? "id-" + key,
			key,
			name: key,
			file: opts.file ?? "f.ts",
			line: opts.line ?? 1,
			endLine: (opts.line ?? 1) + 1,
			nesting: 0,
			direct: new Set(opts.direct ?? []),
			calls: new Set(opts.calls ?? []),
			unknownSites: 0,
			unknownCalls: [],
			thrownTypes: [],
			catches: [],
			stateWrites: [],
			stateReads: [],
		},
		purity,
		effects: new Set(opts.direct ?? []),
		chain: opts.chain ?? (purity === Purity.PURE ? Infinity : 0),
		chainDev: opts.chain ?? Infinity,
		chainCertain: true,
		chainPath: [],
		throwsTypes: [],
		stateDeps: [],
		provenance: "static",
	};
}

// ---------------------------------------------------------------------------
// law:determinism —— 环内多后继平手的 chainPath 源选择
// ---------------------------------------------------------------------------
describe("law:determinism", () => {
	it("SCC 多链等长后继：chainPath 源选择与输入序无关（prevComp 平手须按分量代表键 tiebreak）", () => {
		// SCC {A,B}：A→B,io1；B→A,io2——io1/io2 都是 chain=0 效应源，
		// 分量后继 {comp(io1), comp(io2)} 链长平手 → prevComp 取 succ 集合首元素
		// → succ 插入序 = SCC 成员发现序（tarjan 依赖输入序）→ 源选择随输入翻转
		const base = [
			mk("A", ["B", "io1"]),
			mk("B", ["A", "io2"]),
			mk("io1", [], ["io"]),
			mk("io2", [], ["io"]),
		];
		const shuffles: Chunk[][] = [
			[...base].reverse(),
			[base[3]!, base[1]!, base[0]!, base[2]!],
			[base[2]!, base[0]!, base[3]!, base[1]!],
		];
		const snap = (cs: Chunk[]): string =>
			JSON.stringify(
				analyze(cs).verdicts
					.filter((v) => ["A", "B"].includes(v.chunk.key))
					.map((v) => `${v.chunk.key}:${v.chainPath.join(">")}:${v.chain}`)
					.sort(),
			);
		const baseSig = snap(base);
		for (const sh of shuffles)
			expect(snap(sh), `乱序输入 chainPath 必须稳定`).toBe(baseSig);
		// 语义锚点：A、B 的 chain 都是 1（最近效应源隔 1 跳），源必须是 io1 或 io2 之一
		for (const v of analyze(base).verdicts) {
			if (!["A", "B"].includes(v.chunk.key)) continue;
			expect(v.chain).toBe(1);
			expect(v.chainPath.length).toBe(2); // [源, 自身]（SCC 内无中间跳）
			expect(["io1", "io2"]).toContain(v.chainPath[0]);
		}
	});

	it("riskOfChange 六因子聚合对 verdicts 乱序不变（含环/未知/状态耦合）", () => {
		const base = [
			mkV("A", { calls: ["B"], file: "a.ts" }),
			mkV("B", { calls: ["A", "u"], file: "b.ts" }),
			mkV("u", { purity: Purity.UNKNOWN, calls: [UNKNOWN_TARGET], file: "u.ts" }),
			mkV("io1", { direct: ["io"], purity: Purity.IMPURE, file: "io.ts" }),
			mkV("R", { file: "r.ts", stateDeps: ["cfg.x"] }),
		];
		const changed = new Set(["b.ts"]);
		const r1 = riskOfChange(base, changed);
		const r2 = riskOfChange([base[3]!, base[1]!, base[4]!, base[0]!, base[2]!], changed);
		const { risk: _a, ...f1 } = r1;
		const { risk: _b, ...f2 } = r2;
		expect(JSON.stringify(f1)).toBe(JSON.stringify(f2));
		expect(r1.risk).toBe(r2.risk);
	});
});

// ---------------------------------------------------------------------------
// law:poset-monotonicity —— gov 三视图比较器一致性（tiebreak 文档契约）
// ---------------------------------------------------------------------------
describe("law:poset-monotonicity（gov 比较器一致性）", () => {
	it("deadChunks 同文件条目按行升序（比较器必须反对称：file 相等时落到 line tiebreak）", () => {
		// 文档契约：「按文件、行排序」——同文件两死代码 chunk，行号 5 与 1
		const vs = [
			mkV("later", { file: "m.ts", line: 5 }),
			mkV("earlier", { file: "m.ts", line: 1 }),
			mkV("other", { file: "a.ts", line: 9 }),
		];
		const dead = deadChunks(vs);
		expect(dead.length).toBe(3);
		// 文件字典序：a.ts 在前；m.ts 内行号升序（1 在 5 前）
		expect(dead.map((d) => `${d.file}:${d.line}`)).toEqual([
			"a.ts:9",
			"m.ts:1",
			"m.ts:5",
		]);
	});

	it("duplicateGroups 同 instances 同 file 平手保持稳定（比较器反对称）", () => {
		// 两组重复代码：instances 相同、代表实例同文件——比较器必须返回 0（保持稳定序）
		const vs = [
			mkV("d1a", { id: "dup1", file: "m.ts", line: 1 }),
			mkV("d1b", { id: "dup1", file: "n.ts", line: 1 }),
			mkV("d2a", { id: "dup2", file: "m.ts", line: 9 }),
			mkV("d2b", { id: "dup2", file: "o.ts", line: 1 }),
		];
		const groups = duplicateGroups(vs);
		expect(groups.length).toBe(2);
		// 同 instances（2）同 file（m.ts）：平手无副作用（比较器不得报 a>b 且 b>a）
		const [g1, g2] = groups;
		expect(g1.instances).toBe(2);
		expect(g2.instances).toBe(2);
		// 无论输入序如何，输出组序只由 instances 降序 + file 升序决定（平手 → 输入序，
		// 即确定性：同一输入两遍一致 + 乱序输入仅平手组可换位但组内容不变）
		const r2 = duplicateGroups([...vs].reverse());
		expect(new Set(r2.map((g) => g.id))).toEqual(new Set(groups.map((g) => g.id)));
		for (const g of r2) {
			expect(g.instances).toBe(2);
			expect(g.sites.length).toBe(2);
		}
	});

	it("testCoverage 未覆盖同 callers 平手按文件升序（比较器一致性）", () => {
		// 两个未覆盖 chunk：调用者数相同、文件不同——必须按文件字典序稳定
		const vs = [
			mkV("p1", { file: "b.ts", line: 1 }),
			mkV("p2", { file: "a.ts", line: 1 }),
			mkV("caller1", { file: "x.ts", line: 1, calls: ["p1"] }),
			mkV("caller2", { file: "y.ts", line: 1, calls: ["p2"] }),
			mkV("t", { file: "Tests/t1.ts", line: 1 }),
		];
		// caller1/caller2 自身也是零调用者生产 chunk → 全部 4 个未覆盖；
		// callers 平手组（p1/p2=1、caller1/caller2=0）内按文件字典序：a.ts 先于 b.ts、x.ts 先于 y.ts
		const tc = testCoverage(vs);
		expect(tc.uncovered.map((u) => u.file)).toEqual(["a.ts", "b.ts", "x.ts", "y.ts"]);
		expect(tc.uncovered.map((u) => u.callers)).toEqual([1, 1, 0, 0]);
	});
});

// ---------------------------------------------------------------------------
// law:edge-case —— 极端对象有定义像
// ---------------------------------------------------------------------------
describe("law:edge-case", () => {
	it("proofCompleteness.maxFwd 与 weighted 开关解耦（字段文档契约：未知 chunk 最宽扇出）", () => {
		// u1 是 ? 源且被 d 调用 → Fwd(u1)={u1,d} size 2；d 纯传播型 → Fwd(d)={d} size 1
		const vs = [
			mkV("u1", { purity: Purity.UNKNOWN, calls: [UNKNOWN_TARGET] }),
			mkV("d", { purity: Purity.UNKNOWN, calls: ["u1"] }),
			mkV("iso", { purity: Purity.UNKNOWN, calls: [UNKNOWN_TARGET] }),
		];
		const unweighted = proofCompleteness(vs);
		const weighted = proofCompleteness(vs, { weighted: true });
		expect(weighted.maxFwd).toBe(2); // u1 的扇出
		// 字段文档未限定 weighted 模式——unweighted 调用也必须如实报告
		expect(unweighted.maxFwd).toBe(2);
		// 空/全纯：maxFwd 有定义 0
		expect(proofCompleteness([]).maxFwd).toBe(0);
		expect(
			proofCompleteness([mkV("p", {})]).maxFwd,
		).toBe(0);
	});

	it("contentHash 单令牌变异雪崩（身份函子单射的经验验证：任意单点变异改变哈希）", () => {
		const base = "def handler(x):\n    y = x + 1\n    return y";
		const mutations = [
			"def handler(x):\n    y = x + 2\n    return y", // 字面量
			"def handler(x):\n    y = x + 1\n    return z", // 标识符
			"def handler(x):\n    y = x + 1\n    return y  ", // 尾随空白
			"def handler(x):\n    y = x + 1\n    return Y", // 大小写
			"def handler(xx):\n    y = xx + 1\n    return y", // 参数名
			"def handler(x):\n    y = x - 1\n    return y", // 运算符
			"def handler(x):\n    y = x + 1\n    return y\n", // 尾换行
		];
		const h = contentHash(base);
		expect(contentHash(base)).toBe(h); // 幂等：同一文本恒同哈希
		for (const m of mutations)
			expect(contentHash(m), `变异: ${JSON.stringify(m)}`).not.toBe(h);
	});

	it("sourceSnippet 病态行号（line=0/负/endLine<line/endLine=0）→ 有定义像不抛", () => {
		const file = "weird.ts";
		writeFileSync(join(dir, file), ["a", "b", "c", "d", "e"].join("\n"));
		const chunk = { file, line: 1, endLine: 2 } as Chunk;
		const normal = sourceSnippet(dir, chunk);
		expect(normal).toBe("a\nb");
		// 病态形态全部不抛、返回子串（夹紧后非空或空串）
		const cases: Array<[number, number]> = [
			[0, 2],
			[-3, 2],
			[4, 1], // endLine < line
			[1, 0], // endLine = 0
			[100, 200], // 全部越界
		];
		for (const [line, endLine] of cases) {
			const s = sourceSnippet(dir, { file, line, endLine } as Chunk);
			expect(typeof s).toBe("string");
			expect(s.length).toBeLessThanOrEqual(2000);
		}
		// 夹紧后不得越过文件尾（endLine 超界 → 截到末行）
		expect(sourceSnippet(dir, { file, line: 3, endLine: 999 } as Chunk)).toBe(
			"c\nd\ne",
		);
	});

	it("graphMetrics 负 chain 不产生 NaN 泄漏（恶意/手写 verdict 防御）", () => {
		const vs = [
			mkV("neg", { purity: Purity.IMPURE, chain: -1, direct: ["io"] }),
			mkV("ok", { purity: Purity.IMPURE, chain: 2, direct: ["io"] }),
		];
		const g = graphMetrics(vs);
		// 直方图合计必须等于有限 chain chunk 数（负 chain 不计入，也不得产出 NaN/null）
		const sum = g.chainHistogram.reduce((s, n) => s + n, 0);
		expect(Number.isNaN(sum)).toBe(false);
		expect(sum).toBe(1); // 只有 chain=2 计入
		expect(JSON.stringify(g.chainHistogram)).not.toContain("null");
	});
});

// ---------------------------------------------------------------------------
// law:idempotence / 信任边界 —— cli recheck 回路（dist 产物）
// ---------------------------------------------------------------------------
describe("law:idempotence（recheck 回路）", () => {
	const reportFixture = (): string =>
		JSON.stringify(
			{
				root: ".",
				mode: "audit",
				version: "0.0.0-test",
				stats: {
					files: 1,
					skippedFiles: 0,
					parseErrors: 0,
					chunks: 2,
					pure: 1,
					impure: 1,
					unknown: 0,
					annotationRejected: [],
					annotationUnmatched: [],
					impureApplied: 0,
					unknownRate: 0,
					cycles: 0,
					cachedFiles: 0,
					scannedAt: "2026-01-01T00:00:00",
					staleEdges: 0,
					invariantViolations: 0,
					provenance: { annotated: 0, derived: 0 },
				},
				verdicts: [
					{
						chunk: {
							id: "aabbccddeeff0011",
							key: "a.ts::aabbccddeeff0011",
							name: "purefn",
							file: "a.ts",
							line: 1,
							endLine: 2,
							nesting: 0,
							direct: [],
							calls: [],
							unknownSites: 0,
							unknownCalls: [],
							thrownTypes: [],
							catches: [],
							stateWrites: [],
							stateReads: [],
						},
						purity: 0,
						effects: [],
						chain: "Infinity",
						chainDev: "Infinity",
						chainPath: [],
						throwsTypes: [],
						stateDeps: [],
						chainCertain: true,
						provenance: "static",
					},
					{
						chunk: {
							id: "1122334455667788",
							key: "a.ts::1122334455667788",
							name: "badfn",
							file: "a.ts",
							line: 4,
							endLine: 5,
							nesting: 0,
							direct: ["io"],
							calls: [],
							unknownSites: 0,
							unknownCalls: [],
							thrownTypes: [],
							catches: [],
							stateWrites: [],
							stateReads: [],
						},
						purity: 2,
						effects: ["io"],
						chain: 0,
						chainDev: 0,
						chainPath: ["badfn"],
						throwsTypes: [],
						stateDeps: [],
						chainCertain: true,
						provenance: "static",
					},
				],
			},
			null,
			2,
		);

	it("同一 JSON 两次 recheck --json 输出逐字节一致（重算回路幂等）", () => {
		const inp = join(dir, "rep.json");
		const out1 = join(dir, "out1.json");
		const out2 = join(dir, "out2.json");
		writeFileSync(inp, reportFixture());
		for (const out of [out1, out2]) {
			const r = spawnSync(
				process.execPath,
				[cliJs, "recheck", inp, "--json", out, "--topology", "--sources"],
				{ encoding: "utf8", timeout: 60_000 },
			);
			expect(r.status, r.stderr).toBe(0);
			expect(r.stdout).toBe("");
		}
		expect(readFileSync(out2, "utf8")).toBe(readFileSync(out1, "utf8"));
		// 语义锚点：verdicts 原样保留（判定不被重算改写）
		const parsed = JSON.parse(readFileSync(out1, "utf8"));
		expect(parsed.verdicts.length).toBe(2);
		expect(parsed.topology.nodes).toBe(2);
	});

	it("recheck 拒绝超限 chain（1e9）exit 2 不崩溃（不可信 JSON 形状校验）", () => {
		const inp = join(dir, "evil-chain.json");
		const evil = JSON.parse(reportFixture());
		evil.verdicts[1].chain = 1e9;
		evil.verdicts[1].chainDev = 1e9;
		writeFileSync(inp, JSON.stringify(evil));
		const r = spawnSync(process.execPath, [cliJs, "recheck", inp], {
			encoding: "utf8",
			timeout: 60_000,
		});
		expect(r.status).toBe(2);
		expect(r.stderr).toContain("chain");
	});

	it("recheck 拒绝缺 verdicts 数组（误传 HTML/截断文件）exit 2", () => {
		const inp = join(dir, "no-verdicts.json");
		writeFileSync(inp, JSON.stringify({ stats: { files: 1 }, foo: 1 }));
		const r = spawnSync(process.execPath, [cliJs, "recheck", inp], {
			encoding: "utf8",
			timeout: 60_000,
		});
		expect(r.status).toBe(2);
		expect(r.stderr).toContain("verdicts");
	});
});
