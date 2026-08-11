import { readFileSync } from "node:fs";
import type { Effect } from "../core/types";
import type { LangPack } from "./pack";

/**
 * 效应表注入（F16，迭代28）：用户扩展效应表而不改库代码。
 *
 * 注入面 = link 期 10 表（link.ts 只读 pack，不缓存，每次扫描重跑）——注入零缓存失效。
 * 提取侧表（literalReceivers/builtinMethodReturns/chunkNodes/callNodes/assignmentTargets/
 * nestingNodes/selfNames 等）改变 RawFileFacts（进 cache.json）——注入会在缓存命中时静默
 * 不生效（不一致），白名单直接拒绝并报错而非静默忽略。
 */
export interface EffectTables {
  readonly impureBuiltins: Readonly<Record<string, Effect>>;
  readonly pureBuiltins: ReadonlySet<string>;
  readonly impureModules: Readonly<Record<string, Effect | readonly string[]>>;
  readonly pureModules: ReadonlySet<string>;
  readonly impureGlobals: Readonly<Record<string, Effect | readonly string[]>>;
  readonly pureGlobals: ReadonlySet<string>;
  readonly frameworkIo: Readonly<Record<string, readonly string[]>>;
  readonly builtinTypeEffects: Readonly<Record<string, Readonly<Record<string, "pure" | "hof">>>>;
  readonly hofCallsArgs: ReadonlySet<string>;
  readonly hofAlwaysArgs: ReadonlySet<string>;
}

/** 注入白名单表名 → 值形状（校验用）。 */
const EFFECT_TABLE_SHAPES: Readonly<Record<keyof EffectTables, "record-effect" | "record-array" | "record-prefix" | "nested-pure-hof" | "set">> = {
  impureBuiltins: "record-effect",
  pureBuiltins: "set",
  impureModules: "record-array",
  pureModules: "set",
  impureGlobals: "record-array",
  pureGlobals: "set",
  frameworkIo: "record-prefix",
  builtinTypeEffects: "nested-pure-hof",
  hofCallsArgs: "set",
  hofAlwaysArgs: "set",
};

const EFFECTS: readonly string[] = ["io", "net", "fs", "db", "random", "clock", "state"];
const PURE_HOF = new Set(["pure", "hof"]);

/** 提取侧表名（白名单拒绝——参与缓存，注入会静默失效）。 */
const EXTRACT_SIDE_TABLES = new Set([
  "literalReceivers", "builtinMethodReturns", "chunkNodes", "classNodes",
  "callNodes", "nestingNodes", "selfNames", "assignmentTargets",
]);

/**
 * 校验 override 形状（信任边界：JSON 文件/用户 API 输入必须验）。
 * - 语言名必须存在于 packsByName；
 * - 表名白名单 = EffectTables 10 键，拒绝提取侧表（显式报错防用户以为注入生效）；
 * - 值形状：Effect ∈ 7 类（挡 "IO"/"network" 错别字）、数组为 string[]、builtinTypeEffects 内层 ∈ pure|hof。
 * 返回错误消息数组；空数组 = 合法。
 */
export function validateEffectOverride(
  overrides: Readonly<Record<string, unknown>>,
  packs: readonly LangPack[],
): string[] {
  const errors: string[] = [];
  const byName = new Set(packs.map((p) => p.name));
  for (const [lang, tables] of Object.entries(overrides)) {
    if (!byName.has(lang)) {
      errors.push(`未知语言 "${lang}"（可用：${[...byName].join("/")}）`);
      continue;
    }
    if (tables === null || typeof tables !== "object" || Array.isArray(tables)) {
      errors.push(`语言 "${lang}" 的 override 必须是对象`);
      continue;
    }
    for (const [table, value] of Object.entries(tables as Record<string, unknown>)) {
      if (EXTRACT_SIDE_TABLES.has(table)) {
        errors.push(`表 "${table}" 是提取侧表（参与缓存，注入会静默失效）——请用库 API 或改语言包`);
        continue;
      }
      const shape = EFFECT_TABLE_SHAPES[table as keyof EffectTables];
      if (shape === undefined) {
        errors.push(`未知表名 "${table}"（可用：${Object.keys(EFFECT_TABLE_SHAPES).join("/")}）`);
        continue;
      }
      if (value === null || typeof value !== "object") {
        errors.push(`表 "${lang}.${table}" 必须是对象`);
        continue;
      }
      if (shape === "set") {
        // Set 并集形态：接受数组（["a","b"]）或对象键（{ a: true }）——都转可迭代；
        // 拒绝其他形状（防 JSON 路径传错在 mergeSet 原生 TypeError 崩溃，迭代28 复审 n2）
        if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item !== "string") errors.push(`表 "${lang}.${table}" 的成员必须是字符串`);
          }
        } else {
          for (const item of Object.keys(value)) {
            if (typeof item !== "string") errors.push(`表 "${lang}.${table}" 的键必须是字符串`);
          }
        }
        continue;
      }
      if (shape === "nested-pure-hof") {
        for (const [typeName, methods] of Object.entries(value as Record<string, unknown>)) {
          if (methods === null || typeof methods !== "object" || Array.isArray(methods)) {
            errors.push(`表 "${lang}.${table}.${typeName}" 必须是对象`);
            continue;
          }
          for (const [m, cls] of Object.entries(methods as Record<string, unknown>)) {
            if (typeof cls !== "string" || !PURE_HOF.has(cls)) {
              errors.push(`表 "${lang}.${table}.${typeName}.${m}" 必须是 "pure" 或 "hof"（得 "${String(cls)}"）`);
            }
          }
        }
        continue;
      }
      // record-effect / record-array / record-prefix：值按元素检查
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        if (shape === "record-effect") {
          if (typeof v !== "string" || !EFFECTS.includes(v)) {
            errors.push(`表 "${lang}.${table}.${key}" 必须是效应类之一（${EFFECTS.join("/")}，得 "${String(v)}"）`);
          }
        } else if (shape === "record-array") {
          // impureGlobals/impureModules 值支持两种形态：标量效应类（"net"）或成员数组（["a","b:p"]）
          if (typeof v === "string") {
            if (!EFFECTS.includes(v)) {
              errors.push(`表 "${lang}.${table}.${key}" 的标量值必须是效应类之一（${EFFECTS.join("/")}，得 "${v}"）`);
            }
          } else if (Array.isArray(v)) {
            for (const item of v) {
              if (typeof item !== "string") errors.push(`表 "${lang}.${table}.${key}" 的数组元素必须是字符串`);
            }
          } else {
            errors.push(`表 "${lang}.${table}.${key}" 必须是效应类字符串或字符串数组`);
          }
        } else if (Array.isArray(v)) {
          for (const item of v) {
            if (typeof item !== "string") errors.push(`表 "${lang}.${table}.${key}" 的数组元素必须是字符串`);
          }
        } else {
          errors.push(`表 "${lang}.${table}.${key}" 必须是字符串数组`);
        }
      }
    }
  }
  return errors;
}

