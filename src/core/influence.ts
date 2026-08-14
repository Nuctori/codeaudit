import { type Chunk, UNKNOWN_TARGET, Purity, type Verdict } from "./types";
import { tarjan } from "./tarjan";

/**
 * 影响面分析（--unknowns 标注优先级的数学形式）。
 *
 * 定义：S(w) = w 的调用链下游中含 `?` 的未知源集（w 可到达的源）；源 u 的影响面
 * I(u) = {w : u ∈ S(w)}（u 反向可达闭包内的 chunk 集，按 chunk 计数）。
 * 标注 u 释放所有满足 S(w) ⊆ R 的 w 的 UNKNOWN——u 的影响面越大，
 * 一次标注解除的 UNKNOWN 越多。
 *
 * 计算：Tarjan 凝聚 DAG 上沿 callee 方向单趟传播 Down[k]（k 的调用链
 * 下游中的未知源集；未知沿调用边 callee→caller 传导，k 的 UNKNOWN
 * 依赖其下游源）。与效应传播同序（callee 分量下标小、先处理）。
 */
export interface AnnotationBudget {
  /** 源 chunk key → 影响面（标注解除的 chunk 数）。 */
  readonly influence: Map<string, number>;
  /** chunk key → 依赖的源 chunk 数 |S(w)|（0/缺省 = 无未知依赖）。 */
  readonly deps: Map<string, number>;
  /** 源 chunk key → 它解除的 chunk key 列表（I(u) 桶，标注曲线用）。 */
  readonly released: Map<string, string[]>;
}

export function annotationBudget(chunks: readonly Chunk[]): AnnotationBudget {
  const byKey = new Map(chunks.map((c) => [c.key, c]));
  const edges = new Map<string, Set<string>>();
  for (const c of chunks) {
    const s = new Set<string>();
    for (const t of c.calls) if (t !== UNKNOWN_TARGET && byKey.has(t)) s.add(t);
    edges.set(c.key, s);
  }

  // 逆拓扑：callee 分量下标更小（tarjan 契约）
  const sccs = tarjan(byKey.keys(), edges);
  const comp = new Map<string, number>();
  sccs.forEach((s, k) => s.forEach((i) => comp.set(i, k)));
  // succ[k] = 直接 callee 分量集（与效应传播同向）
  const succ: Array<Set<number>> = sccs.map(() => new Set<number>());
  sccs.forEach((s, k) => {
    for (const i of s)
      for (const t of edges.get(i)!)
        if (comp.get(t)! !== k) succ[k]!.add(comp.get(t)!);
  });

  const sourceOf = new Map<number, string[]>(); // 分量 → 含 `?` 的 chunk key 列表
  for (const c of chunks) {
    if (c.calls.has(UNKNOWN_TARGET)) {
      const k = comp.get(c.key)!;
      const arr = sourceOf.get(k) ?? [];
      arr.push(c.key);
      sourceOf.set(k, arr);
    }
  }

  // 沿 succ（callee）方向传播 Down[k] = k 及其调用链下游中的未知源分量集。
  const Down: Array<Set<number>> = sccs.map(() => new Set<number>());
  const inflByComp = new Map<number, number>();
  const reachByComp = new Map<number, string[]>(); // 源分量 → 受影响的 chunk keys
  for (let k = 0; k < sccs.length; k++) {
    const set = new Set<number>();
    if (sourceOf.has(k)) set.add(k);
    for (const s2 of succ[k]!) for (const s of Down[s2]!) set.add(s);
    Down[k] = set;
    for (const s of set) {
      inflByComp.set(s, (inflByComp.get(s) ?? 0) + sccs[k]!.length);
      const arr = reachByComp.get(s) ?? [];
      for (const key of sccs[k]!) arr.push(key);
      reachByComp.set(s, arr);
    }
  }

  // deps[w] = 影响 w 的源 chunk 总数（|S(w)| 按源 chunk 计；标注需把每个源都标掉）
  const srcCount = new Map<number, number>();
  for (const [k, keys] of sourceOf) srcCount.set(k, keys.length);
  const deps = new Map<string, number>();
  for (const c of chunks) {
    let n = 0;
    for (const s of Down[comp.get(c.key)!]!) n += srcCount.get(s) ?? 0;
    if (n > 0) deps.set(c.key, n);
  }

  // released[u] = 标注源 u 解除的 chunk keys（分量内多个源共享同一桶）
  const released = new Map<string, string[]>();
  for (const [s, keys] of sourceOf) {
    const affected = reachByComp.get(s) ?? [];
    for (const u of keys) released.set(u, affected);
  }

  const influence = new Map<string, number>();
  for (const [k, keys] of sourceOf) {
    const n = inflByComp.get(k) ?? 0;
    for (const key of keys) influence.set(key, n);
  }
  return { influence, deps, released };
}

