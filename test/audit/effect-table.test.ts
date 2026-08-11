import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";

/** C5（迭代21）：C# 效应表覆盖补全——90+ 类只测 10 个的缺口。 */

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "codeaudit-c5-")); });
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

/** 参数化效应断言：方法体（C# 语法）→ 预期效应集（只测有明确语义的——保守类不测）。 */
const CASES: Array<[string, string, Set<string>]> = [
  ["net", "public void net() { UnityWebRequest.Get(\"http://x\"); }", new Set(["net"])],
  ["scene", "public void scene() { SceneManager.LoadScene(\"x\"); }", new Set(["state"])],
  ["anim", "public void anim() { this.animator.SetTrigger(\"x\"); }", new Set(["io"])],
  ["prefs", "public void prefs() { PlayerPrefs.SetFloat(\"b\", 1f); }", new Set(["state"])],
  ["file", "public void file() { File.ReadAllText(\"x\"); }", new Set(["fs"])],
  ["debug", "public void debug() { Debug.Log(\"x\"); }", new Set(["io"])],
  ["env", "public void env() { Environment.GetEnvironmentVariable(\"X\"); }", new Set(["io"])],
  ["proc", "public void proc() { Process.Start(\"x\"); }", new Set(["io"])],
  ["console", "public void console() { Console.WriteLine(\"x\"); }", new Set(["io"])],
  ["destroy", "public void destroy() { Destroy(gameObject); }", new Set(["state"])],
];

describe("C5 C# 效应表覆盖（迭代21）", () => {
  for (const [name, body, expected] of CASES) {
    it(`${name} → ${[...expected].join("+")}`, async () => {
      const root = project(`c5-${name}`, {
        "T.cs": [
          "using UnityEngine;",
          "using System.IO;",
          "using System;",
          "using System.Diagnostics;",
          "public class T : MonoBehaviour {",
          `    ${body}`,
          "}",
        ].join("\n"),
      });
      const r = await scanProject(root, { useCache: false });
      const v = by(r).get("T.cs::T." + name) as
        | { purity: number; effects: Set<string> }
        | undefined;
      expect(v).toBeDefined();
      expect(v!.purity).toBe(2); // IMPURE
      for (const e of expected) expect(v!.effects.has(e)).toBe(true);
    });
  }
});
