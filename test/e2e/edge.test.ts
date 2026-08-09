import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { Purity, Verdict } from "../../src/core/types";

const FIX = join(__dirname, "..", "fixtures");

function index(report: { verdicts: Verdict[] }): Map<string, Verdict> {
  const m = new Map<string, Verdict>();
  for (const v of report.verdicts) m.set(`${v.chunk.file}::${v.chunk.name}`, v);
  return m;
}

describe("E2E: 边界情况", () => {
  it("空目录不崩溃", async () => {
    const dir = mkdtempSync(join(tmpdir(), "codeaudit-empty-"));
    try {
      const r = await scanProject(dir);
      expect(r.stats.files).toBe(0);
      expect(r.stats.chunks).toBe(0);
      expect(r.stats.unknownRate).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("语法损毁的文件被记为 parseError 且不中断扫描", async () => {
    const r = await scanProject(join(FIX, "edge-misc"));
    expect(r.stats.parseErrors).toBeGreaterThanOrEqual(1);
    // 同目录其他文件照常分析
    const by = index(r);
    expect(by.get("dupe.py::caller")).toBeDefined();
  });

  it("同文件完全相同的 chunk 产生去重的图节点", async () => {
    const r = await scanProject(join(FIX, "edge-misc"));
    const dupeKeys = r.verdicts
      .filter((v) => v.chunk.file === "dupe.py")
      .map((v) => v.chunk.key);
    expect(new Set(dupeKeys).size).toBe(dupeKeys.length);
  });

  it("Python 包内相对导入解析", async () => {
    const r = await scanProject(join(FIX, "edge-pkg"));
    const by = index(r);
    // os.makedirs → io 种子
    const run = by.get("pkg/core.py::run")!;
    expect(run.purity).toBe(Purity.IMPURE);
    expect(run.chain).toBe(0);
    // helper 是纯的（from .util import helper 解析成功，不留未知）
    expect(by.get("pkg/util.py::helper")!.purity).toBe(Purity.PURE);
    expect(run.chainCertain).toBe(true);
  });

  it("TS 默认导出/导入解析", async () => {
    const r = await scanProject(join(FIX, "edge-misc"));
    const by = index(r);
    const run = by.get("consumer.ts::run")!;
    // run -> Main(默认导出 main) -> compute：边解析成功，整体纯
    expect(run.purity).toBe(Purity.PURE);
    expect(run.chainCertain).toBe(true);
  });

  it("再导出环：解析终止", async () => {
    const r = await scanProject(join(FIX, "edge-misc"));
    // reA/reB 互相再导出，resolveSymbol 深度受限必须终止
    expect(r.verdicts.length).toBeGreaterThan(0);
  });

  it("TSX 文件用 tsx 语法解析且 JSX 不报解析错误", async () => {
    const r = await scanProject(join(FIX, "edge-misc"));
    const by = index(r);
    const widget = by.get("widget.tsx::Widget")!;
    expect(widget).toBeDefined();
    const persist = by.get("widget.tsx::persist")!;
    expect(persist.purity).toBe(Purity.IMPURE);
    expect(persist.chain).toBe(0);
  });
});
