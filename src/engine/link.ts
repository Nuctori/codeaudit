import {
	type LangPack,
	type RawCall,
	type RawChunk,
	type RawFileFacts,
	type RawImport,
	type FileEventInfo,
	UNRESOLVED_TARGET,
} from "../lang/pack";
import { classifyUsage, type EffectTableUsage } from "../core/effectUsage";
import { type Chunk, UNKNOWN_TARGET, type Effect } from "../core/types";
import { chunkId } from "../core/hash";

/**
 * 链接器：把每个文件的裸调用名解析为全局限定 chunk key。
 *
 * 解析优先级（从高到低）：
 *   1. self/this 方法 → 所在类的方法
 *   2. 同文件定义
 *   3. import 映射 → 项目内文件（含再导出跟随）
 *   4. 效应表（内置/模块/全局对象 → 直接效应或丢弃）
 *   5. 未知 → "?"（公理3：不猜）
 */

interface FileIndex {
	readonly facts: RawFileFacts;
	readonly pack: LangPack;
	/** 文件内限定名 -> chunk key："Svc.save"、"handle"。 */
	readonly byQualified: Map<string, string>;
	/** 文件内限定名 -> 全部候选 chunk keys（多定义/重载全集——迭代37 P1-3 并集边）。 */
	readonly byQualifiedAll: Map<string, string[]>;
	/** 限定名冲突（同名重载/多态）→ 解析时记未知，不静默选一。 */
	readonly ambiguous: ReadonlySet<string>;
	/** 裸名 -> chunk keys（可能多个：方法名与顶层函数同名）。 */
	readonly bySimple: Map<string, string[]>;
	readonly importMap: Map<string, RawImport>;
	/** 星号导入/再导出的目标文件。 */
	readonly wildcards: string[];
	/** 文件级绑定名（module chunk 的 assigned：模块级赋值/重绑遮蔽所有消费者）。 */
	readonly moduleAssigned: ReadonlySet<string>;
	readonly chunkByKey: Map<string, RawChunk>;
	/** 迭代43 B：类事件表（类名 → 事件名 → 订阅信息）——事件触发通道（fireEvent）消费。 */
	readonly events?: Readonly<
		Record<string, Readonly<Record<string, FileEventInfo>>>
	>;
}

