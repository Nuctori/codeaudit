/**
 * 核心数据模型 —— 五条设计公理的载体。
 *
 * 公理1（边的守恒）：每个调用点恰归属一个 chunk（含文件级伪 chunk）。
 * 公理2（先凝聚后计算）：一切传播在 SCC 凝聚后的 DAG 上进行。
 * 公理3（纯度三值，未知不猜）：PURE / UNKNOWN / IMPURE，audit 开关决定未知倒向。
 * 公理4（身份即内容）：chunk.id = hash(规范化源码文本)，搬家改名不漂移。
 * 公理5（排序不混合量纲）：报告排序只用字典序。
 */

/** 图中表示"存在未解析调用"的哨兵目标。 */
export const UNKNOWN_TARGET = "?";

export enum Purity {
  PURE = 0,
  UNKNOWN = 1,
  IMPURE = 2,
}

/** 链接完成后的图节点（不可变）。 */
/**
 * 效应原子集（A7：Σ 有限效应原子集，LangPack 表声明；`?` 是知识标记非效应）。
 * 判定安全序不变：任何效应（含 state）→ IMPURE。
 * io = 未细分（console/process/环境/子进程…）；net = 网络；fs = 文件系统；db = 数据库；
 * random = 随机/熵；clock = 时钟读取；state = 状态写（self.x=/global/nonlocal，用户需求 2026-08-11）。
 */
export type Effect = "io" | "net" | "fs" | "db" | "random" | "clock" | "state";

export interface Chunk {
  /** 内容寻址身份：规范化源码文本的哈希。公理4。 */
  readonly id: string;
  /** 图内唯一键：file::id（同文件重复内容时追加 #n）。 */
  readonly key: string;
  /** 展示名，文件内限定名，如 "Svc.save"、"handle"。 */
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly endLine: number;
  /** 最大嵌套深度（空函数 = 0）。 */
  readonly nesting: number;
  /** 自身直接效应（Effect 原子集）；空集 = 无直接效应。 */
  readonly direct: ReadonlySet<Effect>;
  /** 已解析 callee 的 key 集合；含 UNKNOWN_TARGET 表示存在未解析调用。 */
  readonly calls: ReadonlySet<string>;
  /** 未解析调用点数（calls 中 `?` 是集合去重后的单哨兵；此处保留多重性，标注需全部确证）。 */
  readonly unknownSites: number;
  /** 未解析调用点的站点明细（标注语料：attr/obj + 接收者根类别）。 */
  readonly unknownCalls: ReadonlyArray<{ readonly attr: string; readonly obj: string | null; readonly root: string }>;
  /** 文件解析失败（tree-sitter 错误恢复可能吞边）——内容不可信，PURE 标注被拒、不计入语料（迭代4 F1）。 */
  readonly parseError?: boolean;
  /** 直接抛出的异常类型（raise ValueError / throw new Error() → "ValueError"/"Error"；裸 raise/throw → "*"）。 */
  readonly thrownTypes: readonly string[];
  /** 捕获的异常类型（catch {} / except X → "*"/类型名）。 */
  readonly catches: readonly string[];
  /** 状态写位置（self.x / user.status / global 名）；非空 → state 效应。 */
  readonly stateWrites: readonly string[];
  /** 读侧状态位置（self.x / user.status / ⊤）——stateDeps 传播原料（迭代8 视角2）。 */
  readonly stateReads: readonly string[];
}

export interface Verdict {
  readonly chunk: Chunk;
  readonly purity: Purity;
  /** 传播后的真实效应集（不含 "?"）。 */
  readonly effects: ReadonlySet<string>;
  /**
   * 到效应源的最短距离；Infinity = 纯。
   * audit 模式下的悲观值（未知视为不纯时算得）。
   */
  readonly chain: number;
  /** 链区间上界：dev（乐观）模式链（未知视为纯时算得）。区间 [chain, chainDev] 即未知翻案后的可能范围。 */
  readonly chainDev: number;
  /** 到效应源的最短路径（chunk key 数组，源在前；PURE 为空；audit 模式）——可解释性（用户需求 2026-08-11）。 */
  readonly chainPath: readonly string[];
  /** 本 chunk 或其调用链可能抛出的异常类型（保守传播，含自身直接抛的；盲区1）。 */
  readonly throwsTypes: readonly string[];
  /** 读且被项目内其他 chunk 写的状态位置（纯元数据；不进 purity/effects/chain，公理3；盲区3）。 */
  readonly stateDeps: readonly string[];
  /**
   * chain 是否确定：dev（乐观）与 audit（悲观）两遍结果一致时为 true。
   * false 表示结论依赖未知符号，需要标注。
   */
  readonly chainCertain: boolean;
}

export interface ScanStats {
  readonly files: number;
  /** 因大小超限/读取失败而跳过的文件数（用户知情，防静默欠报）。 */
  readonly skippedFiles: number;
  readonly parseErrors: number;
  readonly chunks: number;
  readonly pure: number;
  readonly impure: number;
  readonly unknown: number;
  /** 被拒标注（迭代21 数学解 A）：PURE 标注但 analyze 后判定非 PURE（未生效/矛盾）——逐实例报告防静默。 */
  readonly annotationRejected: readonly { id: string; file: string; reason: string }[];
  /** chain 不确定的 chunk 占比（0..1），工具对代码库的"无知程度"。 */
  readonly unknownRate: number;
  /** 强连通分量中大小 > 1 的个数（调用环数）。 */
  readonly cycles: number;
  readonly cachedFiles: number;
  /** 指向图中不存在目标的陈旧调用数（缓存漂移可致；>0 时图不完整）。 */
  readonly staleEdges: number;
  /** 传播不变量违规数（边单调性 purity(caller)≥purity(callee)、链三角）；0 = 不变量全部成立。 */
  readonly invariantViolations: number;
}

export interface ScanReport {
  readonly root: string;
  readonly mode: "audit" | "dev";
  readonly verdicts: Verdict[];
  readonly stats: ScanStats;
}
