import { describe, it, expect } from "vitest";
import { proofCompleteness } from "../../src/core/proof";
import { Purity, UNKNOWN_TARGET, type Verdict } from "../../src/core/types";

function v(
	key: string,
	opts: { purity?: number; calls?: string[]; file?: string } = {},
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
			direct: new Set(),
			calls: new Set(opts.calls ?? []),
			unknownSites: 0,
			unknownCalls: [],
			thrownTypes: [],
			catches: [],
			stateWrites: [],
			stateReads: [],
		},
		purity,
		effects: new Set(purity === Purity.IMPURE ? ["io"] : []),
		chain: purity === Purity.PURE ? Infinity : 0,
		chainDev: Infinity,
		chainCertain: true,
		inDegree: 0,
		outDegree: 0,
		chainPath: [],
		throwsTypes: [],
		stateDeps: [],
	};
}

describe("证明完整度 proofCompleteness", () => {
	it("自源 UNKNOWN 全标后释放（BLOCKER-1 修复）：孤立 A(?) → θ=1", () => {
		const now = [v("A", { purity: Purity.UNKNOWN, calls: [UNKNOWN_TARGET] })];
		const p = proofCompleteness(now);
		expect(p.theta).toBe(1); // 修复前 θ=0（自源永不可释放）
		expect(p.curve[p.curve.length - 1]).toBe(0);
		expect(p.budgetToTarget).toBeNull(); // 无 target
	});

	it("多源 ALL-sources 释放：w 依赖 {u1,u2} → 两源标完才释放", () => {
		const now = [
			v("u1", { purity: Purity.UNKNOWN, calls: [UNKNOWN_TARGET] }),
			v("u2", { purity: Purity.UNKNOWN, calls: [UNKNOWN_TARGET] }),
			v("w", { purity: Purity.UNKNOWN, calls: ["u1", "u2", UNKNOWN_TARGET] }),
		];
		const p = proofCompleteness(now);
		// 全标后 θ=1（修复前 θ=0.333）
		expect(p.theta).toBe(1);
		expect(p.curve[p.curve.length - 1]).toBe(0);
		// 标 u1 后 w 未释放（deps=2 需两源）——curve[1] 应仍含 w
		expect(p.curve[1]).toBeGreaterThan(0);
	});

	it("预算序确定性 + 曲线单调不增 + 乱序输入一致", () => {
		const now = [
			v("a", { purity: Purity.UNKNOWN, calls: ["b", UNKNOWN_TARGET] }),
			v("b", { purity: Purity.UNKNOWN, calls: [UNKNOWN_TARGET] }),
			v("c", { purity: Purity.PURE, calls: [] }),
		];
		const p1 = proofCompleteness(now);
		const p2 = proofCompleteness([...now].reverse());
		expect(JSON.stringify(p1.order)).toBe(JSON.stringify(p2.order));
		expect(p1.curve.every((x, i) => i === 0 || x <= p1.curve[i - 1]!)).toBe(
			true,
		);
		expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));
	});

	it("budgetToTarget：目标可达/不可达/精确边界（BLOCKER-2 修复）", () => {
		const now = [
			v("A", { purity: Purity.UNKNOWN, calls: [UNKNOWN_TARGET] }),
			v("B", { purity: Purity.UNKNOWN, calls: [UNKNOWN_TARGET] }),
			v("C", { purity: Purity.UNKNOWN, calls: [UNKNOWN_TARGET] }),
		];
		// 3 个独立源：标 1 条 θ=1/3、2 条 2/3、3 条 1
		const p = proofCompleteness(now);
		expect(p.theta).toBe(1);
		expect(p.budgetToTarget).toBeNull();
		const t50 = proofCompleteness(now, { targetTheta: 0.5 });
		expect(t50.budgetToTarget).not.toBeNull();
		// 精确边界：target == θ（可达）不应误报 null（修复前浮点下溢）
		const exact = proofCompleteness(now, { targetTheta: 1 });
		expect(exact.budgetToTarget).not.toBeNull();
		expect(exact.budgetToTarget).toBe(3);
		const over = proofCompleteness(now, { targetTheta: 0.99 });
		expect(over.budgetToTarget).not.toBeNull();
	});

	it("全 PURE / 空 → θ=1；加权模式：UNKNOWN 的 Fwd 深度权重", () => {
		const pure = [v("x", { purity: Purity.PURE })];
		expect(proofCompleteness(pure).theta).toBe(1);
		expect(proofCompleteness([]).theta).toBe(1);
		// 加权：链 A(?)→B→C(?)→D(?)——A/C/D 是 UNKNOWN，Fwd 深度 1/3/4
		const chain = [
			v("A", { purity: Purity.UNKNOWN, calls: ["B", UNKNOWN_TARGET] }),
			v("B", { calls: ["C"] }),
			v("C", { purity: Purity.UNKNOWN, calls: ["D", UNKNOWN_TARGET] }),
			v("D", { purity: Purity.UNKNOWN, calls: [UNKNOWN_TARGET] }),
		];
		const weighted = proofCompleteness(chain, { weighted: true });
		const simple = proofCompleteness(chain);
		expect(weighted.maxFwd).toBeGreaterThan(0);
		// 简单计数 total=3（A/C/D）；加权 = |Fwd(A)|+|Fwd(C)|+|Fwd(D)| = 4+2+1 = 7
		expect(simple.curve[0]).toBe(3);
		expect(weighted.curve[0]).toBe(7);
	});
});
