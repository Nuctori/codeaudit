import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validatePackConsistency } from "../../src/lang/pack";
import { csharpPack } from "../../src/lang/packs/csharp";
import { pythonPack } from "../../src/lang/packs/python";
import { typescriptPack, tsxPack } from "../../src/lang/packs/typescript";
import { javascriptPack } from "../../src/lang/packs/javascript";
import { applyEffectOverrides } from "../../src/lang/effectOverride";

/** 内置 5 注册 pack（ts/tsx 共用数据、js spread 复用 TS）。 */
const packs = [csharpPack, pythonPack, typescriptPack, tsxPack, javascriptPack];

describe("pack 一致性断言（迭代41）", () => {
	it("内置 5 注册 pack 全部一致（M1-M6 零违规）", () => {
		for (const p of packs) {
			expect(validatePackConsistency(p), p.name).toEqual([]);
		}
	});

	it("override 夹具合并后仍一致（通用示例）", () => {
		let raw: unknown;
		try {
			raw = JSON.parse(
				readFileSync(
					join(__dirname, "../../examples/effect-override-example.json"),
					"utf8",
				),
			);
		} catch (e) {
			throw new Error(`夹具读取失败：${(e as Error).message}`);
		}
		const ovs = raw as Record<string, unknown>;
		for (const [lang, ov] of Object.entries(ovs)) {
			const pack = packs.find((p) => p.name === lang);
			if (pack) {
				expect(
					validatePackConsistency(applyEffectOverrides(pack, ov as never)),
					`${lang} 合并后`,
				).toEqual([]);
			}
		}
	});

	it("人为制造 M5 违反（pureCtor ∩ impureGlobals）→ 断言触发", () => {
		// Debug ∈ impureGlobals(string 值键)——探针实证合并后 M5 红
		const bad = applyEffectOverrides(csharpPack, {
			pureCtor: new Set(["Debug"]),
		} as never);
		expect(validatePackConsistency(bad).some((m) => m.startsWith("M5"))).toBe(
			true,
		);
	});

	it("人为制造 M6 违反（hofAlwaysArgs ⊄ hofCallsArgs）→ 断言触发", () => {
		const bad = applyEffectOverrides(pythonPack, {
			hofAlwaysArgs: new Set(["evil_hof"]),
		} as never);
		expect(validatePackConsistency(bad).some((m) => m.startsWith("M6"))).toBe(
			true,
		);
	});

	it("人为制造 M3s 违反（string 值键 impureGlobals ∩ pureGlobals）→ 断言触发", () => {
		const bad = applyEffectOverrides(csharpPack, {
			pureGlobals: new Set(["Debug"]),
		} as never);
		expect(validatePackConsistency(bad).some((m) => m.startsWith("M3s"))).toBe(
			true,
		);
	});
});
