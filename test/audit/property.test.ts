import { describe, it, expect } from "vitest";
import { tarjan } from "../../src/core/tarjan";
import { analyze } from "../../src/core/analyze";
import { Chunk, Purity, UNKNOWN_TARGET } from "../../src/core/types";

/**
 * 维度 1-8：核心算法性质测试。
 * 方法：确定性伪随机生成图，与朴素参考实现对照。
 */

// 确定性 PRNG（mulberry32），保证测试可复现
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 朴素参考：可达性求 SCC 划分 ----
function naiveSccs(nodes: string[], edges: Map<string, Set<string>>): string[][] {
  const reach = new Map<string, Set<string>>();
  for (const n of nodes) {
    const seen = new Set<string>();
    const stack = [n];
    while (stack.length) {
      const v = stack.pop()!;
      if (seen.has(v)) continue;
      seen.add(v);
      for (const w of edges.get(v) ?? []) stack.push(w);
    }
    reach.set(n, seen);
  }
  const assigned = new Set<string>();
  const out: string[][] = [];
  for (const n of nodes) {
    if (assigned.has(n)) continue;
    const scc = nodes.filter(
      (m) => reach.get(n)!.has(m) && reach.get(m)!.has(n),
    );
    scc.forEach((m) => assigned.add(m));
    out.push(scc);
  }
  return out;
}

function randGraph(rand: () => number, n: number, edgeProb: number): Map<string, Set<string>> {
  const edges = new Map<string, Set<string>>();
  for (let i = 0; i < n; i++) {
    const s = new Set<string>();
    for (let j = 0; j < n; j++) {
      if (i !== j && rand() < edgeProb) s.add("n" + j);
    }
    edges.set("n" + i, s);
  }
  return edges;
}

function mkChunk(key: string, direct: string[], calls: string[]): Chunk {
  return {
    id: key, key, name: key, file: "f", line: 1, endLine: 2,
    nesting: 0, direct: new Set(direct), calls: new Set(calls),
  };
}

describe("维度1: Tarjan 划分与朴素可达性参考一致（性质测试）", () => {
  for (const [seed, n, p] of [[1, 8, 0.3], [2, 10, 0.2], [3, 12, 0.15], [4, 9, 0.4]] as const) {
    it(`随机图 seed=${seed} n=${n}`, () => {
      const rand = rng(seed);
      const nodes = Array.from({ length: n }, (_, i) => "n" + i);
      const edges = randGraph(rand, n, p);
      const mine = tarjan(nodes, edges).map((s) => [...s].sort());
      const ref = naiveSccs(nodes, edges).map((s) => [...s].sort());
      const canon = (x: string[][]) => x.map((s) => s.join(",")).sort();
      expect(canon(mine)).toEqual(canon(ref));
    });
  }
});

describe("维度2: 凝聚 DAG 逆拓扑序契约（随机图）", () => {
  it("50 个随机图上契约恒成立", () => {
    for (let seed = 10; seed < 60; seed++) {
      const rand = rng(seed);
      const n = 12;
      const nodes = Array.from({ length: n }, (_, i) => "n" + i);
      const edges = randGraph(rand, n, 0.2);
      const sccs = tarjan(nodes, edges);
      const compOf = new Map<string, number>();
      sccs.forEach((s, i) => s.forEach((v) => compOf.set(v, i)));
      for (const [u, ts] of edges) {
        for (const t of ts) {
          if (compOf.get(u) !== compOf.get(t)) {
            expect(compOf.get(t)!).toBeLessThan(compOf.get(u)!);
          }
        }
      }
    }
  });
});

/** 朴素参考：凝聚后链长 = 0(分量含种子) / 1+min(后继) / ∞。 */
function naiveChains(chunks: Chunk[]): Map<string, number> {
  const keys = chunks.map((c) => c.key);
  const edges = new Map(chunks.map((c) => [c.key, new Set([...c.calls].filter((t) => t !== UNKNOWN_TARGET))]));
  const sccs = naiveSccs(keys, edges);
  const compOf = new Map<string, number>();
  sccs.forEach((s, i) => s.forEach((v) => compOf.set(v, i)));
  const directOf = new Map(chunks.map((c) => [c.key, c.direct]));
  const memo = new Map<number, number>();
  const chainOf = (k: number): number => {
    if (memo.has(k)) return memo.get(k)!;
    const members = sccs[k]!;
    if (members.some((m) => directOf.get(m)!.size > 0)) {
      memo.set(k, 0);
      return 0;
    }
    let best = Infinity;
    for (const m of members) {
      for (const t of edges.get(m)!) {
        const k2 = compOf.get(t)!;
        if (k2 === k) continue;
        const sub = chainOf(k2);
        if (sub !== Infinity && 1 + sub < best) best = 1 + sub;
      }
    }
    memo.set(k, best);
    return best;
  };
  const out = new Map<string, number>();
  chunks.forEach((c) => out.set(c.key, chainOf(compOf.get(c.key)!)));
  return out;
}