/** 影响面视图（--unknowns 排序用）：源 chunk key → 影响面。 */
export function influenceAnalysis(chunks: readonly Chunk[]): Map<string, number> {
  return annotationBudget(chunks).influence;
}

/** 两次扫描的判定变化（diff 后影响分析，库 API）。 */
export interface VerdictDelta {
  readonly key: string;
  readonly file: string;
  readonly name: string;
  readonly purityFrom: number;
  readonly purityTo: number;
  readonly chainFrom: number;
  readonly chainTo: number;
  /** 新增效应类（如 diff 引入 fs）。 */
  readonly effectsAdded: readonly string[];
  /** 消失的效应类。 */
  readonly effectsRemoved: readonly string[];
}

/**
 * 对比两次扫描的判定（用户需求可解释性 2026-08-11）：purity/chain/effects 变化的 chunk 清单。
 * 典型用法：改动前扫一次、改动后扫一次 → compareReports → 哪些函数判定翻转/链变深。
 * 配合 analyzeChange（改动文件 → 受影响调用者）构成完整 diff 影响分析。
 */
export function compareReports(a: readonly { chunk: Chunk; purity: number; chain: number; effects: ReadonlySet<string> }[], b: readonly { chunk: Chunk; purity: number; chain: number; effects: ReadonlySet<string> }[]): VerdictDelta[] {
  const bm = new Map(b.map((v) => [v.chunk.key, v]));
  const out: VerdictDelta[] = [];
  const setsEqual = (x: ReadonlySet<string>, y: ReadonlySet<string>): boolean =>
    x.size === y.size && [...x].every((e) => y.has(e));
  for (const va of a) {
    const vb = bm.get(va.chunk.key);
    if (!vb) {
      // 被删除的 chunk（改动删了函数 / 内容寻址 key 变化 = 编辑视为删+增）——镜像新增发 delta（迭代7 Med1）
      out.push({
        key: va.chunk.key,
        file: va.chunk.file,
        name: va.chunk.name,
        purityFrom: va.purity,
        purityTo: -1,
        chainFrom: va.chain,
        chainTo: -1,
        effectsAdded: [],
        effectsRemoved: [...va.effects].sort(),
      });
      continue;
    }
    // 判定未变的 chunk（key 稳定且 purity/chain/effects 全同）不发 delta——输出契约是「变化的 chunk 清单」
    // （d9f2869 重构删除分支时误删此守卫，导致同判定 chunk 发 no-op edit delta，迭代8 对拍回归发现）
    if (va.purity === vb.purity && va.chain === vb.chain && setsEqual(va.effects, vb.effects)) continue;
    out.push({
      key: va.chunk.key,
      file: va.chunk.file,
      name: va.chunk.name,
      purityFrom: va.purity,
      purityTo: vb.purity,
      chainFrom: va.chain,
      chainTo: vb.chain,
      effectsAdded: [...vb.effects].filter((e) => !va.effects.has(e)).sort(),
      effectsRemoved: [...va.effects].filter((e) => !vb.effects.has(e)).sort(),
    });
  }
  // b 新增的 chunk（改动新增函数，纯新判定）
  const am = new Set(a.map((v) => v.chunk.key));
  for (const vb of b) {
    if (!am.has(vb.chunk.key)) {
      out.push({
        key: vb.chunk.key,
        file: vb.chunk.file,
        name: vb.chunk.name,
        purityFrom: -1,
        purityTo: vb.purity,
        chainFrom: -1,
        chainTo: vb.chain,
        effectsAdded: [...vb.effects].sort(),
        effectsRemoved: [],
      });
    }
  }
  out.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
  return out;
}

