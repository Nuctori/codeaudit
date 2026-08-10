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
  readonly chunkByKey: Map<string, RawChunk>;
}

export interface LinkOutput {
  readonly chunks: Chunk[];
  readonly dynamicCalls: number;
}

export function link(
  allFacts: readonly RawFileFacts[],
  packs: ReadonlyMap<string, LangPack>,
): LinkOutput {
  const projectFiles = new Set(allFacts.map((f) => f.file));

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
        const target = pack.resolveModule(imp.module, facts.file, projectFiles);
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

    files.set(facts.file, { facts, pack, byQualified, ambiguous, bySimple, importMap, wildcards, chunkByKey });
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
      const target = fi.pack.resolveModule(imp.module, file, projectFiles);
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

      const effectFromModule = (rawModule: string, member: string | null): boolean => {
        const module = rawModule.replace(/^node:/, ""); // node:fs ≡ fs
        const rule = fi.pack.impureModules[module];
        if (rule === "*" || (Array.isArray(rule) && member !== null && rule.includes(member))) {
          direct.add("io");
          return true;
        }
        if (fi.pack.pureModules.has(module)) return true;
        return false;
      };

      for (const call of rc.calls) {
        resolveCall(call, rc, fi, files, projectFiles, resolveSymbol, {
          addEdge: (k) => calls.add(k),
          addEffect: (e) => direct.add(e),
          markUnknown: () => { unknownSites++; calls.add(UNKNOWN_TARGET); },
          markDynamic: () => { dynamicCalls++; unknownSites++; calls.add(UNKNOWN_TARGET); },
          addArgEdges: (names) => {
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
                const target = fi.pack.resolveModule(imp.module, fi.facts.file, projectFiles);
                if (target !== null) {
                  const hit = resolveSymbol(target, imp.imported, 0);
                  if (hit !== null) { calls.add(hit); continue; }
                }
              }
              // 解析不到（变量实参/外部函数）：跳过——无法区分 max(xs) 与 map(ext_fn)，
              // 记未知会把 max(xs) 这类常见形态误伤成噪音
            }
          },
          effectFromModule,
        });
      }

      out.push({
        // 公理4：id 由内容直接重算，与 key 的去重后缀无关（module 用文件限定 id）
        id: rc.name === "<module>" ? `module@${file}` : chunkId(rc.normText),
        key,
        name: rc.ownerClass ? `${rc.ownerClass}.${rc.name}` : rc.name,
        file,
        line: rc.line,
        endLine: rc.endLine,
        nesting: rc.nesting,
        direct,
        calls,
        unknownSites,
      });
    }
  }

  return { chunks: out, dynamicCalls };
}

interface Sink {
  addEdge(key: string): void;
  addEffect(effect: string): void;
  markUnknown(): void;
  markDynamic(): void;
  addArgEdges(names: readonly string[]): void;
  effectFromModule(module: string, member: string | null): boolean;
}

