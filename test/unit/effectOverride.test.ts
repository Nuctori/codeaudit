import { describe, it, expect } from "vitest";
import { applyEffectOverrides, validateEffectOverride } from "../../src/lang/effectOverride";
import { csharpPack } from "../../src/lang/packs/csharp";
import { pythonPack } from "../../src/lang/packs/python";
import { typescriptPack } from "../../src/lang/packs/typescript";
import type { LangPack } from "../../src/lang/pack";

const PACKS: readonly LangPack[] = [pythonPack, typescriptPack, csharpPack];

describe("F16 效应表注入（迭代28）", () => {
  it("Record 键级浅合并 + 标量覆盖（impureGlobals 追加不删内置）", () => {
    const base = csharpPack.impureGlobals;
    const merged = applyEffectOverrides(csharpPack, {
      impureGlobals: { NetCall: "net", Debug: "state" }, // Debug 覆盖内置 io→state（方向可纠正）
    });
    expect(merged.impureGlobals).not.toBe(base); // 合并克隆非原引用
    expect(merged.impureGlobals.NetCall).toBe("net"); // 注入生效
    expect(merged.impureGlobals.Debug).toBe("state"); // 同键标量覆盖
    expect(Object.keys(base).length).toBeGreaterThan(0); // 内置表非空
    for (const k of Object.keys(base)) expect(merged.impureGlobals).toHaveProperty(k); // 内置键全保留
  });

  it("frameworkIo 键扩展数组并集（不重列内置前缀）", () => {
    const merged = applyEffectOverrides(csharpPack, {
      frameworkIo: { this: ["AddComponent"] },
    });
    const prefixes = merged.frameworkIo["this"];
    expect(prefixes).toContain("AddComponent"); // 注入前缀
    for (const p of csharpPack.frameworkIo["this"]) expect(prefixes).toContain(p); // 内置前缀全保留（并集）
  });

  it("Set 并集（pureGlobals 追加）", () => {
    const merged = applyEffectOverrides(csharpPack, {
      pureGlobals: new Set(["MyPureUtil"]),
    });
    expect(merged.pureGlobals.has("MyPureUtil")).toBe(true);
    expect(csharpPack.pureGlobals.size).toBeGreaterThan(0);
    for (const p of csharpPack.pureGlobals) expect(merged.pureGlobals.has(p)).toBe(true);
  });

  it("builtinTypeEffects 两层深合并（给 str 加方法不丢内置）", () => {
    const merged = applyEffectOverrides(csharpPack, {
      builtinTypeEffects: { string: { MyCustom: "pure" } },
    });
    expect(merged.builtinTypeEffects["string"]).toBeDefined();
    expect(merged.builtinTypeEffects["string"]!.MyCustom).toBe("pure");
    for (const [m, cls] of Object.entries(csharpPack.builtinTypeEffects["string"] ?? {})) {
      expect(merged.builtinTypeEffects["string"]![m]).toBe(cls); // 内置方法全保留
    }
  });

  it("空 override → 返回原 pack 引用（短路零行为变化）", () => {
    expect(applyEffectOverrides(csharpPack, undefined)).toBe(csharpPack);
    expect(applyEffectOverrides(csharpPack, {})).toBe(csharpPack);
  });

  it("迭代37 P1-1：frameworkPure 三层深合并（ns → type → 成员表并集不丢内置）", () => {
    const merged = applyEffectOverrides(csharpPack, {
      frameworkPure: {
        System: {
          Text: { StringBuilder: "pure", Encoding: "pure", MyExtra: "pure" },
          Linq: "hof",
        },
      },
    });
    // 内置 System.Text 三子键全保留 + 注入的 MyExtra 追加
    const text = merged.frameworkPure?.System?.Text as Record<string, string> | undefined;
    expect(text).toBeDefined();
    expect(text!.StringBuilder).toBe("pure");
    expect(text!.Encoding).toBe("pure");
    expect(text!.RegularExpressions).toBe("pure");
    expect(text!.MyExtra).toBe("pure");
    // 整类型键注入（Linq）覆盖式生效
    expect(merged.frameworkPure?.System?.Linq).toBe("hof");
    // 未列 ns 的既有键不动
    expect(merged.frameworkPure?.System?.Uri).toBe("pure");
  });

  it("迭代37 P1-1：pureCtor Set 并集 + 校验（合法注入/非法形状/非法 tag）", () => {
    const merged = applyEffectOverrides(csharpPack, {
      pureCtor: new Set(["MyWidget", "MyBuffer"]),
    });
    expect(merged.pureCtor).toBeDefined();
    expect(merged.pureCtor!.has("MyWidget")).toBe(true);
    expect(merged.pureCtor!.has("MyBuffer")).toBe(true);
    expect(merged.pureCtor!.has("List")).toBe(true); // 内置全保留
    // 校验：ns-nested-pure-hof 合法形状
    expect(validateEffectOverride(
      { csharp: { frameworkPure: { System: { MyLib: { A: "pure", B: "hof" } } } } }, PACKS,
    ).length).toBe(0);
    // 非法 tag 拒绝
    expect(validateEffectOverride(
      { csharp: { frameworkPure: { System: { MyLib: { A: "evil" } } } } }, PACKS,
    ).length).toBe(1);
    // 非法形状拒绝（type 值既非字符串也非对象）
    expect(validateEffectOverride(
      { csharp: { frameworkPure: { System: { MyLib: [42] } } } }, PACKS,
    ).length).toBe(1);
    // pureCtor set 形状校验
    expect(validateEffectOverride({ csharp: { pureCtor: ["A", "B"] } }, PACKS).length).toBe(0);
  });

  it("校验：未知语言 / 提取侧表 / 非法效应类拒绝", () => {
    expect(validateEffectOverride({ unknownLang: { impureGlobals: { X: "io" } } }, PACKS).length).toBe(1);
    expect(validateEffectOverride({ csharp: { literalReceivers: { x: "y" } } }, PACKS).length).toBe(1);
    expect(validateEffectOverride({ csharp: { impureGlobals: { X: "IO" } } }, PACKS).length).toBe(1);
    expect(validateEffectOverride({ csharp: { impureGlobals: { X: "net" } } }, PACKS).length).toBe(0);
    expect(validateEffectOverride({ csharp: { builtinTypeEffects: { s: { m: "pure" } } } }, PACKS).length).toBe(0);
    expect(validateEffectOverride({ csharp: { builtinTypeEffects: { s: { m: "evil" } } } }, PACKS).length).toBe(1);
    expect(validateEffectOverride({ csharp: { impureModules: { fs: ["read", "write:p"] } } }, PACKS).length).toBe(0);
    // set 表双形态：数组（纯表并集可迭代）与对象键都合法；数组内非法成员拒绝（迭代28 复审 n2）
    expect(validateEffectOverride({ csharp: { pureGlobals: ["MyHelper"] } }, PACKS).length).toBe(0);
    expect(validateEffectOverride({ csharp: { pureGlobals: { MyHelper: true } } }, PACKS).length).toBe(0);
    expect(validateEffectOverride({ csharp: { pureGlobals: [42] } }, PACKS).length).toBe(1);
  });
});