describe("维度3+4: 链长 = 凝聚 DAG 最短距离（随机图对照，含环）", () => {
  it("30 个随机图，analyze 与朴素参考逐点一致", () => {
    for (let seed = 100; seed < 130; seed++) {
      const rand = rng(seed);
      const n = 10;
      const keys = Array.from({ length: n }, (_, i) => "n" + i);
      const edges = randGraph(rand, n, 0.25);
      const chunks = keys.map((k) =>
        mkChunk(k, rand() < 0.15 ? ["io"] : [], [...edges.get(k)!]),
      );
      const { verdicts } = analyze(chunks);
      const ref = naiveChains(chunks);
      for (const v of verdicts) {
        expect(v.chain).toBe(ref.get(v.chunk.key));
      }
    }
  });
});

describe("维度5: audit/dev 区间语义", () => {
  it("无未知符号时两遍恒等（chainCertain 全真）", () => {
    const rand = rng(200);
    const keys = Array.from({ length: 15 }, (_, i) => "n" + i);
    const edges = randGraph(rand, 15, 0.2);
    const chunks = keys.map((k) =>
      mkChunk(k, rand() < 0.2 ? ["io"] : [], [...edges.get(k)!]),
    );
    const { verdicts } = analyze(chunks);
    expect(verdicts.every((v) => v.chainCertain)).toBe(true);
  });

  it("下游含未知时 audit ≤ dev，且区间非零当且仅当可达 '?'", () => {
    const seed = mkChunk("seed", [], [UNKNOWN_TARGET]);
    const mid = mkChunk("mid", [], ["seed"]);
    const far = mkChunk("far", [], ["mid"]);
    const pure = mkChunk("pure", [], []);
    const { verdicts } = analyze([seed, mid, far, pure]);
    const by = new Map(verdicts.map((v) => [v.chunk.key, v]));
    expect(by.get("far")!.chainCertain).toBe(false);
    expect(by.get("pure")!.chainCertain).toBe(true);
    // audit 下 far 的 chain = 2（悲观），且 purity 不为 IMPURE（无真实效应）
    expect(by.get("far")!.chain).toBe(2);
    expect(by.get("far")!.purity).toBe(Purity.UNKNOWN);
  });
});

describe("维度6: 排序确定性", () => {
  it("输入乱序不影响输出顺序", () => {
    const a = mkChunk("a", ["io"], []);
    const b = mkChunk("b", [], ["a"]);
    const c = mkChunk("c", [], ["b"]);
    const r1 = analyze([a, b, c]).verdicts.map((v) => v.chunk.key);
    const r2 = analyze([c, b, a]).verdicts.map((v) => v.chunk.key);
    const r3 = analyze([b, a, c]).verdicts.map((v) => v.chunk.key);
    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });
});

describe("维度7: 效应并集传播", () => {
  it("多个效应源沿不同路径并集", () => {
    const io1 = mkChunk("io1", ["io"], []);
    const st1 = mkChunk("st1", ["state"], []);
    const top = mkChunk("top", [], ["io1", "st1"]);
    const { verdicts } = analyze([io1, st1, top]);
    const t = verdicts.find((v) => v.chunk.key === "top")!;
    expect(t.effects.has("io")).toBe(true);
    expect(t.effects.has("state")).toBe(true);
    expect(t.chain).toBe(1);
  });
});

describe("维度8: 自环", () => {
  it("自调用种子 chain=0，自调用非种子保持纯", () => {
    const s = mkChunk("s", ["io"], ["s"]);
    const p = mkChunk("p", [], ["p"]);
    const { verdicts } = analyze([s, p]);
    expect(verdicts.find((v) => v.chunk.key === "s")!.chain).toBe(0);
    expect(verdicts.find((v) => v.chunk.key === "p")!.purity).toBe(Purity.PURE);
  });
});
