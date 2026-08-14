/**
 * 项目治理派生视图（迭代56：codeaudit 能力圈内的低成本治理——全部复用 verdicts 现有数据，
 * 零新增扫描能力；与 topology/sources 同款 additive 设计，recheck 对旧产物自动生效）。
 *
 * 三个视图：
 * - duplicateGroups：重复代码（公理4 直接支撑——id = 内容哈希，id 相同且 key 不同 = 复制粘贴）
 * - testCoverage：测试盲区（Tests/ 目录调用闭包 ∩ 生产 chunks 的补集，按调用者数排序）
 * - deadChunks：疑似死代码（零调用者，排除 Unity 生命周期/事件订阅/反射入口等已知误报）
 */
import type { Verdict } from "./types";

/** 重复代码组：同内容（id）多实例（key 不同）。 */
export interface DupGroup {
	/** 内容哈希（公理4：id 相同 = 规范化源码逐字节相同）。 */
	readonly id: string;
	/** 实例数（= 复制粘贴次数 + 1 原始）。 */
	readonly instances: number;
	/** 代表实例（首个）。 */
	readonly name: string;
	readonly file: string;
	readonly line: number;
	/** 全部实例位置（文件:行）。 */
	readonly sites: readonly { readonly file: string; readonly line: number }[];
}

/** 测试盲区视图。 */
export interface TestCoverageView {
	/** 生产 chunk 总数（排除 Tests/ 目录）。 */
	readonly production: number;
	/** 被 Tests/ 目录直接或间接引用的生产 chunk 数。 */
	readonly covered: number;
	/** 覆盖比例（0..1）。 */
	readonly coverage: number;
	/** 未覆盖的生产 chunk（按调用者数降序）。 */
	readonly uncovered: readonly {
		readonly key: string;
		readonly name: string;
		readonly file: string;
		readonly line: number;
		/** 生产代码内调用者数（影响力代理——被引用越多、无测试越危险）。 */
		readonly callers: number;
	}[];
}

/** 死代码条目。 */
export interface DeadChunk {
	readonly key: string;
	readonly name: string;
	readonly file: string;
	readonly line: number;
	/** high = 非 public 且零调用者（静态图内确定无引用）；suspected = public 零调用者（反射/外部可能引用）。 */
	readonly confidence: "high" | "suspected";
}

/** 测试目录判定：路径含 /Tests/ 或 /tests/ 或 .Tests（Unity 约定；文件级伪块含 Tests/ 同样命中）。 */
export function isTestFile(file: string): boolean {
	// 目录名本身（Assets/Tests）与目录内文件（Tests/PlayMode/X.cs）都命中
	return (
		/(^|\/)(Tests|tests|test)(\/|$)/.test(file) || /\.Tests[\\/]/.test(file)
	);
}

/** 第一方判定：排除常见第三方/生成代码路径（治理视图的噪音源——InitDeity 实测 top 被 UniRx/API.g.cs 主导）。 */
const THIRD_PARTY_HINTS = [
	"LocalPackages/",
	"Plugins/",
	"/Packages/",
	".g.cs", // C# 生成代码（API.g.cs / ConfigTableAccessObjects）
	"node_modules/",
	"Library/",
];
export function isFirstParty(file: string): boolean {
	return !THIRD_PARTY_HINTS.some((h) => file.includes(h));
}

/** Unity 生命周期/消息方法（静态图看不到反射与引擎回调——零调用者不代表死代码）。 */
const UNITY_LIFECYCLE = new Set([
	"Awake",
	"Start",
	"OnEnable",
	"OnDisable",
	"OnDestroy",
	"OnGUI",
	"Update",
	"FixedUpdate",
	"LateUpdate",
	"OnAnimatorMove",
	"OnAnimatorIK",
	"OnApplicationFocus",
	"OnApplicationPause",
	"OnApplicationQuit",
	"OnTriggerEnter",
	"OnTriggerExit",
	"OnTriggerStay",
	"OnCollisionEnter",
	"OnCollisionExit",
	"OnCollisionStay",
	"OnMouseDown",
	"OnMouseUp",
	"OnMouseDrag",
	"OnMouseEnter",
	"OnMouseExit",
	"OnBecameVisible",
	"OnBecameInvisible",
	"OnDrawGizmos",
	"OnDrawGizmosSelected",
	"OnValidate",
	"Reset",
	"OnPreRender",
	"OnPostRender",
	"OnRenderImage",
	"OnParticleCollision",
	"OnJointBreak",
	"OnTransformChildrenChanged",
	"OnTransformParentChanged",
	"OnBeforeSerialize",
	"OnAfterDeserialize",
	"OnSceneLoaded",
	"OnSceneUnloaded",
	"OnAudioFilterRead",
]);

/** Unity 特性标记入口（[ContextMenu]/[SerializeField] 等——反射调用，静态图不可见）。 */
const UNITY_ATTR_HINTS = [
	"ContextMenu",
	"SerializeField",
	"Header",
	"RuntimeInitializeOnLoadMethod",
];

/**
 * 重复代码分组：id（内容哈希）相同且 key 不同的 chunk。
 * 公理4 保证 id 相同 = 规范化源码逐字节相同——复制粘贴检测零新增分析。
 */
