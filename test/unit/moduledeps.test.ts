import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { moduleSummary } from "../../src/core/module";
import { outDepsOf, inDepsOf } from "../../src/core/filedeps";

describe("迭代44-r4：模块聚合 + 文件依赖（重构决策视图）", () => {
	const dir = mkdtempSync(join(tmpdir(), "cq-mod-"));
	mkdirSync(join(dir, "Mod"), { recursive: true });
	mkdirSync(join(dir, "Other"), { recursive: true });
	writeFileSync(
		join(dir, "Mod/A.cs"),
		[
			"public class A {",
			"    public void io() { System.Console.WriteLine(1); }",
			"    public void call() { new B().pure(); }",
			"}",
		].join("\n"),
	);
	writeFileSync(
		join(dir, "Mod/B.cs"),
		["public class B {", "    public int pure() { return 1; }", "}"].join("\n"),
	);
	writeFileSync(
		join(dir, "Other/C.cs"),
		"public class C { public int x() { return new Mod.A().io(); } }\n",
	);

	it("moduleSummary 按目录前缀聚合", async () => {
		const r = await scanProject(dir, { useCache: false });
		const mods = moduleSummary(r.verdicts);
		const mod = mods.find((m) => m.module === "Mod");
		const other = mods.find((m) => m.module === "Other");
		expect(mod).toBeDefined();
		expect(mod!.files).toBe(2);
		expect(mod!.effects).toContain("io");
		expect(other).toBeDefined();
		expect(other!.module).toBe("Other");
	});

	it("outDepsOf/inDepsOf 文件级边（calls key 反解）", async () => {
		const r = await scanProject(dir, { useCache: false });
		const out = outDepsOf(r.verdicts, "Mod/A.cs");
		expect(out.some((d) => d.file === "Mod/B.cs")).toBe(true); // A 调 B
		const inn = inDepsOf(r.verdicts, "Mod/A.cs");
		expect(inn.some((d) => d.file === "Other/C.cs")).toBe(true); // C 调 A
	});

	it("maxComplexity 排除类 chunk（类 Σ 是尺寸代理——迭代47 数学评审）", async () => {
		const dir2 = mkdtempSync(join(tmpdir(), "cq-mod2-"));
		mkdirSync(join(dir2, "M"), { recursive: true });
		// 类含两个分支方法（各 C≥3）——类 chunk Σ > 任一方法 C
		writeFileSync(
			join(dir2, "M/Big.cs"),
			[
				"public class Big {",
				"    public int A(int x) {",
				"        if (x > 0) return 1;",
				"        if (x > 1) return 2;",
				"        return 0;",
				"    }",
				"    public int B(int x) {",
				"        if (x < 0) return -1;",
				"        if (x < -1) return -2;",
				"        return 0;",
				"    }",
				"    public int Pure() { return 1; }",
				"}",
			].join("\n"),
		);
		const r2 = await scanProject(dir2, { useCache: false });
		const mods2 = moduleSummary(r2.verdicts);
		const m2 = mods2.find((m) => m.module === "M");
		expect(m2).toBeDefined();
		// 修复前：类 chunk Σ（A3+B3+Pure1 ≈ 7）> 方法级 max（3）——maxComplexity 被类污染；
		// 修复后：maxComplexity = 方法级 max = 3
		expect(m2!.maxComplexity).toBe(3);
		rmSync(dir2, { recursive: true, force: true });
	});

	afterAll(() => rmSync(dir, { recursive: true, force: true }));
});
