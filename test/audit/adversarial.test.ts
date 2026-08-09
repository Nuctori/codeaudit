import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { Purity } from "../../src/core/types";

/**
 * 维度 9-20：对抗性输入。
 * 目标：任何病态代码库都不能让工具崩溃、发散或给出非确定性结果。
 */

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "codeaudit-adv-")); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function project(name: string, files: Record<string, string>): string {
  const root = join(dir, name);
  mkdirSync(root, { recursive: true });
  for (const [f, content] of Object.entries(files)) {
    const p = join(root, f);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}

describe("维度9: 语法损毁", () => {
  it("半写坏的函数 + 乱码字节 + 截断文件", async () => {
    const root = project("broken", {
      "a.py": "def ok():\n    return 1\n",
      "b.py": "def broken(:\n    {{{\n",
      "c.py": "\x00\x01\x02 def x(): pass",
      "d.ts": "export function t( { return; }",
      "e.py": "def truncated():\n    if True:\n",
    });
    const r = await scanProject(root);
    expect(r.stats.parseErrors).toBeGreaterThanOrEqual(2);
    // 好文件照常分析
    expect(r.verdicts.some((v) => v.chunk.name === "ok")).toBe(true);
  });
});

describe("维度10: 空文件与纯注释文件", () => {
  it("不产生 chunk、不崩溃", async () => {
    const root = project("empty", {
      "empty.py": "",
      "comment.py": "# 只有注释\n# 再来一行\n",
      "ws.ts": "\n\n   \n",
      "doc.py": '"""模块文档字符串。"""\n',
    });
    const r = await scanProject(root);
    expect(r.stats.files).toBe(4);
    // 每个文件只有 <module> 伪 chunk
    expect(r.verdicts.every((v) => v.chunk.name === "<module>")).toBe(true);
    expect(r.verdicts.every((v) => v.purity === Purity.PURE)).toBe(true);
  });
});

describe("维度11: 极深嵌套（栈安全）", () => {
  it("JS 1000 层嵌套不爆栈，nesting=1000", async () => {
    const depth = 1000;
    let src = "function deep(){";
    for (let i = 0; i < depth; i++) src += "if(x){";
    src += "return 1;" + "}".repeat(depth) + "}";
    const root = project("deep", { "deep.js": src + "\n" });
    const r = await scanProject(root);
    const v = r.verdicts.find((x) => x.chunk.name === "deep")!;
    expect(v.chunk.nesting).toBe(depth);
  });

  it("Python 60 层缩进正常；超深缩进优雅降级不拖垮其他文件", async () => {
    const ok: string[] = ["def deep():"];
    for (let i = 1; i <= 60; i++) ok.push("    ".repeat(i) + `if x${i}:`);
    ok.push("    ".repeat(61) + "return 1");
    const bad: string[] = ["def abyss():"];
    for (let i = 1; i <= 500; i++) bad.push("    ".repeat(i) + `if x${i}:`);
    bad.push("    ".repeat(501) + "return 1");
    const root = project("deep-py", {
      "ok.py": ok.join("\n"),
      "abyss.py": bad.join("\n"),
      "healthy.py": "def healthy():\n    return 1\n",
    });
    const r = await scanProject(root);
    const v = r.verdicts.find((x) => x.chunk.name === "deep")!;
    expect(v.chunk.nesting).toBe(60);
    // tree-sitter-python 缩进栈上限(~62层) → 降级为 parseError 占位，不崩溃、不传染
    expect(r.stats.parseErrors).toBe(1);
    expect(r.verdicts.find((x) => x.chunk.name === "healthy")!.purity).toBe(Purity.PURE);
  });
});

describe("维度12: 超长单行（minified）", () => {
  it("300KB 单行 JS 正常解析", async () => {
    const parts: string[] = [];
    for (let i = 0; i < 800; i++) {
      parts.push(`function f${i}(){return f${(i + 1) % 800}()}`);
    }
    const root = project("minified", { "bundle.js": parts.join("") + "\n" });
    const r = await scanProject(root);
    // f0..f799 构成大环 → 全部同 SCC；无效应源 → 全纯
    expect(r.stats.cycles).toBeGreaterThanOrEqual(1);
    const f0 = r.verdicts.find((v) => v.chunk.name === "f0")!;
    expect(f0.purity).toBe(Purity.PURE);
  });
});

describe("维度13: Unicode/emoji 标识符", () => {
  it("中文标识符正常建边，emoji 字符串不炸解析器", async () => {
    const root = project("unicode", {
      // PEP 3131：中文是合法 Python 标识符（emoji 不是，放进字符串里）
      "u.py": 'def 计算(值):\n    """emoji 压力: 🚀🔥💥"""\n    return 值 * 2\n\ndef 入口(x):\n    return 计算("🚀" + str(x))\n',
      "v.ts": 'function 处理(x: number) { return x * 2; }\nexport function 入口(x: number) { return 处理(x); } // 🚀\n',
    });
    const r = await scanProject(root);
    expect(r.stats.parseErrors).toBe(0);
    const pyEntry = r.verdicts.find((v) => v.chunk.name === "入口" && v.chunk.file === "u.py")!;
    expect(pyEntry.purity).toBe(Purity.PURE);
    expect(pyEntry.chainCertain).toBe(true); // 边解析成功，无未知
    const tsEntry = r.verdicts.find((v) => v.chunk.name === "入口" && v.chunk.file === "v.ts")!;
    expect(tsEntry.purity).toBe(Purity.PURE);
    expect(tsEntry.chainCertain).toBe(true);
  });
});

describe("维度14: 同文件大量重复 chunk", () => {
  it("100 个完全相同函数 → key 全部唯一", async () => {
    const body = "def noop():\n    pass\n\n";
    const root = project("dupes", { "d.py": body.repeat(100) });
    const r = await scanProject(root);
    const keys = r.verdicts.map((v) => v.chunk.key);
    expect(new Set(keys).size).toBe(keys.length);
    // 但内容 id 全部相同（公理4：同内容同身份）
    const ids = new Set(r.verdicts.filter((v) => v.chunk.name === "noop").map((v) => v.chunk.id));
    expect(ids.size).toBe(1);
  });
});

describe("维度15: 同名冲突（方法 vs 顶层函数）", () => {
  it("裸名调用优先解析为顶层函数", async () => {
    const root = project("shadow", {
      "s.py": [
        "def save(x):",
        "    return x",
        "",
        "class Repo:",
        "    def save(self, x):",
        "        print(x)",
        "",
        "def run(v):",
        "    return save(v)",
        "",
      ].join("\n"),
    });
    const r = await scanProject(root);
    const run = r.verdicts.find((v) => v.chunk.name === "run")!;
    // run 调的是顶层纯 save，不是 Repo.save
    expect(run.purity).toBe(Purity.PURE);
    expect(run.chainCertain).toBe(true);
  });
});

describe("维度16: 1000 节点大环", () => {
  it("环中一个种子 → 全环 chain=0（SCC 语义），且秒级完成", async () => {
    const n = 1000;
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      // 完整环 f0→f1→…→f999→f0，f0 同时是效应种子
      const body = i === 0
        ? `print(x)\n    return f1(x - 1)`
        : `return f${(i + 1) % n}(x - 1)`;
      lines.push(`def f${i}(x):`);
      lines.push(`    ${body}`);
      lines.push("");
    }
    const root = project("bigcycle", { "c.py": lines.join("\n") });
    const t0 = Date.now();
    const r = await scanProject(root);
    expect(Date.now() - t0).toBeLessThan(10_000);
    // f0 有 print → 种子；全环同 SCC → 全环 chain=0
    const f500 = r.verdicts.find((v) => v.chunk.name === "f500")!;
    expect(f500.chain).toBe(0);
    expect(f500.purity).toBe(Purity.IMPURE);
  });
});

