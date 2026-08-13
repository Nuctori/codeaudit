// 迭代46 A/桥：依赖骨架（传递约简）+ 桥/割点测试
import { describe, expect, it } from "vitest";
import { dependencySkeleton, bridgesOf } from "../../src/core/skeleton";
import type { Verdict } from "../../src/core/types";

/** fixture：构造 Verdict（topology.test.ts v() 同款最小形状）。 */
function v(
	key: string,
	opts: { calls?: string[]; unknownSites?: number } = {},
): Verdict {
	return {
		chunk: {
			key,
			file: `${key}.js`,
			startLine: 1,
			endLine: 2,
			calls: new Set(opts.calls ?? []),
			unknownSites: opts.unknownSites ?? 0,
			stateWrites: [],
			parseError: false,
		},
		purity: 0,
		chain: 0,
		chainCertain: true,
		stateDeps: [],
	} as unknown as Verdict;
}

describe("dependencySkeleton（迭代46 A：凝聚 DAG 传递约简）", () => {
	it("A→B→C 且 A→C：骨架删传递冗余 A→C", () => {
		const sk = dependencySkeleton([
			v("A", { calls: ["B", "C"] }),
			v("B", { calls: ["C"] }),
			v("C"),
		]);
		const edges = sk.map((e) => `${e.from}->${e.to}`).sort();
		expect(edges).toEqual(["A->B", "B->C"]);
	});

	it("菱形 A→B、A→C、B→D、C→D：A→D 无直连，全保留（无冗余）", () => {
		const sk = dependencySkeleton([
			v("A", { calls: ["B", "C"] }),
			v("B", { calls: ["D"] }),
			v("C", { calls: ["D"] }),
			v("D"),
		]);
		expect(sk.map((e) => `${e.from}->${e.to}`).sort()).toEqual([
			"A->B",
			"A->C",
			"B->D",
			"C->D",
		]);
	});

	it("SCC 凝聚：环内边不出现，环外直连保留", () => {
		const sk = dependencySkeleton([
			v("X", { calls: ["A"] }),
			v("A", { calls: ["B"] }),
			v("B", { calls: ["A", "Y"] }),
			v("Y"),
		]);
		// A↔B 是一个 SCC → 代表 key 为 comp[0]（A 或 B）；骨架只含 X→SCC、SCC→Y
		const edges = sk.map((e) => `${e.from}->${e.to}`);
		expect(edges).toHaveLength(2);
		// 代表 key 是分量内第一个 chunk（A），故 X->A 与 A->Y 或 B 代表——断言连通性语义
		expect(edges.some((e) => e.startsWith("X->"))).toBe(true);
		expect(edges.some((e) => e.endsWith("->Y"))).toBe(true);
	});

	it("不可变性：输入 verdicts 的 calls 不被修改", () => {
		const a = v("A", { calls: ["B", "C"] });
		const b = v("B", { calls: ["C"] });
		const c = v("C");
		const before = [...a.chunk.calls];
		dependencySkeleton([a, b, c]);
		expect([...a.chunk.calls]).toEqual(before);
	});
});

describe("bridgesOf（迭代46 桥/割点：模块边界）", () => {
	it("两分量单桥边：删边即隔离", () => {
		const r = bridgesOf([
			v("A", { calls: ["B"] }),
			v("B"),
			v("C", { calls: ["D"] }),
			v("D"),
		]);
		// A→B 与 C→D 两条桥（无向化后）；A/B 分量与 C/D 分量各自独立
		expect(r.bridges).toHaveLength(2);
	});

	it("星形 A→B、A→C、A→D：A 是割点，每条边都是桥（叶唯一通道）", () => {
		const r = bridgesOf([
			v("A", { calls: ["B", "C", "D"] }),
			v("B"),
			v("C"),
			v("D"),
		]);
		// 无向星形：B/C/D 各只连 A——每条边是唯一通道 = 桥；A 是割点
		expect(r.bridges).toHaveLength(3);
		expect(r.articulationPoints).toContain("A");
	});
});
