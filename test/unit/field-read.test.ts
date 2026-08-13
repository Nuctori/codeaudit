import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { Purity } from "../../src/core/types";

describe("迭代44 候选1：局部变量 prop 读判纯（阴影守卫误伤修复）", () => {
	it("局部变量读取不产生 unknownCalls（与参数读取同族）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-field-"));
		writeFileSync(
			join(dir, "C.cs"),
			[
				"public class C {",
				"    public void M() {",
				"        int status_ = 200;",
				"        if (status_ == 200) { }",
				"        var name_ = \"x\";",
				"        var s = name_;",
				"    }",
				"}",
			].join("\n"),
		);
		const r = await scanProject(dir, { useCache: false });
		const m = r.verdicts.find((x) => x.chunk.name === "C.M");
		expect(m).toBeDefined();
		// 修复前：status_/name_ 裸名 prop 读 → 阴影守卫跳过 → ?（InitDeity root=bare 形态）
		// 修复后：读取存储位置恒纯（无用户代码）→ 无 unknownCalls
		expect(m!.chunk.unknownSites ?? 0).toBe(0);
		expect(m!.purity).toBe(Purity.PURE);
		rmSync(dir, { recursive: true, force: true });
	});

	it("遮蔽调用形态维持 ?（iter41 阴影守卫不回退——C# 对照）", async () => {
		const dir = mkdtempSync(join(tmpdir(), "cq-shadow-"));
		writeFileSync(
			join(dir, "S.cs"),
			[
				"public class Evil {",
				'    public static void WriteLine(string s) { System.IO.File.WriteAllText("x", s); }',
				"}",
				"public class User {",
				"    private static object GetSomething() { return null; }",
				"    public void M() {",
				"        var Helper_ = GetSomething();", // 非构造赋值 → 无 localBindings → 无类型信息
				'        Helper_.Run("x");', // obj=Helper_（遮蔽 + 动态）→ ?（Console 是 impureGlobals 键——iter41 过近似，避开）
				"    }",
				"}",
			].join("\n"),
		);
		const r = await scanProject(dir, { useCache: false });
		const m = r.verdicts.find((x) => x.chunk.name === "User.M");
		expect(m).toBeDefined();
		// 调用形态（prop=false）+ 遮蔽（无类型信息）→ 维持 ?（与迭代41 `const Math = evil()` 同语义；
		// 注意：`var Console = new Evil()` 是构造绑定会被 localBindings 精确解析——本用例刻意非构造）
		expect(m!.purity).toBe(Purity.UNKNOWN);
		rmSync(dir, { recursive: true, force: true });
	});
});