/** 迭代39：类层次上下文（import 解析通道复用 resolveClassMember 的参数束）。 */
interface HierarchyCtx {
	globalClasses: ReadonlyMap<
		string,
		{ file: string; key: string; lang: string }[]
	>;
	superMap: ReadonlyMap<string, ReadonlySet<string>>;
	hasSubclass: ReadonlySet<string>;
	langHasDynamicExtends: ReadonlySet<string>;
	virtualMembers: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface LinkOutput {
	readonly chunks: Chunk[];
	/** 效应表使用率（迭代21 数学解 B——link 期计数，scan 装配为 stats.effectTableUsage）。 */
	readonly effectTableUsage: EffectTableUsage[];
}

export function link(
	allFacts: readonly RawFileFacts[],
	packs: ReadonlyMap<string, LangPack>,
): LinkOutput {
	const projectFiles = new Set(allFacts.map((f) => f.file));
	const idOf = new WeakMap<RawChunk, string>(); // 公理4 id 每 chunk 只哈希一次（M2 性能：双算 sha256 浪费）

	// 末段路径索引（M2）：绝对导入候选按最后一段查，免每 distinct 模块全扫 F 文件（O(F×M_distinct) → O(F+M)）
	const byLast = new Map<string, string[]>();
	for (const f of projectFiles) {
		const seg = f.slice(f.lastIndexOf("/") + 1);
		const arr = byLast.get(seg);
		if (arr) arr.push(f);
		else byLast.set(seg, [f]);
	}

	// resolveModule 调用内 memo（纯函数：projectFiles 本次 link 恒定；键含 pack 名防跨语言串味；null 也缓存）。
	// 绝对导入（非 ./ 相对）解析结果与 fromFile 无关——键去 fromFile，防 Python 绝对导入 O(F×P) 退化（10k 文件 × 10k 次全扫）
	const resMemo = new Map<string, string | null>();
	const resolveMod = (
		pack: LangPack,
		module: string,
		fromFile: string,
	): string | null => {
		const k = module.startsWith(".")
			? pack.name + "\u0000" + module + "\u0000" + fromFile
			: pack.name + "\u0000" + module;
		const hit = resMemo.get(k);
		if (hit !== undefined) return hit;
		const v = pack.resolveModule(module, fromFile, projectFiles, byLast);
		resMemo.set(k, v);
		return v;
	};

	// ---- 第一遍：建立每个文件的符号索引 ----
	const files = new Map<string, FileIndex>();

	for (const facts of allFacts) {
		const pack = packs.get(facts.lang)!;
		const byQualified = new Map<string, string>();
		const byQualifiedAll = new Map<string, string[]>(); // 迭代37 P1-3：全候选（并集边消费）
		const ambiguous = new Set<string>();
		const bySimple = new Map<string, string[]>();
		const chunkByKey = new Map<string, RawChunk>();
		const seenIds = new Map<string, number>();

		for (const rc of facts.chunks) {
			// 公理4：id 永远是纯内容身份；唯一性后缀只加在图键 key 上。
			// module 伪 chunk 无源码，id 用文件限定（否则所有文件的 module chunk 共享 "module"，标注会泄漏）
			const baseId =
				rc.name === "<module>" ? `module@${facts.file}` : chunkId(rc.normText);
			idOf.set(rc, baseId);
			const n = (seenIds.get(baseId) ?? 0) + 1;
			seenIds.set(baseId, n);
			const key = `${facts.file}::${n > 1 ? `${baseId}#${n}` : baseId}`;
			const qualified = rc.ownerClass ? `${rc.ownerClass}.${rc.name}` : rc.name;
			const existing = byQualified.get(qualified);
			if (existing !== undefined) ambiguous.add(qualified);
			else byQualified.set(qualified, key);
			const all = byQualifiedAll.get(qualified) ?? [];
			all.push(key);
			byQualifiedAll.set(qualified, all);
			const arr = bySimple.get(rc.name) ?? [];
			arr.push(key);
			bySimple.set(rc.name, arr);
			chunkByKey.set(key, rc);
		}

		const importMap = new Map<string, RawImport>();
		const wildcards: string[] = [];
		for (const imp of facts.imports) {
			if (imp.local === "*") {
				const target = resolveMod(pack, imp.module, facts.file);
				if (target !== null) wildcards.push(target);
				continue;
			}
			importMap.set(imp.local, imp);
		}

		// 同名解析优先级：顶层函数 > 类方法（裸名调用更可能指顶层）
		for (const arr of bySimple.values()) {
			arr.sort((a, b) => {
				const am = chunkByKey.get(a)!.ownerClass !== null ? 1 : 0;
				const bm = chunkByKey.get(b)!.ownerClass !== null ? 1 : 0;
				return am - bm;
			});
		}

		const moduleAssigned = new Set(
			facts.chunks.find((c) => c.name === "<module>")?.assigned ?? [],
		);

		files.set(facts.file, {
			facts,
			pack,
			byQualified,
			byQualifiedAll,
			ambiguous,
			bySimple,
			importMap,
			wildcards,
			chunkByKey,
			moduleAssigned,
			events: facts.events, // 迭代43 B：类事件表（fireEvent 消费）
		});
	}

	// 全局类名索引（迭代19 C# 跨文件类调用）：类 chunk 名 → (file, key, lang) 列表——
	// C# namespace 可见性让 obj=类名 可在任何文件解析（File/GameObject 等已在效应表，项目内类走此表）。
	// **语言隔离（迭代19 复审 F1）**：条目带 pack 名，解析时只查同语言——C# 类名撞 Python 类不串味
	const globalClasses = new Map<
		string,
		{ file: string; key: string; lang: string }[]
	>();
	for (const [file, fi] of files) {
		for (const rc of fi.facts.chunks) {
			if (rc.kind !== "class") continue;
			// class chunk 的 bySimple 键 = rc.name（顶层类）；多文件同名类 → 列表（歧义处理在调用侧）
			const keys = fi.bySimple.get(rc.name);
			if (!keys || keys.length === 0) continue;
			const arr = globalClasses.get(rc.name) ?? [];
			arr.push({ file, key: keys[0]!, lang: fi.pack.name });
			globalClasses.set(rc.name, arr);
		}
	}

	// 迭代43 r2：static-init 单元映射（类名 → 合成 chunk keys 数组）——类型加载效应独立判定。
	// 合成 chunk（name="<static-init>"，ownerClass=类名）由 extractor 生成，link 侧按名识别。
	// **多值并集**（审计 blocker）：C# partial 类多文件 static 初始化器——单值 Map 互相覆盖
	// 前序文件效应漏报（假纯方向 S1）；与 globalClasses 多文件同名类全候选处理（G5）对齐。
	const staticInitKey = new Map<string, string[]>();
	for (const fi of files.values()) {
		for (const rc of fi.facts.chunks) {
			if (rc.name === "<static-init>" && rc.ownerClass) {
				const k = fi.bySimple.get(rc.name)?.find((key) => {
					const c = fi.chunkByKey.get(key);
					return c?.ownerClass === rc.ownerClass;
				});
				if (k) {
					const kk = `${fi.pack.name}\u0000${rc.ownerClass}`;
					const arr = staticInitKey.get(kk) ?? [];
					arr.push(k);
					staticInitKey.set(kk, arr);
				}
			}
		}
	}

	// 迭代38 A：继承层次（per-lang）。superMap 键 `${lang}\u0000${cls}`（同名类跨文件基类并集，规则2）；
	// hasSubclass = 被项目类继承的名字（H6 守卫 + 多态降级）；langHasDynamicExtends = 语言存在动态 extends → 多态 ? （规则3）。
	const superMap = new Map<string, Set<string>>();
	const hasSubclass = new Set<string>();
	const langHasDynamicExtends = new Set<string>();
	// 迭代39 B7：virtual 族方法（per-lang 合并，同名类并集）
	const virtualMembers = new Map<string, Set<string>>();
	for (const fi of files.values()) {
		if (fi.facts.hasDynamicExtends) langHasDynamicExtends.add(fi.pack.name);
		if (fi.facts.virtualMembers) {
			for (const [cls, ms] of Object.entries(fi.facts.virtualMembers)) {
				const vk = `${fi.pack.name}\u0000${cls}`;
				let vs = virtualMembers.get(vk);
				if (!vs) {
					vs = new Set();
					virtualMembers.set(vk, vs);
				}
				for (const m of ms) vs.add(m);
			}
		}
		if (!fi.facts.classExtends) continue;
		for (const [cls, bases] of Object.entries(fi.facts.classExtends)) {
			const k = `${fi.pack.name}\u0000${cls}`;
			let s = superMap.get(k);
			if (!s) {
				s = new Set();
				superMap.set(k, s);
			}
			for (const b of bases) {
				s.add(b);
				hasSubclass.add(`${fi.pack.name}\u0000${b}`);
			}
		}
	}

	// ---- 符号解析（含再导出跟随，深度受限） ----
	const resolveSymbol = (
		file: string,
		name: string,
		depth: number,
	): string | null => {
		if (depth > 6) return null;
		const fi = files.get(file);
		if (!fi) return null;
		const direct = fi.bySimple.get(name);
		if (direct && direct.length > 0) return direct[0]!;
		const q = fi.byQualified.get(name);
		if (q && !fi.ambiguous.has(name)) return q;
		// 导入跟随：Python 语义下模块内绑定的名字即可作为属性再导出；
		// TS 的显式 reexport 与普通 import 都走这里（深度受限防环）
		for (const imp of fi.facts.imports) {
			if (imp.local !== name && imp.local !== "*") continue;
			if (imp.imported === null) continue; // 命名空间在调用侧解析；别名/再导出（imported 可为别名）按 imported 跟随
			const target = resolveMod(fi.pack, imp.module, file);
			if (target === null) continue;
			const importedName =
				imp.imported === "*" || imp.imported === null ? name : imp.imported;
			const hit = resolveSymbol(target, importedName, depth + 1);
			if (hit !== null) return hit;
		}
		return null;
	};

	// ---- 第二遍：解析调用、计算直接效应 ----
	const out: Chunk[] = [];
	// 效应表使用率计数（迭代21 数学解 B）：hit=槽位命中，miss=槽位咨询未中（module 未中 1:1 对应未知站点）
	const tableHit = new Map<string, number>();
	const tableMiss = new Map<string, number>();
	const bump = (m: Map<string, number>, k: string): void => {
		m.set(k, (m.get(k) ?? 0) + 1);
	};

	for (const [file, fi] of files) {
		for (const [key, rc] of fi.chunkByKey) {
			const direct = new Set<Effect>();
			const calls = new Set<string>();
			// 迭代39 B10：link 期新增写位置（参数容器 mutate）——出站时与 facts.stateWrites 合并
			const extraStateWrites: string[] = [];
			let unknownSites = 0; // `?` 多重性：calls 是 Set 只记一个 `?`，此处记未解析调用点数
			const unknownCalls: Array<{
				attr: string;
				obj: string | null;
				root: string;
			}> = [];

			// 接收者根类别（标注语料的条件维度）：字面量 / 裸名 / self / 框架命名空间 / 变量
			const rootOf = (call: RawCall): string => {
				if (call.receiver !== null) return `literal:${call.receiver}`;
				if (call.obj === null) return "bare";
				if (fi.pack.selfNames.includes(call.obj)) return "self";
				if (Object.hasOwn(fi.pack.frameworkIo, call.obj))
					return `frame:${call.obj}`;
				return "variable";
			};

			const effectFromModule = (
				rawModule: string,
				member: string | null,
			): boolean => {
				const module = effectModuleName(rawModule, fi.pack); // node:fs ≡ fs（语言数据，迭代39）
				const rule = fi.pack.impureModules[module];
				// 迭代33 TP4 修复：effectFromModule 是 sink 构造（L244 加前缀）之前的独立闭包——
				// 5 处 bump 必须同样加 pack 前缀，否则 module 命中键无前缀 → classifyUsage 按 pack 过滤后
				// 全语言消失（Med-High：hits 低估/corpus-inactive 高估，污染效应表使用率审计）。
				const mk = `${fi.pack.name}\u0000module:${module}`;
				if (typeof rule === "string") {
					// 模块整体效应类（fs: "fs"、http: "net"、sqlite3: "db"…）
					direct.add(rule);
					bump(tableHit, mk);
					return true;
				}
				if (Array.isArray(rule) && member !== null) {
					// 两级成员链前缀回退（迭代18 旧宇宙驱动）：os.environ.get → 逐级查 "environ.get"→"environ"
					// （environ 在表=io——环境变量映射整体访问）；os.path.join → "path.join" 命中 :p
					const parts = member.split(".");
					for (let i = parts.length; i >= 1; i--) {
						const prefix = parts.slice(0, i).join(".");
						if (rule.includes(prefix)) {
							direct.add("io");
							bump(tableHit, mk);
							return true;
						}
						// 成员带效应类后缀（"randomBytes:random" / "now:clock"）或纯标记（"member:p"）
						const tagged = rule.find((r) => r.startsWith(prefix + ":"));
						if (tagged) {
							const cls = tagged.slice(prefix.length + 1);
							if (cls === "p") {
								bump(tableHit, mk);
								return true;
							}
							direct.add(cls as Effect);
							bump(tableHit, mk);
							return true;
						}
					}
				}
				if (fi.pack.pureModules.has(module)) {
					bump(tableHit, mk);
					return true;
				}
				return false;
			};

			for (const call of rc.calls) {
				// 迭代33 TP4：效应表记账按语言分桶（pack 前缀键）——classifyUsage 按 pack 过滤，
				// 消除"5 个 pack 行输出同一数据"的误导（纯 C# 语料下 python 行显示 37292 咨询未中）。
				const pk = fi.pack.name;
				resolveCall(
					call,
					rc,
					fi,
					files,
					projectFiles,
					resolveSymbol,
					resolveMod,
					globalClasses,
					superMap,
					hasSubclass,
					langHasDynamicExtends,
					virtualMembers,
					staticInitKey,
					{
						addEdge: (k) => calls.add(k),
						addEffect: (e) => direct.add(e),
						markUnknown: () => {
							unknownSites++;
							calls.add(UNKNOWN_TARGET);
						},
						markDynamic: () => {
							unknownSites++;
							calls.add(UNKNOWN_TARGET);
						},
						hitTable: (k) => bump(tableHit, `${pk}\u0000${k}`),
						missTable: (k) => bump(tableMiss, `${pk}\u0000${k}`),
						addUnknownCall: (call) =>
							unknownCalls.push({
								attr: call.attr,
								obj: call.obj,
								root: rootOf(call),
							}),
						addArgEdges: (names, hof, unconditional = false) => {
							for (const n of names) {
								// 成员形回调：this.log / self.render → 当前类的同名方法（HOF 成员形假纯修复）
								const dotIdx = n.indexOf(".");
								if (
									dotIdx !== -1 &&
									rc.ownerClass &&
									fi.pack.selfNames.includes(n.slice(0, dotIdx))
								) {
									const q = `${rc.ownerClass}.${n.slice(dotIdx + 1)}`;
									if (!fi.ambiguous.has(q)) {
										const hit = fi.byQualified.get(q);
										if (hit) {
											calls.add(hit);
											continue;
										}
									} else {
										// 迭代37 P1-3 并集边：成员形回调撞名（重载）→ 全候选不静默跳过
										const cands = fi.byQualifiedAll.get(q);
										if (cands) for (const k of cands) calls.add(k);
									}
									continue;
								}
								const local = fi.bySimple.get(n);
								if (local && local.length > 0) {
									calls.add(local[0]!);
									continue;
								}
								const imp = fi.importMap.get(n);
								if (
									imp &&
									imp.imported !== null &&
									imp.imported !== "default" &&
									imp.imported !== "*"
								) {
									const target = resolveMod(fi.pack, imp.module, fi.facts.file);
									if (target !== null) {
										const hit = resolveSymbol(target, imp.imported, 0);
										if (hit !== null) {
											calls.add(hit);
											continue;
										}
									}
								}
								// 迭代53：C# 隐式 this 裸名方法组实参（Enumerable.ForEach(xs, Save)）——
								// HOF 回调边通道补齐：此前靠参数位 prop-read 误发射兜底（iter30-32 测试依赖），
								// 参数位 prop-read 停发后此处必须自持；edges=已解析、unknown=落回下方无条件未知。
								if (fi.pack.implicitThis && rc.ownerClass) {
									const r = resolveClassMember(
										rc.ownerClass,
										n,
										fi.pack,
										files,
										globalClasses,
										superMap,
										hasSubclass,
										langHasDynamicExtends,
										virtualMembers,
										{ addEdge: (k: string) => calls.add(k) } as unknown as Sink,
										true,
									);
									if (r === "edges") continue;
								}
								// 无条件调用实参的 HOF（map/filter/forEach…）：实参未解析 → 记未知（防假纯，
								// 如 const f = writeFileSync; [1].map(f)）；条件调用（sorted key=/Array.from cb）
								// 的实参未解析 → 跳过（无法区分 max(xs) 与 map(ext_fn)，记未知会误伤噪音）
								// 迭代32：unconditional=true（frameworkPure 成员级 hof/纯命中且 argFns 非空）时
								// 无条件记 ?——linqHof 表删除后该语义由本参数承担（iter31 HIGH-1 差集洞结构性关闭）。
								// 迭代31 记账修复：走完整记账（unknownSites++ + unknownCalls）——与 markUnknown 一致，
								// 恢复 scan.ts L272 不变量 calls.has("?") === (unknownSites > 0)。
								if (unconditional || fi.pack.hofAlwaysArgs.has(hof)) {
									calls.add(UNKNOWN_TARGET);
									unknownSites++;
									unknownCalls.push({
										attr: call.attr,
										obj: call.obj,
										root: rootOf(call),
									});
								}
							}
						},
						effectFromModule,
						addStateWrite: (pos) => {
							extraStateWrites.push(pos);
						},
					},
				);
			}

			// 构造器体效应并入 class chunk（S1 修复）：class C 的构造器在实例化时执行，
			// 其 io 必须传播到 class chunk（否则 `def f(): return C()` 判纯但运行时构造器写 io → 假纯）。
			// 迭代40 P0-3 H01：构造器 chunk 名走 pack 数据（Python __init__ / TS constructor；
			// C# ctor 名 = 类名走 resolveClassMember isCtor 分支，不填）
			if (rc.kind === "class" && fi.pack.ctorChunkNames) {
				for (const [k, c2] of fi.chunkByKey) {
					if (
						c2.ownerClass === rc.name &&
						fi.pack.ctorChunkNames.includes(c2.name)
					) {
						calls.add(k);
					}
				}
			}

			// 状态写（用户需求 2026-08-11）：self.x = / this.x = / global、nonlocal 声明 → state 效应——
			// 函数只改全局/实例状态不再判 PURE（S1 假纯漏报闭合）
			if (rc.stateWrites.length > 0) direct.add("state");

			out.push({
				// 公理4：id 由内容直接重算，与 key 的去重后缀无关（module 用文件限定 id）
				id:
					idOf.get(rc) ??
					(rc.name === "<module>" ? `module@${file}` : chunkId(rc.normText)),
				key,
				name: rc.ownerClass ? `${rc.ownerClass}.${rc.name}` : rc.name,
				file,
				line: rc.line,
				endLine: rc.endLine,
				nesting: rc.nesting,
				complexity: rc.complexity, // 迭代44-r4：MCCabe 近似透传
				kind: rc.kind, // 迭代44-r4：--complexity 类级排除
				direct,
				calls,
				unknownSites,
				unknownCalls,
				thrownTypes: rc.thrownTypes,
				catches: rc.catches,
				stateReads: rc.stateReads,
				stateWrites:
					extraStateWrites.length > 0
						? [...rc.stateWrites, ...extraStateWrites]
						: rc.stateWrites,
			});
		}
	}

	return {
		chunks: out,
		effectTableUsage: classifyUsage(packs, tableHit, tableMiss),
	};
}

interface Sink {
	addEdge(key: string): void;
	addEffect(effect: Effect): void;
	markUnknown(): void;
	markDynamic(): void;
	/** 效应表槽位命中（迭代21 B）：slot 形如 module:fs / global:Debug / builtin:print。 */
	hitTable(slot: string): void;
	/** 效应表槽位咨询未中（miss——module 类 1:1 对应未知站点，补表候选）。 */
	missTable(slot: string): void;
	addUnknownCall(call: RawCall): void;
	addArgEdges(
		names: readonly string[],
		hof: string,
		unconditional?: boolean,
	): void;
	/** 迭代39 B10：记录 mutate 写位置（参数容器变异 → stateDeps 可见，--state 耦合图补齐）。 */
	addStateWrite(pos: string): void;
	effectFromModule(module: string, member: string | null): boolean;
}

// 命名空间导入解析（迭代36 r2 从 resolveImport 抽出——机械拆分，行为不变）
function resolveNamespaceImport(
	call: RawCall,
	caller: RawChunk,
	fi: FileIndex,
	pack: LangPack,
	imp: RawImport,
	resolveMod: (
		pack: LangPack,
		module: string,
		fromFile: string,
	) => string | null,
	resolveSymbol: (file: string, name: string, depth: number) => string | null,
	sink: Sink,
): boolean {
	const member = call.obj !== null ? call.attr : null;
	const target = resolveMod(pack, imp.module, fi.facts.file);
	if (target !== null) {
		if (member !== null) {
			const hit = resolveSymbol(target, member, 0);
			if (hit !== null) {
				sink.addEdge(hit);
				return true;
			}
			// 点连成员：import a.b; a.b.fn() → callOf 首点切分得 obj=a、attr=b.fn，
			// 全名 a.b.fn 去掉模块路径 a.b 后的段（fn）在模块内解析（遮蔽重绑则跳过）
			if (call.obj !== null && !caller.assigned.includes(call.obj)) {
				const full = `${call.obj}.${call.attr}`;
				if (full.startsWith(imp.module + ".")) {
					const inner = full.slice(imp.module.length + 1);
					const hit2 = resolveSymbol(target, inner, 0);
					if (hit2 !== null) {
						sink.addEdge(hit2);
						return true;
					}
				}
			}
		}
		sink.addUnknownCall(call);
		sink.markUnknown();
		return true;
	}
	// 两级成员链（迭代18 旧宇宙驱动）：os.environ.get → 效应表查全链 "environ.get"
	// （effectFromModule 前缀回退命中 "environ"=io）；os.path.join → "path.join":p
	const effMember =
		call.obj !== null && call.obj.startsWith(imp.module + ".")
			? `${call.obj.slice(imp.module.length + 1)}.${call.attr}`
			: member;
	if (effMember !== null && sink.effectFromModule(imp.module, effMember)) {
		if (pack.hofCallsArgs.has(effMember))
			sink.addArgEdges(call.argFns, effMember); // functools.reduce(cb, …)
		return true;
	}
	if (sink.effectFromModule(imp.module, null)) return true;
	sink.missTable(`module:${imp.module}`); // 迭代21 B：module 咨询未中 = 补表候选
	sink.addUnknownCall(call);
	sink.markUnknown();
	return true;
}

// from 裸名导入解析（迭代36 r2 从 resolveImport 抽出——机械拆分，行为不变）
function resolveFromBareImport(
	call: RawCall,
	fi: FileIndex,
	files: ReadonlyMap<string, FileIndex>,
	pack: LangPack,
	imp: RawImport,
	resolveMod: (
		pack: LangPack,
		module: string,
		fromFile: string,
	) => string | null,
	resolveSymbol: (file: string, name: string, depth: number) => string | null,
	sink: Sink,
): boolean {
	const target = resolveMod(pack, imp.module, fi.facts.file);
	if (target !== null) {
		const name =
			imp.imported === "default"
				? (files.get(target)?.facts.defaultExport ?? imp.imported!)
				: imp.imported!;
		const hit = resolveSymbol(target, name, 0);
		if (hit !== null) {
			sink.addEdge(hit);
			return true;
		}
		sink.addUnknownCall(call);
		sink.markUnknown();
		return true;
	}
	if (sink.effectFromModule(imp.module, imp.imported!)) {
		// HOF 实参回调边（与命名空间分支对称）：from functools import reduce; reduce(write, xs) → write 效应保留
		if (pack.hofCallsArgs.has(imp.imported!))
			sink.addArgEdges(call.argFns, imp.imported!);
		return true;
	}
	sink.missTable(`module:${imp.module}`); // 迭代21 B
	sink.addUnknownCall(call);
	sink.markUnknown();
	return true;
}

// from 对象导入解析
// from db import conn; conn.execute(...) → 模块导出面解析：类成员真边；外部模块走效应表；重绑遮蔽则跳过
function resolveFromObjectImport(
	call: RawCall,
	caller: RawChunk,
	fi: FileIndex,
	files: ReadonlyMap<string, FileIndex>,
	pack: LangPack,
	imp: RawImport,
	resolveMod: (
		pack: LangPack,
		module: string,
		fromFile: string,
	) => string | null,
	resolveSymbol: (file: string, name: string, depth: number) => string | null,
	hctx: HierarchyCtx,
	sink: Sink,
): boolean {
	if (call.obj !== null && !caller.assigned.includes(call.obj)) {
		const target = resolveMod(pack, imp.module, fi.facts.file);
		const name =
			imp.imported === "default"
				? target !== null
					? (files.get(target)?.facts.defaultExport ?? imp.imported!)
					: imp.imported!
				: imp.imported!;
		if (target !== null) {
			const tf = files.get(target);
			if (tf) {
				const q = `${name}.${call.attr}`;
				if (addUnionEdges(tf, q, sink)) return true;
				// 模块级值绑定：export const db = new Pool() → 绑定名解析到类 → 类成员真边
				const boundCls = Object.hasOwn(tf.facts.moduleBindings, name)
					? tf.facts.moduleBindings[name]
					: undefined;
				if (boundCls) {
					// 迭代39 B9：接继承——精确构造 polymorphic=false（祖先闭包并集，无后代守卫）
					const r = resolveClassMember(
						boundCls,
						call.attr,
						pack,
						files,
						hctx.globalClasses,
						hctx.superMap,
						hctx.hasSubclass,
						hctx.langHasDynamicExtends,
						hctx.virtualMembers,
						sink,
						false,
					);
					if (r === "edges") return true;
					// 表外方法 → 落后续（ns 再导出链/效应表/?）
				}
				// 命名空间再导出链：ns 在 target 里是 export * as ns from → 继续解析 attr
				const nsImp = tf.importMap.get(name);
				if (nsImp && nsImp.imported === null) {
					const t2 = resolveMod(pack, nsImp.module, target);
					if (t2 !== null) {
						const hit2 = resolveSymbol(t2, call.attr, 0);
						if (hit2 !== null) {
							sink.addEdge(hit2);
							return true;
						}
					}
				}
			}
		} else if (sink.effectFromModule(imp.module, call.attr)) {
			if (pack.hofCallsArgs.has(call.attr))
				sink.addArgEdges(call.argFns, call.attr); // _.map(cb, xs)
			return true;
		}
	}
	sink.addUnknownCall(call);
	sink.markDynamic();
	return true;
}

function resolveImport(
	call: RawCall,
	caller: RawChunk,
	fi: FileIndex,
	files: ReadonlyMap<string, FileIndex>,
	_projectFiles: ReadonlySet<string>,
	resolveSymbol: (file: string, name: string, depth: number) => string | null,
	resolveMod: (
		pack: LangPack,
		module: string,
		fromFile: string,
	) => string | null,
	hctx: HierarchyCtx,
	sink: Sink,
): boolean {
	const pack = fi.pack;
	const binding = call.obj ?? call.attr;
	const imp = fi.importMap.get(binding);
	if (
		imp &&
		!caller.assigned.includes(binding) &&
		!fi.moduleAssigned.has(binding)
	) {
		if (imp.imported === null) {
			return resolveNamespaceImport(
				call,
				caller,
				fi,
				pack,
				imp,
				resolveMod,
				resolveSymbol,
				sink,
			);
		}
		if (call.obj === null) {
			return resolveFromBareImport(
				call,
				fi,
				files,
				pack,
				imp,
				resolveMod,
				resolveSymbol,
				sink,
			);
		}
		return resolveFromObjectImport(
			call,
			caller,
			fi,
			files,
			pack,
			imp,
			resolveMod,
			resolveSymbol,
			hctx,
			sink,
		);
	}

	return false;
}

/** 迭代37 P1-3 重载并集边（数学命题 3/4）：同限定名多定义（重载/重复定义）→ 对**全候选**建边。
 *  效应 = ∪ 闭包：S1（PURE ⟺ ∀i eff=∅）、S2（∪ ⊇ 真分派）、S3（min 链 ≤ 真分派链）可证保持；
 *  禁止任选/单候选定选（命题 1：无支配信息时任意选可假纯——C# int/string 同 arity 重载不可消歧）。
 *  返回是否建了边（false = 无候选，调用方落 ? 诚实）。 */
function addUnionEdges(tf: FileIndex, q: string, sink: Sink): boolean {
	if (!tf.ambiguous.has(q)) {
		const hit = tf.byQualified.get(q);
		if (hit) {
			sink.addEdge(hit);
			return true;
		}
		return false;
	}
	const cands = tf.byQualifiedAll.get(q);
	if (!cands || cands.length === 0) return false;
	for (const k of cands) sink.addEdge(k);
	return true;
}

/** 迭代39：模块说明符规范化——语言数据驱动的前缀别名（JS/TS "node:" ≡ 无前缀）。引擎零语言常量。 */
function effectModuleName(rawModule: string, pack: LangPack): string {
	let m = rawModule;
	for (const p of pack.stripModulePrefixes ?? [])
		if (m.startsWith(p)) m = m.slice(p.length);
	return m;
}

/** 迭代39：祖先闭包（visited 截断环；多继承取并集）。resolveClassMember 与 ctor 分支共用。 */
function ancestorClosureOf(
	cls: string,
	pack: LangPack,
	superMap: ReadonlyMap<string, ReadonlySet<string>>,
): Set<string> {
	const reach = new Set<string>([cls]);
	const stack = [cls];
	while (stack.length > 0) {
		const bases = superMap.get(`${pack.name}\u0000${stack.pop()!}`);
		if (!bases) continue;
		for (const b of bases) {
			if (!reach.has(b)) {
				reach.add(b);
				stack.push(b);
			}
		}
	}
	return reach;
}

/** 迭代40 M6：类字段名存在性（本类 + 祖先闭包内任一文件的 memberNames 命中）。
 *  仅 TS/JS 提取（memberNameNodes）；C# 无 memberNames → 恒 false（propMissIsPure 已覆盖）。
 *  JS 语义：无 getter 声明的字段读取无副作用（读不存在属性 = undefined）→ 判纯。 */
function memberNameExists(
	cls: string,
	name: string,
	pack: LangPack,
	files: ReadonlyMap<string, FileIndex>,
	globalClasses: ReadonlyMap<
		string,
		{ file: string; key: string; lang: string }[]
	>,
	superMap: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
	for (const c of ancestorClosureOf(cls, pack, superMap)) {
		const entries = globalClasses.get(c);
		if (!entries) continue;
		for (const e of entries) {
			if (e.lang !== pack.name) continue;
			const tf = files.get(e.file);
			if (tf?.facts.memberNames?.[c]?.includes(name)) return true;
		}
	}
	return false;
}

/** 迭代45 C1 反例修复：attr 是否为 ownerClass 的成员（C# 属性/方法——限定名索引命中）。
 *  仅 C# 语义下启用（bareNameMeansThisInMethod：隐式 this 可裸写/裸读类成员）——
 *  TS/JS/Python 无隐式 this 属性读，裸名读永远是局部/模块级，短路判纯无洞。
 *  C# 侧判定 = byQualified/ambiguous 限定名 `${cls}.${attr}` 命中（B5 属性 chunk 建了限定名）；
 *  字段不产 chunk（无 getter，读纯——prop-miss 已覆盖）→ 不命中 → 短路保留。
 *  返回 true = 是类成员 → 短路点不判纯（落回既有解析：属性 chunk 边 / ?）。 */
function isClassMemberName(
	cls: string,
	name: string,
	pack: LangPack,
	files: ReadonlyMap<string, FileIndex>,
	globalClasses: ReadonlyMap<
		string,
		{ file: string; key: string; lang: string }[]
	>,
	superMap: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
	for (const c of ancestorClosureOf(cls, pack, superMap)) {
		const entries = globalClasses.get(c);
		if (!entries) continue;
		for (const e of entries) {
			if (e.lang !== pack.name) continue;
			const tf = files.get(e.file);
			if (!tf) continue;
			const q = `${c}.${name}`;
			if (tf.byQualified.has(q) || tf.ambiguous.has(q)) return true;
		}
	}
	return false;
}

/** 迭代38 A + 迭代39 B7：类成员解析（继承/多态最小健全版）。
 *  polymorphic=true（self/隐式 this/参数接收者）：运行时对象可能是 cls 的子类——
 *  后代守卫：Python/JS 一切方法多态（pack.polymorphicMethods）→ cls ∈ hasSubclass 即降 "unknown"；
 *  C# 仅 virtual 族（L4：非 virtual 静态分派精确）——首声明层 virtual → 降；语言存在动态 extends → 降。
 *  polymorphic=false（构造器 class:/lb）：精确构造 → 无后代守卫。
 *  impls = {cls} ∪ ancestors(cls) 中**全部**直接声明 method 的类（规则1：全并集，禁最近层——
 *  Python 多继承 MRO 反例：最近层并集是欠近似）；同名类跨文件并集（规则2）。
 *  返回 "edges"（已建边）/ "unknown"（守卫降级，调用方记 ?）/ "none"（闭包无声明，调用方继续或 ?）。 */
function resolveClassMember(
	cls: string,
	method: string,
	pack: LangPack,
	files: ReadonlyMap<string, FileIndex>,
	globalClasses: ReadonlyMap<
		string,
		{ file: string; key: string; lang: string }[]
	>,
	superMap: ReadonlyMap<string, ReadonlySet<string>>,
	hasSubclass: ReadonlySet<string>,
	langHasDynamicExtends: ReadonlySet<string>,
	virtualMembers: ReadonlyMap<string, ReadonlySet<string>>,
	sink: Sink,
	polymorphic: boolean,
): "edges" | "unknown" | "none" {
	if (polymorphic && langHasDynamicExtends.has(pack.name)) return "unknown";
	const reach = ancestorClosureOf(cls, pack, superMap);
	/** c（同名并集内任一同语言文件）是否直接声明 method（含重载多定义）。 */
	const declares = (c: string): boolean => {
		const entries = globalClasses.get(c);
		if (!entries) return false;
		for (const e of entries) {
			if (e.lang !== pack.name) continue;
			const tf = files.get(e.file);
			if (!tf) continue;
			const q = `${c}.${method}`;
			if (tf.byQualified.has(q) || tf.ambiguous.has(q)) return true;
		}
		return false;
	};
	if (polymorphic && hasSubclass.has(`${pack.name}\u0000${cls}`)) {
		if (pack.polymorphicMethods !== false) return "unknown"; // Python/JS：一切方法原型分派
		// 迭代39 L4（B7）：C# virtual 族才降——非 virtual 静态分派精确。首声明层 = BFS 最近层；
		// 层内任一声明为 virtual 族（virtual/override/abstract，无 sealed）→ 降 ?。
		// 单接口基类隐含 virtual 的残余记 B13（base_list 无法区分接口与类）。
		let frontier: string[] = [cls];
		const seen = new Set<string>(frontier);
		while (frontier.length > 0) {
			let levelDeclared = false;
			let levelVirtual = false;
			const next: string[] = [];
			for (const c of frontier) {
				if (declares(c)) {
					levelDeclared = true;
					if (virtualMembers.get(`${pack.name}\u0000${c}`)?.has(method))
						levelVirtual = true;
				}
				const bases = superMap.get(`${pack.name}\u0000${c}`);
				if (bases)
					for (const b of bases)
						if (!seen.has(b)) {
							seen.add(b);
							next.push(b);
						}
			}
			if (levelDeclared) {
				if (levelVirtual) return "unknown";
				break;
			}
			frontier = next;
		}
	}
	let anyDeclaring = false;
	// ctor 解析（method === cls）：每个类 c 的构造器限定名是 `${c}.${c}`（C# ctor 名 = 类名），
	// 非入口类统一 method（多态同名）。
	const isCtor = method === cls;
	for (const c of reach) {
		const entries = globalClasses.get(c);
		if (!entries) continue;
		for (const e of entries) {
			if (e.lang !== pack.name) continue;
			const tf = files.get(e.file);
			if (!tf) continue;
			const q = isCtor ? `${c}.${c}` : `${c}.${method}`;
			if (tf.byQualified.has(q) || tf.ambiguous.has(q)) {
				anyDeclaring = true;
				addUnionEdges(tf, q, sink);
			}
		}
	}
	return anyDeclaring ? "edges" : "none";
}

/** 迭代40 C1：构造调用分派（0.5 分支，自 resolveCall 拆分——行为零变化）。
 *  规则：① impureGlobals 类型键 → 对应效应（FileStream:fs/Random:random/WaitForSeconds:clock 免费复用）；
 *  ② 项目类（globalClasses 单命中且 !ambiguous）→ 边到 **ctor chunk**（constructor_declaration，
 *    byQualified "Type.Type"——禁止走 bySimple 裸名分支（错边到 class chunk 丢构造体效应 = 假纯））；
 *    **项目类优先于 pureCtor 名单**（迭代34 独立审计 Med：项目自建类撞 List/Color/Uri 等名单名且构造体
 *    有 io → 先查 pureCtor 会假纯，红线方向）。
 *    注（迭代36 独立审计 Low）：ctor 分支 impureGlobals 在项目类**之前**，与常规 obj 分支
 *    （globalClasses 在 impureGlobals 前）顺序不同——项目类撞 impureGlobals 键（Debug/FileStream 等）
 *    时构造形态走效应表、成员调用形态走项目类边；行为有界（效应表键有限且构造即效应语义可辩），记录不修；
 *  ③ 纯构造清单（pureCtor）→ 纯；④ 其余框架类型 → ? 诚实（未列类型默认不纯，绝不给"未知皆纯"）。
 *  恒消费（true）。 */
function resolveCtorCall(
	call: RawCall,
	t: string,
	caller: RawChunk,
	fi: FileIndex,
	files: ReadonlyMap<string, FileIndex>,
	pack: LangPack,
	globalClasses: ReadonlyMap<
		string,
		{ file: string; key: string; lang: string }[]
	>,
	superMap: ReadonlyMap<string, ReadonlySet<string>>,
	hasSubclass: ReadonlySet<string>,
	langHasDynamicExtends: ReadonlySet<string>,
	virtualMembers: ReadonlyMap<string, ReadonlySet<string>>,
	staticInitKey: ReadonlyMap<string, string[]>,
	sink: Sink,
): boolean {
	const rule = Object.hasOwn(pack.impureGlobals, t)
		? pack.impureGlobals[t]
		: undefined;
	if (typeof rule === "string") {
		sink.addEffect(rule);
		sink.hitTable(`ctor:${t}`);
		return true;
	}
	if (Array.isArray(rule)) {
		// 迭代34 独立审计 Low：当前 csharp impureGlobals 全为 string 值（数组形态仅 python impureModules）——
		// 本分支对 ctor（仅 C# 产生）不可达，是防御代码。构造即整体效应 → 保守 io。
		sink.addEffect("io");
		sink.hitTable(`ctor:${t}`);
		return true;
	}
	// 项目类构造（优先于 pureCtor——防假纯）：边到 ctor chunk（含基类构造器并集——C# 基类 ctor 必执行；
	// Python 不自动调基类 __init__ 但并集是过近似方向安全，迭代38 A）。
	if (!caller.assigned.includes(t) && !fi.moduleAssigned.has(t)) {
		const r = resolveClassMember(
			t,
			t,
			pack,
			files,
			globalClasses,
			superMap,
			hasSubclass,
			langHasDynamicExtends,
			virtualMembers,
			sink,
			false,
		);
		// 迭代39 L5：构造器效应 = 闭包内显式 ctor（resolveClassMember 并集）∪ 字段初始化器——
		// 闭包内**全部** class chunk 原始调用并集（含基类字段初始化器；C# 静态初始化器在实例化路径
		// 上执行，并入是过近似，S2 方向安全）。**并集必须先于 r==="edges" return**（显式 ctor +
		// 字段初始化器并存时不得漏字段初始化器效应——独立审计 FAIL 反例）。
		const clsEntries = globalClasses.get(t);
		let bodyEdges = 0;
		for (const c of ancestorClosureOf(t, pack, superMap)) {
			const entries = globalClasses.get(c);
			if (!entries) continue;
			for (const e of entries) {
				if (e.lang !== pack.name) continue;
				const tf = files.get(e.file);
				const rc = tf?.chunkByKey.get(e.key);
				// rc.calls 是原始调用（facts）——含字段初始化器调用；ctor-merge 边在 link 输出侧，不在此
				if (rc && rc.calls.length > 0) {
					sink.addEdge(e.key);
					bodyEdges++;
				}
				// 迭代43 r2：static-init 单元（类型加载效应）——new C() 触发类型加载 → 并集 staticInit；
				// **必须计入 bodyEdges**（工程评审 E2：隐式纯分支 1000-1007 在 bodyEdges>0 时提前 return——
				// 否则 `class C { static int X = ReadFile(); }` + new C() 翻 PURE 假纯）。
				// 仅静态拆分语言（C# staticModifiers 存在）；其他语言 class chunk 已含类体调用。
				const sks = staticInitKey.get(`${pack.name}\u0000${c}`);
				if (sks) {
					for (const sk of sks) {
						sink.addEdge(sk);
						bodyEdges++;
					}
				}
			}
		}
		if (r === "edges" || bodyEdges > 0) {
			sink.hitTable(`ctor:${t}`);
			return true;
		}
		// 隐式默认构造（C# 隐式 ctor 只链 base()）：充分条件 = 闭包无显式 ctor（r === "none"）
		// ∧ 闭包全部 class chunk 零原始调用（无字段初始化器效应）——前提成立才判纯。
		if (
			r === "none" &&
			clsEntries &&
			clsEntries.some((c) => c.lang === pack.name)
		) {
			sink.hitTable(`ctor:${t}:p`);
			return true;
		}
	}
	if (pack.pureCtor && pack.pureCtor.has(t)) {
		sink.hitTable(`ctor:${t}:p`);
		return true;
	}
	sink.missTable(`ctor:${t}`); // 未列框架类型/歧义 → 补表候选 + 诚实 ?
	sink.addUnknownCall(call);
	sink.markUnknown();
	return true;
}

/** 迭代40 C1：对象方法分派（4. 效应表 else 分支，自 resolveCall 拆分——行为零变化）。
 *  通道序：A1 参数类型（项目类/内建表+H6+mutate）→ lb 局部绑定 → 全局类 → impureGlobals/pureGlobals。
 *  返回是否已消费（true = 调用方 return）。 */
function resolveObjDispatch(
	call: RawCall,
	caller: RawChunk,
	fi: FileIndex,
	files: ReadonlyMap<string, FileIndex>,
	pack: LangPack,
	globalClasses: ReadonlyMap<
		string,
		{ file: string; key: string; lang: string }[]
	>,
	superMap: ReadonlyMap<string, ReadonlySet<string>>,
	hasSubclass: ReadonlySet<string>,
	langHasDynamicExtends: ReadonlySet<string>,
	virtualMembers: ReadonlyMap<string, ReadonlySet<string>>,
	staticInitKey: ReadonlyMap<string, string[]>,
	sink: Sink,
): boolean {
	// 调用方已保证 call.obj !== null（裸名走 impureBuiltins 分支）——此处收窄类型
	if (call.obj === null) return false;
	// 迭代35 A1：参数显式类型绑定——obj 是参数且类型已知（Dictionary<string,int> d → d.TryGetValue）
	// → 查 builtinTypeEffects（List/Dictionary/array 的 Add/Remove/TryGetValue 等纯读写信箱）。
	// 迭代36 独立审计 High 修复：项目类名撞表键（项目自建 List/Dictionary 类作参数类型）→ 跳过表绑定
	// ——与 ctor 分支同守卫。否则 `xs.Add`（xs 参数类型为项目 List 类）误判 PURE（假纯红线）。
	// 仅当参数未遮蔽（assigned 无同名重绑）。
	// 迭代40 M6：prop 链式读取（u.name.length 的 obj="u.name"）→ 类型查询取接收者根首段
	const ptype = caller.paramTypes?.[(call.obj ?? "").split(".")[0]!];
	// 迭代40 P0-3：参数豁免——参数名在 assigned（防 import 遮蔽，四·五 #6），但显式类型标注
	// （A1）是声明事实，不应被遮蔽守卫误挡（参数声明非重绑；重绑场景与基线行为一致）。
	if (
		ptype !== undefined &&
		(!caller.assigned.includes(call.obj ?? "") ||
			caller.params.includes(call.obj ?? ""))
	) {
		// 迭代40 M6：对象字面量类型（TS `{name?: string}`）——属性读取恒纯（类型字面量属性
		// 是数据字段无 getter）；必须在 isProject 之前（__objectLiteral 不是项目类）
		if (ptype === "__objectLiteral" && call.prop) {
			sink.hitTable(`type:${ptype}.${call.attr}`);
			return true;
		}
		const pcls = globalClasses.get(ptype);
		const isProject =
			pcls && pcls.length > 0 && pcls.some((c) => c.lang === pack.name);
		if (
			isProject &&
			!caller.assigned.includes(ptype) &&
			!fi.moduleAssigned.has(ptype)
		) {
			// 迭代38 A：参数类型为项目类 → 继承+多态解析（祖先并集 + 子类覆写守卫降 ?）
			const r = resolveClassMember(
				ptype,
				call.attr,
				pack,
				files,
				globalClasses,
				superMap,
				hasSubclass,
				langHasDynamicExtends,
				virtualMembers,
				sink,
				true,
			);
			if (r === "edges") {
				sink.hitTable(`type:${ptype}.${call.attr}`);
				return true;
			}
			if (r === "unknown") {
				sink.addUnknownCall(call);
				sink.markUnknown();
				return true;
			}
			// 迭代40 B5：参数类型类成员 miss + 属性读取 → 纯（字段/自动属性；C# 静态语义，
			// 与 self/全局类分支同论证）。方法调用 miss 保持 ?（诚实）。
			// 迭代40 B5/M6：参数类型类成员 miss + 属性读取 → 纯（C# 静态语义 propMissIsPure；
			// TS/JS 查 memberNames 字段清单；__objectLiteral = 对象字面量类型属性读取恒纯）。
			// 方法调用 miss 保持 ?。
			if (
				call.prop &&
				(ptype === "__objectLiteral" ||
					pack.propMissIsPure ||
					memberNameExists(
						ptype,
						call.attr,
						pack,
						files,
						globalClasses,
						superMap,
					))
			) {
				sink.hitTable(`type:${ptype}.${call.attr}`);
				return true;
			}
		} else {
			// 迭代38 H6：内建子类守卫——项目内存在 extends ptype 的类（可能覆写 m）→ 表判定不健全 → ?
			if (hasSubclass.has(`${pack.name}\u0000${ptype}`)) {
				sink.addUnknownCall(call);
				sink.markUnknown();
				return true;
			}
			// 迭代38 B：参数共享容器方法变异 → state（与 d[0]=1 → stateWrites 同语义统一，iter36 §b-7）；
			// 必须在 pure/hof 之前（List.Add 在 builtinTypeEffects 标 pure，此处抢先）；
			// 回调义务：builtinTypeEffects 标 hof 或 hof 表含 attr → addArgEdges（sort 的 key=，规则5）。
			if (pack.builtinMutators?.[ptype]?.has(call.attr)) {
				if (
					pack.builtinTypeEffects[ptype]?.[call.attr] === "hof" ||
					pack.hofAlwaysArgs.has(call.attr) ||
					pack.hofCallsArgs.has(call.attr)
				)
					sink.addArgEdges(call.argFns, call.attr);
				sink.addEffect("state");
				sink.addStateWrite(call.obj ?? ""); // 迭代39 B10：容器位置（前缀匹配读者 d.x）
				sink.hitTable(`mutate:${ptype}.${call.attr}`);
				return true;
			}
			const rule = pack.builtinTypeEffects[ptype]?.[call.attr];
			if (rule === "hof") {
				sink.addArgEdges(call.argFns, call.attr);
				sink.hitTable(`type:${ptype}.${call.attr}`);
				return true;
			}
			if (rule === "pure") {
				sink.hitTable(`type:${ptype}.${call.attr}`);
				return true;
			}
		}
		// 表外方法 / 项目类歧义 → 落 ? 或继续走全局类解析（诚实）
	}
	// 迭代37 P1-2：局部单赋值构造绑定（var xs = new List<int>() → xs.Add）——最小语言类型层
	// 第一传递函数。G4 守卫：提取侧已保证单赋值构造；此处防重绑遮蔽（assigned）与参数注入（params 走 A1）。
	// 消费：项目类（globalClasses 只含 kind=class → 函数名 RHS 不命中 → ? 诚实）→ 类成员并集边；
	// 内建类型（List/Dictionary/string…）→ builtinTypeEffects 查表（纯信箱）。miss 仍落 ?。
	const lb = caller.localBindings?.[call.obj ?? ""];
	// 守卫：提取侧已保证单赋值构造（多赋值/重绑不绑）+ 参数排除（params）；此处防参数注入
	// （paramTypes 双保险）。不用 assigned/moduleAssigned——局部声明（var xs = ...）本身就在
	// assigned 且 moduleAssigned 含整树赋值（assignedNames(root) 遍历函数体），会误杀全部局部变量；
	// 局部声明遮蔽模块级同名（C# var / Python 赋值即局部 / TS 声明），绑定可靠。
	if (
		lb !== undefined &&
		!Object.hasOwn(caller.paramTypes ?? {}, call.obj ?? "")
	) {
		const lbCls = globalClasses.get(lb);
		if (lbCls && lbCls.some((c) => c.lang === pack.name)) {
			// 迭代38 A：局部精确构造（polymorphic=false——祖先闭包并集，无后代守卫；
			// JS/TS 不产 trusted 绑定已在提取侧门控，规则7）
			const r = resolveClassMember(
				lb,
				call.attr,
				pack,
				files,
				globalClasses,
				superMap,
				hasSubclass,
				langHasDynamicExtends,
				virtualMembers,
				sink,
				false,
			);
			if (r === "edges") {
				sink.hitTable(`lb:${lb}.${call.attr}`);
				return true;
			}
			// 迭代40 B5/M6：局部构造类成员 miss + 属性读取 → 纯（同 ptype 分支论证）
			if (
				r === "none" &&
				call.prop &&
				(pack.propMissIsPure ||
					memberNameExists(lb, call.attr, pack, files, globalClasses, superMap))
			) {
				sink.hitTable(`lb:${lb}.${call.attr}`);
				return true;
			}
		}
		const rule = pack.builtinTypeEffects[lb]?.[call.attr];
		if (rule === "hof") {
			sink.addArgEdges(call.argFns, call.attr);
			sink.hitTable(`lb:${lb}.${call.attr}`);
			return true;
		}
		if (rule === "pure") {
			sink.hitTable(`lb:${lb}.${call.attr}`);
			return true;
		}
	}
	// 全局类名解析（迭代19 C# 跨文件类调用）——**优先于效应表（迭代21 正确化）**：
	// 项目内类 NetCall 撞效应表条目 NetCall: "net"——项目类优先（真实实现），表条目是通用库名。
	// 遮蔽守卫：调用方局部赋值或模块级重绑（conn = make_evil() 遮蔽 import）→ 不解析
	// 语言隔离（迭代19 复审 F1）：只解析同语言类——跨语言同名类不串味
	const cls = globalClasses.get(call.obj);
	if (
		cls &&
		!caller.assigned.includes(call.obj) &&
		!fi.moduleAssigned.has(call.obj)
	) {
		// 迭代37 P1-3：跨文件同名类 + 成员重载 → 全候选并集边（G5：含跨文件多命中）
		const same = cls.filter((c) => c.lang === pack.name);
		const q = `${call.obj}.${call.attr}`;
		let any = false;
		for (const c of same) {
			const tf = files.get(c.file);
			if (tf && addUnionEdges(tf, q, sink)) any = true;
		}
		// 迭代42 候选7 + 迭代43 r2：类型加载效应闭合——静态成员访问（C.Get()/C.X）触发类型加载。
		// C# 精确版（staticModifiers 存在）：只并 static-init 单元（静态字段初始化器 + 静态构造器体；
		// 实例初始化器/实例 ctor 不执行于静态访问——数学修正 1 同时替换 H1 的 ctor 并集与 class chunk 并集）。
		// 其他语言（无 staticModifiers）：class chunk 并集（类体/静态块调用在 class chunk，现状语义）。
		let loadEdges = 0;
		const hasStaticSplit = (pack.staticModifiers?.length ?? 0) > 0;
		for (const c of ancestorClosureOf(call.obj, pack, superMap)) {
			if (hasStaticSplit) {
				const sks = staticInitKey.get(`${pack.name}\u0000${c}`);
				if (sks) {
					for (const sk of sks) {
						sink.addEdge(sk);
						loadEdges++;
					}
				}
				continue;
			}
			const entries = globalClasses.get(c);
			if (!entries) continue;
			for (const e of entries) {
				if (e.lang !== pack.name) continue;
				const tf = files.get(e.file);
				const rc = tf?.chunkByKey.get(e.key);
				if (rc && rc.calls.length > 0) {
					sink.addEdge(e.key);
					loadEdges++;
				}
			}
		}
		if (any) return true;
		// M1（审计）：成员 miss（调用形态）+ 类型加载效应——不结算：边已保留（效应传播）但成员未知
		// 必须落 ?（否则类初始化器全纯时 UNKNOWN→PURE 假纯，audit 侧判定变化 + 门禁放行）。
		// 读取形态结算（读取不执行未知代码，类型加载效应即全部；loadEdges=0 时走下方 propMissIsPure 判纯）。
		if (loadEdges > 0 && call.prop) return true;
		// 迭代40 B5/M6：项目类成员 miss + 属性读取 → 纯（C# 静态语义 propMissIsPure / TS-JS
		// memberNames 字段清单；partial 类已由 same 全文件并集覆盖）
		if (
			call.prop &&
			(pack.propMissIsPure ||
				memberNameExists(
					call.obj,
					call.attr,
					pack,
					files,
					globalClasses,
					superMap,
				))
		)
			return true;
	}
	// hasOwn 守卫：impureGlobals 普通对象字面量，继承键（constructor 等）→ undefined（纪律与 B1 同源）
	const rule = Object.hasOwn(pack.impureGlobals, call.obj)
		? pack.impureGlobals[call.obj]
		: undefined;
	if (typeof rule === "string") {
		sink.addEffect(rule); // 模块/全局整体效应类（console: "io"）
		sink.hitTable(`global:${call.obj}`); // 迭代21 B
		return true;
	}
	if (Array.isArray(rule)) {
		if (rule.includes(call.attr)) {
			sink.addEffect("io");
			sink.hitTable(`global:${call.obj}`); // 迭代21 B
			return true;
		}
		const tagged = rule.find((r) => r.startsWith(call.attr + ":"));
		if (tagged) {
			const cls = tagged.slice(call.attr.length + 1);
			if (cls === "p") {
				sink.hitTable(`global:${call.obj}`); // 迭代21 B
				return true; // 纯标记（与 effectFromModule 同语义，A7 原子性守卫，迭代7 发现B）
			}
			sink.addEffect(cls); // "now:clock" / "random:random"
			sink.hitTable(`global:${call.obj}`); // 迭代21 B
			return true;
		}
	}
	if (
		!caller.assigned.includes(call.obj) &&
		!fi.moduleAssigned.has(call.obj) &&
		pack.pureGlobals.has(call.obj)
	) {
		if (pack.hofCallsArgs.has(call.attr))
			sink.addArgEdges(call.argFns, call.attr); // Array.from(xs, cb)
		sink.hitTable(`global:${call.obj}`); // 迭代21 B
		return true;
	}
	if (call.obj !== UNRESOLVED_TARGET) sink.missTable(`global:${call.obj}`); // 迭代21 B：对象双未中 → 补表候选
	return false;
}

function resolveCall(
	call: RawCall,
	caller: RawChunk,
	fi: FileIndex,
	files: ReadonlyMap<string, FileIndex>,
	projectFiles: ReadonlySet<string>,
	resolveSymbol: (file: string, name: string, depth: number) => string | null,
	resolveMod: (
		pack: LangPack,
		module: string,
		fromFile: string,
	) => string | null,
	globalClasses: ReadonlyMap<
		string,
		{ file: string; key: string; lang: string }[]
	>,
	superMap: ReadonlyMap<string, ReadonlySet<string>>,
	hasSubclass: ReadonlySet<string>,
	langHasDynamicExtends: ReadonlySet<string>,
	virtualMembers: ReadonlyMap<string, ReadonlySet<string>>,
	staticInitKey: ReadonlyMap<string, string[]>,
	sink: Sink,
): void {
	const pack = fi.pack;
	// 迭代39 B9：import 通道的类层次参数束
	const hctx: HierarchyCtx = {
		globalClasses,
		superMap,
		hasSubclass,
		langHasDynamicExtends,
		virtualMembers,
	};

	// 0.5 构造调用（迭代33 C1：new X(...) 构造器建模——C# object_creation_expression 产 ctor 标记）。
	// 规则/优先级细节见 resolveCtorCall（迭代40 C1 拆分）。
	if (call.ctor !== undefined) {
		resolveCtorCall(
			call,
			call.ctor,
			caller,
			fi,
			files,
			pack,
			globalClasses,
			superMap,
			hasSubclass,
			langHasDynamicExtends,
			virtualMembers,
			staticInitKey,
			sink,
		);
		return;
	}

	// 0. 字面量接收者：类型已证明（"x".strip / [].push / (5).toFixed）→ 内建方法表。
	//    必须置于一切分支之前（obj=null 会被裸名分支劫持成对本地同名函数的错边）；
	//    表外方法 → ?（F9），永不静默丢。
	if (call.receiver !== null) {
		// 构造器接收者：new C().m() → 解析类名（本地/import）→ kind=class → 类成员真边
		if (call.receiver.startsWith("class:")) {
			const className = call.receiver.slice(6);
			// 遮蔽守卫（迭代4 F1，与分支 2/3 对称）：局部变量遮蔽类名时 class: 接收者不可信 → 诚实未知
			if (caller.assigned.includes(className)) {
				sink.addUnknownCall(call);
				sink.markUnknown();
				return;
			}
			// 迭代38 规则7：JS/TS 构造器可 return 任意对象 → class: 接收者不可信 → ?（B2 假纯洞）
			if (pack.trustedCtor === false) {
				sink.addUnknownCall(call);
				sink.markUnknown();
				return;
			}
			// 迭代38 A：继承解析（精确构造 polymorphic=false——祖先闭包并集，无后代守卫）
			const r = resolveClassMember(
				className,
				call.attr,
				pack,
				files,
				globalClasses,
				superMap,
				hasSubclass,
				langHasDynamicExtends,
				virtualMembers,
				sink,
				false,
			);
			if (r === "edges") return;
			sink.addUnknownCall(call);
			sink.markUnknown();
			return;
		}
		// 迭代52-r3 G1（数学家健全性 blocker）：receiver 分支补 builtinMutators 检查——
		// 返回链表补全后 `sb.Append(a).Append(b)` 第二环 receiver=StringBuilder 命中 pure 前
		// 必须拦截变异（参数共享容器变异 = S1 假纯；ptype 分支 L1216 已有此检查，此处镜像）。
		// 豁免①：字面量 receiver（Python list/dict/set/str、C# string/array——每次求值新建，
		// 变异不可观察外部状态；'x'.strip / [].append 纯，迭代38 测试锚定）。
		// 豁免②：局部构造绑定 receiver（var sb = new StringBuilder()——局部新建不可共享，
		// 变异只影响局部对象；与 ptype 参数分支的共享语义区分）。
		// 注：链式 receiver（obj=null）**不豁免**——参数共享链 sb.Append(x).Append(y) 第二环
		// 变异对象来自参数（外部共享），豁免即 S1 违约；局部链第二环误报 state = 方向安全过近似。
		const rule = pack.builtinTypeEffects[call.receiver]?.[call.attr];
		const isLocalCtor =
			call.obj !== null && caller.localBindings?.[call.obj] !== undefined;
		if (
			pack.builtinMutators?.[call.receiver]?.has(call.attr) &&
			!(pack.literalMutatorExempt ?? []).includes(call.receiver) &&
			!isLocalCtor
		) {
			sink.addEffect("state");
			sink.addStateWrite(call.obj ?? "");
			sink.hitTable(`mutate:${call.receiver}.${call.attr}`);
			return;
		}
		if (rule === "hof") {
			sink.addArgEdges(call.argFns, call.attr);
			return;
		}
		if (rule === "pure") return;
		sink.addUnknownCall(call);
		sink.markUnknown();
		return;
	}

	// 1. self/this 方法调用 → 所在类（同名冲突时诚实记未知）
	//    多级链（self.client.post 的 attr="client.post" 含 "."）不在此分支——落到 2.5 frameworkIo
	//    （迭代18：Locust 压测客户端模式）；否则会被当作不存在的类成员记 ?
	if (
		call.obj !== null &&
		pack.selfNames.includes(call.obj) &&
		!call.attr.includes(".")
	) {
		if (caller.ownerClass) {
			// 迭代38 A：self/this 多态解析——祖先闭包并集；类被子类继承 → 覆写不可见 → ?（H4 假纯洞闭合）
			const r = resolveClassMember(
				caller.ownerClass,
				call.attr,
				pack,
				files,
				globalClasses,
				superMap,
				hasSubclass,
				langHasDynamicExtends,
				virtualMembers,
				sink,
				true,
			);
			if (r === "edges") return;
			if (r === "unknown") {
				sink.addUnknownCall(call);
				sink.markUnknown();
				return;
			}
			// 迭代40 B5/M6：属性读取成员 miss（"none"——字段/自动属性/不存在成员）→ 纯。
			// C# 静态语义 propMissIsPure；TS/JS selfPropReadIsPure（this.attr 非 getter 读取
			// 无副作用——JS 语义读 undefined；getter 已建 chunk 命中）；memberNames 字段清单兜底。
			if (
				call.prop &&
				(pack.propMissIsPure ||
					pack.selfPropReadIsPure ||
					memberNameExists(
						caller.ownerClass,
						call.attr,
						pack,
						files,
						globalClasses,
						superMap,
					))
			)
				return;
		}
		sink.addUnknownCall(call);
		sink.markUnknown(); // 继承/混入/冲突：诚实标记
		return;
	}

	// 迭代44 候选1（双评审锚定）：裸名 prop 读 + 遮蔽名 → 读取存储位置恒纯（与参数读取同族，
	// extractor 参数跳过先例——「纯是静态事实，不需要解析」）。必须在 bySimple 之前短路：遮蔽语义下
	// 读的就是局部，无需解析（防顶层同名假边）。调用形态（prop=false）遮蔽维持 ?（iter41 阴影守卫
	// 不回退——`const Math = evil(); Math(...)` 仍 ?）。豁免面 = obj===null ∧ prop ∧ attr∈assigned。
	// 迭代45 审计修正（C1 反例，S1 违反）：assigned 含 assignment_expression 左值收集——C# 隐式 this
	// 属性写（`V = "a"` 无局部 V 时解析到本类属性）后裸读 V 会被短路判 PURE，而 getter 执行 io → 假纯；
	// 类 chunk 同理（assigned = 整棵类子树，方法内局部声明名污染类级字段初始化器读属性）。修复 =
	// 成员互斥：attr 是 ownerClass（类 chunk 用自身名）的成员（属性/方法）时**不**短路（落回既有解析）。
	// 局部/参数/foreach/catch 名非类成员 → 短路保留（iter44 收益不回退）；局部遮蔽成员名退回 ?（安全）。
	if (
		call.obj === null &&
		call.prop &&
		caller.assigned.includes(call.attr) &&
		!(
			pack.bareNameMeansThisInMethod &&
			(caller.ownerClass ?? (caller.kind === "class" ? caller.name : null)) &&
			isClassMemberName(
				caller.ownerClass ?? (caller.kind === "class" ? caller.name : null)!,
				call.attr,
				pack,
				files,
				globalClasses,
				superMap,
			)
		)
	)
		return;

	// 2. 裸名：同文件顶层定义。仅顶层可裸名解析（方法不在裸名作用域）；
	//    局部赋值遮蔽则跳过；同名重定义歧义 → ?（与限定名 ambiguous 对称）。
	if (call.obj === null && !caller.assigned.includes(call.attr)) {
		const local = fi.bySimple.get(call.attr);
		if (local && local.length > 0) {
			// 迭代40 B5：裸名属性读取跳过类 chunk——读取类名/类型引用无运行时效应
			// （(Config)x / Config c 的 Config 会被 identifier 形态误收；类 chunk 只能经
			// 成员访问 Config.X 或构造 new Config() 引用）。方法/函数 chunk 保持边。
			const top = local.filter((k) => {
				const c = fi.chunkByKey.get(k)!;
				return c.ownerClass === null && (call.prop ? c.kind !== "class" : true);
			});
			if (top.length === 1) {
				sink.addEdge(top[0]!);
				return;
			}
			if (top.length > 1) {
				// 迭代37 P1-3 并集边：同名顶层重定义 → 全候选（S1/S2/S3 可证安全）
				for (const k of top) sink.addEdge(k);
				return;
			}
		}
		if (pack.implicitThis && caller.ownerClass) {
			// C# 隐式 this（迭代19）：类内裸名调用 = 本类方法（Game.Start 调 LoadGame() 无 this. 前缀）
			// 迭代38 A：与 self 分支同款多态解析（继承并集 + 子类覆写守卫降 ?）
			const r = resolveClassMember(
				caller.ownerClass,
				call.attr,
				pack,
				files,
				globalClasses,
				superMap,
				hasSubclass,
				langHasDynamicExtends,
				virtualMembers,
				sink,
				true,
			);
			if (r === "edges") return;
			if (r === "unknown") {
				sink.addUnknownCall(call);
				sink.markUnknown();
				return;
			}
			// 迭代40 B5/M6：裸名属性读取成员 miss → 纯（同 self 分支论证——TS/JS 隐式 this 语义
			// 与显式 this 相同；局部变量读取同样无用户代码——miss 判纯双向安全）。
			if (
				call.prop &&
				(pack.propMissIsPure ||
					pack.selfPropReadIsPure ||
					memberNameExists(
						caller.ownerClass,
						call.attr,
						pack,
						files,
						globalClasses,
						superMap,
					))
			)
				return;
		}
		// 仅方法候选：裸名调用不指向方法 → 落到后续分支（import/效应表/未知）
	}

	// 属性链前缀白名单（迭代33 C2，迭代37 P0-1 数据化）：任意变量的 `.head.member` 链
	// （item.gameObject.SetActive 的 obj=item、attr="gameObject.SetActive"）查 frameworkAttrPrefix。
	// **必须在 assigned 守卫之前**（本形态主体是局部变量 receiver——item.gameObject.SetActive 的 item
	// 在 assigned 命中会被下方守卫跳过）。白名单 miss → 落回后续分支 → UNKNOWN 诚实（方向安全）。
	if (call.obj !== null) {
		const dot = call.attr.indexOf(".");
		if (dot !== -1) {
			const head = call.attr.slice(0, dot);
			const prefixes =
				pack.frameworkAttrPrefix &&
				Object.hasOwn(pack.frameworkAttrPrefix, head)
					? pack.frameworkAttrPrefix[head]
					: undefined;
			if (prefixes) {
				const rest = call.attr.slice(dot + 1);
				const member =
					rest.indexOf(".") === -1 ? rest : rest.slice(0, rest.indexOf("."));
				if (prefixes.includes(member)) {
					sink.addEffect("io");
					sink.hitTable(`frame:${head}`); // 迭代21 B：框架前缀命中计数
					return;
				}
			}
		}
	}

	// 2.5 框架命名空间（egg ctx.model.* / ctx.service.* → io 边界；遮蔽/参数同名则跳过判定）。
	// selfNames 豁免（迭代18）：self 是参数会进 assigned——self.client.post 是实例属性访问非本地遮蔽
	if (
		call.obj !== null &&
		(!caller.assigned.includes(call.obj) || pack.selfNames.includes(call.obj))
	) {
		// Object.hasOwn 守卫：frameworkIo 是普通对象字面量，裸下标/`in` 会命中继承的
		// Object.prototype 键（hasOwnProperty/toString/constructor…）→ truthy → for...of 函数崩溃（DoS）
		const prefixes = Object.hasOwn(pack.frameworkIo, call.obj)
			? pack.frameworkIo[call.obj]
			: undefined;
		if (prefixes) {
			for (const p of prefixes) {
				if (call.attr === p || call.attr.startsWith(p + ".")) {
					sink.addEffect("io");
					sink.hitTable(`frame:${call.obj}`); // 迭代21 B：frameworkIo 命中计数
					return;
				}
			}
		}
		// 迭代32：frameworkPure 成员级白名单（Record<ns, Record<type, "pure"|"hof" | Record<member, tag>>>，
		// 未列落 ?）。匹配分两级：① type 键 = rest 首段（Array/Linq/Uri…）命中；② 若 type 值是嵌套
		// 成员表（异质类型如 Array），按剩余段查成员取 tag。回调义务仅 hof 承担（tag==="hof" 且 argFns
		// 非空 → addArgEdges(unconditional=true) → 未解析记 UNKNOWN 防假纯）；pure 成员忽略 argFns
		// （值实参被 argFnsOf 收集是常态——纯成员无委托形参，语言事实排除假纯）。
		// linqHof 表已删除（迭代32）——"LINQ 算子无条件调用回调"语义由 hof 标记 + unconditional 承担。
		const pureNs =
			pack.frameworkPure && Object.hasOwn(pack.frameworkPure, call.obj)
				? pack.frameworkPure[call.obj]
				: undefined;
		if (pureNs) {
			const rest = call.attr; // obj 已切走首段，rest = 完整剩余点连
			const firstDot = rest.indexOf(".");
			const typeKey = firstDot === -1 ? rest : rest.slice(0, firstDot);
			const typeVal = Object.hasOwn(pureNs, typeKey)
				? pureNs[typeKey]
				: undefined;
			if (typeVal !== undefined) {
				let tag: "pure" | "hof" | undefined;
				if (typeof typeVal === "string") {
					tag = typeVal; // 整类型键（Uri/Linq/Convert…）
				} else if (firstDot !== -1) {
					const memberRest = rest.slice(firstDot + 1);
					const mDot = memberRest.indexOf(".");
					const memberKey =
						mDot === -1 ? memberRest : memberRest.slice(0, mDot);
					const m = typeVal[memberKey];
					if (typeof m === "string") tag = m; // 嵌套成员表（Array 异质）
				}
				if (tag !== undefined) {
					const last = rest.slice(rest.lastIndexOf(".") + 1);
					if (tag === "hof" && call.argFns.length > 0)
						sink.addArgEdges(call.argFns, last, true); // unconditional
					sink.hitTable(`pure:${call.obj}.${typeKey}`); // 迭代21 B 风格：纯侧独立槽位（类型级）
					return;
				}
			}
		}
	}

	if (
		resolveImport(
			call,
			caller,
			fi,
			files,
			projectFiles,
			resolveSymbol,
			resolveMod,
			hctx,
			sink,
		)
	)
		return;
	// 4. 效应表
	if (call.obj === null) {
		const b = Object.hasOwn(pack.impureBuiltins, call.attr)
			? pack.impureBuiltins[call.attr]
			: undefined;
		if (b) {
			// 异步边（迭代14 视角 4 F1 修复 + D-092 修正）：setTimeout/setInterval/queueMicrotask 在
			// hofAlwaysArgs（无条件调用实参），触发门必须含它——仅 hofCallsArgs 恒 false（死配置）。
			// 未解析回调记 ?（S4）；否则回调在反向闭包/回归风险不可见
			if (pack.hofAlwaysArgs.has(call.attr) || pack.hofCallsArgs.has(call.attr))
				sink.addArgEdges(call.argFns, call.attr);
			sink.addEffect(b);
			sink.hitTable(`builtin:${call.attr}`); // 迭代21 B
			return;
		}
		if (
			!caller.assigned.includes(call.attr) &&
			!fi.moduleAssigned.has(call.attr) &&
			pack.pureBuiltins.has(call.attr)
		) {
			// HOF（map/filter/sorted…）会调用函数实参：回调效应必须保留，否则假纯
			if (pack.hofAlwaysArgs.has(call.attr) || pack.hofCallsArgs.has(call.attr))
				sink.addArgEdges(call.argFns, call.attr);
			sink.hitTable(`builtin:${call.attr}`); // 迭代21 B
			return;
		}
		if (call.attr !== UNRESOLVED_TARGET) sink.missTable(`builtin:${call.attr}`); // 迭代21 B：裸名双未中 → 补表候选
	} else {
		// 对象方法分派：A1 参数类型 / lb 局部绑定 / 全局类 / 效应表——细节见 resolveObjDispatch（迭代40 C1 拆分）
		if (
			resolveObjDispatch(
				call,
				caller,
				fi,
				files,
				pack,
				globalClasses,
				superMap,
				hasSubclass,
				langHasDynamicExtends,
				virtualMembers,
				staticInitKey,
				sink,
			)
		)
			return;
	}

	// 5. 星号导入回退；其余裸名记未知，对象方法记动态分派
	// 迭代43 B：事件触发通道——插在所有既有通道之后（零优先级扰动）、markUnknown/markDynamic 之前。
	// 语义：事件 = 间接层；触发展开订阅 handler 闭包（S2 过近似：可能执行 = 效应传播）；
	// 非 private / 集合不完整 → 附加 ?（可见性守卫）。形态：evt(...) 裸名 / evt.Invoke() / evt?.Invoke()。
	const fireEvent = (evName: string): boolean => {
		const cls = caller.ownerClass;
		const info = cls ? fi.events?.[cls]?.[evName] : undefined;
		if (!info) return false;
		// 订阅 handler 展开（类内方法解析——隐式 this 语义，多态并集）
		for (const h of info.handlers) {
			const r = resolveClassMember(
				cls!,
				h,
				pack,
				files,
				globalClasses,
				superMap,
				hasSubclass,
				langHasDynamicExtends,
				virtualMembers,
				sink,
				true,
			);
			if (r === "unknown") {
				sink.addUnknownCall(call);
				sink.markUnknown();
			}
			// edges：边已建；none：handler 方法不可见（外部/标注）→ 不加边（不误报）
		}
		// 可见性守卫（非 private：外部订阅不可见 → ?）+ 集合完整性守卫（incomplete：形态不可归属 → ?）
		if (!info.private || info.incomplete) {
			sink.addUnknownCall(call);
			sink.markUnknown();
		}
		sink.hitTable(`event:${evName}`);
		return true;
	};
	if (call.obj === null) {
		if (fireEvent(call.attr)) return;
		for (const wf of fi.wildcards) {
			const hit = resolveSymbol(wf, call.attr, 1);
			if (hit !== null) {
				sink.addEdge(hit);
				return;
			}
		}
		sink.addUnknownCall(call);
		sink.markUnknown();
		return;
	}

	// 事件对象触发（evt.Invoke() / evt?.Invoke()——obj 为裸事件名，attr 为 Invoke；
	// 跨实例/链式接收者（x.evt / this.evt / C.evt）保持 markDynamic ?（数学 §2b：接收者类型不可证）
	if (call.attr === "Invoke" && !call.obj.includes(".") && fireEvent(call.obj))
		return;
	sink.addUnknownCall(call);
	sink.markDynamic();
}
