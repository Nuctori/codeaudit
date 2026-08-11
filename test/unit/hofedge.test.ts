import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject, changedImpact } from "../../src/index";

/** D-092 回归：定时器/数组方法回调建边（迭代14 视角 4 F1——setTimeout 异步边真实生效）。 */
describe("HOF 异步边（D-092）", () => {
	it("setTimeout 回调在反向闭包可见（S4）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "hof1-"));
		writeFileSync(
			join(dir, "t.js"),
			"function handler() { return 1; }\nsetTimeout(handler, 100);\nmodule.exports = { handler };\n",
		);
		const r = await scanProject(dir, { useCache: false });
		const mod = r.verdicts.find((v) => v.chunk.name === "<module>");
		const handler = r.verdicts.find((v) => v.chunk.name === "handler");
		expect(handler).toBeDefined();
		expect(mod!.chunk.calls.has(handler!.chunk.key)).toBe(true); // 异步边建了
		rmSync(dir, { recursive: true, force: true });
	});

	it("setTimeout(doesNotExist) 未解析回调记 ?（S4）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "hof2-"));
		writeFileSync(join(dir, "t.js"), "setTimeout(doesNotExist, 100);\n");
		const r = await scanProject(dir, { useCache: false });
		const mod = r.verdicts.find((v) => v.chunk.name === "<module>");
		// addArgEdges 的 hofAlwaysArgs 分支只加 calls 不加 unknownSites（既有口径）——断言 ? 在 calls
		expect(mod!.chunk.calls.has("?")).toBe(true);
		rmSync(dir, { recursive: true, force: true });
	});

	it("字面量数组 HOF 回调建边（[1,2].map(cb) 走 receiver 分支）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "hof3-"));
		writeFileSync(
			join(dir, "t.js"),
			"function cb() { return 1; }\n[1, 2].map(cb);\n[1, 2].forEach(cb);\nmodule.exports = { cb };\n",
		);
		const r = await scanProject(dir, { useCache: false });
		const mod = r.verdicts.find((v) => v.chunk.name === "<module>");
		const cb = r.verdicts.find((v) => v.chunk.name === "cb");
		expect(mod!.chunk.calls.has(cb!.chunk.key)).toBe(true);
		rmSync(dir, { recursive: true, force: true });
	});

	it("changedImpact 含定时器调度（迭代14 视角 4 发现：handler.ts 改动 → main 在影响面）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "hof4-"));
		writeFileSync(
			join(dir, "main.ts"),
			"import { handler } from './handler';\nsetTimeout(handler, 100);\n",
		);
		writeFileSync(
			join(dir, "handler.ts"),
			"export function handler() { return 1; }\n",
		);
		const r = await scanProject(dir, { useCache: false });
		const impact = changedImpact(r.verdicts, new Set(["handler.ts"]));
		expect(impact.affected.some((c) => c.file.endsWith("main.ts"))).toBe(true);
		rmSync(dir, { recursive: true, force: true });
	});
});
