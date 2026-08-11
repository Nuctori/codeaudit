import { describe, it, expect } from "vitest";
import { stateCouplingOf } from "../../src/core/state";
import { Purity, type Verdict } from "../../src/core/types";

/**
 * 状态耦合图纯函数（迭代23 D-127 --state）：写方 → 读者映射，按读者数降序。
 * T1：反查 verdict.stateDeps 的正确性（复用 analyze 已算结果，不重复调 stateDepsOf）。
 */

function v(
	key: string,
	opts: {
		stateWrites?: string[];
		stateDeps?: string[];
		name?: string;
		file?: string;
		line?: number;
	} = {},
): Verdict {
	return {
		chunk: {
			id: key,
			key,
			name: opts.name ?? key,
			file: opts.file ?? "f.ts",
			line: opts.line ?? 1,
			endLine: 2,
			nesting: 0,
			direct: new Set(),
			calls: new Set(),
			unknownSites: 0,
			unknownCalls: [],
			thrownTypes: [],
			catches: [],
			stateWrites: opts.stateWrites ?? [],
			stateReads: [],
		},
		purity: Purity.PURE,
		effects: new Set(),
		chain: Infinity,
		chainDev: Infinity,
		chainCertain: true,
		chainPath: [],
		throwsTypes: [],
		stateDeps: opts.stateDeps ?? [],
	};
}

describe("stateCouplingOf（迭代23 D-127）", () => {
	it("写方 + 多读者 → readers 计数、readerKeys 字典序、排序首位", () => {
		const verdicts = [
			v("W", { stateWrites: ["user.status"], name: "setUserStatus", file: "a.py", line: 12 }),
			v("R1", { stateDeps: ["user.status"], file: "b.py", line: 30 }),
			v("R2", { stateDeps: ["user.status"], file: "c.py", line: 40 }),
			v("R3", { stateDeps: ["user.status"], file: "d.py", line: 50 }),
			v("Other", { stateDeps: [], file: "e.py", line: 60 }), // 无依赖 reader
		];
		const out = stateCouplingOf(verdicts);
		expect(out.length).toBe(1);
		expect(out[0]).toMatchObject({ key: "W", readers: 3, name: "setUserStatus", file: "a.py", line: 12 });
		expect(out[0].writes).toEqual(["user.status"]);
		expect(out[0].readerKeys).toEqual(["R1", "R2", "R3"]); // 字典序
	});

	it("两写者同位置 → 读者同时计入两写者（按写者列读者语义）", () => {
		const verdicts = [
			v("W1", { stateWrites: ["user.status"] }),
			v("W2", { stateWrites: ["user.status"] }),
			v("R", { stateDeps: ["user.status"] }),
		];
		const out = stateCouplingOf(verdicts);
		expect(out.length).toBe(2);
		const r1 = out.find((e) => e.key === "W1")!;
		const r2 = out.find((e) => e.key === "W2")!;
		expect(r1.readers).toBe(1);
		expect(r1.readerKeys).toEqual(["R"]);
		expect(r2.readers).toBe(1);
		expect(r2.readerKeys).toEqual(["R"]);
	});

	it("自写自读不虚增（stateDeps 已排除自写——fixture 构造空 deps 验证）", () => {
		const verdicts = [
			v("W", { stateWrites: ["d"] }),
			// 自写自读：stateDepsOf 保证 stateDeps 不含自写位置；fixture 直接给空 stateDeps
			v("R", { stateDeps: [], stateWrites: [] }),
		];
		const out = stateCouplingOf(verdicts);
		expect(out.length).toBe(0); // 无外部读者
	});

	it("无写方/无读者 → 空数组", () => {
		expect(stateCouplingOf([])).toEqual([]);
		expect(stateCouplingOf([v("A", {}), v("B", { stateDeps: ["x"] })])).toEqual([]); // 有读者无写者
		expect(stateCouplingOf([v("A", { stateWrites: ["x"] }), v("B", {})])).toEqual([]); // 有写者无读者
	});

	it("排序：readers 降序，平手按 key 字典序（公理5）", () => {
		const verdicts = [
			v("A", { stateWrites: ["a"] }),
			v("B", { stateWrites: ["b"] }),
			v("C", { stateWrites: ["c"] }),
			v("R1", { stateDeps: ["a"] }),
			v("R2", { stateDeps: ["a"] }),
			v("R3", { stateDeps: ["a"] }),
			v("R4", { stateDeps: ["b"] }),
		];
		const out = stateCouplingOf(verdicts);
		// A:3 读者；B:1 读者；C:0 读者（不输出）
		expect(out.map((e) => e.key)).toEqual(["A", "B"]);
		expect(out[0]!.readers).toBe(3);
		expect(out[1]!.readers).toBe(1);
	});

	it("⊤ 降级条目暴露（不隐藏，防静默欠报纪律）", () => {
		const verdicts = [
			v("W", { stateWrites: ["⊤"] }),
			v("R", { stateDeps: ["⊤"] }),
		];
		const out = stateCouplingOf(verdicts);
		expect(out.length).toBe(1);
		expect(out[0]!.writes).toEqual(["⊤"]);
		expect(out[0]!.readers).toBe(1);
	});
});