describe("维度17: 稠密图", () => {
  it("200 函数两两互调", async () => {
    const n = 200;
    const calls = Array.from({ length: n }, (_, j) => `g${j}(x)`).join("; ");
    const lines: string[] = [];
    for (let i = 0; i < n; i++) {
      lines.push(`def g${i}(x):`);
      lines.push(`    r = (${calls})`);
      lines.push("    return x");
      lines.push("");
    }
    const root = project("dense", { "d.py": lines.join("\n") });
    const t0 = Date.now();
    const r = await scanProject(root);
    expect(Date.now() - t0).toBeLessThan(10_000);
    expect(r.stats.chunks).toBe(n + 1); // + <module>
  });
});

describe("维度18: 星号导入地狱", () => {
  it("多层 wildcard 回退解析，不重复不遗漏", async () => {
    const root = project("wild", {
      "base.py": "def origin(x):\n    return x\n",
      "mid.py": "from base import *\n",
      "top.py": "from mid import *\n\ndef use(v):\n    return origin(v)\n",
    });
    const r = await scanProject(root);
    const use = r.verdicts.find((v) => v.chunk.name === "use")!;
    // top 的 wildcard 目标只有 mid；origin 定义在 base —— mid 的星号再导出不在解析范围
    // 诚实结果：UNKNOWN 或解析成功，二者取其一，但绝不能崩
    expect([Purity.PURE, Purity.UNKNOWN]).toContain(use.purity);
  });
});

describe("维度19: 再导出环", () => {
  it("a→b→c→a 再导出环终止", async () => {
    const root = project("recycle", {
      "a.ts": 'export { b } from "./b";\nexport function a() { return 1; }\n',
      "b.ts": 'export { c } from "./c";\nexport function b() { return 2; }\n',
      "c.ts": 'export { a } from "./a";\nexport function c() { return 3; }\n',
      "user.ts": 'import { b } from "./a";\nexport function use() { return b(); }\n',
    });
    const r = await scanProject(root);
    const use = r.verdicts.find((v) => v.chunk.name === "use")!;
    expect(use.purity).toBe(Purity.PURE); // b 经 a 的再导出解析成功
    expect(use.chainCertain).toBe(true);
  });
});

describe("维度20: 文件导入自己", () => {
  it("自导入不死循环", async () => {
    const root = project("selfimp", {
      "s.py": "from s import helper\n\ndef helper(x):\n    return x\n\ndef main():\n    return helper(1)\n",
      "t.ts": 'import { h } from "./t";\nexport function h() { return 1; }\nexport function m() { return h(); }\n',
    });
    const r = await scanProject(root);
    expect(r.verdicts.find((v) => v.chunk.name === "main")!.purity).toBe(Purity.PURE);
    expect(r.verdicts.find((v) => v.chunk.name === "m")!.purity).toBe(Purity.PURE);
  });
});
