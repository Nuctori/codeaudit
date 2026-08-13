import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { Purity } from "../../src/core/types";

describe("迭代44-r3：预处理指令符号不提取", () => {
	it("#if UNITY_EDITOR 不产生 unknownCalls", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-preproc-"));
		writeFileSync(
			join(dir, "C.cs"),
			[
				"public class C {",
				"    void M() {",
				"#if UNITY_EDITOR",
				'        System.Console.WriteLine("editor");',
				"#else",
				'        System.Console.WriteLine("runtime");',
				"#endif",
				"    }",
				"}",
			].join("\n"),
		);
		const r = await scanProject(dir, { useCache: false });
		const m = r.verdicts.find((x) => x.chunk.name === "C.M");
		expect(m).toBeDefined();
		// 修复前：#if UNITY_EDITOR 的符号被当裸名调用 → unknown；修复后：预处理指令位置无运行时读取
		// Console.WriteLine 仍正常解析（IMPURE——不受排除影响）
		expect(m!.purity).toBe(Purity.IMPURE);
		expect([...(m!.chunk.unknownCalls ?? [])].filter((uc) => uc.attr === "UNITY_EDITOR").length).toBe(0);
		rmSync(dir, { recursive: true, force: true });
	});
});
