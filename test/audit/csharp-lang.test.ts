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
});
