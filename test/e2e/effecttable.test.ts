import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject, type EffectTables } from "../../src/index";
import { Purity } from "../../src/core/types";

/** 迭代28 F16：效应表注入端到端——无 override 判 UNKNOWN，注入后判 IMPURE 且 direct 含 net。 */

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "codeaudit-ovr-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("F16 效应表注入 E2E（迭代28）", () => {
  it("注入 impureGlobals MySdk:net → 外部 SDK 调用判 IMPURE（direct 含 net）", async () => {
    const root = join(dir, "netcall");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "netcall.cs"),
      [
        "public class Consumer {",
        "    public void Run() { MySdk.Send(); }", // MySdk 非项目内类 → 无 globalClasses → 走效应表
        "}",
      ].join("\n"),
    );

    // 无 override：MySdk.Send() 不可解析 → ?（UNKNOWN）
    const base = await scanProject(root, { useCache: false });
    const baseConsumer = base.verdicts.find((v) => v.chunk.name === "Consumer.Run");
    expect(baseConsumer).toBeDefined();
    expect(baseConsumer!.purity).toBe(Purity.UNKNOWN);

    // 注入：MySdk: "net" → impureGlobals 命中 → direct net → IMPURE
    const override: Partial<EffectTables> = { impureGlobals: { MySdk: "net" } };
    const injected = await scanProject(root, { useCache: false, effectOverrides: { csharp: override } });
    const injectedConsumer = injected.verdicts.find((v) => v.chunk.name === "Consumer.Run");
    expect(injectedConsumer).toBeDefined();
    expect(injectedConsumer!.purity).toBe(Purity.IMPURE);
    expect(injectedConsumer!.chunk.direct.has("net")).toBe(true);
  });

  it("空 override → 两次扫描输出一致（短路零行为变化）", async () => {
    const root = join(dir, "plain");
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, "a.py"),
      "import os\ndef f():\n    return os.getcwd()\n",
    );
    const r1 = await scanProject(root, { useCache: false });
    const r2 = await scanProject(root, { useCache: false, effectOverrides: {} });
    const sig = (r: typeof r1) => JSON.stringify(r.verdicts.map((v) => [v.chunk.key, v.purity, [...v.chunk.direct].sort()]));
    expect(sig(r2)).toBe(sig(r1));
  });

  it("非法 override（未知语言）→ scanProject 抛错", async () => {
    const root = join(dir, "badlang");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "a.py"), "def f():\n    return 1\n");
    await expect(
      scanProject(root, { useCache: false, effectOverrides: { klingon: { impureGlobals: { X: "io" } } } }),
    ).rejects.toThrow("未知语言");
  });
});
