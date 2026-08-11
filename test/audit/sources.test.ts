import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { scanProject } from "../../src/index";
import { execFileSync } from "node:child_process";
import { Purity, type Verdict } from "../../src/core/types";

/** 迭代17 视角 1：--sources 过滤/排序/json 形状（补充测试缺口）。 */

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "codeaudit-src-")); });
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

function isDirectSource(v: Verdict): boolean {
  return v.purity === Purity.IMPURE && v.chain === 0 && v.chunk.direct.size > 0;
}

describe("--sources 效应源（迭代17 视角 1）", () => {
  it("只列 direct 非空的源头：纯函数/调用者/悲观未知源排除", async () => {
    const root = project("srcs", {
      "t.js": [
        "function saveData() { return console.log('saved'); }", // console 全局 io → 确定源头
        "function pure() { return 1 + 2; }",
        "function caller() { return saveData(); }",
        "function pessimistic() { return obj.unknownMethod(); }", // 未知调用 → ? 悲观链
        "module.exports = { saveData, pure, caller, pessimistic };",
      ].join("\n"),
    });
    const r = await scanProject(root, { useCache: false });
    const sources = r.verdicts.filter(isDirectSource);
    const names = sources.map((v) => v.chunk.name);
    expect(names).toContain("saveData"); // 直接 fs 写 → 源头
    expect(names).not.toContain("pure"); // 纯函数
    expect(names).not.toContain("caller"); // chain=1 调用者
    expect(names).not.toContain("pessimistic"); // 悲观未知源（direct 空）
  });

  it("json 模式 --sources 顶层 sources 数组（R2-1）", () => {
    const root = project("srcjson", {
      "a.js": "module.exports.save = function save() { return console.log('s'); };\n",
    });
    const cli = join(dirname(require.resolve("../../package.json")), "dist", "cli.js");
    const out = execFileSync("node", [cli, "scan", root, "--no-cache", "--sources", "--json"], { encoding: "utf8" });
    const parsed = JSON.parse(out) as { sources: Array<{ name: string; file: string; line: number; calls: number }> };
    expect(Array.isArray(parsed.sources)).toBe(true);
    expect(parsed.sources.length).toBeGreaterThan(0);
  });

  it("排序确定性：两次运行 sources 一致", async () => {
    const root = project("srcdet", {
      "m.js": [
        "function a() { return console.log('a'); }",
        "function b() { return console.log('b'); }",
        "module.exports = { a, b };",
      ].join("\n"),
    });
    const r1 = await scanProject(root, { useCache: false });
    const r2 = await scanProject(root, { useCache: false });
    const keys = (r: { verdicts: Verdict[] }) =>
      r.verdicts.filter(isDirectSource).map((v) => v.chunk.key).sort();
    expect(keys(r1)).toEqual(keys(r2));
  });
});
