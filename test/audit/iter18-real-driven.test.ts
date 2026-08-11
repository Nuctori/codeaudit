import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";

/** 迭代18（旧宇宙真实项目驱动）修复回归。 */

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "codeaudit-it18-")); });
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

describe("迭代18 真实项目驱动修复", () => {
  it("两级成员链前缀回退：os.environ.get → io（原 UNKNOWN）", async () => {
    const root = project("environ", {
      "t.py": "import os\ndef get_cfg():\n    return os.environ.get('X', '1')\n",
    });
    const r = await scanProject(root, { useCache: false });
    const v = by(r).get("t.py::get_cfg") as { purity: number; effects: Set<string> } | undefined;
    expect(v).toBeDefined();
    expect(v!.purity).toBe(2); // IMPURE（io）
    expect(v!.effects.has("io")).toBe(true);
  });

  it("os.path.join 纯标记仍 PURE（前缀回退不破坏 :p）", async () => {
    const root = project("pathjoin", {
      "t.py": "import os\ndef p():\n    return os.path.join('a', 'b')\n",
    });
    const r = await scanProject(root, { useCache: false });
    const v = by(r).get("t.py::p") as { purity: number } | undefined;
    expect(v!.purity).toBe(0); // PURE
  });

  it("Locust self.client.post → net（场景类继承基类）", async () => {
    const root = project("locust", {
      "user.py": "class MyUser:\n    def login(self):\n        return self.client.post('/api/login', json={'a': 1})\n",
    });
    const r = await scanProject(root, { useCache: false });
    const v = by(r).get("user.py::MyUser.login") as { purity: number; effects: Set<string> } | undefined;
    expect(v).toBeDefined();
    expect(v!.purity).toBe(2); // IMPURE
    expect(v!.effects.has("io")).toBe(true); // frameworkIo 命中（io 含 net 语义）
  });

  it("PURE 标注同步减 unknownSites（missingSiteRate 不失真）", async () => {
    const root = project("ann", {
      "a.js": "function f() { return obj.unknown(); }\nmodule.exports = { f };\n",
    });
    const r0 = await scanProject(root, { useCache: false });
    const before = r0.verdicts.find((v) => v.chunk.name === "f")!;
    const unknownSitesBefore = before.chunk.unknownSites;
    expect(unknownSitesBefore).toBeGreaterThan(0);
    // 标 PURE（移除 ? 并减 unknownSites）
    const ann = new Map<string, "PURE" | "IMPURE">([[before.chunk.id, "PURE"]]);
    const r1 = await scanProject(root, { useCache: false, annotations: ann });
    const after = r1.verdicts.find((v) => v.chunk.name === "f")!;
    expect(after.chunk.unknownSites).toBeLessThan(unknownSitesBefore);
    expect(after.chunk.calls.has("?")).toBe(false);
  });
});
