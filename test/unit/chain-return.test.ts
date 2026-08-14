// 迭代52-r3：链式接收者返回表 + G1 mutator 守卫（S1 红线）回归
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { Purity } from "../../src/core/types";

const mk = (tag: string, files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), tag));
	for (const [f, src] of Object.entries(files))
		writeFileSync(join(dir, f), src);
	return dir;
};

describe("迭代52-r3 链式返回 + G1 守卫", () => {
	it("StringBuilder 链式：两环都解析（返回表——无 <unresolved>）；局部链第二环 state 过近似", async () => {
		const dir = mk("r3-sb-", {
			"C.cs": `using System.Text;
public class C {
    public string M() {
        var sb = new StringBuilder();
        sb.Append("a").Append("b");
        return sb.ToString();
    }
}
`,
		});
		try {
			const res = await scanProject(dir, { useCache: false });
			const m = res.verdicts.find((v) => v.chunk.name === "C.M")!;
			expect(m).toBeDefined();
			// 链式两环解析成功：无 <unresolved>（返回表）
			expect(m.chunk.unknownSites).toBe(0);
			expect([...m.chunk.calls].some((t) => t.includes("<unresolved>"))).toBe(
				false,
			);
			// 局部链第二环 mutator 检查 → state 过近似（方向安全，参数共享链 S1 保护）
			expect(m.purity).toBe(Purity.IMPURE);
			expect(m.effects.has("state")).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("G1 守卫：参数共享 StringBuilder.Append 第二环 → state（S1 不假纯）", async () => {
		const dir = mk("r3-g1-", {
			"C.cs": `using System.Text;
public class C {
    public string M(StringBuilder sb) {
        sb.Append("a").Append("b");  // 参数共享容器变异 → state（第二环 receiver 分支 mutator 检查）
        return "x";
    }
}
`,
		});
		try {
			const res = await scanProject(dir, { useCache: false });
			const m = res.verdicts.find((v) => v.chunk.name === "C.M")!;
			expect(m).toBeDefined();
			expect(m.purity).toBe(Purity.IMPURE);
			expect(m.effects.has("state")).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("字面量豁免保留：[].append 仍纯（字面量不可共享）", async () => {
		const dir = mk("r3-lit-", {
			"l.py": "def f():\n    return [].append(1) or ' x '.strip()\n",
		});
		try {
			const res = await scanProject(dir, { useCache: false });
			const f = res.verdicts.find((v) => v.chunk.name === "f")!;
			expect(f).toBeDefined();
			expect(f.purity).toBe(Purity.PURE);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
