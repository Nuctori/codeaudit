import type { LangPack, RawCall, RawChunk, RawFileFacts, RawImport } from "../lang/pack";
import { type Chunk, UNKNOWN_TARGET } from "../core/types";
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
  let dynamicCalls = 0;

  for (const facts of allFacts) {
    const pack = packs.get(facts.lang)!;
    const byQualified = new Map<string, string>();
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

    files.set(facts.file, { facts, pack, byQualified, ambiguous, bySimple, importMap, wildcards, chunkByKey, moduleAssigned });
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

  for (const [file, fi] of files) {
    for (const [key, rc] of fi.chunkByKey) {
      const direct = new Set<string>();
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
        if (rule === "*" || (Array.isArray(rule) && member !== null && rule.includes(member))) {
          direct.add("io");
          return true;
        }
        // 显式纯成员（"member:p" 标记）：拆表模块中可证的纯计算（json.dumps、crypto.createHash…）
        if (Array.isArray(rule) && member !== null && rule.includes(member + ":p")) return true;
        if (fi.pack.pureModules.has(module)) return true;
        return false;
      };

      for (const call of rc.calls) {
        resolveCall(call, rc, fi, files, projectFiles, resolveSymbol, resolveMod, {
          addEdge: (k) => calls.add(k),
          addEffect: (e) => direct.add(e),
          markUnknown: () => { unknownSites++; calls.add(UNKNOWN_TARGET); },
          markDynamic: () => { unknownSites++; calls.add(UNKNOWN_TARGET); },
          addUnknownCall: (call) => unknownCalls.push({ attr: call.attr, obj: call.obj, root: rootOf(call) }),
          addArgEdges: (names, hof) => {
            for (const n of names) {
              // 成员形回调：this.log / self.render → 当前类的同名方法（HOF 成员形假纯修复）
              const dotIdx = n.indexOf(".");
              if (dotIdx !== -1 && rc.ownerClass && fi.pack.selfNames.includes(n.slice(0, dotIdx))) {
                const q = `${rc.ownerClass}.${n.slice(dotIdx + 1)}`;
                if (!fi.ambiguous.has(q)) {
                  const hit = fi.byQualified.get(q);
                  if (hit) { calls.add(hit); continue; }
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
              if (fi.pack.hofAlwaysArgs.has(hof)) calls.add(UNKNOWN_TARGET);
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
      });
    }
  }

  return { chunks: out };
}

interface Sink {
  addEdge(key: string): void;
  addEffect(effect: string): void;
  markUnknown(): void;
  markDynamic(): void;
  addUnknownCall(call: RawCall): void;
  addArgEdges(names: readonly string[], hof: string): void;
  effectFromModule(module: string, member: string | null): boolean;
}

function resolveCall(
  call: RawCall,
  caller: RawChunk,
  fi: FileIndex,
  files: ReadonlyMap<string, FileIndex>,
  projectFiles: ReadonlySet<string>,
  resolveSymbol: (file: string, name: string, depth: number) => string | null,
  resolveMod: (pack: LangPack, module: string, fromFile: string) => string | null,
  sink: Sink,
): void {
  const pack = fi.pack;

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
  if (call.obj !== null && pack.selfNames.includes(call.obj)) {
    if (caller.ownerClass) {
      const q = `${caller.ownerClass}.${call.attr}`;
      if (!fi.ambiguous.has(q)) {
        const key = fi.byQualified.get(q);
        if (key) { sink.addEdge(key); return; }
      }
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
        sink.addUnknownCall(call);
        sink.markUnknown(); // 同名顶层重定义：不静默选一
        return;
      }
      // 仅方法候选：裸名调用不指向方法 → 落到后续分支（import/效应表/未知）
    }
  }

  // 2.5 框架命名空间（egg ctx.model.* / ctx.service.* → io 边界；遮蔽/参数同名则跳过判定）
  if (call.obj !== null && !caller.assigned.includes(call.obj)) {
    // Object.hasOwn 守卫：frameworkIo 是普通对象字面量，裸下标/`in` 会命中继承的
    // Object.prototype 键（hasOwnProperty/toString/constructor…）→ truthy → for...of 函数崩溃（DoS）
    const prefixes = Object.hasOwn(pack.frameworkIo, call.obj) ? pack.frameworkIo[call.obj] : undefined;
    if (prefixes) {
      for (const p of prefixes) {
        if (call.attr === p || call.attr.startsWith(p + ".")) {
          sink.addEffect("io");
          return;
        }
      }
    }
  }

  // 3. import 映射（绑定被遮蔽——赋值/参数/模块级重绑——则不解析，落到效应表/未知诚实处理）
  const binding = call.obj ?? call.attr;
  const imp = fi.importMap.get(binding);
  if (imp && !caller.assigned.includes(binding) && !fi.moduleAssigned.has(binding)) {
    if (imp.imported === null) {
      // 命名空间导入：import os / import * as fs / const fs = require("fs")
      const member = call.obj !== null ? call.attr : null;
      const target = resolveMod(pack, imp.module, fi.facts.file);
      if (target !== null) {
        if (member !== null) {
          const hit = resolveSymbol(target, member, 0);
          if (hit !== null) { sink.addEdge(hit); return; }
          // 点连成员：import a.b; a.b.fn() → callOf 首点切分得 obj=a、attr=b.fn，
          // 全名 a.b.fn 去掉模块路径 a.b 后的段（fn）在模块内解析（遮蔽重绑则跳过）
          if (call.obj !== null && !caller.assigned.includes(call.obj)) {
            const full = `${call.obj}.${call.attr}`;
            if (full.startsWith(imp.module + ".")) {
              const inner = full.slice(imp.module.length + 1);
              const hit2 = resolveSymbol(target, inner, 0);
              if (hit2 !== null) { sink.addEdge(hit2); return; }
            }
          }
        }
        sink.addUnknownCall(call);
        sink.markUnknown();
        return;
      }
      if (member !== null && sink.effectFromModule(imp.module, member)) {
        if (pack.hofCallsArgs.has(member)) sink.addArgEdges(call.argFns, member); // functools.reduce(cb, …)
        return;
      }
      if (sink.effectFromModule(imp.module, null)) return;
      sink.addUnknownCall(call);
      sink.markUnknown();
      return;
    }
    // from 导入：from db import save_user → save_user(...)
    if (call.obj === null) {
      const target = resolveMod(pack, imp.module, fi.facts.file);
      if (target !== null) {
        const name = imp.imported === "default"
          ? (files.get(target)?.facts.defaultExport ?? imp.imported)
          : imp.imported;
        const hit = resolveSymbol(target, name, 0);
        if (hit !== null) { sink.addEdge(hit); return; }
        sink.addUnknownCall(call);
        sink.markUnknown();
        return;
      }
      if (sink.effectFromModule(imp.module, imp.imported)) {
        // HOF 实参回调边（与命名空间分支对称）：from functools import reduce; reduce(write, xs) → write 效应保留
        if (pack.hofCallsArgs.has(imp.imported)) sink.addArgEdges(call.argFns, imp.imported);
        return;
      }
      sink.addUnknownCall(call);
      sink.markUnknown();
      return;
    }
    // from db import conn; conn.execute(...) → 模块导出面解析：类成员真边；外部模块走效应表；重绑遮蔽则跳过
    if (call.obj !== null && !caller.assigned.includes(call.obj)) {
      const target = resolveMod(pack, imp.module, fi.facts.file);
      const name = imp.imported === "default"
        ? (target !== null ? (files.get(target)?.facts.defaultExport ?? imp.imported) : imp.imported)
        : imp.imported;
      if (target !== null) {
        const tf = files.get(target);
        if (tf) {
          const q = `${name}.${call.attr}`;
          if (!tf.ambiguous.has(q)) {
            const hit = tf.byQualified.get(q);
            if (hit) { sink.addEdge(hit); return; }
          }
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
                  if (hit2) { sink.addEdge(hit2); return; }
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
              if (hit2 !== null) { sink.addEdge(hit2); return; }
            }
          }
        }
      } else if (sink.effectFromModule(imp.module, call.attr)) {
        if (pack.hofCallsArgs.has(call.attr)) sink.addArgEdges(call.argFns, call.attr); // _.map(cb, xs)
        return;
      }
    }
    sink.addUnknownCall(call);
    sink.markDynamic();
    return;
  }

  // 4. 效应表
  if (call.obj === null) {
    if (pack.impureBuiltins.has(call.attr)) { sink.addEffect("io"); return; }
    if (pack.pureBuiltins.has(call.attr)) {
      // HOF（map/filter/sorted…）会调用函数实参：回调效应必须保留，否则假纯
      if (pack.hofCallsArgs.has(call.attr)) sink.addArgEdges(call.argFns, call.attr);
      return;
    }
  } else {
    // hasOwn 守卫：impureGlobals 普通对象字面量，继承键（constructor 等）→ undefined（纪律与 B1 同源）
    const rule = Object.hasOwn(pack.impureGlobals, call.obj) ? pack.impureGlobals[call.obj] : undefined;
    if (rule === "*" || (Array.isArray(rule) && rule.includes(call.attr))) {
      sink.addEffect("io");
      return;
    }
    if (pack.pureGlobals.has(call.obj)) {
      if (pack.hofCallsArgs.has(call.attr)) sink.addArgEdges(call.argFns, call.attr); // Array.from(xs, cb)
      return;
    }
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
