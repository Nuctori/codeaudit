// 迭代45 O-C5/O-C6 机检测试：heritageSkipNodes / propertyReadSkipParents 与 grammar 节点集对拍
import { describe, it, expect } from "vitest";
import {
	readFileSync,
	existsSync,
	mkdtempSync,
	writeFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { csharpPack } from "../../src/lang/packs/csharp";
import { scanProject } from "../../src/index";

/** 从 tree-sitter-c_sharp.wasm 提取 directive 节点类型（grammar 事实源）。 */
function grammarDirectiveNodes(): string[] {
	const wasmPath = join(
		__dirname,
		"../../node_modules/tree-sitter-wasms/out/tree-sitter-c_sharp.wasm",
	);
	if (!existsSync(wasmPath)) return []; // 环境缺包 → 跳过（CI 装齐）
	const bytes = readFileSync(wasmPath).toString("latin1");
	const names = new Set<string>();
	const re = /[a-z_]*directive[a-z_]*/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(bytes))) names.add(m[0]);
	return [...names].sort();
}

describe("O-C5/O-C6 节点清单完备性机检（迭代45）", () => {
	it("heritageSkipNodes 覆盖全部可出现在 base_list 的预处理指令（痛点2 事故类）", () => {
		const skip = new Set(csharpPack.heritageSkipNodes ?? []);
		// 预处理指令族：37eb151 实证 if_directive 可出现在 base_list 子节点位——全族保守入表
		const preprocDirectives = [
			"if_directive",
			"elif_directive",
			"else_directive",
			"endif_directive",
			"define_directive",
			"undef_directive",
			"region_directive",
			"endregion_directive",
			"line_directive",
			"error_directive",
			"warning_directive",
			"pragma_directive",
			"nullable_directive",
			"extern_alias_directive",
		];
		const missing = preprocDirectives.filter((d) => !skip.has(d));
		expect(missing).toEqual([]); // 漏节点 → 语言级降级（全库多态 unknown，-37% 级）
	});

	it("heritageSkipNodes 与 propertyReadSkipParents 两表指令覆盖一致", () => {
		const skip = new Set(csharpPack.heritageSkipNodes ?? []);
		const prop = new Set(csharpPack.propertyReadSkipParents ?? []);
		const dirs = grammarDirectiveNodes().filter(
			(d) => !d.startsWith("_preproc") && !d.endsWith("_repeat"), // 匿名/repeat 辅助节点非语法节点
		);
		for (const d of dirs) {
			// 任一表漏覆盖 = 该节点在某通道被误收（读侧噪音或 heritage 误判）
			expect(
				skip.has(d) || prop.has(d),
				`directive ${d} 未被任一跳过表覆盖`,
			).toBe(true);
		}
	});

	it("别名限定基类（global::Ns.Base）不再触发动态 heritage（O-C5 alias_qualified_name 修复）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-oc5-"));
		try {
			writeFileSync(
				join(dir, "C.cs"),
				[
					"namespace Ns { public class Base { public int F() { return 1; } } }",
					"class Derived : global::Ns.Base { public int G() { return F(); } }",
				].join("\n"),
			);
			const r = await scanProject(dir, { useCache: false });
			const g = r.verdicts.find((v) => v.chunk.name === "Derived.G");
			// F() 是基类方法（implicitThis 经祖先闭包解析）——alias_qualified_name 基类必须
			// 被接受（剥壳 Ns.Base → Base），否则语言级降级 → G 判 UNKNOWN
			expect(g).toBeDefined();
			expect(g!.purity).toBe(0); // PURE：F() 解析到纯方法，未降级
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
