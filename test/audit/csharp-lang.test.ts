import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";

/** 迭代19：C# 语言包（InitDeity Unity 真实项目驱动）。 */

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "codeaudit-cs-")); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function project(name: string, files: Record<string, string>): string {
  const root = join(dir, name);
  for (const [f, content] of Object.entries(files)) {
    const p = join(root, f);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}
function by(report: { verdicts: { chunk: { file: string; name: string } }[] }): Map<string, unknown> {
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
        "    void Start() { Debug.Log(\"started\"); LoadGame(); }",
        "    public void LoadGame() { score = 1; }",
        "    private int score = 0;",
        "    public int PureCalc(int a) { return Math.Max(a, score); }",
        "}",
      ].join("\n"),
    });
    const r = await scanProject(root, { useCache: false });
    expect(r.stats.parseErrors).toBe(0);
    const start = by(r).get("Game.cs::Game.Start") as { purity: number; effects: Set<string> } | undefined;
    const load = by(r).get("Game.cs::Game.LoadGame") as { purity: number } | undefined;
    const calc = by(r).get("Game.cs::Game.PureCalc") as { purity: number } | undefined;
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
        "    public void Save() { PlayerPrefs.SetFloat(\"b\", 1f); }",
        "    public void Read() { var d = File.ReadAllText(\"s\"); }",
        "    public void Spawn() { GameObject.Find(\"x\"); }",
        "    public void Load() { Resources.Load<GameObject>(\"p\"); }",
        "}",
      ].join("\n"),
    });
    const r = await scanProject(root, { useCache: false });
    const save = by(r).get("S.cs::S.Save") as { purity: number; effects: Set<string> } | undefined;
    const read = by(r).get("S.cs::S.Read") as { purity: number; effects: Set<string> } | undefined;
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
});
