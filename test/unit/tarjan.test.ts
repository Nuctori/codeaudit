import { describe, it, expect } from "vitest";
import { tarjan } from "../../src/core/tarjan";

function edgesOf(obj: Record<string, string[]>): Map<string, Set<string>> {
  return new Map(Object.entries(obj).map(([k, v]) => [k, new Set(v)]));
}

describe("tarjan", () => {
  it("DAG 上每个节点自成分量，且按逆拓扑序返回", () => {
    const sccs = tarjan(["a", "b", "c"], edgesOf({ a: ["b"], b: ["c"], c: [] }));
    expect(sccs.map((s) => s.sort())).toEqual([["c"], ["b"], ["a"]]);
  });

  it("环被凝聚为一个分量", () => {
    const sccs = tarjan(["a", "b", "c"], edgesOf({ a: ["b"], b: ["c"], c: ["a"] }));
    expect(sccs.length).toBe(1);
    expect(new Set(sccs[0])).toEqual(new Set(["a", "b", "c"]));
  });

  it("自环不导致重复或丢失", () => {
    const sccs = tarjan(["a"], edgesOf({ a: ["a"] }));
    expect(sccs).toEqual([["a"]]);
  });

  it("逆拓扑契约：跨分量边 u->v 时 v 的分量先出现", () => {
    const sccs = tarjan(
      ["a", "b", "c", "d", "e"],
      edgesOf({ a: ["b"], b: ["a", "c"], c: ["d"], d: ["e"], e: ["d"] }),
    );
    const compOf = new Map<string, number>();
    sccs.forEach((s, i) => s.forEach((n) => compOf.set(n, i)));
    const edges = edgesOf({ a: ["b"], b: ["a", "c"], c: ["d"], d: ["e"], e: ["d"] });
    for (const [u, ts] of edges) {
      for (const t of ts) {
        if (compOf.get(u) !== compOf.get(t)) {
          expect(compOf.get(t)!).toBeLessThan(compOf.get(u)!);
        }
      }
    }
  });

  it("大规模深链不爆栈（迭代实现）", () => {
    const n = 50_000;
    const nodes: string[] = [];
    const edges = new Map<string, Set<string>>();
    for (let i = 0; i < n; i++) {
      nodes.push("n" + i);
      edges.set("n" + i, new Set(i + 1 < n ? ["n" + (i + 1)] : []));
    }
    const sccs = tarjan(nodes, edges);
    expect(sccs.length).toBe(n);
  });
});
