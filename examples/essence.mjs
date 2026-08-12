#!/usr/bin/env node
// codeaudit 的「一句诗」——整个项目的一次蒸馏（对应 CPS 例子的地位）。
//
// 全项目 = 提取(lang/packs：源码→chunk/调用/直接效应) + 链接(engine/link：目标解析→边/"?")
//        + 本文件（唯一的分析函数 core/analyze.ts） + 派生(influence/risk/proof/corpus：verdicts 的读法）
//
// 本文件 = core/ 的精髓：tarjan（生产在 core/tarjan.ts 是迭代版——50k 深链不爆栈；此处递归版仅演示）
//        + runOnce（SCC 凝聚 DAG 单趟：效应并集 + 最短链）+ analyze（audit/dev 双跑成区间）。

// ---- 1. Tarjan SCC（输出契约：跨分量边 u→v ⇒ v 分量先出——不动点单趟的前提）----
function tarjan(nodes, edges) {
	const index = new Map(),
		low = new Map(),
		onStack = new Set(),
		stack = [],
		out = [];
	let counter = 0;
	const visit = (v) => {
		index.set(v, counter);
		low.set(v, counter);
		counter++;
		stack.push(v);
		onStack.add(v);
		for (const w of edges.get(v) ?? []) {
			if (!index.has(w)) {
				visit(w);
				low.set(v, Math.min(low.get(v), low.get(w)));
			} else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
		}
		if (low.get(v) === index.get(v)) {
			const scc = [];
			for (;;) {
				const w = stack.pop();
				onStack.delete(w);
				scc.push(w);
				if (w === v) break;
			}
			out.push(scc);
		}
	};
	for (const n of nodes) if (!index.has(n)) visit(n);
	return out;
}

// ---- 2. runOnce：凝聚 DAG 上单趟（公理2 终止性由构造保证）。
//      audit=true 时 "?" 构成效应源（公理3 悲观）；eff 并集单调（A7 不动点唯一）。----
function runOnce(chunks, audit) {
	const byKey = new Map(chunks.map((c) => [c.key, c]));
	const edges = new Map(
		chunks.map((c) => [
			c.key,
			new Set([...c.calls].filter((t) => byKey.has(t))),
		]),
	);
	const hasUnknown = new Set(
		chunks.filter((c) => c.calls.has("?")).map((c) => c.key),
	);
	const sccs = tarjan(byKey.keys(), edges);
	const comp = new Map();
	sccs.forEach((s, k) => s.forEach((i) => comp.set(i, k)));
	const succ = sccs.map(() => new Set());
	sccs.forEach((s, k) =>
		s.forEach((i) => {
			for (const t of edges.get(i) ?? []) {
				const c2 = comp.get(t);
				if (c2 !== undefined && c2 !== k) succ[k].add(c2);
			}
		}),
	);
	const eff = [],
		chain = [];
	for (let k = 0; k < sccs.length; k++) {
		const e = new Set();
		for (const i of sccs[k]) for (const d of byKey.get(i).direct) e.add(d);
		if (audit && sccs[k].some((i) => hasUnknown.has(i))) e.add("?");
		let best = e.size > 0 ? 0 : Infinity;
		for (const k2 of succ[k]) {
			for (const d of eff[k2]) e.add(d);
			if (eff[k2].size > 0 && 1 + chain[k2] < best) best = 1 + chain[k2];
		}
		eff[k] = e;
		chain[k] = best;
	}
	const res = new Map();
	for (const c of chunks) {
		const k = comp.get(c.key);
		const real = new Set([...eff[k]].filter((x) => x !== "?"));
		res.set(c.key, {
			purity: real.size > 0 ? 2 : eff[k].has("?") ? 1 : 0,
			chain: chain[k],
		});
	}
	return res;
}

// ---- 3. analyze：audit/dev 双跑成区间（真值 ∈ [audit 链, dev 链]；一致 ⟹ chainCertain）----
function analyze(chunks) {
	const audit = runOnce(chunks, true),
		dev = runOnce(chunks, false);
	return chunks.map((c) => {
		const a = audit.get(c.key),
			d = dev.get(c.key);
		return {
			key: c.key,
			purity: a.purity,
			chain: a.chain,
			chainDev: d.chain,
			chainCertain: a.chain === d.chain,
		};
	});
}

// ---- 4. 工作示例：传染链 handle_request chain=2 → sqlite3 chain=0 ----
const chunk = (key, direct, calls) => ({
	key,
	direct: new Set(direct),
	calls: new Set(calls),
});
const demo = [
	chunk("api.handle_request", [], ["service.batch_create"]),
	chunk("service.batch_create", [], ["db.execute"]),
	chunk("db.execute", ["db"], []),
	chunk("worker.engage", [], ["?"]), // 未解析调用：audit 悲观源
];
const verdicts = analyze(demo);
const by = new Map(verdicts.map((v) => [v.key, v]));

// ---- 5. 八断言 ----
const assert = (cond, msg) => {
	if (!cond) {
		console.error("FAIL:", msg);
		process.exit(1);
	}
};
assert(by.get("db.execute").chain === 0, "db.execute chain=0（直接效应源）");
assert(by.get("service.batch_create").chain === 1, "batch_create chain=1");
assert(by.get("api.handle_request").chain === 2, "handle_request chain=2");
assert(by.get("api.handle_request").purity === 2, "handle_request IMPURE");
assert(by.get("worker.engage").purity === 1, "engage UNKNOWN（audit 悲观）");
assert(
	by.get("worker.engage").chainDev === Infinity,
	"engage dev 纯 → 区间上界 ∞",
);
assert(!by.get("worker.engage").chainCertain, "区间非零 ⟹ 不确定");
assert(
	by.get("worker.engage").chain <= by.get("worker.engage").chainDev,
	"区间定理 audit ≤ dev",
);

console.log("essence: 8/8 assertions passed");
console.log(
	"  handle_request chain=2 → sqlite3 chain=0（副作用藏 2 层，源头是 db.execute）",
);