/** diff 影响面中的单个 chunk 条目。 */
export interface ImpactedChunk {
  /** 图内唯一键 file::id。 */
  readonly key: string;
  readonly file: string;
  /** 展示名（含 ownerClass 前缀，如 "Svc.save"）。 */
  readonly name: string;
  readonly line: number;
  /** 到最近改动 chunk 的调用层数（0 = 改动文件自身）。 */
  readonly depth: number;
  /** 影响路径首跳：到达本 chunk 路径上"我直接调用的被调用者" key（depth ≥ 1 时非空）。 */
  readonly via: string | null;
  /** via 对应 chunk 的展示名（可读证据；via 是内容哈希 key，配 name 给读者）。 */
  readonly viaName: string | null;
}

/** diff 影响面结果：改动文件的反向可达闭包（谁直接/传递调用了它们）。 */
export interface ChangeImpact {
  /** 改动文件直接包含的 chunk（depth 0）。 */
  readonly changed: readonly ImpactedChunk[];
  /** 受影响调用者（depth ≥ 1，按 depth 升序、key 字典序）。 */
  readonly affected: readonly ImpactedChunk[];
  readonly summary: {
    /** 匹配到 ≥1 个 chunk 的改动文件数。 */
    readonly changedFiles: number;
    /** 传入但未匹配任何 chunk 的改动文件数（路径形态不匹配/parseError/跳过——静默空结果的可观测标记）。 */
    readonly unmatchedFiles: number;
    readonly changedChunks: number;
    readonly affectedChunks: number;
    readonly maxDepth: number;
  };
}

/**
 * diff 影响面：给定改动文件集，返回其 chunk 的**反向可达闭包**（谁直接/传递调用了它们）。
 * depth = 到最近改动 chunk 的调用层数；via/viaName = 影响路径首跳上"本 chunk 直接调用的被调用者"
 * （证据：我调了什么才受影响）。与标注影响面（influence）同一反向闭包数学，方向互补——「改动 N 个函数，影响哪些调用者」。
 */
/**
 * UNKNOWN chunk key 集（S3，迭代14 视角 2）：verdicts 单遍过滤——risk/proof/cli 三处共享。
 */
export function unknownKeysOf(verdicts: readonly Verdict[]): Set<string> {
  const out = new Set<string>();
  for (const v of verdicts) if (v.purity === Purity.UNKNOWN) out.add(v.chunk.key);
  return out;
}

/**
 * 标注序比较器（S3，迭代14 视角 2）：released∩UNKNOWN 数降序 → influence 降序 → key 升序（公理5 确定性 tiebreak）。
 * proof 与 cli 共享——cli 平手序由 analyze 稳定序变 key asc，向公理 5 对齐。
 */
export function annotationCompare(
  budget: AnnotationBudget,
  unknownKeys: ReadonlySet<string>,
): (a: string, b: string) => number {
  return (a, b) => {
    const ra = (budget.released.get(a) ?? []).filter((x) => unknownKeys.has(x)).length;
    const rb = (budget.released.get(b) ?? []).filter((x) => unknownKeys.has(x)).length;
    if (ra !== rb) return rb - ra;
    const ia = budget.influence.get(a) ?? 0;
    const ib = budget.influence.get(b) ?? 0;
    if (ia !== ib) return ib - ia;
    return a < b ? -1 : a > b ? 1 : 0;
  };
}

