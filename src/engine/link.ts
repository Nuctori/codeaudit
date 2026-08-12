import { type LangPack, type RawCall, type RawChunk, type RawFileFacts, type RawImport, UNRESOLVED_TARGET } from "../lang/pack";
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
  const resolveMod = (pack: LangPack, module: string, fromFile: string): string | null => {
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
      const baseId = rc.name === "<module>" ? `module@${facts.file}` : chunkId(rc.normText);
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

    const moduleAssigned = new Set(facts.chunks.find((c) => c.name === "<module>")?.assigned ?? []);

    files.set(facts.file, { facts, pack, byQualified, byQualifiedAll, ambiguous, bySimple, importMap, wildcards, chunkByKey, moduleAssigned });
  }

  // 全局类名索引（迭代19 C# 跨文件类调用）：类 chunk 名 → (file, key, lang) 列表——
  // C# namespace 可见性让 obj=类名 可在任何文件解析（File/GameObject 等已在效应表，项目内类走此表）。
  // **语言隔离（迭代19 复审 F1）**：条目带 pack 名，解析时只查同语言——C# 类名撞 Python 类不串味
  const globalClasses = new Map<string, { file: string; key: string; lang: string }[]>();
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
      const importedName = imp.imported === "*" || imp.imported === null ? name : imp.imported;
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
      let unknownSites = 0; // `?` 多重性：calls 是 Set 只记一个 `?`，此处记未解析调用点数
      const unknownCalls: Array<{ attr: string; obj: string | null; root: string }> = [];

      // 接收者根类别（标注语料的条件维度）：字面量 / 裸名 / self / 框架命名空间 / 变量
      const rootOf = (call: RawCall): string => {
        if (call.receiver !== null) return `literal:${call.receiver}`;
        if (call.obj === null) return "bare";
        if (fi.pack.selfNames.includes(call.obj)) return "self";
        if (Object.hasOwn(fi.pack.frameworkIo, call.obj)) return `frame:${call.obj}`;
        return "variable";
      };

      const effectFromModule = (rawModule: string, member: string | null): boolean => {
        const module = rawModule.replace(/^node:/, ""); // node:fs ≡ fs
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
        resolveCall(call, rc, fi, files, projectFiles, resolveSymbol, resolveMod, globalClasses, {
          addEdge: (k) => calls.add(k),
          addEffect: (e) => direct.add(e),
          markUnknown: () => { unknownSites++; calls.add(UNKNOWN_TARGET); },
          markDynamic: () => { unknownSites++; calls.add(UNKNOWN_TARGET); },
          hitTable: (k) => bump(tableHit, `${pk}\u0000${k}`),
          missTable: (k) => bump(tableMiss, `${pk}\u0000${k}`),
          addUnknownCall: (call) => unknownCalls.push({ attr: call.attr, obj: call.obj, root: rootOf(call) }),
          addArgEdges: (names, hof, unconditional = false) => {
            for (const n of names) {
              // 成员形回调：this.log / self.render → 当前类的同名方法（HOF 成员形假纯修复）
              const dotIdx = n.indexOf(".");
              if (dotIdx !== -1 && rc.ownerClass && fi.pack.selfNames.includes(n.slice(0, dotIdx))) {
                const q = `${rc.ownerClass}.${n.slice(dotIdx + 1)}`;
                if (!fi.ambiguous.has(q)) {
                  const hit = fi.byQualified.get(q);
                  if (hit) { calls.add(hit); continue; }
                } else {
                  // 迭代37 P1-3 并集边：成员形回调撞名（重载）→ 全候选不静默跳过
                  const cands = fi.byQualifiedAll.get(q);
                  if (cands) for (const k of cands) calls.add(k);
                }
                continue;
              }
              const local = fi.bySimple.get(n);
              if (local && local.length > 0) { calls.add(local[0]!); continue; }
              const imp = fi.importMap.get(n);
              if (imp && imp.imported !== null && imp.imported !== "default" && imp.imported !== "*") {
                const target = resolveMod(fi.pack, imp.module, fi.facts.file);
                if (target !== null) {
                  const hit = resolveSymbol(target, imp.imported, 0);
                  if (hit !== null) { calls.add(hit); continue; }
                }
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
                unknownCalls.push({ attr: call.attr, obj: call.obj, root: rootOf(call) });
              }
            }
          },
          effectFromModule,
        });
      }

      // 构造器体效应并入 class chunk（S1 修复）：class C 的 __init__/constructor 在实例化时执行，
      // 其 io 必须传播到 class chunk（否则 `def f(): return C()` 判纯但运行时构造器写 io → 假纯）
      if (rc.kind === "class") {
        for (const [k, c2] of fi.chunkByKey) {
          if (c2.ownerClass === rc.name && (c2.name === "__init__" || c2.name === "constructor")) {
            calls.add(k);
          }
        }
      }

      // 状态写（用户需求 2026-08-11）：self.x = / this.x = / global、nonlocal 声明 → state 效应——
      // 函数只改全局/实例状态不再判 PURE（S1 假纯漏报闭合）
      if (rc.stateWrites.length > 0) direct.add("state");

      out.push({
        // 公理4：id 由内容直接重算，与 key 的去重后缀无关（module 用文件限定 id）
        id: idOf.get(rc) ?? (rc.name === "<module>" ? `module@${file}` : chunkId(rc.normText)),
        key,
        name: rc.ownerClass ? `${rc.ownerClass}.${rc.name}` : rc.name,
        file,
        line: rc.line,
        endLine: rc.endLine,
        nesting: rc.nesting,
        direct,
        calls,
        unknownSites,
        unknownCalls,
        thrownTypes: rc.thrownTypes,
        catches: rc.catches,
        stateReads: rc.stateReads,
        stateWrites: rc.stateWrites,
      });
    }
  }

  return { chunks: out, effectTableUsage: classifyUsage(packs, tableHit, tableMiss) };
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
  addArgEdges(names: readonly string[], hof: string, unconditional?: boolean): void;
  effectFromModule(module: string, member: string | null): boolean;
}


  // 命名空间导入解析（迭代36 r2 从 resolveImport 抽出——机械拆分，行为不变）
  function resolveNamespaceImport(
    call: RawCall,
    caller: RawChunk,
    fi: FileIndex,
    pack: LangPack,
    imp: RawImport,
    resolveMod: (pack: LangPack, module: string, fromFile: string) => string | null,
    resolveSymbol: (file: string, name: string, depth: number) => string | null,
    sink: Sink,
  ): boolean {
    const member = call.obj !== null ? call.attr : null;
    const target = resolveMod(pack, imp.module, fi.facts.file);
    if (target !== null) {
      if (member !== null) {
        const hit = resolveSymbol(target, member, 0);
        if (hit !== null) { sink.addEdge(hit); return true; }
        // 点连成员：import a.b; a.b.fn() → callOf 首点切分得 obj=a、attr=b.fn，
        // 全名 a.b.fn 去掉模块路径 a.b 后的段（fn）在模块内解析（遮蔽重绑则跳过）
        if (call.obj !== null && !caller.assigned.includes(call.obj)) {
          const full = `${call.obj}.${call.attr}`;
          if (full.startsWith(imp.module + ".")) {
            const inner = full.slice(imp.module.length + 1);
            const hit2 = resolveSymbol(target, inner, 0);
            if (hit2 !== null) { sink.addEdge(hit2); return true; }
          }
        }
      }
      sink.addUnknownCall(call);
      sink.markUnknown();
      return true;
    }
    // 两级成员链（迭代18 旧宇宙驱动）：os.environ.get → 效应表查全链 "environ.get"
    // （effectFromModule 前缀回退命中 "environ"=io）；os.path.join → "path.join":p
    const effMember = call.obj !== null && call.obj.startsWith(imp.module + ".")
      ? `${call.obj.slice(imp.module.length + 1)}.${call.attr}`
      : member;
    if (effMember !== null && sink.effectFromModule(imp.module, effMember)) {
      if (pack.hofCallsArgs.has(effMember)) sink.addArgEdges(call.argFns, effMember); // functools.reduce(cb, …)
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
    resolveMod: (pack: LangPack, module: string, fromFile: string) => string | null,
    resolveSymbol: (file: string, name: string, depth: number) => string | null,
    sink: Sink,
  ): boolean {
    const target = resolveMod(pack, imp.module, fi.facts.file);
    if (target !== null) {
      const name = imp.imported === "default"
        ? (files.get(target)?.facts.defaultExport ?? imp.imported!)
        : imp.imported!;
      const hit = resolveSymbol(target, name, 0);
      if (hit !== null) { sink.addEdge(hit); return true; }
      sink.addUnknownCall(call);
      sink.markUnknown();
      return true;
    }
    if (sink.effectFromModule(imp.module, imp.imported!)) {
      // HOF 实参回调边（与命名空间分支对称）：from functools import reduce; reduce(write, xs) → write 效应保留
      if (pack.hofCallsArgs.has(imp.imported!)) sink.addArgEdges(call.argFns, imp.imported!);
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
    resolveMod: (pack: LangPack, module: string, fromFile: string) => string | null,
    resolveSymbol: (file: string, name: string, depth: number) => string | null,
    sink: Sink,
  ): boolean {
    if (call.obj !== null && !caller.assigned.includes(call.obj)) {
      const target = resolveMod(pack, imp.module, fi.facts.file);
      const name = imp.imported === "default"
        ? (target !== null ? (files.get(target)?.facts.defaultExport ?? imp.imported!) : imp.imported!)
        : imp.imported!;
      if (target !== null) {
        const tf = files.get(target);
        if (tf) {
          const q = `${name}.${call.attr}`;
          if (addUnionEdges(tf, q, sink)) return true;
          // 模块级值绑定：export const db = new Pool() → 绑定名解析到类 → 类成员真边
          const boundCls = Object.hasOwn(tf.facts.moduleBindings, name) ? tf.facts.moduleBindings[name] : undefined;
          if (boundCls) {
            const clsKey = resolveSymbol(target, boundCls, 0);
            if (clsKey !== null) {
              const cf = clsKey.slice(0, clsKey.indexOf("::"));
              const tf2 = files.get(cf);
              const rc = tf2?.chunkByKey.get(clsKey);
              if (rc && rc.kind === "class") {
                const q2 = `${boundCls}.${call.attr}`;
                if (!tf2!.ambiguous.has(q2)) {
                  const hit2 = tf2!.byQualified.get(q2);
                  if (hit2) { sink.addEdge(hit2); return true; }
                }
              }
            }
          }
          // 命名空间再导出链：ns 在 target 里是 export * as ns from → 继续解析 attr
          const nsImp = tf.importMap.get(name);
          if (nsImp && nsImp.imported === null) {
            const t2 = resolveMod(pack, nsImp.module, target);
            if (t2 !== null) {
              const hit2 = resolveSymbol(t2, call.attr, 0);
              if (hit2 !== null) { sink.addEdge(hit2); return true; }
            }
          }
        }
      } else if (sink.effectFromModule(imp.module, call.attr)) {
        if (pack.hofCallsArgs.has(call.attr)) sink.addArgEdges(call.argFns, call.attr); // _.map(cb, xs)
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
  resolveMod: (pack: LangPack, module: string, fromFile: string) => string | null,
  sink: Sink,
): boolean {
  const pack = fi.pack;
  const binding = call.obj ?? call.attr;
  const imp = fi.importMap.get(binding);
  if (imp && !caller.assigned.includes(binding) && !fi.moduleAssigned.has(binding)) {
    if (imp.imported === null) {
      return resolveNamespaceImport(call, caller, fi, pack, imp, resolveMod, resolveSymbol, sink);
    }
    if (call.obj === null) {
      return resolveFromBareImport(call, fi, files, pack, imp, resolveMod, resolveSymbol, sink);
    }
    return resolveFromObjectImport(call, caller, fi, files, pack, imp, resolveMod, resolveSymbol, sink);
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
    if (hit) { sink.addEdge(hit); return true; }
    return false;
  }
  const cands = tf.byQualifiedAll.get(q);
  if (!cands || cands.length === 0) return false;
  for (const k of cands) sink.addEdge(k);
  return true;
}

function resolveCall(
  call: RawCall,
  caller: RawChunk,
  fi: FileIndex,
  files: ReadonlyMap<string, FileIndex>,
  projectFiles: ReadonlySet<string>,
  resolveSymbol: (file: string, name: string, depth: number) => string | null,
  resolveMod: (pack: LangPack, module: string, fromFile: string) => string | null,
  globalClasses: ReadonlyMap<string, { file: string; key: string; lang: string }[]>,
  sink: Sink,
): void {
  const pack = fi.pack;

  // 0.5 构造调用（迭代33 C1：new X(...) 构造器建模——C# object_creation_expression 产 ctor 标记）。
  // 规则：① impureGlobals 类型键 → 对应效应（FileStream:fs/Random:random/WaitForSeconds:clock 免费复用）；
  // ② 项目类（globalClasses 单命中且 !ambiguous）→ 边到 **ctor chunk**（constructor_declaration，
  //    byQualified "Type.Type"——禁止走 bySimple 裸名分支（错边到 class chunk 丢构造体效应 = 假纯））；
  //    **项目类优先于 pureCtor 名单**（迭代34 独立审计 Med：项目自建类撞 List/Color/Uri 等名单名且构造体
  //    有 io → 先查 pureCtor 会假纯，红线方向）。
  //    注（迭代36 独立审计 Low）：ctor 分支 impureGlobals 在项目类**之前**，与常规 obj 分支
  //    （globalClasses 在 impureGlobals 前）顺序不同——项目类撞 impureGlobals 键（Debug/FileStream 等）
  //    时构造形态走效应表、成员调用形态走项目类边；行为有界（效应表键有限且构造即效应语义可辩），记录不修；
  // ③ 纯构造清单（pureCtor）→ 纯；④ 其余框架类型 → ? 诚实（未列类型默认不纯，绝不给"未知皆纯"）。
  if (call.ctor !== undefined) {
    const t = call.ctor;
    const rule = Object.hasOwn(pack.impureGlobals, t) ? pack.impureGlobals[t] : undefined;
    if (typeof rule === "string") { sink.addEffect(rule); sink.hitTable(`ctor:${t}`); return; }
    if (Array.isArray(rule)) {
      // 迭代34 独立审计 Low：当前 csharp impureGlobals 全为 string 值（数组形态仅 python impureModules）——
      // 本分支对 ctor（仅 C# 产生）不可达，是防御代码。构造即整体效应 → 保守 io。
      sink.addEffect("io"); sink.hitTable(`ctor:${t}`); return;
    }
    // 项目类构造（优先于 pureCtor——防假纯）：边到 ctor chunk
    if (!caller.assigned.includes(t) && !fi.moduleAssigned.has(t)) {
      const cls = globalClasses.get(t);
      if (cls) {
        // 迭代37 P1-3：跨文件同名类 + 成员重载 → 全候选并集边（G5：不得任选）
        const same = cls.filter((c) => c.lang === pack.name);
        let any = false;
        for (const c of same) {
          const tf = files.get(c.file);
          if (tf && addUnionEdges(tf, `${t}.${t}`, sink)) any = true;
        }
        if (any) { sink.hitTable(`ctor:${t}`); return; }
      }
    }
    if (pack.pureCtor && pack.pureCtor.has(t)) { sink.hitTable(`ctor:${t}:p`); return; }
    sink.missTable(`ctor:${t}`); // 未列框架类型/歧义 → 补表候选 + 诚实 ?
    sink.addUnknownCall(call);
    sink.markUnknown();
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
      const clsKey = resolveSymbol(fi.facts.file, className, 0);
      if (clsKey !== null) {
        const clsFile = clsKey.slice(0, clsKey.indexOf("::"));
        const tf = files.get(clsFile);
        const rc = tf?.chunkByKey.get(clsKey);
        if (rc && rc.kind === "class") {
          const q = `${className}.${call.attr}`;
          if (!tf!.ambiguous.has(q)) {
            const hit = tf!.byQualified.get(q);
            if (hit) { sink.addEdge(hit); return; }
          }
        }
      }
      sink.addUnknownCall(call);
      sink.markUnknown();
      return;
    }
    const rule = pack.builtinTypeEffects[call.receiver]?.[call.attr];
    if (rule === "hof") { sink.addArgEdges(call.argFns, call.attr); return; }
    if (rule === "pure") return;
    sink.addUnknownCall(call);
    sink.markUnknown();
    return;
  }

  // 1. self/this 方法调用 → 所在类（同名冲突时诚实记未知）
  //    多级链（self.client.post 的 attr="client.post" 含 "."）不在此分支——落到 2.5 frameworkIo
  //    （迭代18：Locust 压测客户端模式）；否则会被当作不存在的类成员记 ?
  if (call.obj !== null && pack.selfNames.includes(call.obj) && !call.attr.includes(".")) {
    if (caller.ownerClass) {
      const q = `${caller.ownerClass}.${call.attr}`;
      if (addUnionEdges(fi, q, sink)) return;
    }
    sink.addUnknownCall(call);
    sink.markUnknown(); // 继承/混入/冲突：诚实标记
    return;
  }

  // 2. 裸名：同文件顶层定义。仅顶层可裸名解析（方法不在裸名作用域）；
  //    局部赋值遮蔽则跳过；同名重定义歧义 → ?（与限定名 ambiguous 对称）。
  if (call.obj === null && !caller.assigned.includes(call.attr)) {
    const local = fi.bySimple.get(call.attr);
    if (local && local.length > 0) {
      const top = local.filter((k) => fi.chunkByKey.get(k)!.ownerClass === null);
      if (top.length === 1) { sink.addEdge(top[0]!); return; }
      if (top.length > 1) {
        // 迭代37 P1-3 并集边：同名顶层重定义 → 全候选（S1/S2/S3 可证安全）
        for (const k of top) sink.addEdge(k);
        return;
      }
    }
    if (pack.implicitThis && caller.ownerClass) {
      // C# 隐式 this（迭代19）：类内裸名调用 = 本类方法（Game.Start 调 LoadGame() 无 this. 前缀）
      const q = `${caller.ownerClass}.${call.attr}`;
      if (addUnionEdges(fi, q, sink)) return;
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
      const prefixes = pack.frameworkAttrPrefix && Object.hasOwn(pack.frameworkAttrPrefix, head)
        ? pack.frameworkAttrPrefix[head]
        : undefined;
      if (prefixes) {
        const rest = call.attr.slice(dot + 1);
        const member = rest.indexOf(".") === -1 ? rest : rest.slice(0, rest.indexOf("."));
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
  if (call.obj !== null && (!caller.assigned.includes(call.obj) || pack.selfNames.includes(call.obj))) {
    // Object.hasOwn 守卫：frameworkIo 是普通对象字面量，裸下标/`in` 会命中继承的
    // Object.prototype 键（hasOwnProperty/toString/constructor…）→ truthy → for...of 函数崩溃（DoS）
    const prefixes = Object.hasOwn(pack.frameworkIo, call.obj) ? pack.frameworkIo[call.obj] : undefined;
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
    const pureNs = pack.frameworkPure && Object.hasOwn(pack.frameworkPure, call.obj)
      ? pack.frameworkPure[call.obj] : undefined;
    if (pureNs) {
      const rest = call.attr; // obj 已切走首段，rest = 完整剩余点连
      const firstDot = rest.indexOf(".");
      const typeKey = firstDot === -1 ? rest : rest.slice(0, firstDot);
      const typeVal = Object.hasOwn(pureNs, typeKey) ? pureNs[typeKey] : undefined;
      if (typeVal !== undefined) {
        let tag: "pure" | "hof" | undefined;
        if (typeof typeVal === "string") {
          tag = typeVal; // 整类型键（Uri/Linq/Convert…）
        } else if (firstDot !== -1) {
          const memberRest = rest.slice(firstDot + 1);
          const mDot = memberRest.indexOf(".");
          const memberKey = mDot === -1 ? memberRest : memberRest.slice(0, mDot);
          const m = typeVal[memberKey];
          if (typeof m === "string") tag = m; // 嵌套成员表（Array 异质）
        }
        if (tag !== undefined) {
          const last = rest.slice(rest.lastIndexOf(".") + 1);
          if (tag === "hof" && call.argFns.length > 0) sink.addArgEdges(call.argFns, last, true); // unconditional
          sink.hitTable(`pure:${call.obj}.${typeKey}`); // 迭代21 B 风格：纯侧独立槽位（类型级）
          return;
        }
      }
    }
  }

  if (resolveImport(call, caller, fi, files, projectFiles, resolveSymbol, resolveMod, sink)) return;
  // 4. 效应表
  if (call.obj === null) {
    const b = Object.hasOwn(pack.impureBuiltins, call.attr) ? pack.impureBuiltins[call.attr] : undefined;
    if (b) {
      // 异步边（迭代14 视角 4 F1 修复 + D-092 修正）：setTimeout/setInterval/queueMicrotask 在
      // hofAlwaysArgs（无条件调用实参），触发门必须含它——仅 hofCallsArgs 恒 false（死配置）。
      // 未解析回调记 ?（S4）；否则回调在反向闭包/回归风险不可见
      if (pack.hofAlwaysArgs.has(call.attr) || pack.hofCallsArgs.has(call.attr)) sink.addArgEdges(call.argFns, call.attr);
      sink.addEffect(b);
      sink.hitTable(`builtin:${call.attr}`); // 迭代21 B
      return;
    }
    if (pack.pureBuiltins.has(call.attr)) {
      // HOF（map/filter/sorted…）会调用函数实参：回调效应必须保留，否则假纯
      if (pack.hofAlwaysArgs.has(call.attr) || pack.hofCallsArgs.has(call.attr)) sink.addArgEdges(call.argFns, call.attr);
      sink.hitTable(`builtin:${call.attr}`); // 迭代21 B
      return;
    }
    if (call.attr !== UNRESOLVED_TARGET) sink.missTable(`builtin:${call.attr}`); // 迭代21 B：裸名双未中 → 补表候选
  } else {
    // 迭代35 A1：参数显式类型绑定——obj 是参数且类型已知（Dictionary<string,int> d → d.TryGetValue）
    // → 查 builtinTypeEffects（List/Dictionary/array 的 Add/Remove/TryGetValue 等纯读写信箱）。
    // 迭代36 独立审计 High 修复：项目类名撞表键（项目自建 List/Dictionary 类作参数类型）→ 跳过表绑定
    // ——与 ctor 分支（L504-512）同守卫。否则 `xs.Add`（xs 参数类型为项目 List 类）误判 PURE（假纯红线）。
    // 仅当参数未遮蔽（assigned 无同名重绑）。
    const ptype = caller.paramTypes?.[call.obj ?? ""];
    if (ptype !== undefined && !caller.assigned.includes(call.obj ?? "")) {
      const pcls = globalClasses.get(ptype);
      const isProject = pcls && pcls.length > 0 && pcls.some((c) => c.lang === pack.name);
      if (isProject && !caller.assigned.includes(ptype) && !fi.moduleAssigned.has(ptype)) {
        // 迭代37 P1-3：参数类型为项目类 → 同语言候选类全并集边
        const same = pcls!.filter((c) => c.lang === pack.name);
        const q = `${ptype}.${call.attr}`;
        let any = false;
        for (const c of same) {
          const tf = files.get(c.file);
          if (tf && addUnionEdges(tf, q, sink)) any = true;
        }
        if (any) { sink.hitTable(`type:${ptype}.${call.attr}`); return; }
      } else {
        const rule = pack.builtinTypeEffects[ptype]?.[call.attr];
        if (rule === "hof") { sink.addArgEdges(call.argFns, call.attr); sink.hitTable(`type:${ptype}.${call.attr}`); return; }
        if (rule === "pure") { sink.hitTable(`type:${ptype}.${call.attr}`); return; }
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
    if (lb !== undefined && !Object.hasOwn(caller.paramTypes ?? {}, call.obj ?? "")) {
      const lbCls = globalClasses.get(lb);
      if (lbCls && lbCls.some((c) => c.lang === pack.name)) {
        const same = lbCls.filter((c) => c.lang === pack.name);
        const q = `${lb}.${call.attr}`;
        let any = false;
        for (const c of same) {
          const tf = files.get(c.file);
          if (tf && addUnionEdges(tf, q, sink)) any = true;
        }
        if (any) { sink.hitTable(`lb:${lb}.${call.attr}`); return; }
      }
      const rule = pack.builtinTypeEffects[lb]?.[call.attr];
      if (rule === "hof") { sink.addArgEdges(call.argFns, call.attr); sink.hitTable(`lb:${lb}.${call.attr}`); return; }
      if (rule === "pure") { sink.hitTable(`lb:${lb}.${call.attr}`); return; }
    }
    // 全局类名解析（迭代19 C# 跨文件类调用）——**优先于效应表（迭代21 正确化）**：
    // 项目内类 NetCall 撞效应表条目 NetCall: "net"——项目类优先（真实实现），表条目是通用库名。
    // 遮蔽守卫：调用方局部赋值或模块级重绑（conn = make_evil() 遮蔽 import）→ 不解析
    // 语言隔离（迭代19 复审 F1）：只解析同语言类——跨语言同名类不串味
    const cls = globalClasses.get(call.obj);
    if (cls && !caller.assigned.includes(call.obj) && !fi.moduleAssigned.has(call.obj)) {
      // 迭代37 P1-3：跨文件同名类 + 成员重载 → 全候选并集边（G5：含跨文件多命中）
      const same = cls.filter((c) => c.lang === pack.name);
      const q = `${call.obj}.${call.attr}`;
      let any = false;
      for (const c of same) {
        const tf = files.get(c.file);
        if (tf && addUnionEdges(tf, q, sink)) any = true;
      }
      if (any) return;
    }
    // hasOwn 守卫：impureGlobals 普通对象字面量，继承键（constructor 等）→ undefined（纪律与 B1 同源）
    const rule = Object.hasOwn(pack.impureGlobals, call.obj) ? pack.impureGlobals[call.obj] : undefined;
    if (typeof rule === "string") {
      sink.addEffect(rule); // 模块/全局整体效应类（console: "io"）
      sink.hitTable(`global:${call.obj}`); // 迭代21 B
      return;
    }
    if (Array.isArray(rule)) {
      if (rule.includes(call.attr)) {
        sink.addEffect("io");
        sink.hitTable(`global:${call.obj}`); // 迭代21 B
        return;
      }
      const tagged = rule.find((r) => r.startsWith(call.attr + ":"));
      if (tagged) {
        const cls = tagged.slice(call.attr.length + 1);
        if (cls === "p") {
          sink.hitTable(`global:${call.obj}`); // 迭代21 B
          return; // 纯标记（与 effectFromModule 同语义，A7 原子性守卫，迭代7 发现B）
        }
        sink.addEffect(cls); // "now:clock" / "random:random"
        sink.hitTable(`global:${call.obj}`); // 迭代21 B
        return;
      }
    }
    if (pack.pureGlobals.has(call.obj)) {
      if (pack.hofCallsArgs.has(call.attr)) sink.addArgEdges(call.argFns, call.attr); // Array.from(xs, cb)
      sink.hitTable(`global:${call.obj}`); // 迭代21 B
      return;
    }
    if (call.obj !== UNRESOLVED_TARGET) sink.missTable(`global:${call.obj}`); // 迭代21 B：对象双未中 → 补表候选
  }

  // 5. 星号导入回退；其余裸名记未知，对象方法记动态分派
  if (call.obj === null) {
    for (const wf of fi.wildcards) {
      const hit = resolveSymbol(wf, call.attr, 1);
      if (hit !== null) { sink.addEdge(hit); return; }
    }
    sink.addUnknownCall(call);
    sink.markUnknown();
    return;
  }

  sink.addUnknownCall(call);
  sink.markDynamic();
}
