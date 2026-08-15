import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { Purity } from "../../src/core/types";

/**
 * 轮10 终验（证明系统完备性终验——验收审计员，非修复者）：
 * 本轮不扩张审计面，只补「判据无测试支撑」的终验缺口。
 *
 * 判据3（S2/S4 通道穷举）缺口：轮7 三通道 + 轮9 八通道 = 11 通道外，
 * link.ts:1977-1985 的**星号导入 miss** 通道（fi.wildcards 循环 → resolveSymbol
 * 全 miss → markUnknown）只有成功路径测试（adversarial.test.ts:206 星号再导出链；
 * ct-adversarial9:391 星号导入回退并集），无「wildcard 目标不含符号 → UNKNOWN 非 PURE」断言。
 * 本测试锚定该通道（S4：要么边要么 unknown，无静默 ∅）。
 */

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-ct10-"));
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

describe("law:edge-case（轮10 终验——星号导入 miss 通道，S4 解析闭包）", () => {
	it("Python 星号导入 miss：from base import * 后调用 base 不存在的名字 → UNKNOWN 非 PURE（不静默 ∅）", async () => {
		const root = project("ct10-wildcard-miss", {
			"base.py": "def existing(x):\n    return x\n",
			"top.py": [
				"from base import *",
				"",
				"def main():",
				"    return ghost_call(1)  # base 无此符号 → wildcard 全 miss → 必须 UNKNOWN",
				"",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const main = r.verdicts.find((v) => v.chunk.name === "main")!;
		// S4 通道：markUnknown（link.ts:1982-1985 fallthrough）→ ? 参与传播 → UNKNOWN
		expect(main.purity).toBe(Purity.UNKNOWN);
		// 对照：符号在 base 中 → 真边 → PURE（通道的解析侧不受影响）
		const root2 = project("ct10-wildcard-hit", {
			"base.py": "def existing(x):\n    return x\n",
			"top.py": "from base import *\n\ndef main():\n    return existing(1)\n",
		});
		const r2 = await scanProject(root2, { useCache: false });
		expect(
			r2.verdicts.find((v) => v.chunk.name === "main")!.purity,
		).toBe(Purity.PURE);
	});
});
