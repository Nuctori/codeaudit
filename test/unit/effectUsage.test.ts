import { describe, it, expect } from "vitest";
import { classifyUsage } from "../../src/core/effectUsage";
import { csharpPack } from "../../src/lang/packs/csharp";
import { pythonPack } from "../../src/lang/packs/python";

describe("classifyUsage 分语言记账（迭代33 TP4）", () => {
	it("hit/miss 按 pack 前缀分桶——csharp 命中/未中不进 python 行", () => {
		const packs = new Map([
			["csharp", csharpPack],
			["python", pythonPack],
		]);
		// 构造分语言记账：csharp Debug 命中（impureGlobals → global:Debug 枚举）、
		// csharp urlBuilder_ 未中（非表键，missSlots 兜底）；python os 命中（impureModules → module:os）
		const hit = new Map([
			["csharp\u0000global:Debug", 3],
			["python\u0000module:os", 1],
		]);
		const miss = new Map([
			["csharp\u0000global:urlBuilder_", 5],
			["python\u0000module:requests", 2],
		]);
		const usage = classifyUsage(packs, hit, miss);
		const csharp = usage.find((u) => u.pack === "csharp")!;
		const python = usage.find((u) => u.pack === "python")!;
		// missSites 各自只含本语言前缀的条目（csharp 5 / python 2）——TP4 修复前两行同为 7（全语言共享）
		expect(csharp.summary.missSites).toBe(5);
		expect(python.summary.missSites).toBe(2);
		// hits 是"有命中的表键数"（各 1 键命中：csharp global:Debug / python module:os）——TP4 修复前
		// python 行会显示 csharp 的命中键（全局 Map 共享），修复后各自归位
		expect(csharp.summary.hits).toBe(1);
		expect(python.summary.hits).toBe(1);
	});

	it("迭代34 TP4 修复：module 命中键带 pack 前缀（effectFromModule 直写路径）", () => {
		const packs = new Map([
			["csharp", csharpPack],
			["python", pythonPack],
		]);
		// effectFromModule 的 5 处 bump 在 sink 构造前——模拟它产出的带前缀键（迭代34 Med-High 修复）：
		// 此前 module:os 无前缀 → classifyUsage 按 pack 过滤后 python 行 hits=0/corpus-inactive（数据损坏）
		const hit = new Map([
			["python\u0000module:os", 7], // os 模块命中（effectFromModule 直写）
			["python\u0000module:json", 3],
		]);
		const usage = classifyUsage(packs, hit, new Map());
		const python = usage.find((u) => u.pack === "python")!;
		// os/json 都在 python impureModules → 枚举表键 → 命中计入 hits（TP4 修复前无前缀键 → 全 0）
		expect(python.summary.hits).toBe(2);
		// corpus-inactive 是"表有键但语料未咨询"（91 条目中 89 个未命中）——正常，不淹没 hits
		expect(python.summary.hits).toBeGreaterThan(0);
	});
});
