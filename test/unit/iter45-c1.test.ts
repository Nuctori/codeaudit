// 迭代45 C1 反例回归：写-读缓存属性/类 chunk 跨作用域污染——成员互斥短路守卫
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";

const mk = (tag: string, files: Record<string, string>) => {
	const dir = mkdtempSync(join(tmpdir(), tag));
	for (const [f, src] of Object.entries(files))
		writeFileSync(join(dir, f), src);
	return dir;
};

describe("iter45 C1 成员互斥守卫（S1 修复）", () => {
	it("类 chunk 跨作用域污染：字段初始化器读属性名不得短路判纯（C1 反例）", async () => {
		const dir = mk("c1-pollute-", {
			"C.cs": `class C {
    string _x = V;   // 字段初始化器：构造期读属性 V（getter 执行 io）
    public string V { get { return File.ReadAllText("x"); } }
    public int M() {
        int V = 5;   // 方法内局部声明同名 → 污染类 assigned
        return V;
    }
}
class Holder { public int Use() { return new C().M(); } }
`,
		});
		try {
			const res = await scanProject(dir, { useCache: false });
			const c = res.verdicts.find((v) => v.chunk.name === "C")!;
			expect(c).toBeDefined();
			// 类 chunk 字段初始化器读属性 V（getter io）——成员互斥守卫下不短路 → 非 PURE
			expect(c.purity).not.toBe(0); // 非 PURE（UNKNOWN=1 或 IMPURE=2）
			// 对照：无污染（V 不在类 assigned）时字段初始化器读 V 走既有解析 → 非 PURE
			expect(c.chunk.unknownSites).toBeGreaterThan(0); // 诚实 ?（属性读取 miss 或未知）
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("局部变量读短路保留（iter44 收益不回退）", async () => {
		const dir = mk("c1-local-", {
			"C.cs": `class C {
    public int M() {
        int status_ = 200;
        if (status_ == 200) return 0;
        return status_;
    }
}
`,
		});
		try {
			const res = await scanProject(dir, { useCache: false });
			const m = res.verdicts.find((v) => v.chunk.name === "C.M")!;
			expect(m).toBeDefined();
			expect(m.purity).toBe(0); // PURE——局部读短路
			expect(m.chunk.unknownSites).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("方法内写-读属性：成员名不短路（C# 隐式 this）", async () => {
		const dir = mk("c1-rw-", {
			"C.cs": `class C {
    string _v;
    public string V { get { if (_v == null) _v = File.ReadAllText("x"); return _v; } set { _v = value; } }
    public int M() {
        V = "a";
        if (V == null) return 0;
        return V.Length;
    }
}
class Holder { public int Use() { return new C().M(); } }
`,
		});
		try {
			const res = await scanProject(dir, { useCache: false });
			const m = res.verdicts.find((v) => v.chunk.name === "C.M")!;
			expect(m).toBeDefined();
			// V ∈ assigned(M)（赋值左值）但 V 是类成员 → 不短路 → 走既有解析
			// M 有 self.V state 写 → IMPURE（purity=2）
			expect(m.purity).toBe(2);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
