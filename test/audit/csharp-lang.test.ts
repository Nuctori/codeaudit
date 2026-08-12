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
		const save = by(r).get("Helper.cs::Helper.SaveData") as { purity: number } | undefined;
		expect(save!.purity).toBe(2);
	});

	it("Unity 隐式 this 组件链：gameObject.SetActive / this.transform（迭代19）", async () => {
		const root = project("compchain", {
			"G.cs": [
				"using UnityEngine;",
				"public class G : MonoBehaviour {",
				'    void Start() { gameObject.SetActive(false); this.transform.position = Vector3.zero; }',
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const start = by(r).get("G.cs::G.Start") as { purity: number; effects: Set<string> } | undefined;
		expect(start).toBeDefined();
		expect(start!.purity).toBe(2); // gameObject.SetActive → frameworkIo io
		expect(start!.effects.has("io")).toBe(true);
	});

	it("跨语言类名隔离（迭代19 复审 F1）：C# 不解析到 Python 同名类", async () => {
		const root = project("cslang", {
			"helper.py": "class Helper:\n    def Build(self):\n        import os\n        os.system('x')\n",
			"main.cs": [
				"public class Main {",
				"    public void Run() { Helper.Build(); }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		// C# Main.Run 调 Helper.Build——语言隔离：不解析到 Python Helper.Build（会串入 io）
		const run = by(r).get("main.cs::Main.Run") as { purity: number; effects: Set<string> } | undefined;
		const pyBuild = by(r).get("helper.py::Helper.Build") as { purity: number } | undefined;
		expect(pyBuild!.purity).toBe(2); // Python Helper.Build 独立判 io
		// C# 侧不应因 Python 类而变 IMPURE（无语言隔离时 Main.Run 会解析到 Python Build → io 串味）
		expect(run).toBeDefined();
	});

	it("迭代23：反射元数据读非 io（frameworkIo.System 收紧——全限定 System.Reflection 读落 UNKNOWN 不含 io）", async () => {
		const root = project("reflect-read", {
			"R.cs": [
				"using System;",
				"public class R {",
				'    public string Describe(Type t) { return System.Reflection.IntrospectionExtensions.GetTypeInfo(t).Name; }',
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const m = by(r).get("R.cs::R.Describe") as { purity: number; effects: Set<string> } | undefined;
		expect(m).toBeDefined();
		expect(m!.effects.has("io")).toBe(false); // 反射元数据读不是 io（修复前 frameworkIo System.Reflection 前缀假阳 io）
		expect(m!.purity).toBe(1); // 前缀移除 → 落 ? → UNKNOWN（audit 公理 3，绝不 PURE）
	});

	it("迭代23：MethodInfo.Invoke 不假纯（全限定 System.Reflection 动态调用落 UNKNOWN 非 PURE）", async () => {
		const root = project("reflect-invoke", {
			"I.cs": [
				"public class I {",
				'    public object Call(object mi, object o) { return System.Reflection.MethodInfo.Invoke(mi, o, null); }',
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const m = by(r).get("I.cs::I.Call") as { purity: number; effects: Set<string> } | undefined;
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
		const run = by(r).get("S.cs::Service.Run") as { chunk: { stateReads: string[] } } | undefined;
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
		const read = by(r).get("S.cs::Service.Read") as { chunk: { stateReads: string[] } } | undefined;
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
		const bump = by(r).get("S.cs::Service.Bump") as { purity: number; effects: Set<string>; chunk: { stateWrites: string[] } } | undefined;
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
				"    public static Config Make(int v) { return new Config { SegmentId = v, Name = \"a\" }; }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const make = by(r).get("C.cs::Config.Make") as { chunk: { stateWrites: string[] } } | undefined;
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
		const bump = by(r).get("I.cs::Counter.Bump") as { chunk: { stateWrites: string[] } } | undefined;
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
		const m = by(r).get("L.cs::L.M") as { chunk: { stateReads: string[] } } | undefined;
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
		const set = by(r).get("S.cs::Service.Set") as { chunk: { stateWrites: string[] } } | undefined;
		expect(set).toBeDefined();
		// 修复前：裸写 "score"（全局裸名 → 与全库任何裸读 score 假耦合）；修复后：self.score
		expect(set!.chunk.stateWrites).toContain("self.score");
		expect(set!.chunk.stateWrites).not.toContain("score");
		expect(set!.chunk.stateWrites).not.toContain("l"); // 局部声明+重赋值 → 无写
		const outer = by(r).get("S.cs::Service.Outer") as { chunk: { stateWrites: string[] } } | undefined;
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
		const f = by(r).get("S.cs::Service.F") as { chunk: { stateWrites: string[] } } | undefined;
		expect(f).toBeDefined();
		// 修复前：下标写完全不可见（假纯）；修复后：参数容器变异=外部写、C# 字段容器=self.items
		expect(f!.chunk.stateWrites).toContain("arr"); // 参数数组变异（外部——影响调用方）
		expect(f!.chunk.stateWrites).toContain("self.items"); // 裸字段容器 → self.items
		expect(f!.chunk.stateWrites).not.toContain("items"); // 不得是全局裸名
	});

	it("迭代26 T2：Python for 变量下标写不判外部（item[k]=v 的 item 在 assigned → 非外部）；TS 参数下标变异外部", async () => {
		const root = project("subscript-py", {
			"a.py": "def f(data):\n    for item in data:\n        item['k'] = 1\n    return data\n",
			"b.ts": "export function g(arr: number[], i: number) { arr[i] = 5; }\n",
		});
		const r = await scanProject(root, { useCache: false });
		const pf = by(r).get("a.py::f") as { chunk: { stateWrites: string[] } } | undefined;
		expect(pf).toBeDefined();
		// for 变量 item 在 assigned（for_statement 是 assignmentTargets）→ 局部容器写，非外部
		expect(pf!.chunk.stateWrites).not.toContain("item");
		const tg = by(r).get("b.ts::g") as { chunk: { stateWrites: string[] } } | undefined;
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
		const read = by(r).get("S.cs::Service.Read") as { chunk: { stateReads: string[] } } | undefined;
		expect(read).toBeDefined();
		// 修复前：方法名 Read 被当裸读（与全库同名写者假耦合）；修复后：声明名抑制
		expect(read!.chunk.stateReads).not.toContain("Read");
		// 类名 Service 在类 chunk（class_declaration name 字段），不在方法 chunk——类 chunk 断言（修复前含 Service 裸读）
		const cls = by(r).get("S.cs::Service") as { chunk: { stateReads: string[] } } | undefined;
		expect(cls).toBeDefined();
		expect(cls!.chunk.stateReads).not.toContain("Service");
	});

	it("迭代26 T4：d[k].x = v 写 → 根限定 ⊤（d.⊤，与读侧对偶）；局部 o.x=1 不误报", async () => {
		const root = project("sub-member-write", {
			"a.py": "def f(d, k):\n    d[k].x = 2\n    return d\ndef g():\n    o = {}\n    o.x = 1\n    return o\n",
		});
		const r = await scanProject(root, { useCache: false });
		const f = by(r).get("a.py::f") as { chunk: { stateWrites: string[] } } | undefined;
		expect(f).toBeDefined();
		expect(f!.chunk.stateWrites).toContain("d.⊤"); // d[k].x = v → 根限定 ⊤（读侧对偶）
		const g = by(r).get("a.py::g") as { chunk: { stateWrites: string[] } } | undefined;
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
		const m = by(r).get("M.cs::M.Run") as { chunk: { stateReads: string[] } } | undefined;
		expect(m).toBeDefined();
		expect(m!.chunk.stateReads).not.toContain("a"); // tuple_pattern 声明名（修复前裸读）
		expect(m!.chunk.stateReads).not.toContain("b");
		expect(m!.chunk.stateReads).not.toContain("item"); // foreach 变量（修复前裸读）
		expect(m!.chunk.stateReads).toContain("arr"); // 集合读（in 之后的 arr 字段是真外部读）——④ 不得误抑制
	});

	it("迭代27 T2：TS catch 变量 + 解构声明名不裸读", async () => {
		const root = project("decl-ts", {
			"a.ts": "export function f(arr: number[]) {\n  const [a, b] = arr;\n  let r = a + b;\n  try { r++; } catch (e) { r = 0; }\n  return r;\n}\n",
		});
		const r = await scanProject(root, { useCache: false });
		const f = by(r).get("a.ts::f") as { chunk: { stateReads: string[] } } | undefined;
		expect(f).toBeDefined();
		// catch 变量 e 不裸读（修复前裸读）；解构声明名 a/b 不裸读（修复前裸读；use 读 a+b 仍存在——方案B 待办）
		expect(f!.chunk.stateReads).not.toContain("e");
		const reads = f!.chunk.stateReads.filter((x) => x === "a" || x === "b").length;
		expect(reads).toBeLessThanOrEqual(2); // 仅 use 读（声明名抑制后），修复前 4 次（声明 2 + use 2）
	});

	it("迭代27 T3：Python except 变量不裸读；异常类型名保留", async () => {
		const root = project("decl-py", {
			"a.py": "def f():\n    try:\n        return 1\n    except Exception as e:\n        return 0\n",
		});
		const r = await scanProject(root, { useCache: false });
		const f = by(r).get("a.py::f") as { chunk: { stateReads: string[] } } | undefined;
		expect(f).toBeDefined();
		expect(f!.chunk.stateReads).not.toContain("e"); // except as 变量（修复前裸读）
		// Exception 类型名是既有噪音族（不动）——不断言不包含，仅记录
	});

	it("迭代27 T4：JS catch 变量不裸读", async () => {
		const root = project("decl-js", {
			"a.js": "function f() {\n  try { return 1; } catch (e) { return 0; }\n}\n",
		});
		const r = await scanProject(root, { useCache: false });
		const f = by(r).get("a.js::f") as { chunk: { stateReads: string[] } } | undefined;
		expect(f).toBeDefined();
		expect(f!.chunk.stateReads).not.toContain("e"); // catch 变量（修复前裸读）
	});

	it("迭代30 T1：全限定 System.* 纯命名空间判纯（global:System miss 回退——frameworkPure 白名单）", async () => {
		const root = project("system-pure", {
			"U.cs": [
				"public class U {",
				'    public string Encode(string s) { return System.Uri.EscapeDataString(s); }',
				"    public int Add() {",
				"        var l = new System.Collections.Generic.List<int>();",
				"        System.Collections.Generic.List<int>.Add(l, 1);",
				"        return l.Count;",
				"    }",
				"}",
			].join("\n"),
		});
		const r = await scanProject(root, { useCache: false });
		const enc = by(r).get("U.cs::U.Encode") as { purity: number; effects: Set<string> } | undefined;
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
		const n = by(r).get("N.cs::N.Send") as { purity: number; effects: Set<string> } | undefined;
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
		const run = by(r).get("H.cs::H.Run") as { purity: number; effects: Set<string>; chain: number } | undefined;
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
		const run = by(r).get("C.cs::C.Run") as { purity: number; effects: Set<string> } | undefined;
		expect(run).toBeDefined();
		// 迭代31 S3（审计实证活洞）：修复前 hofAlwaysArgs 空表 → Console.WriteLine 回调 io 被吞 → PURE=0 假纯。
		// 修复后：Select 进 hofAlwaysArgs → 回调未解析 → calls 含 ? → UNKNOWN=1（公理 3，绝不假纯）
		expect(run!.purity).not.toBe(0); // 不容忍 PURE——回调可能 io
		expect(run!.purity).toBe(1); // UNKNOWN——诚实未知
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
		const chain = by(r).get("S.cs::S.Chain") as { purity: number; effects: Set<string>; chunk: { unknownSites: number } } | undefined;
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
		// 修复后：addArgEdges 门同时认 linqHof → 未解析回调 → calls 含 ? → UNKNOWN=1（公理 3）
		expect(run!.purity).not.toBe(0); // 不容忍 PURE
		expect(run!.purity).toBe(1); // UNKNOWN
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
		const join = by(r).get("C.cs::C.Join") as { purity: number; effects: Set<string> } | undefined;
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
		const calc = by(r).get("C.cs::C.Calc") as { purity: number; effects: Set<string> } | undefined;
		expect(calc).toBeDefined();
		// 撞名守卫（复审建议）：Math.Max 的 score 是状态读非回调——若 Max 在全局 HOF 表会被 argFnsOf
		// 误收 → 假 UNKNOWN。修复后 Max 移入 linqHof、全局表不含 → PURE
		expect(calc!.effects.has("io")).toBe(false);
		expect(calc!.purity).toBe(0); // PURE——Math.Max 纯 + 读状态
	});
});
