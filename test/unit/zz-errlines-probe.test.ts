import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";

describe("probe", () => {
	it("static 字段错误文件：chunk 被降级（H1 守卫迭代55-r2 空数组兜底）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ca-probe-"));
		mkdirSync(join(dir, "Assets"), { recursive: true });
		// ERROR 在 static 字段内（visit 跳过子树 → errorLines=[]）→ 修复前 Math.min([])=Infinity
		// → 全文件不降级（C.Pure=0 假纯实证）；修复后空数组兜底 [1] → 全降级
		writeFileSync(join(dir, "Assets/A.cs"), `class C {
  static int x = ;
  int Pure() { return 1; }
}`);
		const r = await scanProject(dir);
		const v = r.verdicts.filter((x) => x.chunk.name === "C.Pure");
		expect(
			JSON.stringify(
				v.map((x) => ({
					name: x.chunk.name,
					parseError: x.chunk.parseError,
					purity: x.purity,
				})),
			),
		).toBe('[{"name":"C.Pure","parseError":true,"purity":1}]'); // 降级：parseError + UNKNOWN
		rmSync(dir, { recursive: true, force: true });
	});
});
