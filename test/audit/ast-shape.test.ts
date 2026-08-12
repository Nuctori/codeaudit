import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";

/**
 * 迭代39 P2-2：AST 形状契约测试网——锁定 extractor 依赖的 tree-sitter 形状假设。
 * 迭代38 探针实证的 3 个缺陷（typed_parameter 无 name 字段 / base_list 是子节点 /
 * 逗号匿名子节点）都是「形状假设」类 bug——wasm 升级改变形状时静默失效。
 * 本组测试在提取行为上断言关键形状：形状破坏 → 测试红（防静默提取错误）。
 * 断言对象 = 提取产物（classExtends/paramTypes/virtualMembers），非原始 AST——
 * 形状错了产物即错，且比断言 AST 节点类型更贴近语义契约。
 */

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-shape-"));
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

/** 用 scanProject 的 verdicts 反推提取产物（stateWrites/effects 等可见），并直查 facts 路径。 */
async function factsOf(
	root: string,
	file: string,
): Promise<Record<string, unknown>> {
	// 直接走 extractor（不经缓存），拿 RawFileFacts
	const { Extractor } = await import("../../src/lang/extractor");
	const { defaultPacks } = await import("../../src/index");
	const { initParser, loadLanguage } = await import("../../src/loader");
	const { readFileSync } = await import("node:fs");
	const Parser = await initParser();
	const pack = defaultPacks.find((p) =>
		p.extensions.some((e) => file.endsWith(e)),
	)!;
	const ext = new Extractor(Parser as never, pack, await loadLanguage(pack));
	return ext.extract(
		readFileSync(join(root, file), "utf8"),
		file,
	) as unknown as Record<string, unknown>;
}

describe("AST 形状契约（迭代39 P2-2）", () => {
	it("Python typed_parameter：paramTypes 提取（name 无字段 → identifier 子节点回退）", async () => {
		const root = project("py-typed", {
			"m.py": "def f(x: X):\n    x.m()\n",
		});
		const facts = await factsOf(root, "m.py");
		const chunks = facts.chunks as Array<{
			name: string;
			paramTypes?: Record<string, string>;
		}>;
		const f = chunks.find((c) => c.name === "f")!;
		expect(f.paramTypes).toEqual({ x: "X" });
	});

	it("Python superclasses：classExtends 提取（含逗号匿名子节点过滤）", async () => {
		const root = project("py-bases", {
			"m.py": "class A: pass\nclass B: pass\nclass X(A, B):\n    pass\n",
		});
		const facts = await factsOf(root, "m.py");
		expect((facts.classExtends as Record<string, readonly string[]>).X).toEqual(
			["A", "B"],
		);
		expect(facts.hasDynamicExtends).toBeUndefined(); // 逗号不得误标 dynamic
	});

	it("C# base_list 是子节点非字段：classExtends 提取", async () => {
		const root = project("cs-bases", {
			"C.cs": "public class Base { }\npublic class Derived : Base { }\n",
		});
		const facts = await factsOf(root, "C.cs");
		expect(
			(facts.classExtends as Record<string, readonly string[]>).Derived,
		).toEqual(["Base"]);
	});

	it("C# method_declaration 修饰符：virtualMembers 提取（virtual/override/abstract，sealed 排除）", async () => {
		const root = project("cs-virtual", {
			"V.cs": [
				"public class B {",
				"    public virtual void V1() { }",
				"    public override void V2() { }",
				"    public void N() { }",
				"}",
				"public class S : B {",
				"    public sealed override void V2() { }",
				"}",
			].join("\n"),
		});
		const facts = await factsOf(root, "V.cs");
		const vm = facts.virtualMembers as Record<string, readonly string[]>;
		expect(vm.B).toEqual(["V1", "V2"]); // N 非 virtual
		expect(vm.S).toBeUndefined(); // sealed override 精确 → 不记录
	});

	it("C# 接口多基类（≥2 基）→ 全部方法隐含 virtual 族（保守并集）", async () => {
		const root = project("cs-iface", {
			"I.cs": [
				"public class B { public void M() { } }",
				"public class C : B, System.IDisposable {",
				"    public void Dispose() { }",
				"}",
			].join("\n"),
		});
		const facts = await factsOf(root, "I.cs");
		const vm = facts.virtualMembers as Record<string, readonly string[]>;
		expect(vm.C).toEqual(["Dispose"]); // 接口存在 → Dispose 隐含 virtual
		expect(vm.B).toBeUndefined(); // 无非 virtual 记录
	});

	it("TS class_heritage：静态 identifier 基类提取 + 动态 heritage → hasDynamicExtends", async () => {
		const root = project("ts-heritage", {
			"t.ts": [
				"class A { m(): number { return 1; } }",
				"class B extends A { }",
				"function getBase(): any { return A; }",
				"class C extends getBase() { }",
			].join("\n"),
		});
		const facts = await factsOf(root, "t.ts");
		const ce = facts.classExtends as Record<string, readonly string[]>;
		expect(ce.B).toEqual(["A"]);
		expect(facts.hasDynamicExtends).toBe(true); // C 动态 heritage
	});
});
