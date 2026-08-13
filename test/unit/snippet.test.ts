import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sourceSnippet } from "../../src/core/snippet";
import type { Chunk } from "../../src/core/types";

describe("迭代44-r3：sourceSnippet（标注工作台 code 字段）", () => {
	const dir = mkdtempSync(join(tmpdir(), "cq-snippet-"));
	writeFileSync(
		join(dir, "A.cs"),
		[
			"line1",
			"line2",
			"public void M() {",
			'    System.Console.WriteLine("x");',
			"}",
			"line6",
		].join("\n"),
	);

	it("行区间切片（含 endLine，不含越界）", () => {
		const chunk = { file: "A.cs", line: 3, endLine: 5 } as Chunk;
		const s = sourceSnippet(dir, chunk);
		expect(s).toBe('public void M() {\n    System.Console.WriteLine("x");\n}');
	});

	it("读取失败（文件不存在）→ 空串不中断", () => {
		const chunk = { file: "Nope.cs", line: 1, endLine: 2 } as Chunk;
		expect(sourceSnippet(dir, chunk)).toBe("");
	});

	it("越界行号被夹紧", () => {
		const chunk = { file: "A.cs", line: 100, endLine: 200 } as Chunk;
		expect(sourceSnippet(dir, chunk)).toBe("line6");
	});

	afterAll(() => rmSync(dir, { recursive: true, force: true }));
});
