import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { moduleSummary } from "../../src/core/module";
import { outDepsOf, inDepsOf } from "../../src/core/filedeps";

describe("迭代44-r4：模块聚合 + 文件依赖（重构决策视图）", () => {
	const dir = mkdtempSync(join(tmpdir(), "cq-mod-"));
	writeFileSync(
		join(dir, "Mod/A.cs"),
		[
			"public class A {",
			'    public void io() { System.Console.WriteLine(1); }',
			"    public void call() { new B().pure(); }",
			"}",
		].join("\n"),
	);
	writeFileSync(
		join(dir, "Mod/B.cs"),
		[
			"public class B {",
			"    public int pure() { return 1; }",
			"}",
		].join("\n"),
	);
	writeFileSync(join(dir, "Other/C.cs"), "public class C { public int x() { return new Mod.A().io(); } }\n");

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

	afterAll(() => rmSync(dir, { recursive: true, force: true }));
});
