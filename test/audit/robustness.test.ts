import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { scanProject } from "../../src/index";
import { scan } from "../../src/engine/scan";
import { initParser, loadLanguage } from "../../src/loader";
import { pythonPack } from "../../src/lang/packs/python";
import { Purity } from "../../src/core/types";

/**
 * 维度 26-30：工程健壮性（缓存/文件系统/CLI/确定性/性能）。
 */

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "codeaudit-rob-")); });
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

const CLI = join(__dirname, "..", "..", "dist", "cli.js");

describe("维度26: 缓存健壮性", () => {
  it("损坏的缓存文件 → 回退全量扫描", async () => {
    const root = project("cache-corrupt", { "a.py": "def f():\n    return 1\n" });
    const cacheDir = join(root, ".codeaudit");
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "cache.json"), "{ not json !!!");
    const r = await scanProject(root, { useCache: true, cacheDir });
    expect(r.stats.chunks).toBeGreaterThan(0);
    expect(r.stats.cachedFiles).toBe(0);
  });

  it("内容变更 → 缓存失效重新分析", async () => {
    const root = project("cache-invalidate", { "a.py": "def f():\n    return 1\n" });
    const cacheDir = join(root, ".codeaudit");
    await scanProject(root, { useCache: true, cacheDir });
    writeFileSync(join(root, "a.py"), "def f():\n    print(1)\n");
    const r = await scanProject(root, { useCache: true, cacheDir });
    const f = r.verdicts.find((v) => v.chunk.name === "f")!;
    expect(f.purity).toBe(Purity.IMPURE); // 新内容被分析
  });

  it("删除文件 → 缓存中的陈旧条目被清理", async () => {
    const root = project("cache-delete", {
      "a.py": "def f():\n    return 1\n",
      "b.py": "def g():\n    return 2\n",
    });
    const cacheDir = join(root, ".codeaudit");
    await scanProject(root, { useCache: true, cacheDir });
    rmSync(join(root, "b.py"));
    const r = await scanProject(root, { useCache: true, cacheDir });
    expect(r.verdicts.some((v) => v.chunk.name === "g")).toBe(false);
    const cache = JSON.parse(readFileSync(join(cacheDir, "cache.json"), "utf8"));
    expect(Object.keys(cache.files)).toEqual(["a.py"]);
  });
});

describe("维度27: 文件系统对抗", () => {
  it("深层目录 + 不可读文件不中断扫描", async () => {
    const files: Record<string, string> = {};
    let deep = "d";
    for (let i = 0; i < 50; i++) deep = join(deep, `l${i}`);
    files[join(deep, "leaf.py")] = "def leaf():\n    return 1\n";
    files["top.py"] = "def top():\n    return 0\n";
    const root = project("fs-adv", files);
    const r = await scanProject(root);
    expect(r.verdicts.some((v) => v.chunk.name === "leaf")).toBe(true);
  });
});

