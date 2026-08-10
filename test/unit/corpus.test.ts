import { describe, it, expect } from "vitest";
import {
  emptyCorpus, updateCorpus, mergeCorpus, priorFor, summarize, siteShapeInfo, isCorpus,
  MIN_TOTAL, MIN_CELL, PRIOR_THRESHOLD,
} from "../../src/core/corpus";
import type { Chunk } from "../../src/core/types";

function chunk(id: string, sites: Array<{ attr: string; obj: string | null; root: string }>): Chunk {
  return {
    id, key: id, name: "f", file: "a.py", line: 1, endLine: 2, nesting: 0,
    direct: new Set(), calls: new Set(["?"]), unknownSites: sites.length,
    unknownCalls: sites,
  } as unknown as Chunk;
}

describe("标注语料（corpus）", () => {
  it("isCorpus 守卫：畸形语料（负计数/NaN/缺字段/字符串计数）全拒", () => {
    const v2 = (extra = {}) => ({ version: 2, seen: {}, method: {}, root: {}, cell: {}, ...extra });
    expect(isCorpus(v2())).toBe(true);
    expect(isCorpus(v2({ method: { get: { pure: 40, impure: 0 } } }))).toBe(true);
    expect(isCorpus(v2({ method: { get: { pure: 100, impure: -70 } } }))).toBe(false);
    expect(isCorpus(v2({ method: { get: { pure: "40", impure: 0 } } }))).toBe(false);
    expect(isCorpus(v2({ method: { get: { pure: NaN, impure: 0 } } }))).toBe(false);
    expect(isCorpus(v2({ method: null }))).toBe(false);
    expect(isCorpus(v2({ root: undefined }))).toBe(false);
    expect(isCorpus(v2({ cell: { x: { pure: 1, impure: -1 } } }))).toBe(false);
    expect(isCorpus(v2({ cell: undefined }))).toBe(false);
    expect(isCorpus(null)).toBe(false);
    expect(isCorpus({ version: 1, seen: {}, method: {}, root: {} })).toBe(false); // v1 旧语料拒（cell 缺失）
  });

  it("v2 cell 维度（继续做）：n 显示真格计数、LOO 精确——多 attr 共享 root 不虚高", () => {
    // 15 read/self PURE + 15 write/self IMPURE：root.self={15,15} 但 (read,self) 格 = {15,0}
    const chunks: Chunk[] = [];
    const ann = new Map<string, "PURE" | "IMPURE">();
    for (let i = 0; i < 15; i++) { chunks.push(chunk("r" + i, [{ attr: "read", obj: "f", root: "self" }])); ann.set("r" + i, "PURE"); }
    for (let i = 0; i < 15; i++) { chunks.push(chunk("w" + i, [{ attr: "write", obj: "f", root: "self" }])); ann.set("w" + i, "IMPURE"); }
    const c = updateCorpus(emptyCorpus(), chunks, ann);
    // cell 精确：read/self 格 15 条全 PURE → 建议 PURE（旧 root 边际语义被桶污染 → 无建议）
    const p = priorFor(c, { attr: "read", obj: "f", root: "self" });
    expect(p).not.toBeNull();
    expect(p!.n).toBe(15); // n = 真格计数（旧行为显示 root 桶 30）
    expect(p!.pPure).toBeGreaterThan(0.9);
  });

  it("file 锚定标注计入语料（F1 修复：updateCorpus 与 scan 回读同构）", () => {
    const c1 = chunk("idX", [{ attr: "get", obj: "req", root: "variable" }]);
    const c2 = chunk("idX", [{ attr: "get", obj: "req", root: "variable" }]);
    // 同内容跨文件，file 锚定标注只入账对应实例
    const ann = new Map<string, "PURE" | "IMPURE">([["a.py\u0000idX", "PURE"]]);
    const corpus = updateCorpus(emptyCorpus(), [c1, c2], ann);
    expect(corpus.method.get).toEqual({ pure: 1, impure: 0 }); // 只有 a.py 实例入账
    // 双键 seen（裸 id + file\0id）——换标注格式不重复入账（统计评审迭代2 #2）
    expect(corpus.seen).toEqual({ "a.py\u0000idX": true, idX: true });
    // 后续以裸 id 重标同 chunk → 已入账跳过（幂等跨格式）
    const ann2 = new Map<string, "PURE" | "IMPURE">([["idX", "IMPURE"]]);
    const again = updateCorpus(corpus, [c1], ann2);
    expect(again.method.get).toEqual({ pure: 1, impure: 0 }); // 不再入账
  });

  it("实例级去重门（迭代3 #3）：同内容跨文件异判定都入账", () => {
    const c1 = { ...chunk("idX", [{ attr: "get", obj: "req", root: "variable" }]), file: "f1.py" };
    const c2 = { ...chunk("idX", [{ attr: "get", obj: "req", root: "variable" }]), file: "f2.py" };
    const ann = new Map<string, "PURE" | "IMPURE">([
      ["f1.py\u0000idX", "PURE"],
      ["f2.py\u0000idX", "IMPURE"],
    ]);
    const corpus = updateCorpus(emptyCorpus(), [c1, c2], ann);
    expect(corpus.method.get).toEqual({ pure: 1, impure: 1 }); // 异判定观测都保留（修复前 IMPURE 被裸 id 门吞掉）
  });

  it("LOO 角冲突回退 null（迭代4 F2）：方法 50/50 + root 池纯 → 不制造虚假 PURE 建议", () => {
    // method.read=10/10（50/50 本应无建议）；root.variable 只收部分 impure（{24,5}，kCell=5 < 方法 impure=10）
    // → mImpureLOO=5、mTotalLOO=0（clamp 角）→ 修复前 thetaM=5/12≈0.42 方向失真 → 角守卫回退 null
    const chunks: Chunk[] = [];
    const ann = new Map<string, "PURE" | "IMPURE">();
    for (let i = 0; i < 10; i++) { chunks.push(chunk("r" + i, [{ attr: "read", obj: "f", root: "variable" }])); ann.set("r" + i, "PURE"); }
    for (let i = 0; i < 5; i++) { chunks.push(chunk("w" + i, [{ attr: "read", obj: "f", root: "variable" }])); ann.set("w" + i, "IMPURE"); }
    for (let i = 5; i < 10; i++) { chunks.push(chunk("w" + i, [{ attr: "read", obj: "f", root: "bare" }])); ann.set("w" + i, "IMPURE"); }
    for (let i = 0; i < 14; i++) { chunks.push(chunk("x" + i, [{ attr: "write", obj: "f", root: "variable" }])); ann.set("x" + i, "PURE"); }
    const c = updateCorpus(emptyCorpus(), chunks, ann);
    const p = priorFor(c, { attr: "read", obj: "f", root: "variable" });
    expect(p).toBeNull(); // 证据冲突 → 宁缺毋滥
  });

  it("parseError chunk 不计入语料（迭代4 F1）：scan 拒 PURE 与语料侧一致", () => {
    const c1 = { ...chunk("idX", [{ attr: "unknown", obj: "x", root: "variable" }]), parseError: true };
    const ann = new Map<string, "PURE" | "IMPURE">([["idX", "PURE"]]);
    const corpus = updateCorpus(emptyCorpus(), [c1], ann);
    expect(corpus.method.unknown).toBeUndefined(); // body 不可信的标注不得累积先验
  });

  it("siteShapeInfo：shape 取最大先验样本站点；batchable 要求全部站点高置信", () => {
    // 构造 40 条 get·variable PURE 语料
    const chunks: Chunk[] = [];
    const ann = new Map<string, "PURE" | "IMPURE">();
    for (let i = 0; i < 40; i++) {
      chunks.push(chunk("id" + i, [{ attr: "get", obj: "req", root: "variable" }]));
      ann.set("id" + i, "PURE");
    }
    const c = updateCorpus(emptyCorpus(), chunks, ann);
    // 单站点高置信 → batchable
    const single = siteShapeInfo(c, [{ attr: "get", obj: "req", root: "variable" }]);
    expect(single.batchable).toBe(true);
    expect(single.shape).toBe("get·variable");
    // 混合站点：一个无先验 → 不 batchable
    const mixed = siteShapeInfo(c, [
      { attr: "get", obj: "req", root: "variable" },
      { attr: "save", obj: "db", root: "variable" }, // save 无语料先验
    ]);
    expect(mixed.batchable).toBe(false);
    expect(mixed.shape).toBe("get·variable"); // 最大先验样本站点
  });

  it("updateCorpus 按 chunk.id 去重且按站点计数（幂等）", () => {
    const c1 = chunk("id1", [{ attr: "get", obj: "req", root: "variable" }, { attr: "save", obj: null, root: "bare" }]);
    const c2 = chunk("id2", [{ attr: "get", obj: "req", root: "variable" }]);
    const ann = new Map<string, "PURE" | "IMPURE">([
      ["id1", "PURE"],   // 2 站点 → method.get+1, method.save+1
      ["id2", "IMPURE"], // 1 站点 → method.get+1 impure
    ]);
    const c = updateCorpus(emptyCorpus(), [c1, c2], ann);
    expect(c.method.get).toEqual({ pure: 1, impure: 1 });
    expect(c.method.save).toEqual({ pure: 1, impure: 0 });
    expect(c.root.variable).toEqual({ pure: 1, impure: 1 });
    expect(c.seen).toEqual({ id1: true, id2: true });
    // 幂等：同一标注再跑不重复计数
    const c2x = updateCorpus(c, [c1, c2], ann);
    expect(c2x.method.get).toEqual({ pure: 1, impure: 1 });
  });

  it("mergeCorpus 计数求和、seen 并集", () => {
    const a = updateCorpus(emptyCorpus(), [chunk("a", [{ attr: "get", obj: null, root: "bare" }])],
      new Map([["a", "PURE"]]));
    const b = updateCorpus(emptyCorpus(), [chunk("b", [{ attr: "get", obj: null, root: "bare" }])],
      new Map([["b", "IMPURE"]]));
    const m = mergeCorpus(a, b);
    expect(m.method.get).toEqual({ pure: 1, impure: 1 });
    expect(m.seen).toEqual({ a: true, b: true });
  });

  it("冷启动：总样本 < MIN_TOTAL 不提供先验", () => {
    const c = updateCorpus(emptyCorpus(), [chunk("a", [{ attr: "get", obj: null, root: "bare" }])],
      new Map([["a", "PURE"]]));
    expect(summarize(c).total).toBe(1);
    expect(priorFor(c, { attr: "get", obj: null, root: "bare" })).toBeNull();
  });

  it("样本充分时按两层收缩给先验（PURE 侧）", () => {
    // 构造 40 个同形态 PURE 标注（method.get / root.bare）
    const chunks: Chunk[] = [];
    const ann = new Map<string, "PURE" | "IMPURE">();
    for (let i = 0; i < 40; i++) {
      chunks.push(chunk("id" + i, [{ attr: "get", obj: null, root: "bare" }]));
      ann.set("id" + i, "PURE");
    }
    const c = updateCorpus(emptyCorpus(), chunks, ann);
    const p = priorFor(c, { attr: "get", obj: null, root: "bare" })!;
    expect(p.n).toBe(40);
    expect(p.pPure).toBeGreaterThan(PRIOR_THRESHOLD); // 全 PURE → 建议 PURE
  });

  it("分歧形态（近 50/50）不提供建议", () => {
    const chunks: Chunk[] = [];
    const ann = new Map<string, "PURE" | "IMPURE">();
    for (let i = 0; i < 40; i++) {
      chunks.push(chunk("id" + i, [{ attr: "mixed", obj: null, root: "bare" }]));
      ann.set("id" + i, i % 2 === 0 ? "PURE" : "IMPURE");
    }
    const c = updateCorpus(emptyCorpus(), chunks, ann);
    expect(priorFor(c, { attr: "mixed", obj: null, root: "bare" })).toBeNull();
  });

  it("单格样本 < MIN_CELL 不提供建议", () => {
    // 总量足（40 条 get）但目标格（save）样本少
    const chunks: Chunk[] = [];
    const ann = new Map<string, "PURE" | "IMPURE">();
    for (let i = 0; i < 40; i++) {
      chunks.push(chunk("id" + i, [{ attr: i < 35 ? "get" : "save", obj: null, root: "bare" }]));
      ann.set("id" + i, "PURE");
    }
    const c = updateCorpus(emptyCorpus(), chunks, ann);
    expect(priorFor(c, { attr: "get", obj: null, root: "bare" })).not.toBeNull();
    expect(priorFor(c, { attr: "save", obj: null, root: "bare" })).toBeNull(); // n=5 < 10
  });
});
