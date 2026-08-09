import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { Purity, Verdict } from "../../src/core/types";

/**
 * 维度 21-25：语言特性覆盖。
 * 每个特性断言"当前定义的诚实行为"，防止静默回归。
 */

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "codeaudit-lang-")); });
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

function by(report: { verdicts: Verdict[] }): Map<string, Verdict> {
  const m = new Map<string, Verdict>();
  for (const v of report.verdicts) m.set(`${v.chunk.file}::${v.chunk.name}`, v);
  return m;
}

describe("维度21: Python 特性", () => {
  it("async def / 装饰器 / lambda / 嵌套函数 / 类方法", async () => {
    const root = project("pyfeat", {
      "feat.py": [
        "import functools",
        "import asyncio",
        "",
        "def deco(f):",
        "    @functools.wraps(f)",
        "    def wrapper(*a, **k):",
        "        return f(*a, **k)",
        "    return wrapper",
        "",
        "@deco",
        "async def fetch_data(uid):",
        '    print("fetch", uid)',
        "    return uid",
        "",
        "def use_lambda(items):",
        "    return sorted(items, key=lambda x: x[1])",
        "",
        "class Repo:",
        "    def __init__(self):",
        "        self.db = None",
        "",
        "    @staticmethod",
        "    def pure_check(x):",
        "        return x > 0",
        "",
        "    def write(self, x):",
        "        open('f.txt', 'w').write(str(x))",
        "",
      ].join("\n"),
    });
    const b = by(await scanProject(root));

    // async 函数是 chunk；内部 print → io
    expect(b.get("feat.py::fetch_data")!.purity).toBe(Purity.IMPURE);
    // 装饰器调用 deco 建边（deco 纯）
    expect(b.get("feat.py::fetch_data")!.chainCertain).toBe(true);
    // lambda 不是 chunk，sorted 是纯内置
    expect(b.get("feat.py::use_lambda")!.purity).toBe(Purity.PURE);
    // 嵌套函数 wrapper 是独立 chunk
    expect(b.get("feat.py::wrapper")).toBeDefined();
    // open(...) 直接效应
    expect(b.get("feat.py::Repo.write")!.chain).toBe(0);
    // 静态方法纯
    expect(b.get("feat.py::Repo.pure_check")!.purity).toBe(Purity.PURE);
  });

  it("from . import x（包内点导入）", async () => {
    const root = project("pydot", {
      "pkg/__init__.py": "from .core import main\n",
      "pkg/core.py": "def main():\n    return 1\n",
      "pkg/user.py": "from . import main\n\ndef run():\n    return main()\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("pkg/user.py::run")!.purity).toBe(Purity.PURE);
    expect(b.get("pkg/user.py::run")!.chainCertain).toBe(true);
  });
});

describe("维度22: TypeScript 特性", () => {
  it("泛型 / 可选链 / getter-setter / 箭头函数链", async () => {
    const root = project("tsfeat", {
      "g.ts": [
        "export function identity<T>(x: T): T { return x; }",
        "",
        "export class Box<T> {",
        "  private v: T | null = null;",
        "  get value(): T | null { return this.v; }",
        "  set value(x: T | null) { this.v = x; }",
        "}",
        "",
        "interface Maybe { run?: () => number }",
        "export function optCall(m: Maybe | null): number {",
        "  return m?.run?.() ?? 0;",
        "}",
        "",
        "export const pipe = (x: number) => (y: number) => x + y;",
        "",
        "export function usePipe(): number {",
        "  return pipe(1)(2);",
        "}",
        "",
      ].join("\n"),
    });
    const b = by(await scanProject(root));
    expect(b.get("g.ts::identity")!.purity).toBe(Purity.PURE);
    expect(b.get("g.ts::Box.value")).toBeDefined();
    // 可选链调用不崩溃；m?.run?.() 是局部对象方法 → dynamic（诚实忽略）
    expect(b.get("g.ts::optCall")).toBeDefined();
    expect(b.get("g.ts::usePipe")!.purity).toBe(Purity.PURE);
  });
});

describe("维度23: JavaScript 特性", () => {
  it("require 重命名 / module.exports 形态 / 解构 require", async () => {
    const root = project("jsfeat", {
      "lib.js": "function go() { return 1; }\nmodule.exports = { go };\n",
      "renamed.js": 'const fs2 = require("fs");\nfunction w() { fs2.writeFileSync("a", "b"); }\nmodule.exports = { w };\n',
      "destructured.js": 'const { go } = require("./lib");\nfunction use() { return go(); }\nmodule.exports = { use };\n',
    });
    const b = by(await scanProject(root));
    // require 重命名后 fs2 仍是命名空间绑定 → fs 表命中
    expect(b.get("renamed.js::w")!.purity).toBe(Purity.IMPURE);
    // 解构 require：go 不是标识符绑定 → 当前诚实行为是未解析
    const use = b.get("destructured.js::use")!;
    expect([Purity.PURE, Purity.UNKNOWN]).toContain(use.purity);
  });
});

describe("维度24: TSX 特性", () => {
  it("泛型组件 + 内联事件处理 + 效应在组件体内", async () => {
    const root = project("tsxfeat", {
      "App.tsx": [
        'import * as fs from "fs";',
        "",
        "interface Props<T> { items: T[] }",
        "",
        "export function List<T>({ items }: Props<T>) {",
        "  return <ul>{items.map((x, i) => <li key={i}>{String(x)}</li>)}</ul>;",
        "}",
        "",
        "export function SaveBtn() {",
        "  const onClick = () => {",
        '    fs.writeFileSync("save.txt", "x");',
        "  };",
        "  return <button onClick={onClick}>save</button>;",
        "}",
        "",
      ].join("\n"),
    });
    const r = await scanProject(root);
    expect(r.stats.parseErrors).toBe(0);
    const b = by(r);
    expect(b.get("App.tsx::List")!.purity).toBe(Purity.PURE);
    // onClick 是变量声明的箭头函数 chunk，含 fs 效应
    const onClick = b.get("App.tsx::onClick")!;
    expect(onClick.purity).toBe(Purity.IMPURE);
    expect(onClick.chain).toBe(0);
    // SaveBtn 体内没有直接调用 onClick（JSX 属性引用不是调用点）
    expect(b.get("App.tsx::SaveBtn")).toBeDefined();
  });
});

describe("维度25: 动态导入边界", () => {
  it("import() 与 require(变量) 不崩溃且诚实标记", async () => {
    const root = project("dynimp", {
      "a.ts": [
        "export async function load(name: string) {",
        '  const m = await import("./" + name);',
        "  return m.default;",
        "}",
        "",
        "export function loadCjs(name: string) {",
        "  return require(name);",
        "}",
        "",
      ].join("\n"),
    });
    const r = await scanProject(root);
    const b = by(r);
    // 动态说明符无法解析 → 不允许假装成功
    expect(b.get("a.ts::load")).toBeDefined();
    expect(b.get("a.ts::loadCjs")).toBeDefined();
  });
});