export function duplicateGroups(verdicts: readonly Verdict[]): DupGroup[] {
	const byId = new Map<string, Verdict[]>();
	for (const v of verdicts) {
		const g = byId.get(v.chunk.id);
		if (g) g.push(v);
		else byId.set(v.chunk.id, [v]);
	}
	const groups: DupGroup[] = [];
	for (const [id, members] of byId) {
		if (members.length < 2) continue;
		const byKey = new Map<string, Verdict>();
		for (const m of members) byKey.set(m.chunk.key, m); // 同文件同内容 #n 后缀去重
		if (byKey.size < 2) continue;
		const first = members[0]!;
		groups.push({
			id,
			instances: byKey.size,
			name: first.chunk.name,
			file: first.chunk.file,
			line: first.chunk.line,
			sites: members.map((m) => ({ file: m.chunk.file, line: m.chunk.line })),
		});
	}
	return groups.sort(
		(a, b) => b.instances - a.instances || (a.file < b.file ? -1 : 1),
	);
}

/**
 * 测试盲区：生产 chunk 中被 Tests/ 目录（直接或经测试链）引用的比例。
 * 覆盖 = 测试 chunk 的调用闭包（含中间生产 chunk 的转发）——被测试间接调用也算覆盖。
 */
export function testCoverage(verdicts: readonly Verdict[]): TestCoverageView {
	const prod = new Map<string, Verdict>();
	const testKeys = new Set<string>();
	for (const v of verdicts) {
		if (isTestFile(v.chunk.file)) testKeys.add(v.chunk.key);
		else prod.set(v.chunk.key, v);
	}
	// 从测试 chunk 的调用目标出发 BFS（测试 chunk 自身不在 prod——起点 = 其 calls）
	const covered = new Set<string>();
	const queue: string[] = [];
	for (const v of verdicts) {
		if (!isTestFile(v.chunk.file)) continue;
		for (const t of v.chunk.calls) if (t !== "?") queue.push(t);
	}
	while (queue.length > 0) {
		const k = queue.pop()!;
		const v = prod.get(k);
		if (!v || covered.has(k)) continue;
		covered.add(k);
		for (const t of v.chunk.calls) {
			if (t !== "?" && !covered.has(t)) queue.push(t);
		}
	}
	// 生产内调用者数（影响力代理）
	const callers = new Map<string, number>();
	for (const v of prod.values()) {
		for (const t of v.chunk.calls) {
			if (t === "?" || !prod.has(t)) continue;
			callers.set(t, (callers.get(t) ?? 0) + 1);
		}
	}
	const uncovered = [...prod.values()]
		.filter((v) => !covered.has(v.chunk.key))
		.map((v) => ({
			key: v.chunk.key,
			name: v.chunk.name,
			file: v.chunk.file,
			line: v.chunk.line,
			callers: callers.get(v.chunk.key) ?? 0,
		}))
		.sort((a, b) => b.callers - a.callers || (a.file < b.file ? -1 : 1));
	const production = prod.size;
	const cov = covered.size;
	return {
		production,
		covered: cov,
		coverage: production > 0 ? cov / production : 1,
		uncovered,
	};
}

/**
 * 疑似死代码：零调用者的第一方 chunk。
 * 排除已知误报：Unity 生命周期/消息方法（引擎回调）、Unity 特性标记入口（反射）、
 * 类构造函数（new 动态创建）、测试文件自身（测试入口由 runner 调用）。
 */
export function deadChunks(verdicts: readonly Verdict[]): DeadChunk[] {
	const callers = new Set<string>();
	for (const v of verdicts) {
		for (const t of v.chunk.calls) if (t !== "?") callers.add(t);
	}
	const out: DeadChunk[] = [];
	for (const v of verdicts) {
		const c = v.chunk;
		if (callers.has(c.key)) continue;
		if (isTestFile(c.file)) continue;
		const shortName = c.name.includes(".")
			? c.name.slice(c.name.lastIndexOf(".") + 1)
			: c.name;
		if (UNITY_LIFECYCLE.has(shortName)) continue;
		// 排除合成/特殊 chunk：`<static-init>`（尖括号——迭代43 类型加载效应单元，
		// 曾误写 ".static-init" 失配导致永不命中——审计 blocker）、`.ctor`（构造器——
		// new 动态创建，静态图零调用者正常）、`<module>` 伪块
		if (
			shortName === "<static-init>" ||
			shortName === ".ctor" ||
			shortName === "<module>"
		)
			continue;
		if (UNITY_ATTR_HINTS.some((h) => c.name.includes(h))) continue;
		// public 判定：无可见性字段，用方法名首字母大写 + 非 Unity 约定成员粗略分——
		// C# 公开成员通常首字母大写；python 无 public 概念一律 suspected。
		// 注意（审计低危项）：PascalCase 惯例下 C# 公开方法全落 suspected——方向安全
		// （宁可疑不误删；高置信 = 小写/私有风格零调用者，可直接删）。
		const isUpper = /^[A-Z]/.test(shortName);
		out.push({
			key: c.key,
			name: c.name,
			file: c.file,
			line: c.line,
			confidence: isUpper ? "suspected" : "high",
		});
	}
	return out.sort((a, b) => (a.file < b.file ? -1 : 1) || a.line - b.line);
}
