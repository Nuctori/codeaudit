import { describe, it, expect } from "vitest";
import {
  emptyCorpus, updateCorpus, mergeCorpus, priorFor, summarize, siteShapeInfo, isCorpus, fitBaseRate,
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

  it("证据冲突回退 null（迭代4 F2 角守卫 → v2 分歧带）：方法 50/50 + 部分 root 证据 → 无建议", () => {
    // method.read=10/10（50/50 本应无建议）；(read,variable) 格={10,5} 而 method 其余 5 impure 在 (read,bare)
    // → v2 下角守卫不触发（cell 精确，mTotalLOO=5），经分歧带（pPure≈0.619∈(0.35,0.65)）→ null
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

describe("分层基率（fitBaseRate，迭代22）", () => {
  // 项目语料工厂：n 个 (pure, impure) 混合标注 → method.get = {pure, impure}
  function proj(pure: number, impure: number) {
    const chunks: Chunk[] = [];
    const ann = new Map<string, "PURE" | "IMPURE">();
    for (let i = 0; i < pure; i++) {
      chunks.push(chunk("p" + pure + "-" + i, [{ attr: "get", obj: null, root: "bare" }]));
      ann.set("p" + pure + "-" + i, "PURE");
    }
    for (let i = 0; i < impure; i++) {
      chunks.push(chunk("i" + impure + "-" + i, [{ attr: "get", obj: null, root: "bare" }]));
      ann.set("i" + impure + "-" + i, "IMPURE");
    }
    return updateCorpus(emptyCorpus(), chunks, ann);
  }

  it("T1 对拍手算：μ 加权均值、κ 方差反解", () => {
    // A=(30,10) n=40 θ̂=0.25；B=(40,40) n=80 θ̂=0.5；C=(10,70) n=80 θ̂=0.875
    // μ=(10+40+70)/200=0.6；Var=0.2·0.35²+0.4·0.1²+0.4·0.275²=0.05875；κ=0.24/0.05875−1≈3.0851
    const m = fitBaseRate([proj(30, 10), proj(40, 40), proj(10, 70)]);
    expect(m.mu).toBeCloseTo(0.6, 9);
    expect(m.kappa).toBeCloseTo(3.085106382978723, 9);
    expect(m.projects).toBe(3);
  });

  it("T2 单调性/加权主导：大样本项目主导，μ 在 [min, max] 内（不纯率语义，对齐 T1 手算）", () => {
    // A=(990,10) 不纯率 10/1000=0.01 n=1000、B=(1,1) 不纯率 0.5 n=2 →
    // μ=(10+1)/1002≈0.01098——被 A 主导（简单均值 0.255）
    const m = fitBaseRate([proj(990, 10), proj(1, 1)]);
    expect(m.mu).toBeCloseTo((10 + 1) / 1002, 9);
    // 向 A 追加 impure → 不纯率 μ 单调上升
    const m2 = fitBaseRate([proj(990, 50), proj(1, 1)]);
    expect(m2.mu).toBeGreaterThan(m.mu);
    // 随机多组计数：μ ∈ [min θ̂, max θ̂] 恒成立（θ̂ 为不纯率）
    for (let t = 0; t < 20; t++) {
      const ps = [proj(3 + t, 1), proj(10, 5 + t), proj(2, 8)];
      const mm = fitBaseRate(ps);
      const thetas = ps.map((c) => { const s = summarize(c); return (s.total - s.pure) / s.total; });
      expect(mm.mu).toBeGreaterThanOrEqual(Math.min(...thetas) - 1e-9);
      expect(mm.mu).toBeLessThanOrEqual(Math.max(...thetas) + 1e-9);
    }
  });

  it("T3 冷启动：<2 有计数项目（含空输入/空项目）→ 固定模型", () => {
    expect(fitBaseRate([])).toEqual({ mu: 0.25, kappa: 12, projects: 0 });
    expect(fitBaseRate([proj(500, 500)])).toEqual({ mu: 0.25, kappa: 12, projects: 0 }); // 单项目样本再大也冷启动
    expect(fitBaseRate([proj(500, 500), emptyCorpus()])).toEqual({ mu: 0.25, kappa: 12, projects: 0 }); // 空项目不计入
  });

  it("T3b 角情况：畸形语料过滤、全同率 κ 钳上限、κ<0 钳 0", () => {
    expect(fitBaseRate([proj(1, 0), { version: 1 } as never, proj(0, 1)])).toEqual(
      fitBaseRate([proj(1, 0), proj(0, 1)]),
    ); // 畸形语料被 isCorpus 过滤
    const same = fitBaseRate([proj(40, 0), proj(80, 0)]);
    expect(same.kappa).toBe(1e6); // Var=0 → 完全 pooling 钳上限
    const diff = fitBaseRate([proj(0, 40), proj(40, 0)]); // 两项目率 0/1 极端对立
    expect(diff.kappa).toBe(0); // 项目间差异 > Beta 可表达 → 无收缩
  });

  it("T4 接入生效：baseRate.mu 替代 GLOBAL_THETA0（冷单元格先验随 μ 移动）；缺省路径逐位一致", () => {
    // 目标项目：method.get 有 40 条全 PURE（够 MIN_CELL），但 cell 格 (get,bare) 只放 1 条 IMPURE →
    // nCell=1 < MIN_CELL → priorFor 返回 null……需要 cell ≥ MIN_CELL。构造：method.get 50 PURE、
    // (get,bare) 格 10 条中 9 PURE 1 IMPURE → 格证据弱，θ̂ 主要受方法级收缩影响
    const chunks: Chunk[] = [];
    const ann = new Map<string, "PURE" | "IMPURE">();
    for (let i = 0; i < 9; i++) {
      chunks.push(chunk("g" + i, [{ attr: "get", obj: null, root: "bare" }]));
      ann.set("g" + i, "PURE");
    }
    chunks.push(chunk("gx", [{ attr: "get", obj: null, root: "bare" }]));
    ann.set("gx", "IMPURE");
    for (let i = 0; i < 40; i++) {
      chunks.push(chunk("m" + i, [{ attr: "other", obj: null, root: "bare" }]));
      ann.set("m" + i, "PURE"); // 撑总量 ≥ MIN_TOTAL
    }
    const corpus = updateCorpus(emptyCorpus(), chunks, ann);
    const site = { attr: "get", obj: null, root: "bare" };
    const pDefault = priorFor(corpus, site)!;
    expect(pDefault).not.toBeNull();
    // 高不纯率模型（μ=0.6 不纯率）→ 方法级收缩更拉向 IMPURE → pPure 下降（μ=0.95 会落入分歧带 null，选 0.6 保持非空）
    const pHigh = priorFor(corpus, site, { mu: 0.6, kappa: 12, projects: 3 })!;
    expect(pHigh.pPure).toBeLessThan(pDefault.pPure);
    // 低不纯率模型（μ=0.05）→ pPure 上升
    const pLow = priorFor(corpus, site, { mu: 0.05, kappa: 12, projects: 3 })!;
    expect(pLow.pPure).toBeGreaterThan(pDefault.pPure);
    // 缺省路径与显式 0.25 模型逐位一致（向后兼容）
    const pExplicit = priorFor(corpus, site, { mu: 0.25, kappa: 0, projects: 0 })!;
    expect(pExplicit.pPure).toBe(pDefault.pPure);
  });
});
