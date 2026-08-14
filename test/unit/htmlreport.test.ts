// 迭代49：技术债 HTML 可视化（renderTechdebtHtml 插件化）——通用性 + 结构完整性测试
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject, renderTechdebtHtml } from "../../src/index";
import type { Verdict } from "../../src/core/types";

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
				"长传播链",
				"治理清单",
				"拓扑治理优先级",
				"桥边优先保护序",
				"割点优先评审序",
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

	it("长传播链：效应从 direct 源沿调用链传播（迭代50-r4 回归——深度 DP 方向/口径）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-htmlchain-"));
		try {
			writeFileSync(
				join(dir, "a.py"),
				// src 直接调 io（direct 源）→ mid 调 src → top 调 mid：传播深度 2
				"import os\ndef src():\n    os.system('x')\ndef mid():\n    return src()\ndef top():\n    return mid()\n",
			);
			const res = await scanProject(dir, { useCache: false });
			const html = renderTechdebtHtml(res.verdicts, res.stats);
			// 含 2 跳传播链（src→mid→top 的 top 深度 2）；标题 maxPropDepth=2
			expect(html).toMatch(/项目最大 2 跳/);
			// 路径含传染链（src → mid → top）
			expect(html).toMatch(/src → mid → top/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("? 源不计入传播深度（知识缺失非效应源——用户判据实证）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-htmlq-"));
		try {
			writeFileSync(
				join(dir, "a.py"),
				// top 调未知函数（? 源）但无 direct 效应——传播深度应不含 ? 源
				"def top():\n    return missing_fn()\n",
			);
			const res = await scanProject(dir, { useCache: false });
			const html = renderTechdebtHtml(res.verdicts, res.stats);
			// top 判 UNKNOWN（? 源）但 direct 为空 → 不是传播源；无 direct 链 → maxPropDepth 0 或 -1 不误报
			expect(html).toMatch(/项目最大 (0|-1) 跳/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("迭代52：重载同名族不列入纠缠环（并集边人工环消除）", () => {
		// 直接构造 verdicts：重载星形（T.Track 三成员互调，C# 隐式 this 并集边场景）
		// + 真实双入口环（A.bar ↔ B.baz，X/Y 双入口）——后者必须仍在纠缠列表。
		const mk = (key: string, name: string, calls: string[]): Verdict =>
			({
				chunk: {
					key,
					file: `${key.split("#")[0]}.cs`,
					startLine: 1,
					endLine: 2,
					name,
					calls: new Set(calls),
					unknownSites: 0,
					stateWrites: [],
					parseError: false,
				},
				purity: 1,
				chain: 1,
				chainCertain: true,
				effects: new Set<string>(),
				stateDeps: [],
			}) as unknown as Verdict;
		const html = renderTechdebtHtml(
			[
				mk("T.Track#1", "T.Track", ["T.Track#2", "T.Track#3"]),
				mk("T.Track#2", "T.Track", ["T.Track#1", "T.Track#3"]),
				mk("T.Track#3", "T.Track", ["T.Track#1", "T.Track#2"]),
				mk("X.hit", "X.hit", ["A.bar"]),
				mk("Y.hit", "Y.hit", ["B.baz"]),
				mk("A.bar", "A.bar", ["B.baz"]),
				mk("B.baz", "B.baz", ["A.bar"]),
			],
			{ files: 1, cycles: 0 },
		);
		// 真实双入口环仍是纠缠成员
		expect(html).toMatch(/chip">A\.bar<\/span>/);
		expect(html).toMatch(/chip">B\.baz<\/span>/);
		// 重载族不因内部互调成为纠缠环成员
		expect(html).not.toMatch(/chip">T\.Track<\/span>/);
		// 成员 chips 有分隔（iter54 审计：无分隔符拼接曾误导读者——"Event.TrackEvent.TrackEvent"
		// 被误读为单节点名）
		expect(html).toMatch(/chip">[^<]*<\/span> <span class="chip">/);
	});

	it("Iter-54：报告头部携带扫描元数据（root/时间/版本/缓存命中——分辨多份报告）", () => {
		const html = renderTechdebtHtml(
			[],
			{ files: 3, cycles: 0 },
			{
				title: "codeaudit 技术债报告 — /x",
				scannedAt: "2026-08-13T17:53:01",
				version: "9.9.9",
				cachedFiles: 42,
			},
		);
		expect(html).toMatch(/2026-08-13T17:53:01/); // 扫描时间（非生成时间）
		expect(html).toMatch(/v9\.9\.9/);
		expect(html).toMatch(/缓存命中 42 文件/);
		expect(html).toMatch(/codeaudit 技术债报告 — \/x/);
	});

	it("Iter-53：治理清单按限定名聚合——同名重载族计一行、去重调用者", () => {
		const mk = (
			key: string,
			name: string,
			purity: number,
			calls: string[],
		): Verdict =>
			({
				chunk: {
					key,
					file: `${key.split("#")[0]}.cs`,
					startLine: 1,
					endLine: 2,
					name,
					calls: new Set(calls),
					unknownSites: 0,
					stateWrites: [],
					parseError: false,
				},
				purity,
				chain: 1,
				chainCertain: true,
				effects: new Set<string>(),
				stateDeps: [],
			}) as unknown as Verdict;
		// 6 个重载 ctor（同名族）+ 2 个外部调用者（每个都调用全部 6 候选——并集边场景）
		const overloads = ["#1", "#2", "#3", "#4", "#5", "#6"].map((n) =>
			mk(`ApiException.ApiException${n}`, "ApiException.ApiException", 2, []),
		);
		const callers = [
			mk(
				"caller1",
				"caller1",
				2,
				overloads.map((o) => o.chunk.key),
			),
			mk(
				"caller2",
				"caller2",
				2,
				overloads.map((o) => o.chunk.key),
			),
		];
		const html = renderTechdebtHtml([...callers, ...overloads], {
			files: 1,
			cycles: 0,
		});
		// 聚合后：治理清单段内 ApiException.ApiException 只出现一次（带 "6 重载" 标注），
		// 调用者数 = 2（去重——每 caller 命中 6 候选只计 1）
		const govSection = html.slice(
			html.indexOf("治理清单 top 25"),
			html.indexOf("拓扑治理优先级"),
		);
		expect(govSection).toMatch(/ApiException\.ApiException/);
		// 只出现 1 行（bar-row）——名字在 label 和文件名里各出现一次，按行数断言
		expect(
			(govSection.match(/class="bar-label">ApiException\.ApiException/g) ?? [])
				.length,
		).toBe(1);
		expect(govSection).toContain("6 重载");
		expect(govSection).toMatch(
			/ApiException\.ApiException[^<]*<[^>]*>[\s\S]*?bar-val">2<\/div>/,
		);
		// 治理段 bar-row 数 = 3（2 caller + 1 聚合族）
		expect((govSection.match(/class="bar-row"/g) ?? []).length).toBe(3);
	});
});
