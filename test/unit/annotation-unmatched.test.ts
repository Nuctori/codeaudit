import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";

describe("迭代44-r3：标注未匹配回显", () => {
	it("无效 id 标注被报告为 unmatched（不再静默）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-ann-"));
		writeFileSync(
			join(dir, "A.cs"),
			[
				"public class A {",
				"    public void M() {",
				"        System.Console.WriteLine(1);",
				"    }",
				"}",
			].join("\n"),
		);
		const ann: Array<{ id: string; file?: string; verdict: "PURE" | "IMPURE" }> = [
			{ id: "deadbeefdeadbeef", file: "A.cs", verdict: "PURE" }, // 不存在的 id
			{ id: "ffffffffffffffff", verdict: "IMPURE" }, // 裸 id 不存在
		];
		const r = await scanProject(dir, {
			useCache: false,
			annotations: new Map(ann.map((a) => [`${a.file ?? ""}${a.file ? "\u0000" : ""}${a.id}`, a.verdict])),
		});
		// 修复前：未匹配静默忽略；修复后：stats.annotationUnmatched 报告
		expect(r.stats.annotationUnmatched.length).toBe(2);
		expect(r.stats.annotationUnmatched[0].id).toBe("deadbeefdeadbeef");
		rmSync(dir, { recursive: true, force: true });
	});
});
