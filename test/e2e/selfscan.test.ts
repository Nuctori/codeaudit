import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { scanProject } from "../../src/index";

/** 狗食测试：扫描工具自身的 src/，验证在真实 TS 代码上可用。 */
describe("E2E: 自扫描", () => {
  it("扫描 src/ 不崩溃、能发现 fs 效应、结构合理", async () => {
    const src = join(__dirname, "..", "..", "src");
    const report = await scanProject(src);

    expect(report.stats.files).toBeGreaterThanOrEqual(8);
    expect(report.stats.parseErrors).toBe(0);

    // scan.ts 里 writeFileSync/mkdirSync 经 node:fs 命名空间导入
    const fsUsers = report.verdicts.filter(
      (v) => v.effects.has("io") && v.chunk.file.endsWith("scan.ts"),
    );
    expect(fsUsers.length).toBeGreaterThanOrEqual(1);

    // 每个调用点都有归属（公理1）：存在 <module> 伪 chunk
    expect(report.verdicts.some((v) => v.chunk.name === "<module>")).toBe(true);
  }, 60_000);
});
