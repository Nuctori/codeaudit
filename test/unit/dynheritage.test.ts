import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { Purity } from "../../src/core/types";

describe("迭代44-r3：hasDynamicExtends 误判修复（痛点2 根因）", () => {
	it("枚举底层类型 + 预处理 + qualified_name 基类不触发语言级降级", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-dyn-"));
		writeFileSync(
			join(dir, "A.cs"),
			[
				"public enum State : int { Idle, Run }", // 枚举底层类型（修复前 dynamic）
				"public class Base { }",
				"public class Editor : Some.Namespace.OdinEditor { }", // qualified_name 基类（修复前 dynamic）
				"public class S : Base {", // 有子类场景
				"    static void Init() { System.Console.WriteLine(1); }",
				"    public static void Run() { Init(); }", // 同文件方法裸名调用
				"}",
				"#if UNITY_EDITOR",
				"public class EditorOnly : Base { }", // 预处理内类（修复前 dynamic）
				"#endif",
				"",
			].join("\n"),
		);
		const r = await scanProject(dir, { useCache: false });
		// 修复前：dynamic=true → C# 语言级降级 → S.Run 的 Init 裸名调用 unknown
		const run = r.verdicts.find((x) => x.chunk.name === "S.Run");
		expect(run).toBeDefined();
		expect(run!.purity).toBe(Purity.IMPURE); // Init 解析成功（Console io 传播）
		expect(run!.chunk.unknownSites ?? 0).toBe(0);
		// 其他类不受语言级降级影响
		const base = r.verdicts.find((x) => x.chunk.name === "Base");
		expect(base).toBeDefined();
		rmSync(dir, { recursive: true, force: true });
	});

	it("泛型嵌套 qualified_name 基类（class X : System.Collections.Generic.List<int>）剥壳正确", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-dyn2-"));
		writeFileSync(
			join(dir, "G.cs"),
			[
				"public class GenericBase<T> { }",
				"public class Holder : System.Collections.Generic.List<int> { }", // 泛型嵌套 qualified_name
				"public class User {",
				"    public int Get() { return 1; }",
				"}",
				"",
			].join("\n"),
		);
		const r = await scanProject(dir, { useCache: false });
		// 修复前：泛型嵌套 qualified_name 剥壳失败 → dynamic=true → 语言级降级
		const get = r.verdicts.find((x) => x.chunk.name === "User.Get");
		expect(get).toBeDefined();
		expect(get!.purity).toBe(Purity.PURE);
		expect(get!.chunk.unknownSites ?? 0).toBe(0);
		rmSync(dir, { recursive: true, force: true });
	});
});