export function changedImpact(
  verdicts: readonly { chunk: Chunk }[],
  changedFiles: ReadonlySet<string>,
): ChangeImpact {
  // 路径归一化：chunk.file 是正斜杠相对路径（D-031），调用方可能传 Windows 反斜杠 / ./ 前缀
  // → 归一化防静默空结果。语义约定：传相对 root 的路径均可；绝对路径不匹配（与 chunk.file 形态需一致）。
  const norm = new Set<string>();
  for (const f of changedFiles) norm.add(f.replace(/\\/g, "/").replace(/^\.\//, ""));
  const callers = new Map<string, string[]>(); // callee key → caller keys
  for (const v of verdicts) {
    for (const t of v.chunk.calls) {
      if (t === UNKNOWN_TARGET) continue;
      const arr = callers.get(t);
      if (arr) arr.push(v.chunk.key);
      else callers.set(t, [v.chunk.key]);
    }
  }
  // 公理5 确定性（审计迭代 58）：via/viaName 取 BFS 首现路径——邻接序随 verdicts 输入序
  // 变化会翻首现路径（两个改动 seed 同时可达同一 chunk 时）。邻接排序后 BFS 完全由图决定。
  for (const arr of callers.values()) arr.sort();
  const byKey = new Map(verdicts.map((v) => [v.chunk.key, v.chunk]));
  const seeds = verdicts
    .filter((v) => norm.has(v.chunk.file))
    .map((v) => v.chunk.key)
    .sort(); // 公理5：seed 序规范化（BFS 首现路径与输入序解耦）
  const seen = new Set<string>(seeds);
  const queue: Array<[string, number, string | null, string | null]> = seeds.map((k) => [k, 0, null, null]);
  const out: ImpactedChunk[] = [];
  for (let i = 0; i < queue.length; i++) {
    const [k, d, via, viaName] = queue[i]!;
    const c = byKey.get(k);
    if (c) out.push({ key: k, file: c.file, name: c.name, line: c.line, depth: d, via, viaName });
    for (const caller of callers.get(k) ?? []) {
      if (!seen.has(caller)) {
        seen.add(caller);
        queue.push([caller, d + 1, k, c?.name ?? null]);
      }
    }
  }
  out.sort((a, b) => a.depth - b.depth || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const changed = out.filter((x) => x.depth === 0);
  const affected = out.filter((x) => x.depth > 0);
  // 匹配口径 O(F+C)：chunk 文件集做差集（改动文件 = norm ∩ chunkFiles；未匹配 = 其余）
  const chunkFiles = new Set<string>();
  for (const v of verdicts) chunkFiles.add(v.chunk.file);
  let matchedFiles = 0;
  for (const f of norm) if (chunkFiles.has(f)) matchedFiles++;
  return {
    changed,
    affected,
    summary: {
      // 口径：含 ≥1 个 chunk 的改动文件数；unmatchedFiles = 路径形态不匹配/parseError/跳过（无 chunk 可分析）
      changedFiles: matchedFiles,
      unmatchedFiles: norm.size - matchedFiles,
      changedChunks: changed.length,
      affectedChunks: affected.length,
      maxDepth: affected.length > 0 ? affected[affected.length - 1]!.depth : 0,
    },
  };
}

/**
 * 标注曲线：按给定顺序（源 key 列表）逐条标注，返回每个前缀后的剩余 UNKNOWN 缺口。
 * 精确（非估计）：chunk w 在 S(w) ⊆ 已标注集时被释放；曲线[0] = 初始剩余，
 * 曲线[k] = 标注前 k 条后的剩余。标注顺序应取影响面贪心序（budget.influence 降序）。
 * target 限定计数对象（传当前 UNKNOWN chunk 集；缺省 = 全部有未知依赖的 chunk）。
 * weight（迭代14 视角 2 S2）：加权缺口——w 释放时扣 weight(w)（缺省 = 每项 1，即计数口径）。
 * 初值 = 全量累计 weight（**含 deps=0 的 UNKNOWN**——stale 边致 UNKNOWN 真实存在；
 * 只计 deps>0 会让 θ 在 stale 场景漂移，与 proof 口径不一致，视角 2 修正）。
 */
export function annotationCurve(
  budget: AnnotationBudget,
  order: readonly string[],
  target?: ReadonlySet<string>,
  weight?: ReadonlyMap<string, number>,
): number[] {
  const need = new Map(budget.deps);
  const counted = target ?? new Set(need.keys());
  let remaining = 0;
  for (const k of counted) remaining += weight?.get(k) ?? 1;
  const curve: number[] = [remaining];
  const annotated = new Set<string>();
  for (const u of order) {
    if (!annotated.has(u)) {
      annotated.add(u);
      for (const w of budget.released.get(u) ?? []) {
        if (!counted.has(w)) continue; // 目标之外的 chunk（IMPURE 带未知依赖）不计数
        const n = (need.get(w) ?? 0) - 1;
        need.set(w, n);
        if (n === 0) remaining -= weight?.get(w) ?? 1;
      }
    }
    curve.push(remaining);
  }
  return curve;
}
