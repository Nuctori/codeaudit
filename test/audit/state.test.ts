import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * --state CLI 契约（迭代23 D-127）：json 顶层 stateCoupling additive；
 * readers 降序、readerKeys 字典序；不加 --state 时顶层无 stateCoupling。
 */

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-state-"));
});
afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

function project(name: string, files: Record<string, string>): string {
	const root = join(dir, name);
	for (const [f, content] of Object.entries(files)) {
		const p = join(root, f);
		mkdirSync(join(p, ".."), { recursive: true });
		writeFileSync(p, content);
	}
	return root;
}

const cli = join(dirname(require.resolve("../../package.json")), "dist", "cli.js");

interface CouplingEntry {
	key: string;
	name: string;
	file: string;
	line: number;
	writes: string[];
	readers: number;
	readerKeys: string[];
}

describe("--state 状态耦合图（迭代23 D-127）", () => {
	it("json 顶层 stateCoupling：形状/排序/additive 隔离", () => {
		// 写方 write() 写共享状态（self.v 属性写——D-117 提取路径；下标写 d[k]= 是已知盲区不产生 stateWrites）
		// + 两个 reader 读同一状态 + 一个纯函数
		const root = project("sc", {
			"a.py": [
				"class Store:",
				"    v = 0",
				"    def write(self, x):",
				"        self.v = x",
				"        return x",
				"    def reader1(self):",
				"        return self.v",
				"    def reader2(self):",
				"        return self.v + 1",
				"    def pure(self):",
				"        return 42",
			].join("\n"),
		});
		const withFlag = JSON.parse(
			execFileSync("node", [cli, "scan", root, "--no-cache", "--state", "--json"], { encoding: "utf8" }),
		) as { stateCoupling: CouplingEntry[] };
		const withoutFlag = JSON.parse(
			execFileSync("node", [cli, "scan", root, "--no-cache", "--json"], { encoding: "utf8" }),
		) as { stateCoupling?: unknown };
		// additive：加 --state 才出现
		expect(withoutFlag.stateCoupling).toBeUndefined();
		// 形状
		expect(Array.isArray(withFlag.stateCoupling)).toBe(true);
		if (withFlag.stateCoupling.length > 0) {
			const e = withFlag.stateCoupling[0]!;
			expect(typeof e.key).toBe("string");
			expect(typeof e.name).toBe("string");
			expect(typeof e.file).toBe("string");
			expect(typeof e.line).toBe("number");
			expect(Array.isArray(e.writes)).toBe(true);
			expect(typeof e.readers).toBe("number");
			expect(Array.isArray(e.readerKeys)).toBe(true);
		}
		// 排序：readers 降序；readerKeys 字典序
		for (let i = 1; i < withFlag.stateCoupling.length; i++) {
			expect(withFlag.stateCoupling[i - 1]!.readers)
				.toBeGreaterThanOrEqual(withFlag.stateCoupling[i]!.readers);
		}
		for (const e of withFlag.stateCoupling) {
			const sorted = [...e.readerKeys].sort();
			expect(e.readerKeys).toEqual(sorted);
		}
		// 写方 Store.write 应有读者（reader1/reader2 读 self.v）——类方法名带类前缀
		const write = withFlag.stateCoupling.find((e) => e.name.endsWith("write"));
		expect(write).toBeDefined();
		expect(write!.readers).toBeGreaterThan(0);
	});

	it("text 模式输出状态耦合块（无图时明确说明）", () => {
		const root = project("sc-text", {
			"a.py": "shared = 0\ndef f():\n    return shared\n",
		});
		const out = execFileSync("node", [cli, "scan", root, "--no-cache", "--state"], { encoding: "utf8" });
		expect(out).toMatch(/状态耦合/);
		expect(out).toMatch(/读者/);
	});
});
