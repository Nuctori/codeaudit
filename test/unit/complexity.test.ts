import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";

describe("迭代44-r4：圈复杂度（MCCabe 近似）", () => {
	it("if/for/三元/短路运算符计数", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-cx-"));
		writeFileSync(
			join(dir, "C.cs"),
			[
				"public class C {",
				"    public int M(int a, int b) {",
				"        int c = 1;",
				"        if (a > 0 && b > 0) { c++; }", // if + && = 2
				"        for (int i = 0; i < a; i++) { c += i; }", // for = 1
				"        if (a > 5 || b < 2) { c--; }", // if + || = 2
				"        return a > b ? c : b;", // 三元 = 1
				"    }",
				"    public int Simple() { return 1; }", // 无分支 = 1
				"}",
			].join("\n"),
		);
		const r = await scanProject(dir, { useCache: false });
		const m = r.verdicts.find((x) => x.chunk.name === "C.M");
		const s = r.verdicts.find((x) => x.chunk.name === "C.Simple");
		expect(m).toBeDefined();
		expect(s).toBeDefined();
		// 1 基准 + if×2 + for×1 + 三元×1 + &&×1 + ||×1 = 7
		expect(m!.chunk.complexity).toBe(7);
		expect(s!.chunk.complexity).toBe(1);
		rmSync(dir, { recursive: true, force: true });
	});
	it("switch 计数（Iter-53：普通 case 也计——case_switch_label 缺口修复回归）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-sw-"));
		writeFileSync(
			join(dir, "C.cs"),
			[
				"public class C {",
				"    public int M(int a) {",
				"        int c = 0;",
				"        switch (a) {", // switch_statement = 1
				"            case 1: c++; break;", // case_switch_label = 1
				"            case 2: c += 2; break;", // case_switch_label = 1
				"            case 3 when c > 0: c--; break;", // case_pattern_switch_label = 1
				"            default: c = -1; break;",
				"        }",
				"        if (c > 0) c++;", // if = 1
				"        return c;",
				"    }",
				"}",
			].join("\n"),
		);
		const r = await scanProject(dir, { useCache: false });
		const m = r.verdicts.find((x) => x.chunk.name === "C.M");
		expect(m).toBeDefined();
		// 1 基准 + switch×1 + case×2 + pattern case×1 + if×1 = 6
		expect(m!.chunk.complexity).toBe(6);
		rmSync(dir, { recursive: true, force: true });
	});
});
