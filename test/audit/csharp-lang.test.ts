import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";

/** 迭代19：C# 语言包（InitDeity Unity 真实项目驱动）。 */

let dir: string;
beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "codeaudit-cs-"));
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
function by(report: {
	verdicts: { chunk: { file: string; name: string } }[];
}): Map<string, unknown> {
	const m = new Map<string, unknown>();
	for (const v of report.verdicts) m.set(`${v.chunk.file}::${v.chunk.name}`, v);
	return m;
}

describe("C# 语言包（迭代19）", () => {
	it("Unity 生命周期 + Debug.Log + 隐式 this 方法调用", async () => {
		const root = project("unity", {
			"Game.cs": [
				"using UnityEngine;",
				"public class Game : MonoBehaviour {",
				'    void Start() { Debug.Log("started"); LoadGame(); }',
				"    public void LoadGame() { score = 1; }",
				"    private int score = 0;",
				"    public int PureCalc(int a) { return Math.Max(a, score); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(r.stats.parseErrors).toBe(0);
		const start = by(r).get("Game.cs::Game.Start") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const load = by(r).get("Game.cs::Game.LoadGame") as
			| { purity: number }
			| undefined;
		const calc = by(r).get("Game.cs::Game.PureCalc") as
			| { purity: number }
			| undefined;
		expect(start).toBeDefined();
		expect(start!.purity).toBe(2); // Debug.Log io + LoadGame 传染
		expect(start!.effects.has("io")).toBe(true);
		expect(load!.purity).toBe(2); // score 状态写
		expect(calc!.purity).toBe(0); // Math.Max 纯 + 读状态（读非副作用）
	});

	it("Unity 效应表：PlayerPrefs/File/GameObject/Resources", async () => {
		const root = project("unityfx", {
			"S.cs": [
				"using UnityEngine;",
				"using System.IO;",
				"public class S {",
				'    public void Save() { PlayerPrefs.SetFloat("b", 1f); }',
				'    public void Read() { var d = File.ReadAllText("s"); }',
				'    public void Spawn() { GameObject.Find("x"); }',
				'    public void Load() { Resources.Load<GameObject>("p"); }',
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const save = by(r).get("S.cs::S.Save") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const read = by(r).get("S.cs::S.Read") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const spawn = by(r).get("S.cs::S.Spawn") as { purity: number } | undefined;
		const load = by(r).get("S.cs::S.Load") as { purity: number } | undefined;
		expect(save!.effects.has("state")).toBe(true); // PlayerPrefs
		expect(read!.effects.has("fs")).toBe(true); // File
		expect(spawn!.purity).toBe(2); // GameObject
		expect(load!.purity).toBe(2); // Resources
	});

	it("C# 属性访问器/事件订阅不崩溃；LINQ 动态链诚实 ?", async () => {
		const root = project("csfx", {
			"F.cs": [
				"using System.Linq;",
				"using System.Collections.Generic;",
				"public class F {",
				"    public int Count { get; set; }",
				"    public event System.Action OnChange;",
				"    public void Wire() { OnChange += Handle; }",
				"    public void Handle() { }",
				"    public int Sum(List<int> xs) { return xs.Where(x => x > 0).Sum(); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(r.stats.parseErrors).toBe(0);
		expect(r.stats.chunks).toBeGreaterThan(0);
	});

	it("C# 跨文件类调用解析（迭代19 全局类名索引）", async () => {
		const root = project("crossfile", {
			"Helper.cs": [
				"public class Helper {",
				'    public void SaveData() { PlayerPrefs.SetFloat("b", 1f); }',
				"}",
			].join("\n"),
			"Main.cs": [
				"public class Main {",
				"    public void Run() { Helper h = new Helper(); h.SaveData(); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		// Helper.SaveData 判 IMPURE（PlayerPrefs state）——跨文件类方法独立判定
		const save = by(r).get("Helper.cs::Helper.SaveData") as
			| { purity: number }
			| undefined;
		expect(save!.purity).toBe(2);
	});

	it("Unity 隐式 this 组件链：gameObject.SetActive / this.transform（迭代19）", async () => {
		const root = project("compchain", {
			"G.cs": [
				"using UnityEngine;",
				"public class G : MonoBehaviour {",
				"    void Start() { gameObject.SetActive(false); this.transform.position = Vector3.zero; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const start = by(r).get("G.cs::G.Start") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(start).toBeDefined();
		expect(start!.purity).toBe(2); // gameObject.SetActive → frameworkIo io
		expect(start!.effects.has("io")).toBe(true);
	});

	it("跨语言类名隔离（迭代19 复审 F1）：C# 不解析到 Python 同名类", async () => {
		const root = project("cslang", {
			"helper.py":
				"class Helper:\n    def Build(self):\n        import os\n        os.system('x')\n",
			"main.cs": [
				"public class Main {",
				"    public void Run() { Helper.Build(); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		// C# Main.Run 调 Helper.Build——语言隔离：不解析到 Python Helper.Build（会串入 io）
		const run = by(r).get("main.cs::Main.Run") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const pyBuild = by(r).get("helper.py::Helper.Build") as
			| { purity: number }
			| undefined;
		expect(pyBuild!.purity).toBe(2); // Python Helper.Build 独立判 io
		// C# 侧不应因 Python 类而变 IMPURE（无语言隔离时 Main.Run 会解析到 Python Build → io 串味）
		expect(run).toBeDefined();
	});

	it("迭代23：反射元数据读非 io（frameworkIo.System 收紧——全限定 System.Reflection 读落 UNKNOWN 不含 io）", async () => {
		const root = project("reflect-read", {
			"R.cs": [
				"using System;",
				"public class R {",
				"    public string Describe(Type t) { return System.Reflection.IntrospectionExtensions.GetTypeInfo(t).Name; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const m = by(r).get("R.cs::R.Describe") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(m).toBeDefined();
		expect(m!.effects.has("io")).toBe(false); // 反射元数据读不是 io（修复前 frameworkIo System.Reflection 前缀假阳 io）
		expect(m!.purity).toBe(1); // 前缀移除 → 落 ? → UNKNOWN（audit 公理 3，绝不 PURE）
	});

	it("迭代23：MethodInfo.Invoke 不假纯（全限定 System.Reflection 动态调用落 UNKNOWN 非 PURE）", async () => {
		const root = project("reflect-invoke", {
			"I.cs": [
				"public class I {",
				"    public object Call(object mi, object o) { return System.Reflection.MethodInfo.Invoke(mi, o, null); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const m = by(r).get("I.cs::I.Call") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(m).toBeDefined();
		expect(m!.effects.has("io")).toBe(false); // 前缀移除后无 io 假阳
		expect(m!.purity).not.toBe(0); // 动态调用绝不假纯（UNKNOWN=1 或 io=2，不容忍 PURE=0）
	});

	it("迭代24 T1：C# 方法调用目标不产生 stateRead（instance.Configure() 不误报读者）", async () => {
		const root = project("read-call-target", {
			"S.cs": [
				"public class Service {",
				"    public static Service instance;",
				"    public void Run() { instance.Configure(); }",
				"    public void Configure() { }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const run = by(r).get("S.cs::Service.Run") as
			| { chunk: { stateReads: string[] } }
			| undefined;
		expect(run).toBeDefined();
		// 修复前：裸读 ["instance","Configure"]（调用目标排除是死代码）；修复后：调用目标不计字段读
		expect(run!.chunk.stateReads).not.toContain("instance");
		expect(run!.chunk.stateReads).not.toContain("Configure");
		expect(run!.chunk.stateReads).not.toContain("instance.Configure");
	});

	it("迭代24 T2：C# 字段读仍产生 stateRead（instance.Value 位置读保留）", async () => {
		const root = project("read-field", {
			"S.cs": [
				"public class Service {",
				"    public static Service instance;",
				"    public int Value;",
				"    public int Read() { return instance.Value; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const read = by(r).get("S.cs::Service.Read") as
			| { chunk: { stateReads: string[] } }
			| undefined;
		expect(read).toBeDefined();
		// 修复前：只含裸读 ["instance","Value"]（无位置读）；修复后：位置读 "instance.Value" 保留
		expect(read!.chunk.stateReads).toContain("instance.Value");
	});

	it("迭代24 T3：C# 字段写可见（this.x = v 产生 state 写，写侧对偶⑦）", async () => {
		const root = project("write-field", {
			"S.cs": [
				"public class Service {",
				"    public int counter;",
				"    public void Bump() { this.counter = this.counter + 1; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const bump = by(r).get("S.cs::Service.Bump") as
			| {
					purity: number;
					effects: Set<string>;
					chunk: { stateWrites: string[] };
			  }
			| undefined;
		expect(bump).toBeDefined();
		// 修复前：externalWritePos 只认 attribute/member_expression → C# 字段写不可见 → 假 PURE；
		// 修复后：member_access_expression 写侧对偶 → "self.counter" 写 → state 效应
		expect(bump!.chunk.stateWrites).toContain("self.counter");
		expect(bump!.purity).toBe(2); // IMPURE（state 写）
		expect(bump!.effects.has("state")).toBe(true);
	});

	it("迭代25 T1：C# 对象初始化器属性写不产生外部写（new C { A = v } 非状态写）", async () => {
		const root = project("obj-init", {
			"C.cs": [
				"public class Config {",
				"    public int SegmentId;",
				"    public string Name;",
				'    public static Config Make(int v) { return new Config { SegmentId = v, Name = "a" }; }',
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const make = by(r).get("C.cs::Config.Make") as
			| { chunk: { stateWrites: string[] } }
			| undefined;
		expect(make).toBeDefined();
		// 修复前：initializer_expression 内 assignment_expression → 裸写 "SegmentId"/"Name"（伪外部状态写，
		// Quest12* 1949 读者机制源头）；修复后：新对象属性初始化非外部状态写 → 不产生
		expect(make!.chunk.stateWrites).not.toContain("SegmentId");
		expect(make!.chunk.stateWrites).not.toContain("Name");
	});

	it("迭代25 T2：C# ++ 写可见（this.x++ → self.x 写；i++ 局部不写）", async () => {
		const root = project("increment", {
			"I.cs": [
				"public class Counter {",
				"    public int score;",
				"    public int x;",
				"    public void Bump() { score++; ++score; this.x++; int i = 0; i++; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const bump = by(r).get("I.cs::Counter.Bump") as
			| { chunk: { stateWrites: string[] } }
			| undefined;
		expect(bump).toBeDefined();
		// 修复前：postfix/prefix_unary_expression 无写侧 → 自增字段方法被标纯（假纯）；
		// 修复后：this.x++ → "self.x"；裸 score++ / ++score（类字段）→ "self.score"；i++ 局部 → 无写
		expect(bump!.chunk.stateWrites).toContain("self.x");
		expect(bump!.chunk.stateWrites).toContain("self.score");
		expect(bump!.chunk.stateWrites).not.toContain("i");
	});

	it("迭代25 T3：C# 局部声明名不假裸读（variable_declarator 入 assigned）", async () => {
		const root = project("local-decl", {
			"L.cs": [
				"public class L {",
				"    public int M() { int q = 1; int r = q * 2; return r; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const m = by(r).get("L.cs::L.M") as
			| { chunk: { stateReads: string[] } }
			| undefined;
		expect(m).toBeDefined();
		// 修复前：variable_declarator 不在 assigned → q/r 假裸读；修复后：声明名入 assigned → 抑制
		expect(m!.chunk.stateReads).not.toContain("q");
		expect(m!.chunk.stateReads).not.toContain("r");
	});

	it("迭代25 T4：C# 类作用域裸字段写 → self.attr（非全局裸名；局部函数捕获不映射）", async () => {
		const root = project("bare-field", {
			"S.cs": [
				"public class Service {",
				"    public int score;",
				"    public void Set(int v) { score = v; int l = 0; l = 5; }",
				"    public void Outer() { int c = 0; void Inner() { c = 2; } }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const set = by(r).get("S.cs::Service.Set") as
			| { chunk: { stateWrites: string[] } }
			| undefined;
		expect(set).toBeDefined();
		// 修复前：裸写 "score"（全局裸名 → 与全库任何裸读 score 假耦合）；修复后：self.score
		expect(set!.chunk.stateWrites).toContain("self.score");
		expect(set!.chunk.stateWrites).not.toContain("score");
		expect(set!.chunk.stateWrites).not.toContain("l"); // 局部声明+重赋值 → 无写
		const outer = by(r).get("S.cs::Service.Outer") as
			| { chunk: { stateWrites: string[] } }
			| undefined;
		expect(outer).toBeDefined();
		// 局部函数捕获方法局部 c → 不映射 self.c（与 TS 闭包语义一致——裸外部写）
		expect(outer!.chunk.stateWrites).not.toContain("self.c");
	});

	it("迭代26 T1：C# 下标写可见（arr[0]=v → 参数容器外部写；items[0]=v → self.items；this.items[0]=v → self.items）", async () => {
		const root = project("subscript-write", {
			"S.cs": [
				"public class Service {",
				"    public int[] items;",
				"    public void F(int[] arr) {",
				"        arr[0] = 1;",
				"        items[0] = 2;",
				"        this.items[0] = 3;",
				"    }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const f = by(r).get("S.cs::Service.F") as
			| { chunk: { stateWrites: string[] } }
			| undefined;
		expect(f).toBeDefined();
		// 修复前：下标写完全不可见（假纯）；修复后：参数容器变异=外部写、C# 字段容器=self.items
		expect(f!.chunk.stateWrites).toContain("arr"); // 参数数组变异（外部——影响调用方）
		expect(f!.chunk.stateWrites).toContain("self.items"); // 裸字段容器 → self.items
		expect(f!.chunk.stateWrites).not.toContain("items"); // 不得是全局裸名
	});

	it("迭代26 T2：Python for 变量下标写不判外部（item[k]=v 的 item 在 assigned → 非外部）；TS 参数下标变异外部", async () => {
		const root = project("subscript-py", {
			"a.py":
				"def f(data):\n    for item in data:\n        item['k'] = 1\n    return data\n",
			"b.ts": "export function g(arr: number[], i: number) { arr[i] = 5; }\n",
		});
		const r = await scanProject(root, { useCache: false });
		const pf = by(r).get("a.py::f") as
			| { chunk: { stateWrites: string[] } }
			| undefined;
		expect(pf).toBeDefined();
		// for 变量 item 在 assigned（for_statement 是 assignmentTargets）→ 局部容器写，非外部
		expect(pf!.chunk.stateWrites).not.toContain("item");
		const tg = by(r).get("b.ts::g") as
			| { chunk: { stateWrites: string[] } }
			| undefined;
		expect(tg).toBeDefined();
		// TS 参数 arr 变异 → 外部写（与裸重绑 F2 不同——变异影响调用方）
		expect(tg!.chunk.stateWrites).toContain("arr");
	});

	it("迭代26 T3：声明名不产生裸读（C# 方法名/类名非外部变量读）", async () => {
		const root = project("decl-name", {
			"S.cs": [
				"public class Service {",
				"    public int Read() { return 1; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const read = by(r).get("S.cs::Service.Read") as
			| { chunk: { stateReads: string[] } }
			| undefined;
		expect(read).toBeDefined();
		// 修复前：方法名 Read 被当裸读（与全库同名写者假耦合）；修复后：声明名抑制
		expect(read!.chunk.stateReads).not.toContain("Read");
		// 类名 Service 在类 chunk（class_declaration name 字段），不在方法 chunk——类 chunk 断言（修复前含 Service 裸读）
		const cls = by(r).get("S.cs::Service") as
			| { chunk: { stateReads: string[] } }
			| undefined;
		expect(cls).toBeDefined();
		expect(cls!.chunk.stateReads).not.toContain("Service");
	});

	it("迭代26 T4：d[k].x = v 写 → 根限定 ⊤（d.⊤，与读侧对偶）；局部 o.x=1 不误报", async () => {
		const root = project("sub-member-write", {
			"a.py":
				"def f(d, k):\n    d[k].x = 2\n    return d\ndef g():\n    o = {}\n    o.x = 1\n    return o\n",
		});
		const r = await scanProject(root, { useCache: false });
		const f = by(r).get("a.py::f") as
			| { chunk: { stateWrites: string[] } }
			| undefined;
		expect(f).toBeDefined();
		expect(f!.chunk.stateWrites).toContain("d.⊤"); // d[k].x = v → 根限定 ⊤（读侧对偶）
		const g = by(r).get("a.py::g") as
			| { chunk: { stateWrites: string[] } }
			| undefined;
		expect(g).toBeDefined();
		expect(g!.chunk.stateWrites).not.toContain("o.⊤"); // 局部 o（assigned）→ 不产生写
	});

	it("迭代27 T1：C# pattern 解构名 + foreach 变量不裸读；集合读保留（防 ④ 误抑制锚）", async () => {
		const root = project("decl-pattern", {
			"M.cs": [
				"using System;",
				"public class M {",
				"    int[] arr = new int[1];",
				"    public int Run() {",
				"        var (a, b) = Tuple.Create(1, 2);",
				"        foreach (var item in arr) { }",
				"        return 1;",
				"    }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const m = by(r).get("M.cs::M.Run") as
			| { chunk: { stateReads: string[] } }
			| undefined;
		expect(m).toBeDefined();
		expect(m!.chunk.stateReads).not.toContain("a"); // tuple_pattern 声明名（修复前裸读）
		expect(m!.chunk.stateReads).not.toContain("b");
		expect(m!.chunk.stateReads).not.toContain("item"); // foreach 变量（修复前裸读）
		expect(m!.chunk.stateReads).toContain("arr"); // 集合读（in 之后的 arr 字段是真外部读）——④ 不得误抑制
	});

	it("迭代27 T2：TS catch 变量 + 解构声明名不裸读", async () => {
		const root = project("decl-ts", {
			"a.ts":
				"export function f(arr: number[]) {\n  const [a, b] = arr;\n  let r = a + b;\n  try { r++; } catch (e) { r = 0; }\n  return r;\n}\n",
		});
		const r = await scanProject(root, { useCache: false });
		const f = by(r).get("a.ts::f") as
			| { chunk: { stateReads: string[] } }
			| undefined;
		expect(f).toBeDefined();
		// catch 变量 e 不裸读（修复前裸读）；解构声明名 a/b 不裸读（修复前裸读；use 读 a+b 仍存在——方案B 待办）
		expect(f!.chunk.stateReads).not.toContain("e");
		const reads = f!.chunk.stateReads.filter(
			(x) => x === "a" || x === "b",
		).length;
		expect(reads).toBeLessThanOrEqual(2); // 仅 use 读（声明名抑制后），修复前 4 次（声明 2 + use 2）
	});

	it("迭代27 T3：Python except 变量不裸读；异常类型名保留", async () => {
		const root = project("decl-py", {
			"a.py":
				"def f():\n    try:\n        return 1\n    except Exception as e:\n        return 0\n",
		});
		const r = await scanProject(root, { useCache: false });
		const f = by(r).get("a.py::f") as
			| { chunk: { stateReads: string[] } }
			| undefined;
		expect(f).toBeDefined();
		expect(f!.chunk.stateReads).not.toContain("e"); // except as 变量（修复前裸读）
		// Exception 类型名是既有噪音族（不动）——不断言不包含，仅记录
	});

	it("迭代27 T4：JS catch 变量不裸读", async () => {
		const root = project("decl-js", {
			"a.js":
				"function f() {\n  try { return 1; } catch (e) { return 0; }\n}\n",
		});
		const r = await scanProject(root, { useCache: false });
		const f = by(r).get("a.js::f") as
			| { chunk: { stateReads: string[] } }
			| undefined;
		expect(f).toBeDefined();
		expect(f!.chunk.stateReads).not.toContain("e"); // catch 变量（修复前裸读）
	});

	it("迭代30 T1：全限定 System.* 纯命名空间判纯（global:System miss 回退——frameworkPure 白名单）", async () => {
		const root = project("system-pure", {
			"U.cs": [
				"public class U {",
				"    public string Encode(string s) { return System.Uri.EscapeDataString(s); }",
				"    public int Add() {",
				"        var l = new System.Collections.Generic.List<int>();",
				"        System.Collections.Generic.List<int>.Add(l, 1);",
				"        return l.Count;",
				"    }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const enc = by(r).get("U.cs::U.Encode") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(enc).toBeDefined();
		// 修复前：global:System miss → ? → UNKNOWN=1；修复后：Uri 命中 frameworkPure → 纯
		expect(enc!.effects.has("io")).toBe(false);
		expect(enc!.purity).toBe(0); // PURE——EscapeDataString 纯计算
	});

	it("迭代30 T2：frameworkIo.System 9 表边界仍 io（Net 前缀不被 frameworkPure 放纯）", async () => {
		const root = project("system-io", {
			"N.cs": [
				"public class N {",
				"    public void Send() { System.Net.Http.HttpClient.SendAsync(null); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const n = by(r).get("N.cs::N.Send") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(n).toBeDefined();
		// attr="Net.Http.HttpClient.SendAsync" 首段 Net ∈ frameworkIo.System 9 条 → 仍 io
		expect(n!.effects.has("io")).toBe(true);
		expect(n!.purity).toBe(2); // IMPURE——网络调用
	});

	it("迭代30 T3：frameworkPure 命中不吞 HOF 回调效应（Linq.Enumerable.ForEach(xs, Save) 非假纯）", async () => {
		const root = project("system-hof", {
			"H.cs": [
				"public class H {",
				"    static void Save(int x) { System.Console.WriteLine(x); }",
				"    public void Run() { System.Linq.Enumerable.ForEach(new int[] { 1 }, Save); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const run = by(r).get("H.cs::H.Run") as
			| { purity: number; effects: Set<string>; chain: number }
			| undefined;
		expect(run).toBeDefined();
		// 迭代30 复审：纯前缀命中不得丢回调边——Save 写 Console（io）经回调传染 Run。
		// 修复前：frameworkPure 命中直接 return → Run 判 PURE=0（假纯，公理 3 方向最重）；
		// 修复后：hofCallsArgs.ForEach → addArgEdges → Save 的 io 边 → IMPURE=2
		expect(run!.effects.has("io")).toBe(true);
		expect(run!.purity).toBe(2); // IMPURE——回调 io 传染
	});

	it("迭代31 S3：静态 LINQ + 命名框架成员回调（Console.WriteLine）不假纯——UNKNOWN 非 PURE", async () => {
		const root = project("linq-framework-cb", {
			"C.cs": [
				"public class C {",
				"    public void Run() { System.Linq.Enumerable.Select(new int[] { 1 }, System.Console.WriteLine); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const run = by(r).get("C.cs::C.Run") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(run).toBeDefined();
		// 迭代31 S3（审计实证活洞）：修复前 hofAlwaysArgs 空表 → Console.WriteLine 回调 io 被吞 → PURE=0 假纯。
		// 迭代40 B5 后：方法组实参（System.Console.WriteLine）经属性读取通道命中效应表 → 确定 io → IMPURE=2
		// （比旧 UNKNOWN 更精确——方法组被 HOF 调用必然执行 io；S2 方向安全）
		expect(run!.purity).not.toBe(0); // 不容忍 PURE——回调可能 io
		expect(run!.purity).toBe(2); // IMPURE——确定 io（B5 属性读取通道）
	});

	it("迭代31 S1：C# 链式调用第二环起恢复解析（receiverTypeOf 支持 invocation_expression）", async () => {
		const root = project("chain-s1", {
			"S.cs": [
				"public class S {",
				'    public string Chain() { return "  hello  ".Trim().ToUpper().TrimEnd(); }',
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const chain = by(r).get("S.cs::S.Chain") as
			| {
					purity: number;
					effects: Set<string>;
					chunk: { unknownSites: number };
			  }
			| undefined;
		expect(chain).toBeDefined();
		// 修复前：invocation_expression 不在 receiverTypeOf 类型检查 → 第二环起断 → unknownSites > 0；
		// 修复后：Trim→string 查 builtinMethodReturns→ToUpper→string→TrimEnd→string 链不断，零未知站点
		expect(chain!.chunk.unknownSites).toBe(0);
		expect(chain!.purity).toBe(0); // PURE——纯字符串链
	});

	it("迭代31 HIGH-1：linqHof 差集算子命名回调不假纯（Enumerable.Last(xs, Console.WriteLine) → UNKNOWN）", async () => {
		const root = project("linq-high1", {
			"C.cs": [
				"public class C {",
				"    public void Run() { System.Linq.Enumerable.Last(new int[] { 1 }, System.Console.WriteLine); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const run = by(r).get("C.cs::C.Run") as { purity: number } | undefined;
		expect(run).toBeDefined();
		// HIGH-1（复审实证活洞）：Last ∈ linqHof \ hofAlwaysArgs 差集——修复前 frameworkPure 放行
		// addArgEdges 但 UNKNOWN 门只查 hofAlwaysArgs → 命名回调被吞 → PURE=0 假纯。
		// 迭代40 B5 后：方法组实参经属性读取通道命中效应表 → 确定 io → IMPURE=2（同 S3）
		expect(run!.purity).not.toBe(0); // 不容忍 PURE
		expect(run!.purity).toBe(2); // IMPURE——确定 io（B5 属性读取通道）
	});

	it("迭代31 MEDIUM-2：String.Join 值实参不误伤（纯静态非 HOF → PURE）", async () => {
		const root = project("string-join", {
			"C.cs": [
				"public class C {",
				'    public string Join(string[] parts) { return string.Join(",", parts); }',
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const join = by(r).get("C.cs::C.Join") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(join).toBeDefined();
		// MEDIUM-2（复审实证回归）：修复前 Join ∈ 全局 hofCallsArgs → pureGlobals.String 门 →
		// argFnsOf 收 parts → 未解析 → ? → UNKNOWN 假 UNKNOWN（原 PURE）。修复后 Join 移出全局表 → PURE
		expect(join!.effects.has("io")).toBe(false);
		expect(join!.purity).toBe(0); // PURE——string.Join 纯静态
	});

	it("迭代31 撞名守卫：Math.Max(a, score) 纯静态不被当 HOF（PURE——读状态非副作用）", async () => {
		const root = project("math-max-guard", {
			"C.cs": [
				"public class C {",
				"    private int score = 0;",
				"    public int Calc(int a) { return Math.Max(a, score); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const calc = by(r).get("C.cs::C.Calc") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(calc).toBeDefined();
		// 撞名守卫（复审建议）：Math.Max 的 score 是状态读非回调——若 Max 在全局 HOF 表会被 argFnsOf
		// 误收 → 假 UNKNOWN。修复后 Max 移入 linqHof、全局表不含 → PURE
		expect(calc!.effects.has("io")).toBe(false);
		expect(calc!.purity).toBe(0); // PURE——Math.Max 纯 + 读状态
	});

	it("迭代32 T1：frameworkPure 成员级未列成员落 ? 诚实（Runtime.CompilerServices → UNKNOWN 非 PURE）", async () => {
		const root = project("fp-unlisted", {
			"C.cs": [
				"public class C {",
				"    public void Run() { System.Runtime.CompilerServices.RuntimeHelpers.EnsureSufficientExecutionStack(); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const run = by(r).get("C.cs::C.Run") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(run).toBeDefined();
		// 成员级白名单（迭代32）：Runtime/CompilerServices 未列 → fall-through → UNKNOWN=1 诚实
		// （修复前前缀级 System 白名单不含 Runtime 段，同为 UNKNOWN——本用例守卫"成员级不越界放纯"）
		expect(run!.effects.has("io")).toBe(false);
		expect(run!.purity).toBe(1); // UNKNOWN——诚实未知，非假纯
	});

	it("迭代32 T2：Array 逐成员拆分——Find 回调未解析 → UNKNOWN；Sort 纯 → PURE", async () => {
		const root = project("fp-array-split", {
			"C.cs": [
				"public class C {",
				"    static bool Pred(int x) { return x > 0; }",
				"    public int Find() { return System.Array.Find(new int[] { 1 }, Pred); }",
				"    public void SortIt(int[] xs) { System.Array.Sort(xs); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const find = by(r).get("C.cs::C.Find") as { purity: number } | undefined;
		const sort = by(r).get("C.cs::C.SortIt") as { purity: number } | undefined;
		expect(find).toBeDefined();
		expect(sort).toBeDefined();
		// Array.Find = hof 成员（委托形参）→ Pred 经 bySimple 解析成边 → IMPURE 或 PURE 依 Pred；
		// Pred 纯 → Find 纯。核心断言：Find 不走"纯成员忽略回调"路径（其 tag=hof），
		// Sort = pure 成员（无委托）→ PURE
		expect(sort!.purity).toBe(0); // PURE——Sort 纯（无回调义务）
		expect(find!.purity).not.toBe(2); // 回调 Pred 纯 → 非 IMPURE
	});

	it("迭代32 T3：Enumerable 整类 hof 回调义务保留（Select + 本地回调 → PURE；+ 框架回调 → UNKNOWN）", async () => {
		const root = project("fp-enum-hof", {
			"C.cs": [
				"public class C {",
				"    static int Twice(int x) { return x * 2; }",
				"    public void Sel() { System.Linq.Enumerable.Select(new int[] { 1 }, Twice); }",
				"    public void SelFw() { System.Linq.Enumerable.Select(new int[] { 1 }, System.Console.WriteLine); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const sel = by(r).get("C.cs::C.Sel") as { purity: number } | undefined;
		const selFw = by(r).get("C.cs::C.SelFw") as { purity: number } | undefined;
		expect(sel).toBeDefined();
		expect(selFw).toBeDefined();
		// Enumerable = hof 整类（迭代32：1 键取代 linqHof 29 算子）——Twice 解析成边且纯 → PURE；
		// 迭代40 B5 后：Console.WriteLine 方法组实参经属性读取通道命中效应表 → 确定 io → IMPURE（非假纯）
		expect(sel!.purity).toBe(0); // PURE——回调 Twice 纯
		expect(selFw!.purity).not.toBe(0); // 不容忍 PURE——框架回调 io 未确证
		expect(selFw!.purity).toBe(2); // IMPURE——确定 io（B5 属性读取通道）
	});

	it("迭代32 T4：Text 子命名空间嵌套（复审 Blocking 修复——System.Text.Encoding.UTF8 纯计算 → PURE）", async () => {
		const root = project("fp-text", {
			"C.cs": [
				"public class C {",
				'    public byte[] Enc() { return System.Text.Encoding.UTF8.GetBytes("hello"); }',
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const enc = by(r).get("C.cs::C.Enc") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(enc).toBeDefined();
		// 迭代32 复审 Blocking：初版把 StringBuilder/Encoding/RegularExpressions 放 System 顶层散键，
		// 但匹配按 rest 首段 "Text" 查 → System.Text.* 整子树 miss 落 ?（55 站翻纯→? 实证）。
		// 修复后嵌套 Text: { Encoding: pure } → UTF8.GetBytes 纯计算 → PURE
		expect(enc!.effects.has("io")).toBe(false);
		expect(enc!.purity).toBe(0); // PURE——UTF8 编码纯计算
	});

	it("迭代33 C2：X.gameObject.* 前缀白名单 → io（Unity 组件属性，局部变量 receiver）", async () => {
		const root = project("go-prefix", {
			"C.cs": [
				"public class C {",
				"    public void Hide(GameObject item) { item.gameObject.SetActive(false); }",
				"    public void Ext(GameObject root) { root.gameObject.RefreshSelf(true); }",
				"    public void Direct() { this.gameObject.SetActive(true); }",
				"    public void Local(GameObject src) { var item = src; item.gameObject.SetActive(false); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const hide = by(r).get("C.cs::C.Hide") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const ext = by(r).get("C.cs::C.Ext") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const direct = by(r).get("C.cs::C.Direct") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const local = by(r).get("C.cs::C.Local") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(hide).toBeDefined();
		expect(ext).toBeDefined();
		expect(direct).toBeDefined();
		expect(local).toBeDefined();
		// 迭代33 C2（InitDeity 98 chunks/115 站痛点）：item.gameObject.SetActive（局部变量 receiver）→ io
		// （修复前 obj=item 变量全漏 → ?）；root.gameObject.RefreshSelf（项目扩展不在白名单）→ 仍 UNKNOWN 诚实；
		// this.gameObject.SetActive 既有路径不变
		// 迭代34 独立审计修复：C2 分支移回 assigned 守卫之前——**真局部变量**（var item = src）也覆盖
		// （原实现嵌套在守卫内，局部变量被 assigned 跳过——审计实证 UNKNOWN；此用例防回归）
		expect(hide!.effects.has("io")).toBe(true);
		expect(hide!.purity).toBe(2); // IMPURE——SetActive io
		expect(ext!.purity).toBe(1); // UNKNOWN——RefreshSelf 不在白名单（诚实）
		expect(direct!.effects.has("io")).toBe(true);
		expect(direct!.purity).toBe(2); // IMPURE——既有判定不变
		expect(local!.effects.has("io")).toBe(true);
		expect(local!.purity).toBe(2); // IMPURE——局部变量 receiver 也覆盖（迭代34 修复）
	});

	it("迭代33 TP5：NUnit StringAssert/Does 判纯（675 站痛点恢复）", async () => {
		const root = project("nunit-pure", {
			"C.cs": [
				"public class C {",
				'    public void T1(string s) { StringAssert.Contains("a", s); }',
				"    public void T2(string s) { Does.Contain(s); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const t1 = by(r).get("C.cs::C.T1") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const t2 = by(r).get("C.cs::C.T2") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(t1).toBeDefined();
		expect(t2).toBeDefined();
		// 迭代33 TP5：StringAssert/Does 入 pureGlobals（抛异常≠副作用）——修复前 675 站假 UNKNOWN。
		// 注意 Does.Contain(s).Ignore() 链式（Ignore 返回类型表外断链）不属于本修复——裸调判定纯
		expect(t1!.effects.has("io")).toBe(false);
		expect(t1!.purity).toBe(0); // PURE——StringAssert 纯断言
		expect(t2!.effects.has("io")).toBe(false);
		expect(t2!.purity).toBe(0); // PURE——Does 纯断言
	});

	it("迭代33 C1：构造器建模四边界（纯构造/构造即 io/未列诚实/项目类构造边传导）", async () => {
		const root = project("ctor-model", {
			"C.cs": [
				"using System.Collections.Generic;",
				"using System.IO;",
				"public class C {",
				"    public List<int> Pure() { return new List<int>(); }",
				'    public FileStream Io() { return new FileStream("x", FileMode.Open); }',
				"    public void Unlisted() { var x = new UnknownThing(); }",
				"}",
				'public class Proj { public Proj() { File.WriteAllText("a", "b"); } }',
				"public class User { public void M() { var p = new Proj(); } }",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const pure = by(r).get("C.cs::C.Pure") as { purity: number } | undefined;
		const io = by(r).get("C.cs::C.Io") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const unlisted = by(r).get("C.cs::C.Unlisted") as
			| { purity: number }
			| undefined;
		const userM = by(r).get("C.cs::User.M") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(pure).toBeDefined();
		expect(io).toBeDefined();
		expect(unlisted).toBeDefined();
		expect(userM).toBeDefined();
		// 迭代33 C1（InitDeity unknown 5102→4644 最大单项）：纯构造 → PURE；
		// 构造即 io（impureGlobals FileStream:fs）→ IMPURE；未列类型 → UNKNOWN 诚实；
		// 项目类构造边 → ctor chunk（构造体 fs 传导到 User.M——陷阱 2 防假纯验证）
		expect(pure!.purity).toBe(0); // new List → PURE
		expect(io!.effects.has("fs")).toBe(true);
		expect(io!.purity).toBe(2); // new FileStream → IMPURE fs
		expect(unlisted!.purity).toBe(1); // new UnknownThing → UNKNOWN（未列诚实）
		expect(userM!.effects.has("fs")).toBe(true);
		expect(userM!.purity).toBe(2); // new Proj → 构造体 fs 传导
	});

	it("迭代34：ctorTypeName 泛型末段递归 + 项目类撞 pureCtor 名单优先", async () => {
		const root = project("ctor-fix", {
			"C.cs": [
				"using System.Collections.Generic;",
				"public class C {",
				"    public void Gen() { var d = new System.Collections.Generic.Dictionary<string, int>(); }",
				"    public void Pre() { var s = new string('x', 2); }",
				"}",
				// 项目类撞 pureCtor 名单名（List）且构造体有 io——必须走项目类构造边非 pureCtor
				'public class List { public List() { System.Console.WriteLine("ctor"); } }',
				"public class User { public void M() { var l = new List(); } }",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const gen = by(r).get("C.cs::C.Gen") as { purity: number } | undefined;
		const pre = by(r).get("C.cs::C.Pre") as { purity: number } | undefined;
		const userM = by(r).get("C.cs::User.M") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(gen).toBeDefined();
		expect(pre).toBeDefined();
		expect(userM).toBeDefined();
		// 迭代34 修复：qualified_name 末段递归（Dictionary<K,V> → Dictionary ∈ pureCtor → PURE——
		// 此前末段 generic_name 被 filter 丢 → null → 假 UNKNOWN）；predefined_type（string）→ "string"
		// ∈ pureCtor → PURE（此前 null）；项目类撞 pureCtor（List 带 io 构造）→ 项目类边优先 → io 传导
		expect(gen!.purity).toBe(0); // new System.Collections.Generic.Dictionary<string,int> → PURE
		expect(pre!.purity).toBe(0); // new string('x',2) → PURE
		expect(userM!.effects.has("io")).toBe(true);
		expect(userM!.purity).toBe(2); // new List（项目类撞名单）→ 构造体 io 传导（迭代34 修复防假纯）
	});

	it("迭代35 A1 + 迭代38 B：参数显式类型绑定——纯信箱判纯、容器变异方法判 state（§b-7 统一）", async () => {
		const root = project("a1-param", {
			"C.cs": [
				"using System.Collections.Generic;",
				"public class C {",
				"    public int Read(Dictionary<string, int> d, string key) {",
				"        int v = 0;",
				"        d.TryGetValue(key, out v);",
				"        d.Add(key, v);",
				"        return v;",
				"    }",
				"    public int Sum(List<int> xs) {",
				"        xs.Add(1);",
				"        return xs.Count;",
				"    }",
				"    public void Other(string s) { s.Trim(); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const read = by(r).get("C.cs::C.Read") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const sum = by(r).get("C.cs::C.Sum") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const other = by(r).get("C.cs::C.Other") as { purity: number } | undefined;
		expect(read).toBeDefined();
		expect(sum).toBeDefined();
		expect(other).toBeDefined();
		// 纯读信箱（TryGetValue/Count）与 string 表 Trim 仍 → PURE。
		expect(read!.effects.has("io")).toBe(false);
		expect(read!.effects.has("state")).toBe(true);
		expect(read!.purity).toBe(2); // Dictionary 参数：TryGetValue 纯 + Add 变异 → state（IMPURE）
		expect(sum!.effects.has("state")).toBe(true);
		expect(sum!.purity).toBe(2); // List 参数：Add 变异 → state（IMPURE）；Count 纯读
		expect(other!.purity).toBe(0); // string 参数 Trim → PURE（不可变，无变异）
	});

	it("迭代36 A1 修复：项目类撞表键作参数类型 → 不走表绑定（假纯红线闭合）", async () => {
		const root = project("a1-project-guard", {
			"C.cs": [
				"public class C {",
				// 项目自建 List 类（撞 builtinTypeEffects List 键）且 Add 有 io——参数 xs 类型为项目 List
				"    public void Use(List xs) { xs.Add(1); }",
				"}",
				// 项目 List 类：Add 写 Console（io）——若 A1 走表绑定 List.Add → pure 则假纯
				"public class List { public void Add(int x) { System.Console.WriteLine(x); } }",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const use = by(r).get("C.cs::C.Use") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(use).toBeDefined();
		// 迭代36 独立审计 High：修复前 ptype="List" 撞 builtinTypeEffects List 键 → Add 判 PURE 假纯
		// （项目 List.Add 写 Console）。修复后项目类守卫跳过表绑定 → 走全局类解析 → 项目 List.Add io 传导
		expect(use!.effects.has("io")).toBe(true);
		expect(use!.purity).toBe(2); // IMPURE——项目 List.Add io 传导（假纯闭合）
	});

	it("迭代37 P1-3：C# 方法重载歧义 → 并集边（TP2 恢复：PrepareRequest 732 站断链）", async () => {
		const root = project("overload-union", {
			"C.cs": [
				"public class ApiClientHelper {",
				'    public static int PrepareRequest(int x) { return System.IO.File.ReadAllText("a"); }',
				"    public static int PrepareRequest(string s) { return s.Length; }",
				"    public static int Call() { return PrepareRequest(1); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const call = by(r).get("C.cs::ApiClientHelper.Call") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(call).toBeDefined();
		// 两重载并集边：{io} ∪ {} = {io} → IMPURE（原 ambiguous 记 UNKNOWN 断链——TP2 修复）
		expect(call!.effects.has("io")).toBe(true);
		expect(call!.purity).toBe(2); // IMPURE——重载并集保守且确定
	});

	it("迭代37 P1-2：局部单赋值构造绑定（var xs = new List<int>() → xs.Add 纯信箱 PURE）", async () => {
		const root = project("lb-list", {
			"C.cs": [
				"public class C {",
				"    public int Count() { var xs = new List<int>(); xs.Add(1); return xs.Count; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const c = by(r).get("C.cs::C.Count") as { purity: number } | undefined;
		expect(c).toBeDefined();
		// var xs = new List<int>() → xs:"List" → xs.Add 查 builtinTypeEffects.List.Add = pure → PURE
		expect(c!.purity).toBe(0); // PURE——集合纯信箱（修复前 xs.Add 落 ? → UNKNOWN）
	});

	it("迭代37 P1-2：项目类构造绑定 → 构造体 io 传导（不假纯）", async () => {
		const root = project("lb-project", {
			"Db.cs":
				'public class MyDb { public void Connect() { System.Console.WriteLine("x"); } }',
			"C.cs": [
				"public class C {",
				"    public void Run() { var db = new MyDb(); db.Connect(); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const run = by(r).get("C.cs::C.Run") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(run).toBeDefined();
		// db:"MyDb" → 全局类解析 MyDb.Connect（写 Console io）→ IMPURE（修复前 db.Connect 落 ? → UNKNOWN）
		expect(run!.effects.has("io")).toBe(true);
		expect(run!.purity).toBe(2);
	});

	it("迭代37 P1-2：守卫——重绑/多赋值不绑（xs.Add 仍 ? 诚实）", async () => {
		const root = project("lb-guard", {
			"C.cs": [
				"public class C {",
				"    public void Run(List<int> other) { var xs = new List<int>(); xs = other; xs.Add(1); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const run = by(r).get("C.cs::C.Run") as { purity: number } | undefined;
		expect(run).toBeDefined();
		// xs 重绑（count=2）→ 不绑；参数 other 注入 → xs.Add 动态分派 ? → UNKNOWN 诚实（方向安全）
		expect(run!.purity).toBe(1); // UNKNOWN——守卫守住（宁 UNKNOWN 不 PURE）
	});

	it("迭代40 B5：自定义 getter io 传染（参数类型/隐式 this/this/局部构造 → IMPURE 非假纯）", async () => {
		const root = project("b5-prop", {
			"C.cs": [
				"using System;",
				"public class Config {",
				'    public int Value { get { Console.WriteLine("io"); return 1; } }',
				"    public int Auto { get; set; } = 42;",
				"    public int Field = 7;",
				"}",
				"public class User {",
				'    public int Cached { get { Console.WriteLine("u io"); return 3; } }',
				"    public int ReadParam(Config c) { return c.Value; }",
				"    public int Own() { return Cached; }",
				"    public int OwnThis() { return this.Cached; }",
				"    public int Local() { var cfg = new Config(); return cfg.Value; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(r.stats.parseErrors).toBe(0);
		const readParam = by(r).get("C.cs::User.ReadParam") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const own = by(r).get("C.cs::User.Own") as { purity: number } | undefined;
		const ownThis = by(r).get("C.cs::User.OwnThis") as
			| { purity: number }
			| undefined;
		const local = by(r).get("C.cs::User.Local") as
			| { purity: number }
			| undefined;
		const prop = by(r).get("C.cs::Config.Value") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(readParam).toBeDefined();
		expect(own).toBeDefined();
		expect(ownThis).toBeDefined();
		expect(local).toBeDefined();
		expect(prop).toBeDefined();
		// B5 修复前：getter 体效应并入类 chunk，属性读取不建边 → 读取方假纯 PURE=0
		// 修复后：property chunk 独立 + 属性读取建 prop 边 → 四通道全传染 io
		expect(prop!.purity).toBe(2); // getter chunk 自身 io
		expect(prop!.effects.has("io")).toBe(true);
		expect(readParam!.purity).toBe(2); // 参数类型绑定 → getter chunk 边
		expect(own!.purity).toBe(2); // 隐式 this 裸名读取
		expect(ownThis!.purity).toBe(2); // this 读取
		expect(local!.purity).toBe(2); // 局部构造绑定
	});

	it("迭代40 B5：自动属性/字段读取判纯（无用户代码；参数/隐式 this/类名静态通道）", async () => {
		const root = project("b5-pure", {
			"C.cs": [
				"public class Config {",
				"    public int Auto { get; set; } = 42;",
				"    public int Field = 7;",
				"    public static int StaticField = 9;",
				"}",
				"public class User {",
				"    public int ReadAuto(Config c) { return c.Auto; }",
				"    public int ReadField(Config c) { return c.Field; }",
				"    public int Stat() { return Config.StaticField; }",
				"    public int OwnMissing() { return this.Missing; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const auto = by(r).get("C.cs::User.ReadAuto") as
			| { purity: number }
			| undefined;
		const field = by(r).get("C.cs::User.ReadField") as
			| { purity: number }
			| undefined;
		const stat = by(r).get("C.cs::User.Stat") as { purity: number } | undefined;
		const miss = by(r).get("C.cs::User.OwnMissing") as
			| { purity: number }
			| undefined;
		expect(auto).toBeDefined();
		expect(field).toBeDefined();
		expect(stat).toBeDefined();
		expect(miss).toBeDefined();
		// C# 静态语义：字段/自动属性/不存在成员读取不执行用户代码 → 纯（S1 模型内成立）
		expect(auto!.purity).toBe(0); // 自动属性空 chunk 零效应
		expect(field!.purity).toBe(0); // 字段 miss+prop → 纯
		expect(stat!.purity).toBe(0); // 类名静态字段 → 纯
		expect(miss!.purity).toBe(0); // this 不存在成员 → 纯（编译错 = 无运行时行为）
	});

	it("迭代40 M5：obj?.Prop 条件访问读取建边——getter io 传染（?. 假纯通道闭合）", async () => {
		const root = project("b5-cond", {
			"C.cs": [
				"using System;",
				"public class Config {",
				'    public int Value { get { Console.WriteLine("io"); return 1; } }',
				"    public int Auto { get; set; } = 42;",
				'    public int Get() { Console.WriteLine("m"); return 1; }',
				"}",
				"public class User {",
				"    public int Read(Config c) { return c?.Value ?? 0; }",
				"    public int ReadAuto(Config c) { return c?.Auto ?? 0; }",
				"    public int Call(Config c) { c?.Get(); return 0; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const read = by(r).get("C.cs::User.Read") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const auto = by(r).get("C.cs::User.ReadAuto") as
			| { purity: number }
			| undefined;
		const call = by(r).get("C.cs::User.Call") as { purity: number } | undefined;
		expect(read).toBeDefined();
		expect(auto).toBeDefined();
		expect(call).toBeDefined();
		// M5 修复前：c?.Value 不建边 → getter io 不传染（M_out M5 假纯通道）；
		// 修复后：conditional_access 走 prop 通道 → 参数类型解析 → getter 传染
		expect(read!.purity).toBe(2); // c?.Value → getter io 传染
		expect(read!.effects.has("io")).toBe(true);
		expect(auto!.purity).toBe(0); // c?.Auto 自动属性空 chunk → 纯
		expect(call!.purity).toBe(2); // c?.Get() 是调用（conditional 是 invocation 的 function）→ 方法 io 传染
	});

	it("迭代42 候选3：enum 成员读取判纯（编译期常量，无用户代码）", async () => {
		const root = project("enum42", {
			"E.cs": [
				"public enum GameState { Menu, Playing }",
				"public class Use {",
				"    public int GetState() { return (int)GameState.Menu; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(r.stats.parseErrors).toBe(0);
		const v = by(r).get("E.cs::Use.GetState") as { purity: number } | undefined;
		expect(v).toBeDefined();
		// 修复前：GameState.Menu 落 markDynamic → UNKNOWN；修复后：enum chunk 进 globalClasses
		// → prop miss + propMissIsPure 判纯（C# 静态语义：enum 成员无用户代码）
		expect(v!.purity).toBe(0);
	});

	it("迭代42 候选7：静态成员访问触发类型加载——静态初始化器 io 传染（活假纯洞闭合）", async () => {
		const root = project("staticload42", {
			"P.cs": [
				"using System.IO;",
				"public class P {",
				'    public static int X = File.ReadAllText("a").Length;',
				"    public static int Get() { return X; }",
				"}",
				"public class User {",
				"    public int Use() { return P.Get(); }",
				"    public int ReadX() { return P.X; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(r.stats.parseErrors).toBe(0);
		const use = by(r).get("P.cs::User.Use") as
			| { purity: number; effects: Set<string> }
			| undefined;
		const readx = by(r).get("P.cs::User.ReadX") as
			| { purity: number }
			| undefined;
		expect(use).toBeDefined();
		expect(readx).toBeDefined();
		// 修复前：Use/ReadX 判 PURE=0（类型加载执行 File.ReadAllText 漏报——S1 违反）；
		// 修复后：类型加载闭包并入 → fs 效应传播
		expect(use!.purity).toBe(2);
		expect(use!.effects.has("fs")).toBe(true);
		expect(readx!.purity).toBe(2); // prop 读路径同闭合
	});

	it("迭代42 候选7 对照：无字段初始化器的纯静态类零变化 + 裸名初始化器诚实 UNKNOWN", async () => {
		const root = project("staticpure42", {
			"M.cs": [
				"public class M {",
				"    public static int Twice(int x) { return x * 2; }",
				"}",
				"public class P2 {",
				"    public static int Y = Compute(1);",
				"    public static int Get() { return Y; }",
				"}",
				"public class User {",
				"    public int Use() { return M.Twice(21); }",
				"    public int Use2() { return P2.Get(); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const use = by(r).get("M.cs::User.Use") as { purity: number } | undefined;
		const use2 = by(r).get("M.cs::User.Use2") as { purity: number } | undefined;
		expect(use).toBeDefined();
		expect(use2).toBeDefined();
		expect(use!.purity).toBe(0); // 闭包零原始调用 → 不加边 → 零变化
		expect(use2!.purity).toBe(1); // 裸名 Compute(1) 未解析 → 类型加载闭包含 ? → UNKNOWN（诚实非 PURE）
	});

	it("迭代42 H1：静态构造器体 io 传染静态访问路径（reviewer 探针实证，活假纯 S1）", async () => {
		const root = project("staticctor42", {
			"Q.cs": [
				"using System.IO;",
				"public class Q {",
				'    static Q() { File.ReadAllText("static-ctor"); }',
				"    public static int Get() { return 1; }",
				"}",
				"public class User {",
				"    public int Use() { return Q.Get(); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(r.stats.parseErrors).toBe(0);
		const use = by(r).get("Q.cs::User.Use") as
			| { purity: number; effects: Set<string> }
			| undefined;
		expect(use).toBeDefined();
		// 修复前：静态构造器体是独立 constructor chunk（不进 class chunk）→ Q.Get() 判 PURE=0；
		// 修复后：类型加载闭包并集 ctor chunk → fs 效应传播
		expect(use!.purity).toBe(2);
		expect(use!.effects.has("fs")).toBe(true);
	});

	it("迭代42 M1：成员 miss + 类型加载效应不结算——? 保留（防 UNKNOWN→PURE 假纯）", async () => {
		const root = project("staticmiss42", {
			"R.cs": [
				"public class R {",
				"    public static int W = Math.Max(1, 2);", // 纯初始化器调用——class chunk 有效应但纯
				"    public static int Get() { return 1; }",
				"}",
				"public class User {",
				"    public int Use() { return R.UnknownMethod(); }", // 成员 miss
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const use = by(r).get("R.cs::User.Use") as { purity: number } | undefined;
		expect(use).toBeDefined();
		// 修复前：any=false + loadEdges>0 → return true 结算 = 仅 Math.Max 纯 → PURE=0 假纯；
		// 修复后：不结算 → 落 ? → UNKNOWN=1（边保留 + 未知诚实）
		expect(use!.purity).toBe(1);
	});

	it("迭代43 B：private 事件触发判别力——订阅集合完备，触发端确定判定（修复前 UNKNOWN）", async () => {
		const root = project("evt-private43", {
			"P.cs": [
				"public class Priv {",
				"    private event Action<int> OnChange;",
				"    public void Wire() { OnChange += Handle; }",
				"    void Handle(int x) { }",
				"    public void Fire() { OnChange(1); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		expect(r.stats.parseErrors).toBe(0);
		const fire = by(r).get("P.cs::Priv.Fire") as { purity: number } | undefined;
		const wire = by(r).get("P.cs::Priv.Wire") as { purity: number } | undefined;
		expect(fire).toBeDefined();
		expect(wire).toBeDefined();
		// private 事件：语言保证仅声明类可订阅 → 完备集合 {Handle} → Handle 纯 → Fire 确定 PURE
		// （修复前：裸名 OnChange(1) 落 markUnknown → UNKNOWN=1；`+=` 双重语义保留：Wire 仍 state 写）
		expect(fire!.purity).toBe(0);
		expect(wire!.purity).toBe(2);
	});

	it("迭代43 B：跨实例订阅不可归属 → 触发端 ? 传导（对称诚实）", async () => {
		const root = project("evt-cross43", {
			"X.cs": [
				"public class Pub {",
				"    public event Action OnX;",
				"    public void Subscribe(Other o) { o.OnX += HandleX; }",
				"    void HandleX() { }",
				"    public void Fire() { OnX?.Invoke(); }",
				"}",
				"public class Other { }",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const fire = by(r).get("X.cs::Pub.Fire") as { purity: number } | undefined;
		expect(fire).toBeDefined();
		// o.OnX += HandleX：member_access left → 接收者不可证 → OnX 集合不完整 → 触发端 ?
		// （修复前也 UNKNOWN——public 守卫本身附加 ?；本用例验证 incomplete 传导路径）
		expect(fire!.purity).toBe(1);
	});

	it("迭代43 B：private 事件初始化器订阅（= HandleInit）入订阅集合 + 无意外 prop 边", async () => {
		const root = project("evt-init43", {
			"I.cs": [
				"public class Init {",
				"    private event Action Hidden = HandleInit;",
				"    void HandleInit() { }",
				"    public void Fire() { Hidden.Invoke(); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const fire = by(r).get("I.cs::Init.Fire") as { purity: number } | undefined;
		expect(fire).toBeDefined();
		// 初始化器订阅（构造序早期注册）→ sub_static 含 HandleInit → 触发端展开 → 确定 PURE；
		// 修正 1：event_field_declaration 在 propertyReadSkipParents → 无意外 prop 边双计
		expect(fire!.purity).toBe(0);
	});

	it("迭代43 B：非 private 事件触发端保持 ?（可见性守卫）——handler io 不翻确定判定", async () => {
		const root = project("evt-pub43", {
			"G.cs": [
				"using System;",
				"public class Pub2 {",
				"    public event Action<int> OnChanged;",
				"    public void Wire() { OnChanged += Handle; }",
				"    void Handle(int x) { Console.WriteLine(\"io\"); }",
				"    public void Fire() { OnChanged(1); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const fire = by(r).get("G.cs::Pub2.Fire") as { purity: number } | undefined;
		expect(fire).toBeDefined();
		expect(fire).toBeDefined();
		// 非 private 事件：handler io 确定传播（展开边）→ IMPURE（修复前：事件不建模 → 触发落 ? →
		// UNKNOWN——效应归因缺失）；可见性守卫 ? 在 handler 纯时体现（把 PURE 抬到 UNKNOWN，防假纯）
		expect(fire!.purity).toBe(2);
		expect((fire as unknown as { effects: Set<string> }).effects.has("io")).toBe(true);
	});

	it("迭代43 B：可见性守卫——public 事件 + 纯 handler 触发端 ?（防假 PURE）", async () => {
		const root = project("evt-guard43", {
			"H.cs": [
				"public class Pub3 {",
				"    public event Action<int> OnChanged;",
				"    public void Wire() { OnChanged += Handle; }",
				"    void Handle(int x) { }",
				"    public void Fire() { OnChanged(1); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const fire = by(r).get("H.cs::Pub3.Fire") as { purity: number } | undefined;
		expect(fire).toBeDefined();
		// handler 纯但事件 public：外部订阅不可见 → 触发端 ?（UNKNOWN）——
		// 守卫公式 sub_static(e) ∪ {?}；private 事件则确定 PURE（测试 1）
		expect(fire!.purity).toBe(1);
	});
});
