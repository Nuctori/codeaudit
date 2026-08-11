import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { scanProject } from "../../src/index";

/**
 * C# 真实项目 fixture（迭代22：InitDeity 模式锁定——C# 语言包修复的防回归网兜）。
 * 来源：J:/旧宇宙/代码仓库/InitDeity/Assets 抽取（裁剪 <5KB 保模式）。
 * 锁定判定（方向安全契约）：确定效应判 IMPURE、动态/链式判 UNKNOWN、纯读判 PURE。
 */

const root = join(__dirname, "..", "fixtures", "csharp");

function by(report: { verdicts: Array<{ chunk: { file: string; name: string } }> }): Map<string, unknown> {
	const m = new Map<string, unknown>();
	for (const v of report.verdicts) m.set(`${v.chunk.file}::${v.chunk.name}`, v);
	return m;
}

describe("C# 真实项目 fixture（迭代22）", () => {
	it("扫描全部 fixture 无 parseError（中文标识符文件除外）", async () => {
		const r = await scanProject(root, { useCache: false });
		expect(r.stats.files).toBeGreaterThanOrEqual(8);
		// 中文标识符文件：解析器盲区 → parseError（方向安全降级）——其余 7 文件必须 0 错误
		const errFiles = new Set(r.verdicts.filter((v) => v.chunk.parseError).map((v) => v.chunk.file));
		for (const f of errFiles) expect(f).toContain("ChineseEnum");
	});

	it("AutomationSnapshot：快照构建判 state（transform.position + 状态读）", async () => {
		const r = await scanProject(root, { useCache: false });
		const snap = by(r).get("AutomationSnapshot.cs::RuntimeMainlineAutopilot.BuildSnapshot") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(snap).toBeDefined();
		expect(snap!.purity).toBe(2); // IMPURE（state）
		expect(snap!.effects.has("state")).toBe(true);
	});

	it("CoroAsync：协程/async 方法判 IMPURE（Debug.Log io + Task clock）", async () => {
		const r = await scanProject(root, { useCache: false });
		const coro = by(r).get("CoroAsync.cs::CoroAndAsync.MoveCoroutine") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const fetch = by(r).get("CoroAsync.cs::CoroAndAsync.FetchAsync") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const pure = by(r).get("CoroAsync.cs::CoroAndAsync.PureCalc") as { purity: number } | undefined;
		expect(coro!.purity).toBe(2); // Debug.Log io
		expect(fetch!.purity).toBe(2); // Task.Delay clock + Debug.Log
		expect(pure!.purity).toBe(0); // Math.Max 纯
	});

	it("UnityComponents：SetActive/Instantiate/Destroy/transform 判 state", async () => {
		const r = await scanProject(root, { useCache: false });
		const start = by(r).get("UnityComponents.cs::UnityComponents.Start") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(start!.purity).toBe(2);
		expect(start!.effects.has("state")).toBe(true);
	});

	it("LinqChain：动态链诚实 ?（UNKNOWN 不假纯）", async () => {
		const r = await scanProject(root, { useCache: false });
		const compute = by(r).get("LinqChain.cs::LinqChain.Compute") as { purity: number } | undefined;
		expect(compute).toBeDefined();
		expect(compute!.purity).toBe(1); // UNKNOWN（xs.Where 变量 receiver 动态）
	});

	it("DotweenUse：panel.DOMove 实例方法动态 → 诚实 UNKNOWN（非假纯）", async () => {
		const r = await scanProject(root, { useCache: false });
		const open = by(r).get("DotweenUse.cs::DotweenUse.Open") as { purity: number } | undefined;
		expect(open).toBeDefined();
		// panel 是变量 receiver → DOMove 动态分派 → UNKNOWN（方向安全，不假纯）
		expect(open!.purity).toBe(1);
	});

	it("UIWorldLink：main 变量方法动态 → 诚实 UNKNOWN；transform.position 赋值 → state 写（迭代24 写侧对偶生效）", async () => {
		const r = await scanProject(root, { useCache: false });
		const update = by(r).get("UIWorldLink.cs::GetRewardBar.Update") as { purity: number; effects: Set<string> } | undefined;
		expect(update).toBeDefined();
		// main.WorldToScreenPoint（变量 receiver）动态 → 未知边；transform.position = 是成员写
		// （C# member_access_expression 写侧，迭代24 修复前不可见）→ state 效应 → IMPURE
		expect(update!.purity).toBe(2);
		expect(update!.effects.has("state")).toBe(true);
	});

	it("EventSubscribe：事件订阅不崩溃；Wire 无效应（事件不建模）", async () => {
		const r = await scanProject(root, { useCache: false });
		// 目录含 ChineseEnum.cs（中文标识符 parseError=1 预期）——EventSubscribe 自身无 ERROR
		const wire = by(r).get("EventSubscribe.cs::EventSubscribe.Wire") as { purity: number } | undefined;
		expect(wire).toBeDefined();
		// 事件 += 修改事件字段 → state 写（extractor 裸标识符写判定——Wire IMPURE 语义正确）
		expect(wire!.purity).toBe(2);
	});
});