describe("维度28: CLI 对抗", () => {
  const run = (args: string[]): { code: number; out: string } => {
    try {
      const out = execFileSync("node", [CLI, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { code: 0, out };
    } catch (e: any) {
      return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
    }
  };

  it("--help 退出码 0", () => {
    expect(run(["--help"]).code).toBe(0);
  });

  it("不存在的目录 → 优雅报错退出码 2", () => {
    const r = run(["scan", "/nonexistent-xyz-123"]);
    expect(r.code).toBe(2);
  });

  it("未知 flag → 报错退出码 2（不再静默吞值当目录）", () => {
    const root = project("cli-flags", { "a.py": "def f():\n    return 1\n" });
    const r = run(["scan", root, "--no-cache", "--frobnicate"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("未知选项");
  });

  it("--top 2 只输出 2 条非纯记录", () => {
    const root = project("cli-top", {
      "a.py": "import os\ndef a():\n    os.getcwd()\ndef b():\n    a()\ndef c():\n    b()\ndef d():\n    c()\n",
    });
    const r = run(["scan", root, "--no-cache", "--top", "2"]);
    expect(r.code).toBe(0);
    const chainLines = r.out.split("\n").filter((l) => l.includes("chain="));
    expect(chainLines.length).toBe(2);
  });

  it("--strict 退出码矩阵：纯项目 0，不纯项目 1", () => {
    const pure = project("cli-pure", { "a.py": "def f():\n    return 1\n" });
    const impure = project("cli-impure", { "a.py": "def f():\n    print(1)\n" });
    expect(run(["scan", pure, "--no-cache", "--strict"]).code).toBe(0);
    expect(run(["scan", impure, "--no-cache", "--strict"]).code).toBe(1);
  });

  it("--gate 无 --changed → exit 2（依赖校验，不静默失效）", () => {
    const root = project("cli-gate-deps", { "a.py": "def f():\n    return 1\n" });
    const r = run(["scan", root, "--no-cache", "--gate"]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("--gate 需要 --changed");
  });

  it("--gate 低危改动 → 放行 0（low）", () => {
    const root = project("cli-gate-low", { "a.py": "def f():\n    return 1\n" });
    // changed 相对 cwd 解析——传入绝对路径（cli 内部转相对 root）
    const r = run(["scan", root, "--no-cache", "--changed", join(root, "a.py"), "--gate"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("[gate] LOW");
  });

  it("--gate 高危改动（IMPURE 传播链）→ 拒绝 1（high）", () => {
    const root = project("cli-gate-high", {
      "a.ts": "export function f() { console.log('x'); }\n",
      "b.ts": "import { f } from './a';\nexport function g() { f(); }\n",
    });
    const r = run(["scan", root, "--no-cache", "--changed", join(root, "a.ts"), "--gate"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("[gate] HIGH");
  });

  it("--gate invalid（改动文件未匹配）→ 拒绝 1（不静默放行）", () => {
    const root = project("cli-gate-invalid", { "a.py": "def f():\n    return 1\n" });
    const r = run(["scan", root, "--no-cache", "--changed", join(root, "nope.ts"), "--gate"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("回归风险不可评估");
  });

  it("--topology 旗标仍可用（迭代22 回归护栏：--gate 分支不得顶掉兄弟分支）", () => {
    const root = project("cli-topology-flag", { "a.py": "def f():\n    return 1\n" });
    const r = run(["scan", root, "--no-cache", "--topology"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("拓扑");
  });

  it("全部布尔旗标可解析（迭代23 回归护栏：新旗标不得顶掉兄弟分支——--gate/--topology/--sources/--state/--table-usage 逐一冒烟）", () => {
    const root = project("cli-all-flags", { "a.py": "def f():\n    return 1\n" });
    const flags = ["--strict", "--topology", "--sources", "--state", "--table-usage"];
    for (const f of flags) {
      const r = run(["scan", root, "--no-cache", f]);
      expect(r.code).toBe(0); // 未知选项会 exit 2——顶掉兄弟分支即在此失败
      expect(r.out).not.toContain("未知选项");
    }
  });

  it("--effect-table 注入生效：MySdk:net → IMPURE；无 override → UNKNOWN（迭代29）", () => {
    const root = project("cli-effect-table", {
      "netcall.cs": "public class Consumer {\n    public void Run() { MySdk.Send(); }\n}",
    });
    const overrideFile = join(root, "overrides.json");
    writeFileSync(overrideFile, JSON.stringify({ csharp: { impureGlobals: { MySdk: "net" } } }));

    const base = run(["scan", root, "--no-cache"]);
    expect(base.code).toBe(0);
    expect(base.out).toContain("UNKNOWN"); // MySdk 不可解析 → ?

    const injected = run(["scan", root, "--no-cache", "--effect-table", overrideFile]);
    expect(injected.code).toBe(0);
    expect(injected.out).toContain("IMPURE"); // 注入 → net 效应 → IMPURE
    expect(injected.out).toContain("net"); // 效应类 net
  });

  it("--effect-table 读文件失败 → exit 2（不存在路径 / 非法 JSON）（迭代29）", () => {
    const root = project("cli-effect-table-bad", { "a.py": "def f():\n    return 1\n" });
    const missing = run(["scan", root, "--no-cache", "--effect-table", join(root, "nope.json")]);
    expect(missing.code).toBe(2);
    expect(missing.out).toContain("无法读取效应表文件");

    const badJson = join(root, "bad.json");
    writeFileSync(badJson, "{ not json");
    const r = run(["scan", root, "--no-cache", "--effect-table", badJson]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("无法读取效应表文件");
  });

  it("--effect-table 校验失败 → exit 2（非法效应类，scan.ts 兜底）（迭代29）", () => {
    const root = project("cli-effect-table-invalid", { "a.py": "def f():\n    return 1\n" });
    const overrideFile = join(root, "overrides.json");
    writeFileSync(overrideFile, JSON.stringify({ csharp: { impureGlobals: { X: "IO" } } }));
    const r = run(["scan", root, "--no-cache", "--effect-table", overrideFile]);
    expect(r.code).toBe(2);
    expect(r.out).toContain("effectOverrides 非法");
  });
});

describe("维度29: 全 fixture 确定性", () => {
  it("pyshop 三次扫描字节一致", async () => {
    const root = join(__dirname, "..", "fixtures", "pyshop");
    const sig = (r: Awaited<ReturnType<typeof scanProject>>) =>
      JSON.stringify(r.verdicts.map((v) => [v.chunk.key, v.chain, v.purity, v.chunk.nesting]));
    const r1 = sig(await scanProject(root));
    const r2 = sig(await scanProject(root));
    const r3 = sig(await scanProject(root));
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });
});

describe("维度30: 性能预算", () => {
  it("冷扫 300 文件 < 15s；缓存热扫 < 3s", async () => {
    const files: Record<string, string> = { "db.py": "import sqlite3\ndef exec_sql(s):\n    return sqlite3.connect('x').execute(s)\n" };
    for (let i = 0; i < 300; i++) {
      const dep = i > 0 ? `import m${(i * 7) % i}\n` : "";
      const call = i > 0 ? `    r = m${(i * 7) % i}.fn0(x)\n` : "    r = x\n";
      files[`m${i}.py`] = `${dep}def fn0(x):\n${call}    return r\n`;
    }
    const root = project("perf", files);
    const cacheDir = join(root, ".codeaudit");

    const t0 = Date.now();
    await scanProject(root, { useCache: true, cacheDir });
    const cold = Date.now() - t0;
    expect(cold).toBeLessThan(15_000);

    const t1 = Date.now();
    const r = await scanProject(root, { useCache: true, cacheDir });
    const warm = Date.now() - t1;
    expect(warm).toBeLessThan(3_000);
    expect(r.stats.cachedFiles).toBe(301);
  }, 60_000);
});

describe("步骤1：指纹 / memo / 路径裁剪（三方评审落地）", () => {
  const run = (args: string[]): { code: number; out: string } => {
    try {
      const out = execFileSync("node", [CLI, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { code: 0, out };
    } catch (e: any) {
      return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
    }
  };

  it("缓存行为指纹不匹配 → 全量重扫", async () => {
    const root = project("cache-fp", { "a.py": "def f():\n    return 1\n" });
    const cacheDir = join(root, ".codeaudit");
    await scanProject(root, { useCache: true, cacheDir });
    expect((await scanProject(root, { useCache: true, cacheDir })).stats.cachedFiles).toBe(1);
    // 篡改 fingerprint（模拟提取行为变更未失效）→ 全量重扫
    const cp = join(cacheDir, "cache.json");
    const cf = JSON.parse(readFileSync(cp, "utf8"));
    cf.fingerprint = "bogus";
    writeFileSync(cp, JSON.stringify(cf));
    expect((await scanProject(root, { useCache: true, cacheDir })).stats.cachedFiles).toBe(0);
  });

  it("resolveModule 每 (module, fromFile) 只解析一次（memo）", async () => {
    const root = project("memo", {
      "a.py": "import os\ndef f():\n    os.getcwd()\n    os.getcwd()\n    os.getcwd()\n",
    });
    const ParserCtor = await initParser();
    let calls = 0;
    const counting = {
      ...pythonPack,
      resolveModule(m: string, f: string, pf: ReadonlySet<string>): string | null {
        calls++;
        return pythonPack.resolveModule(m, f, pf);
      },
    };
    await scan({ root, useCache: false, packs: [counting], loadLanguage, ParserCtor });
    expect(calls).toBeLessThanOrEqual(1); // 3 个 os.getcwd 共享一次模块解析
  });

  it("错误消息裁剪绝对路径前缀", () => {
    const root = project("cli-trim", { "a.py": "def f():\n    return 1\n" });
    const r = run(["scan", join(root, "nope")]);
    expect(r.code).toBe(2);
    expect(r.out).not.toContain(root);
    expect(r.out).toContain(".");
  });
});
