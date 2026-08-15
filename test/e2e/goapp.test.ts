import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { Purity, type Verdict } from "../../src/core/types";

const FIX = join(__dirname, "..", "fixtures", "goapp");

function index(report: { verdicts: Verdict[] }): Map<string, Verdict> {
	const m = new Map<string, Verdict>();
	for (const v of report.verdicts) {
		m.set(`${v.chunk.file}::${v.chunk.name}`, v);
	}
	return m;
}

describe("E2E: goapp（Go——真实项目 hugo 驱动的盲区固化）", () => {
	it("跨包调用（目录包解析）+ 效应表命中 + 传染链", async () => {
		const report = await scanProject(FIX);
		const by = index(report);

		// Export：os.ReadFile（别名 f "os"）→ fs 效应源 chain=0
		const exportFn = by.get("helper/export.go::Export")!;
		expect(exportFn.purity).toBe(Purity.IMPURE);
		expect(exportFn.chain).toBe(0);
		expect(exportFn.effects.has("fs")).toBe(true);
		// 同包跨文件裸名边（bareNamesCrossFile）：Export 调 util.go 的 bare
		expect(
			[...exportFn.chunk.calls].some((k) => k.startsWith("helper/util.go::")),
		).toBe(true);

		// bare：叶子纯函数（无调用、无直接效应）——链传播验证看 Export 的 calls 而非 bare 自身
		const bare = by.get("helper/util.go::bare")!;
		expect(bare.purity).toBe(Purity.PURE);

		// main：跨包调用 helper.Export（目录包解析）→ fs 经跨包边传播
		const main = by.get("main.go::main")!;
		expect(main.purity).toBe(Purity.IMPURE);
		expect(main.effects.has("fs")).toBe(true);
		expect(
			[...main.chunk.calls].some((k) => k.startsWith("helper/export.go::")),
		).toBe(true);
	});

	it("类型转换不产生未知调用点（int/string 高频盲区）", async () => {
		const report = await scanProject(FIX);
		const by = index(report);

		const convert = by.get("helper/util.go::Convert")!;
		expect(convert.purity).toBe(Purity.PURE);
		expect(convert.chunk.unknownSites).toBe(0); // int(x)/string(...) 不是调用
	});

	it("fmt/time 效应分化 + receiver 方法调用诚实未知", async () => {
		const report = await scanProject(FIX);
		const by = index(report);

		const save = by.get("helper/store.go::Save")!;
		expect(save.purity).toBe(Purity.IMPURE);
		expect(save.effects.has("io")).toBe(true); // fmt.Println
		expect(save.effects.has("clock")).toBe(true); // time.Now
		expect(save.chunk.unknownSites).toBeGreaterThan(0); // s.log receiver 动态分派 ?

		// log 方法 chunk 独立提取（method_declaration）
		const log = by.get("helper/store.go::log")!;
		expect(log).toBeDefined();
		expect(log.purity).toBe(Purity.IMPURE);
	});
});
