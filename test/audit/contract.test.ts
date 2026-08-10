import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { scanProject } from "../../src/index";

/**
 * 维度 31-32：输出契约。
 * JSON schema 稳定、unknowns 导出可供 AI 标注闭环。
 */

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "codeaudit-contract-")); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const CLI = join(__dirname, "..", "..", "dist", "cli.js");

function project(name: string, files: Record<string, string>): string {
  const root = join(dir, name);
  for (const [f, content] of Object.entries(files)) {
    const p = join(root, f);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

describe("维度31: JSON 输出 schema", () => {
  it("顶层字段与 verdict 字段齐全，Infinity/Set 正确序列化", async () => {
    const root = project("schema", {
      "a.py": "import os\ndef imp():\n    os.getcwd()\ndef pure_fn():\n    return 1\n",
    });
    const out = execFileSync("node", [CLI, "scan", root, "--no-cache", "--json"], { encoding: "utf8" });
    const report = JSON.parse(out);

    // 顶层契约
    expect(report).toHaveProperty("root");
    expect(report).toHaveProperty("mode");
    expect(report).toHaveProperty("verdicts");
    expect(report).toHaveProperty("stats");
    expect(report.stats).toMatchObject({
      files: expect.any(Number),
      chunks: expect.any(Number),
      pure: expect.any(Number),
      impure: expect.any(Number),
      unknown: expect.any(Number),
      unknownRate: expect.any(Number),
      cycles: expect.any(Number),
    });

    // verdict 契约
    for (const v of report.verdicts) {
      expect(v).toHaveProperty("chunk.key");
      expect(v).toHaveProperty("chunk.name");
      expect(v).toHaveProperty("chunk.file");
      expect(v).toHaveProperty("chunk.line");
      expect(v).toHaveProperty("purity");
      expect(v).toHaveProperty("chain");
      expect(v).toHaveProperty("chainCertain");
      expect(v).toHaveProperty("effects");
      expect(Array.isArray(v.effects)).toBe(true);   // Set → 数组
      expect(Array.isArray(v.chunk.calls)).toBe(true);
    }
    // Infinity 序列化为字符串而非 null（JSON 不支持 Infinity）
    const pureV = report.verdicts.find((v: any) => v.chunk.name === "pure_fn");
    expect(pureV.chain).toBe("Infinity");
  });

  it("文本输出包含三个分组标题与 STATS 行", async () => {
    const root = project("textfmt", {
      "a.py": "import weirdlib\ndef u():\n    weirdlib.x()\ndef i():\n    print(1)\n",
    });
    const out = execFileSync("node", [CLI, "scan", root, "--no-cache"], { encoding: "utf8" });
    expect(out).toContain("IMPURE");
    expect(out).toContain("UNKNOWN");
    expect(out).toMatch(/STATS: pure \d+, impure \d+, unknown \d+/);
  });
});

describe("维度32: unknowns 导出（AI 标注闭环）", () => {
  it("导出文件存在、含 prompt、只含 UNKNOWN", async () => {
    const root = project("unknowns", {
      "a.py": "import weirdlib\ndef engage():\n    weirdlib.run()\ndef ok():\n    return 1\n",
    });
    const outFile = join(root, "unknowns.json");
    execFileSync("node", [CLI, "scan", root, "--no-cache", "--unknowns", outFile], { encoding: "utf8" });
    expect(existsSync(outFile)).toBe(true);
    const list = JSON.parse(readFileSync(outFile, "utf8"));
    expect(list.length).toBeGreaterThan(0);
    for (const item of list) {
      expect(item).toHaveProperty("symbol");
      expect(item).toHaveProperty("file");
      expect(item).toHaveProperty("line");
      expect(item).toHaveProperty("suggested_prompt");
      expect(item.suggested_prompt).toContain("PURE");
      expect(item.suggested_prompt).toContain("IMPURE");
    }
    // 纯函数不出现在清单里
    expect(list.some((x: any) => x.symbol === "ok")).toBe(false);
  });

  it("编程式 API 的 verdict 带内容寻址 id（标注可锚定）", async () => {
    const root = project("apiid", { "a.py": "def f():\n    return 1\n" });
    const r = await scanProject(root);
    const f = r.verdicts.find((v) => v.chunk.name === "f")!;
    expect(f.chunk.id).toMatch(/^[0-9a-f]{16}/);
  });

  it("--annotations 回读减少 UNKNOWN（CLI 端到端）", async () => {
    const root = project("anncli", { "a.py": "import weirdlib\ndef f():\n    weirdlib.run()\n" });
    const before = JSON.parse(
      execFileSync("node", [CLI, "scan", root, "--no-cache", "--json"], { encoding: "utf8" }),
    );
    const f0 = before.verdicts.find((v: any) => v.chunk.name === "f")!;
    expect(f0.purity).toBe(1);
    const annFile = join(root, "ann.json");
    writeFileSync(annFile, JSON.stringify([{ id: f0.chunk.id, verdict: "PURE" }]));
    const after = JSON.parse(
      execFileSync("node", [CLI, "scan", root, "--no-cache", "--annotations", annFile, "--json"], { encoding: "utf8" }),
    );
    expect(after.verdicts.find((v: any) => v.chunk.name === "f")!.purity).toBe(0);
  });

  it("标注闭环：标注 → 语料累积 → 幂等（CLI 端到端）", async () => {
    const root = project("corpus-e2e", {
      "a.py": "import weirdlib\ndef f():\n    weirdlib.get()\n    weirdlib.get()\n",
    });
    const corpus = join(root, "corpus.json");
    const u1 = join(root, "u1.json");
    // 冷启动：导出含 calls 站点明细，prompt 无先验提示
    execFileSync("node", [CLI, "scan", root, "--no-cache", "--unknowns", u1, "--corpus", corpus], { encoding: "utf8" });
    const l1 = JSON.parse(readFileSync(u1, "utf8"));
    expect(l1[0]!.calls.length).toBe(2); // 2 个未知站点
    expect(l1[0]!.suggested_prompt).not.toContain("语料先验");
    // 标注 PURE → 回读 → 语料累积（按 chunk.id 去重，2 站点同方法只计 1 次）
    const ann = join(root, "ann.json");
    writeFileSync(ann, JSON.stringify([{ id: l1[0]!.id, verdict: "PURE" }]));
    execFileSync("node", [CLI, "scan", root, "--no-cache", "--annotations", ann, "--corpus", corpus], { encoding: "utf8" });
    const cf = JSON.parse(readFileSync(corpus, "utf8"));
    expect(cf.seen[l1[0]!.id]).toBe(true);
    expect(cf.method.get).toEqual({ pure: 1, impure: 0 });
    // 幂等：同一标注重放不重复计数
    execFileSync("node", [CLI, "scan", root, "--no-cache", "--annotations", ann, "--corpus", corpus], { encoding: "utf8" });
    const cf2 = JSON.parse(readFileSync(corpus, "utf8"));
    expect(cf2.method.get).toEqual({ pure: 1, impure: 0 });
  });
});
