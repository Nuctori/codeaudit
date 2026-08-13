import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { Purity } from "../../src/core/types";

describe("迭代44-r2：编译期操作符实参不提取", () => {
	it("typeof(T) 泛型方法不产生 unknownCalls", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-ctop-"));
		writeFileSync(
			join(dir, "W.cs"),
			[
				"public class W {",
				"    public static System.Collections.Generic.List<W> Get<T>() where T : class {",
				"        var t = typeof(T);",
				"        var d = default(T);",
				"        var n = nameof(T);",
				"        return new System.Collections.Generic.List<W>();",
				"    }",
				"}",
			].join("\n"),
		);
		const r = await scanProject(dir, { useCache: false });
		const m = r.verdicts.find((x) => x.chunk.name === "W.Get");
		expect(m).toBeDefined();
		// 修复前：typeof(T) 的 T 被当裸名调用 → unknown；修复后：编译期操作符子树跳过
		expect(m!.chunk.unknownSites ?? 0).toBe(0);
		expect(m!.purity).toBe(Purity.PURE);
		rmSync(dir, { recursive: true, force: true });
	});
});
