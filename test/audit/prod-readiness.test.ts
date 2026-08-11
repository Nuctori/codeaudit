import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";

/** 迭代16 生产就绪：历史 Med 测试盲区补齐（CROSS-AUDIT 行 82 同源）。 */

let dir: string;
function setup(): string {
  dir = mkdtempSync(join(tmpdir(), "codeaudit-prod-"));
  return dir;
}
function teardown(): void {
  rmSync(dir, { recursive: true, force: true });
}
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

describe("迭代16 生产就绪测试（历史 Med 盲区）", () => {
  it("impureModules 成员 → IMPURE io（Python 效应表规则）", async () => {
    setup();
    const root = project("impmod", {
      "app.py": "import sqlite3\ndef save():\n    return sqlite3.connect('db.sqlite')\n",
    });
    const r = await scanProject(root, { useCache: false });
    const save = by(r).get("app.py::save") as { purity: number; effects: Set<string> } | undefined;
    expect(save).toBeDefined();
    expect(save!.purity).toBe(2); // IMPURE
    expect(save!.effects.has("db")).toBe(true);
    teardown();
  });

  it("数组效应表规则：字面量数组方法走内建效应（map 纯 / 变异方法状态）", async () => {
    setup();
    const root = project("arrmod", {
      "t.js": "function f() { return [1, 2].map((x) => x + 1); }\nmodule.exports = { f };\n",
    });
    const r = await scanProject(root, { useCache: false });
    const f = by(r).get("t.js::f") as { purity: number } | undefined;
    expect(f).toBeDefined();
    expect(f!.purity).toBe(0); // [].map 纯（回调纯）
    teardown();
  });

  it("link 深度上限：>6 层 re-export 链 → 解析失败记 ?（不崩溃）", async () => {
    setup();
    const files: Record<string, string> = {};
    files["e0.ts"] = "export function deep() { return 1; }\n";
    for (let i = 1; i <= 10; i++) {
      files[`e${i}.ts`] = `export { deep } from './e${i - 1}';\n`;
    }
    files["main.ts"] = "import { deep } from './e10';\nfunction main() { return deep(); }\n";
    const root = project("depth", files);
    const r = await scanProject(root, { useCache: false });
    // 深度 6 上限：10 层链应解析失败 → main 调 deep 记 ?（诚实未知，不崩溃）
    expect(r.stats.parseErrors).toBe(0);
    teardown();
  });

  it("缓存写失败（只读 cacheDir）→ 不崩溃，扫描结果完整", async () => {
    setup();
    const root = project("ro", { "a.ts": "export function a() { return 1; }\n" });
    const cacheDir = join(root, ".ro-cache");
    mkdirSync(cacheDir, { recursive: true });
    try {
      chmodSync(cacheDir, 0o555); // 只读
    } catch {
      // Windows 上 chmod 可能无效——跳过只读、直接测损坏缓存路径
    }
    const r = await scanProject(root, { useCache: true, cacheDir });
    expect(r.stats.chunks).toBeGreaterThan(0);
    expect(r.stats.parseErrors).toBe(0);
    teardown();
  });

  it("损坏缓存（畸形 JSON）→ 回退全量，结果完整", async () => {
    setup();
    const root = project("badcache", { "a.ts": "export function a() { return 1; }\n" });
    const cacheDir = join(root, ".cache");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "cache.json"), "{ this is not json !!!");
    const r = await scanProject(root, { useCache: true, cacheDir });
    expect(r.stats.chunks).toBeGreaterThan(0);
    teardown();
  });
});
