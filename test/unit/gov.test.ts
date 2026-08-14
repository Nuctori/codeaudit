/**
 * 迭代56：治理三视图单元测试（--dups/--test-coverage/--dead）。
 * 全部为 verdicts 纯派生函数（零扫描依赖）——直接构造 Verdict 断言。
 */
import { describe, expect, it } from "vitest";
import {
	duplicateGroups,
	testCoverage,
	deadChunks,
	isTestFile,
} from "../../src/core/gov";
import { Purity, type Verdict } from "../../src/core/types";

function v(
	key: string,
	id: string,
	file: string,
	name: string,
	calls: string[] = [],
	line = 1,
): Verdict {
	return {
		chunk: {
			id,
			key,
			name,
			file,
			line,
			endLine: line,
			nesting: 0,
			direct: new Set(),
			calls: new Set(calls),
			unknownSites: 0,
			unknownCalls: [],
			thrownTypes: [],
			catches: [],
			stateWrites: [],
			stateReads: [],
		},
		purity: Purity.PURE,
		effects: new Set(),
		chain: Infinity,
		chainDev: Infinity,
		chainPath: [],
		throwsTypes: [],
		stateDeps: [],
		chainCertain: true,
		provenance: "static",
	};
}

describe("duplicateGroups（重复代码，公理4 内容哈希）", () => {
	it("id 相同且 key 不同 = 复制粘贴；单实例不报", () => {
		const verdicts = [
			v("a.py::h1", "ID1", "a.py", "f", [], 10),
			v("b.py::h1", "ID1", "b.py", "f", [], 5), // 同内容不同文件
			v("c.py::h2", "ID2", "c.py", "g"), // 唯一
		];
		const g = duplicateGroups(verdicts);
		expect(g.length).toBe(1);
		expect(g[0]!.instances).toBe(2);
		expect(g[0]!.sites).toHaveLength(2);
	});

	it("同文件同内容 #n 后缀去重（key 不同但同一位置不算多实例）", () => {
		const verdicts = [
			v("x.py::h1", "ID1", "x.py", "f"),
			v("x.py::h1#2", "ID1", "x.py", "f"), // 同文件重复 = 同 key 去重后仍算 2 个实例
			v("x.py::h2", "ID2", "x.py", "g"),
		];
		// 两个同 id 的 key（x.py::h1 与 x.py::h1#2）不同 → 仍是复制
		expect(duplicateGroups(verdicts).length).toBe(1);
	});

	it("instances 降序排列", () => {
		const verdicts = [
			v("a::1", "I1", "a.py", "f"),
			v("b::1", "I1", "b.py", "f"),
			v("c::1", "I1", "c.py", "f"),
			v("d::2", "I2", "d.py", "g"),
			v("e::2", "I2", "e.py", "g"),
		];
		const g = duplicateGroups(verdicts);
		expect(g[0]!.instances).toBe(3);
		expect(g[1]!.instances).toBe(2);
	});
});

describe("testCoverage（测试盲区）", () => {
	it("Tests/ 目录直接引用的生产 chunk 算覆盖", () => {
		const verdicts = [
			v("Tests/a::t", "T1", "Tests/PlayMode/A.cs", "t", ["src/b::h"]),
			v("src/b::h", "S1", "src/B.cs", "b"),
			v("src/c::h", "S2", "src/C.cs", "c"),
		];
		const tc = testCoverage(verdicts);
		expect(tc.production).toBe(2);
		expect(tc.covered).toBe(1);
		expect(tc.coverage).toBe(0.5);
		expect(tc.uncovered).toHaveLength(1);
		expect(tc.uncovered[0]!.name).toBe("c");
	});

	it("传递闭包：测试 → 中间生产 → 深层生产也算覆盖", () => {
		const verdicts = [
			v("Tests/t", "T1", "Tests/T.cs", "t", ["src/a::h"]),
			v("src/a::h", "S1", "src/A.cs", "a", ["src/b::h"]),
			v("src/b::h", "S2", "src/B.cs", "b"),
		];
		const tc = testCoverage(verdicts);
		expect(tc.covered).toBe(2);
		expect(tc.uncovered).toHaveLength(0);
	});

	it("未覆盖按调用者数降序（被引用越多越危险）", () => {
		const verdicts = [
			v("src/a::h", "S1", "src/A.cs", "a", ["src/x::h"]),
			v("src/b::h", "S2", "src/B.cs", "b", ["src/x::h"]),
			v("src/x::h", "S3", "src/X.cs", "x"),
			v("src/y::h", "S4", "src/Y.cs", "y"),
		];
		const tc = testCoverage(verdicts);
		expect(tc.uncovered[0]!.name).toBe("x"); // 2 调用者
		expect(tc.uncovered[0]!.callers).toBe(2);
		expect(tc.uncovered[1]!.callers).toBe(0);
	});

	it("isTestFile 识别 Unity 测试路径", () => {
		expect(isTestFile("Assets/Tests/PlayMode/X.cs")).toBe(true);
		expect(isTestFile("Assets/InitDeity/Tests/Editor/Y.cs")).toBe(true);
		expect(isTestFile("test/unit/a.test.ts")).toBe(true);
		expect(isTestFile("src/core/gov.ts")).toBe(false);
		expect(isTestFile("Assets/Game/Tests")).toBe(true);
	});
});

