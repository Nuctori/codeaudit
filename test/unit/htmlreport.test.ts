// 迭代49：技术债 HTML 可视化（renderTechdebtHtml 插件化）——通用性 + 结构完整性测试
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject, renderTechdebtHtml } from "../../src/index";

describe("renderTechdebtHtml（迭代49 插件化）", () => {
	it("自包含单文件：六大视图 + 零外部依赖（无 CDN/无 script src）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-html-"));
		try {
			writeFileSync(
				join(dir, "a.py"),
				"import os\ndef hub():\n    os.system('x')\ndef leaf():\n    os.getcwd()\n",
			);
			writeFileSync(
				join(dir, "b.py"),
				"from a import hub\ndef b():\n    return hub()\n",
			);
			const res = await scanProject(dir, { useCache: false });
			const html = renderTechdebtHtml(res.verdicts, res.stats, {
				title: "测试项目",
			});
			expect(html).toContain("<!DOCTYPE html>");
			expect(html).toContain("测试项目");
			for (const section of [
				"健康度总览",
				"拓扑健康度",
				"层分布",
				"效应链分布",
				"SCC 入口分布",
				"模块级",
				"治理清单",
				"纠缠环",
				"桥与割点",
				"圈复杂度",
				"未知点形态",
				"效应源",
			])
				expect(html).toContain(section);
			expect(html).toContain("hub"); // 治理 top 含被调用者
			// 零外部依赖：无 CDN 链接、无外链 script/link
			expect(html).not.toMatch(/<script[^>]*src=/);
			expect(html).not.toMatch(/https?:\/\//);
			expect(html).toContain("</html>");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("通用性：空项目不崩溃，输出骨架完整", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-html0-"));
		try {
			writeFileSync(join(dir, "empty.py"), "x = 1\n");
			const res = await scanProject(dir, { useCache: false });
			const html = renderTechdebtHtml(res.verdicts, res.stats);
			expect(html).toContain("<!DOCTYPE html>");
			expect(html).toContain("</html>");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("XSS 转义：chunk 名含 <>& 不破坏 HTML 结构", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-htmlx-"));
		try {
			writeFileSync(
				join(dir, "x.py"),
				"import os\ndef evil_<name>():\n    os.system('x')\n",
			);
			const res = await scanProject(dir, { useCache: false });
			const html = renderTechdebtHtml(res.verdicts, res.stats);
			// < 被转义为 &lt;——若未转义则 HTML 结构会被插入标签破坏
			expect(html).toContain("&lt;");
			expect(html).not.toMatch(/<[a-z]+><\/[a-z]+>/); // 无裸标签插入
			expect(html).toContain("</html>");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