function resolveCall(
  call: RawCall,
  caller: RawChunk,
  fi: FileIndex,
  files: ReadonlyMap<string, FileIndex>,
  projectFiles: ReadonlySet<string>,
  resolveSymbol: (file: string, name: string, depth: number) => string | null,
  sink: Sink,
): void {
  const pack = fi.pack;

  // 1. self/this 方法调用 → 所在类（同名冲突时诚实记未知）
  if (call.obj !== null && pack.selfNames.includes(call.obj)) {
    if (caller.ownerClass) {
      const q = `${caller.ownerClass}.${call.attr}`;
      if (!fi.ambiguous.has(q)) {
        const key = fi.byQualified.get(q);
        if (key) { sink.addEdge(key); return; }
      }
    }
    sink.markUnknown(); // 继承/混入/冲突：诚实标记
    return;
  }

  // 2. 裸名：同文件定义
  if (call.obj === null) {
    const local = fi.bySimple.get(call.attr);
    if (local && local.length > 0) { sink.addEdge(local[0]!); return; }
  }

  // 2.5 框架命名空间（egg ctx.model.* / ctx.service.* → io 边界；遮蔽/参数同名则跳过判定）
  if (call.obj !== null && !caller.assigned.includes(call.obj)) {
    const prefixes = pack.frameworkIo[call.obj];
    if (prefixes) {
      for (const p of prefixes) {
        if (call.attr === p || call.attr.startsWith(p + ".")) {
          sink.addEffect("io");
          return;
        }
      }
    }
  }

  // 3. import 映射
  const binding = call.obj ?? call.attr;
  const imp = fi.importMap.get(binding);
  if (imp) {
    if (imp.imported === null) {
      // 命名空间导入：import os / import * as fs / const fs = require("fs")
      const member = call.obj !== null ? call.attr : null;
      const target = pack.resolveModule(imp.module, fi.facts.file, projectFiles);
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
        sink.markUnknown();
        return;
      }
      if (member !== null && sink.effectFromModule(imp.module, member)) {
        if (pack.hofCallsArgs.has(member)) sink.addArgEdges(call.argFns); // functools.reduce(cb, …)
        return;
      }
      if (sink.effectFromModule(imp.module, null)) return;
      sink.markUnknown();
      return;
    }
    // from 导入：from db import save_user → save_user(...)
    if (call.obj === null) {
      const target = pack.resolveModule(imp.module, fi.facts.file, projectFiles);
      if (target !== null) {
        const name = imp.imported === "default"
          ? (files.get(target)?.facts.defaultExport ?? imp.imported)
          : imp.imported;
        const hit = resolveSymbol(target, name, 0);
        if (hit !== null) { sink.addEdge(hit); return; }
        sink.markUnknown();
        return;
      }
      if (sink.effectFromModule(imp.module, imp.imported)) return;
      sink.markUnknown();
      return;
    }
    // from db import conn; conn.execute(...) → 模块导出面解析：类成员真边；外部模块走效应表；重绑遮蔽则跳过
    if (call.obj !== null && !caller.assigned.includes(call.obj)) {
      const target = pack.resolveModule(imp.module, fi.facts.file, projectFiles);
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
          // 命名空间再导出链：ns 在 target 里是 export * as ns from → 继续解析 attr
          const nsImp = tf.importMap.get(name);
          if (nsImp && nsImp.imported === null) {
            const t2 = pack.resolveModule(nsImp.module, target, projectFiles);
            if (t2 !== null) {
              const hit2 = resolveSymbol(t2, call.attr, 0);
              if (hit2 !== null) { sink.addEdge(hit2); return; }
            }
          }
        }
      } else if (sink.effectFromModule(imp.module, call.attr)) {
        if (pack.hofCallsArgs.has(call.attr)) sink.addArgEdges(call.argFns); // _.map(cb, xs)
        return;
      }
    }
    sink.markDynamic();
    return;
  }

  // 4. 效应表
  if (call.obj === null) {
    if (pack.impureBuiltins.has(call.attr)) { sink.addEffect("io"); return; }
    if (pack.pureBuiltins.has(call.attr)) {
      // HOF（map/filter/sorted…）会调用函数实参：回调效应必须保留，否则假纯
      if (pack.hofCallsArgs.has(call.attr)) sink.addArgEdges(call.argFns);
      return;
    }
  } else {
    const rule = pack.impureGlobals[call.obj];
    if (rule === "*" || (Array.isArray(rule) && rule.includes(call.attr))) {
      sink.addEffect("io");
      return;
    }
    if (pack.pureGlobals.has(call.obj)) {
      if (pack.hofCallsArgs.has(call.attr)) sink.addArgEdges(call.argFns); // Array.from(xs, cb)
      return;
    }
  }

  // 5. 星号导入回退；其余裸名记未知，对象方法记动态分派
  if (call.obj === null) {
    for (const wf of fi.wildcards) {
      const hit = resolveSymbol(wf, call.attr, 1);
      if (hit !== null) { sink.addEdge(hit); return; }
    }
    sink.markUnknown();
    return;
  }

  sink.markDynamic();
}