describe("deadChunks（疑似死代码）", () => {
	it("零调用者报死代码；被调用不报", () => {
		const verdicts = [
			v("src/a::h", "S1", "src/A.cs", "a", ["src/b::h"]),
			v("src/b::h", "S2", "src/B.cs", "b"),
			v("src/c::h", "S3", "src/C.cs", "c"),
		];
		const dead = deadChunks(verdicts);
		expect(dead.map((d) => d.name)).toEqual(["a", "c"]); // a 也零调用者（无人调它）
	});

	it("Unity 生命周期方法排除（引擎回调，静态图不可见）", () => {
		const verdicts = [
			v("src/Mono::h", "S1", "src/Mono.cs", "Mono.Start"),
			v("src/Mono::h2", "S2", "src/Mono.cs", "Mono.Update"),
			v("src/Mono::h3", "S3", "src/Mono.cs", "Mono.Awake"),
		];
		expect(deadChunks(verdicts)).toHaveLength(0);
	});

	it("测试文件自身排除（runner 调用）", () => {
		const verdicts = [
			v("Tests/t::h", "T1", "Tests/T.cs", "t"),
			v("src/a::h", "S1", "src/A.cs", "a"),
		];
		const dead = deadChunks(verdicts);
		expect(dead).toHaveLength(1);
		expect(dead[0]!.file).toBe("src/A.cs");
	});

	it("public（首字母大写）标 suspected，其余 high", () => {
		const verdicts = [
			v("src/a::h", "S1", "src/A.cs", "PublicMethod"),
			v("src/b::h", "S2", "src/B.cs", "privateMethod"),
		];
		const dead = deadChunks(verdicts);
		expect(dead.find((d) => d.name === "PublicMethod")!.confidence).toBe(
			"suspected",
		);
		expect(dead.find((d) => d.name === "privateMethod")!.confidence).toBe(
			"high",
		);
	});

	it("合成 chunk 排除（<static-init>/<module>——审计 blocker：曾误写 .static-init 失配永不命中）", () => {
		const verdicts = [
			v("src/Api::h1", "S1", "src/Api.cs", "Api.<static-init>"),
			v("src/Api::h2", "S2", "src/Api.cs", "Api.<module>"),
			v("src/Api::h3", "S3", "src/Api.cs", "Api.RealMethod"),
		];
		const dead = deadChunks(verdicts);
		expect(dead).toHaveLength(1);
		expect(dead[0]!.name).toBe("Api.RealMethod");
	});

	it("Python 一律 suspected（reviewer Medium-1：模块级零调用者可能是框架/入口）", () => {
		const verdicts = [
			v("src/mod.py::h", "S1", "src/mod.py", "handle_request"),
			v("src/a.cs::h", "S2", "src/A.cs", "_privateHelper"),
		];
		const dead = deadChunks(verdicts);
		expect(dead.find((d) => d.file.endsWith(".py"))!.confidence).toBe(
			"suspected",
		);
		expect(dead.find((d) => d.file.endsWith(".cs"))!.confidence).toBe("high");
	});

	it("纯测试仓库 coverage=0（reviewer Low-5：空生产集不报 100% 误导）", () => {
		const verdicts = [v("Tests/t::h", "T1", "Tests/T.cs", "t")];
		const tc = testCoverage(verdicts);
		expect(tc.production).toBe(0);
		expect(tc.coverage).toBe(0);
	});
});