/** Record 值并集去重（数组元素语义：成员前缀表/效应类列表）。 */
function mergeRecord<K extends string, T>(
  base: Readonly<Record<K, T>>,
  override: Readonly<Record<K, T>> | undefined,
): Readonly<Record<K, T>> {
  if (!override) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const b = (base as Record<string, unknown>)[k];
    if (Array.isArray(b) && Array.isArray(v)) {
      out[k] = [...new Set([...b, ...v])]; // 数组并集：扩展现有键（frameworkIo this）不丢内置前缀
    } else {
      out[k] = v; // 键级浅合并：同键标量覆盖（方向可纠正）
    }
  }
  return out as Readonly<Record<K, T>>;
}

/** 两层深合并（builtinTypeEffects：给 str 加一个方法不丢内置 8 个）。 */
function mergeNested(
  base: Readonly<Record<string, Readonly<Record<string, "pure" | "hof">>>>,
  override: Readonly<Record<string, Readonly<Record<string, "pure" | "hof">>>> | undefined,
): Readonly<Record<string, Readonly<Record<string, "pure" | "hof">>>> {
  if (!override) return base;
  const out: Record<string, Record<string, "pure" | "hof">> = {};
  for (const [t, methods] of Object.entries(base)) out[t] = { ...methods };
  for (const [t, methods] of Object.entries(override)) {
    const existing = out[t] ?? {};
    out[t] = { ...existing, ...methods };
  }
  return out;
}

/** Set 并集（纯表追加不删内置）。override 接受 Set/数组/对象键——JSON 路径与 JS 用户传法都安全（迭代28 复审 n2）。 */
function mergeSet(
  base: ReadonlySet<string>,
  override: ReadonlySet<string> | readonly string[] | Readonly<Record<string, unknown>> | undefined,
): ReadonlySet<string> {
  if (!override) return base;
  const items: string[] =
    override instanceof Set ? [...override]
    : Array.isArray(override) ? [...override]
    : Object.keys(override); // 对象键形态（{ a: true }）
  if (items.length === 0) return base;
  return new Set([...base, ...items]);
}

/**
 * 合并 override 到 pack（键只增不删；标量覆盖；数组并集；builtinTypeEffects 两层深合并）。
 * 返回合并后的克隆 pack；override 为空对象 → 返回原 pack 引用（短路，零行为变化）。
 * 调用方负责先 validateEffectOverride（本函数不做校验——信任边界在入口）。
 */
export function applyEffectOverrides(
  pack: LangPack,
  override: Readonly<Partial<EffectTables>> | undefined,
): LangPack {
  if (!override || Object.keys(override).length === 0) return pack;
  return {
    ...pack,
    impureBuiltins: mergeRecord(pack.impureBuiltins, override.impureBuiltins as never),
    pureBuiltins: mergeSet(pack.pureBuiltins, override.pureBuiltins as ReadonlySet<string> | undefined),
    impureModules: mergeRecord(pack.impureModules, override.impureModules as never),
    pureModules: mergeSet(pack.pureModules, override.pureModules as ReadonlySet<string> | undefined),
    impureGlobals: mergeRecord(pack.impureGlobals, override.impureGlobals as never),
    pureGlobals: mergeSet(pack.pureGlobals, override.pureGlobals as ReadonlySet<string> | undefined),
    frameworkIo: mergeRecord(pack.frameworkIo, override.frameworkIo as never),
    builtinTypeEffects: mergeNested(pack.builtinTypeEffects, override.builtinTypeEffects as never),
    hofCallsArgs: mergeSet(pack.hofCallsArgs, override.hofCallsArgs as ReadonlySet<string> | undefined),
    hofAlwaysArgs: mergeSet(pack.hofAlwaysArgs, override.hofAlwaysArgs as ReadonlySet<string> | undefined),
  };
}

/**
 * 从 JSON 文件加载 override（CLI --effect-table 预留）。
 * 抛错信息含路径（调用方负责捕获 → exit 2）。
 */
export function loadEffectOverrides(path: string): Readonly<Record<string, unknown>> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("effect table override 必须是对象（{ 语言名: { 表名: 值 } }）");
  }
  return parsed as Readonly<Record<string, unknown>>;
}
