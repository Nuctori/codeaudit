import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { Purity } from "../../src/core/types";

/**
 * 合成复杂代码库：300 个 Python 文件，分层架构 + 跨层调用 + 故意成环。
 * 验证：终止性、性能、确定性、不变式。
 */

const N_FILES = 300;
const FUNCS_PER_FILE = 8;

function genProject(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "db.py"),
    [
      "import sqlite3",
      "def exec_sql(sql):",
      '    return sqlite3.connect("x.db").execute(sql)',
      "",
    ].join("\n"),
  );

  const name = (i: number) => `m${i}`;
  for (let i = 0; i < N_FILES; i++) {
    const lines: string[] = [];
    const deps: number[] = [];
    if (i > 0) {
      const nDeps = 1 + (i % 3);
      for (let d = 0; d < nDeps; d++) deps.push((i * 7 + d * 13) % i);
    }
    if (i % 10 === 0) deps.push(-1); // 依赖 db
    // 故意成环：m0 依赖 m37，而 m37 等（i%37==0）依赖 m0
    if (i === 0) deps.push(37);
    const depNames = [...new Set(deps)].map((d) => (d === -1 ? "db" : name(d)));
    for (const dn of depNames) lines.push(`import ${dn}`);
    for (let f = 0; f < FUNCS_PER_FILE; f++) {
      lines.push(`def fn_${f}(x):`);
      const body: string[] = [];
      for (const dn of depNames.slice(0, 2)) {
        body.push(`    r = ${dn}.fn_${(f + 1) % FUNCS_PER_FILE}(x)`);
      }
      if (body.length === 0) body.push("    r = x * 2");
      lines.push(...body);
      lines.push("    return x");
      lines.push("");
    }
    writeFileSync(join(root, `${name(i)}.py`), lines.join("\n"));
  }
}

describe("E2E: 合成复杂代码库（300 文件 / ~2400 chunks / 含环）", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "codeaudit-synth-"));
    genProject(dir);
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("在时限内完成、结果确定、不变式成立", async () => {
    const t0 = Date.now();
    const r1 = await scanProject(dir);
    const elapsed = Date.now() - t0;

    // 性能：冷扫 < 15s
    expect(elapsed).toBeLessThan(15_000);

    // 规模
    expect(r1.stats.files).toBe(N_FILES + 1);
    expect(r1.stats.chunks).toBeGreaterThan(2000);

    // 不变式1：所有 verdict 的 chain 有限或 Infinity，无 NaN
    for (const v of r1.verdicts) {
      expect(v.chain === Infinity || Number.isFinite(v.chain)).toBe(true);
    }

    // 不变式2：环被检出（m0 被 m37 等回指）
    expect(r1.stats.cycles).toBeGreaterThanOrEqual(1);

    // 不变式3：db.exec_sql 是 chain=0 的源头
    const seed = r1.verdicts.find((v) => v.chunk.name === "exec_sql")!;
    expect(seed.chain).toBe(0);
    expect(seed.purity).toBe(Purity.IMPURE);

    // 不变式4：排序单调 —— purity 非递增
    for (let i = 1; i < r1.verdicts.length; i++) {
      expect(r1.verdicts[i - 1]!.purity).toBeGreaterThanOrEqual(r1.verdicts[i]!.purity);
    }

    // 不变式5：确定性 —— 两次扫描结果逐字节一致
    const r2 = await scanProject(dir);
    const sig = (r: typeof r1) =>
      JSON.stringify(r.verdicts.map((v) => [v.chunk.key, v.chain, v.purity, v.chainCertain]));
    expect(sig(r1)).toBe(sig(r2));
  }, 120_000);
});
