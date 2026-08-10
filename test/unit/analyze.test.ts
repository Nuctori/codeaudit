import { describe, it, expect } from "vitest";
import { analyze } from "../../src/core/analyze";
import { Chunk, Purity, UNKNOWN_TARGET } from "../../src/core/types";

function mk(partial: Partial<Chunk> & { key: string }): Chunk {
  return {
    id: partial.key,
    name: partial.key,
    file: "f",
    line: 1,
    endLine: 2,
    nesting: 0,
    direct: new Set(),
    calls: new Set(),
    thrownTypes: [],
    ...partial,
  };
}

describe("analyze", () => {
  it("种子 chain=0，调用者 chain+1（最短距离）", () => {
    const io = mk({ key: "io", direct: new Set(["io"]) });
    const mid = mk({ key: "mid", calls: new Set(["io"]) });
    const top = mk({ key: "top", calls: new Set(["mid"]) });
    const { verdicts } = analyze([io, mid, top]);
    const by = new Map(verdicts.map((v) => [v.chunk.key, v]));
    expect(by.get("io")!.chain).toBe(0);
    expect(by.get("mid")!.chain).toBe(1);
    expect(by.get("top")!.chain).toBe(2);
    expect(by.get("top")!.purity).toBe(Purity.IMPURE);
  });

  it("调用环上的传染链终止且有限", () => {
    const a = mk({ key: "a", calls: new Set(["b"]) });
    const b = mk({ key: "b", calls: new Set(["a"]), direct: new Set(["io"]) });
    const { verdicts } = analyze([a, b]);
    for (const v of verdicts) {
      expect(Number.isFinite(v.chain)).toBe(true);
    }
  });

  it("无种子的环保持纯", () => {
    const a = mk({ key: "a", calls: new Set(["b"]) });
    const b = mk({ key: "b", calls: new Set(["a"]) });
    const { verdicts } = analyze([a, b]);
    expect(verdicts.every((v) => v.purity === Purity.PURE)).toBe(true);
    expect(verdicts.every((v) => v.chain === Infinity)).toBe(true);
  });

  it("未知符号：audit 与 dev 产生链长区间", () => {
    const u = mk({ key: "u", calls: new Set([UNKNOWN_TARGET]) });
    const caller = mk({ key: "caller", calls: new Set(["u"]) });
    const { verdicts } = analyze([u, caller]);
    const by = new Map(verdicts.map((v) => [v.chunk.key, v]));
    expect(by.get("u")!.purity).toBe(Purity.UNKNOWN);
    // audit 下 chain=0（未知当不纯），dev 下 Infinity → 区间非零 = 不确定
    expect(by.get("u")!.chainCertain).toBe(false);
    expect(by.get("caller")!.chainCertain).toBe(false);
  });

  it("排序是字典序：IMPURE 在前，chain 大者在前", () => {
    const io = mk({ key: "z-io", direct: new Set(["io"]) });
    const top = mk({ key: "a-top", calls: new Set(["z-io"]), nesting: 0 });
    const deep = mk({ key: "m-deep", calls: new Set(["a-top"]) });
    const pure = mk({ key: "pure" });
    const { verdicts } = analyze([io, top, deep, pure]);
    expect(verdicts[0]!.chunk.key).toBe("m-deep");   // chain=2
    expect(verdicts[1]!.chunk.key).toBe("a-top");    // chain=1
    expect(verdicts[2]!.chunk.key).toBe("z-io");     // chain=0
    expect(verdicts[3]!.purity).toBe(Purity.PURE);
  });

  it("多条路径取最短链", () => {
    const io = mk({ key: "io", direct: new Set(["io"]) });
    const detour = mk({ key: "detour", calls: new Set(["io"]) });
    const both = mk({ key: "both", calls: new Set(["io", "detour"]) });
    const { verdicts } = analyze([io, detour, both]);
    const by = new Map(verdicts.map((v) => [v.chunk.key, v]));
    expect(by.get("both")!.chain).toBe(1); // min(1, 1+1)
  });
});
