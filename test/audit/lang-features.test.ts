import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { influenceAnalysis } from "../../src/core/influence";
import { annotationBudget, annotationCurve } from "../../src/core/influence";
import { Purity, type Verdict } from "../../src/core/types";

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
    // 可选链调用不崩溃；m?.run?.() 是局部对象方法 → 记未知（诚实承认不可见）
    expect(b.get("g.ts::optCall")).toBeDefined();
    // pipe(1)(2) 是不可拍平调用（调用结果再调用）→ 记未知，不再静默丢边
    expect(b.get("g.ts::usePipe")!.purity).toBe(Purity.UNKNOWN);
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
    // 解构 require（定义性事实族 D）：{ go } 绑定到 lib.go → 真边 → 确定性 PURE（go 纯函数）
    const use = b.get("destructured.js::use")!;
    expect(use.purity).toBe(Purity.PURE);
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
    // items.map(...) 是参数方法调用 → 记 `?`，诚实未知
    expect(b.get("App.tsx::List")!.purity).toBe(Purity.UNKNOWN);
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

describe("OO 健全性回归：假纯修复", () => {
  it("super().save() 继承调用不假纯（父类效应不再静默丢失）", async () => {
    const root = project("oosuper", {
      "base.py": "class Base:\n    def save(self):\n        print('io')\n",
      "child.py": "from base import Base\nclass Child(Base):\n    def save(self):\n        super().save()\n",
    });
    const b = by(await scanProject(root));
    // 不可拍平 → 诚实未知，而非 PURE
    expect(b.get("child.py::Child.save")!.purity).toBe(Purity.UNKNOWN);
  });

  it("导入对象的方法调用不假纯（import { db }; db.query()）", async () => {
    const root = project("ooobj", {
      "db.ts": "export const db = { query: (q: string) => console.log(q) };\n",
      "app.ts": "import { db } from './db';\nexport function run() { db.query('DELETE FROM t'); }\n",
    });
    const b = by(await scanProject(root));
    // 对象方法调用 → 诚实未知，而非 PURE
    expect(b.get("app.ts::run")!.purity).toBe(Purity.UNKNOWN);
  });

  it("同名方法冲突不静默选一（self 调用记未知）", async () => {
    const root = project("oopoly", {
      "poly.py": "class C:\n    def m(self):\n        print('a')\n    def m(self):\n        print('b')\n    def run(self):\n        self.m()\n",
    });
    const b = by(await scanProject(root));
    // 冲突 → 不猜，记未知
    expect(b.get("poly.py::C.run")!.purity).toBe(Purity.UNKNOWN);
  });
});

describe("公理4：令牌级规范化（身份即内容）", () => {
  const idOf = async (p: string): Promise<string> => {
    const r = await scanProject(p);
    return r.verdicts.find((v) => v.chunk.name === "f")!.chunk.id;
  };

  it("注释/空白不敏感（改注释、调缩进 id 不变）", async () => {
    const a = project("ax4a", { "f.py": "def f(x):\n    # 注释\n    return x + 1\n" });
    const b = project("ax4b", { "f.py": "def f(x):\n    return x + 1\n" });
    expect(await idOf(a)).toBe(await idOf(b));
  });

  it("字符串内容敏感（旧正则会把 \"a  b\" 与 \"a b\" 塌缩为同 id）", async () => {
    const a = project("ax4c", { "f.py": 'def f(x):\n    return "a  b"\n' });
    const b = project("ax4d", { "f.py": 'def f(x):\n    return "a b"\n' });
    expect(await idOf(a)).not.toBe(await idOf(b));
  });

  it("整除 // 不被当注释（旧正则 x//2 与 x//3 同 id）", async () => {
    const a = project("ax4e", { "f.py": "def f(x):\n    return x // 2\n" });
    const b = project("ax4f", { "f.py": "def f(x):\n    return x // 3\n" });
    expect(await idOf(a)).not.toBe(await idOf(b));
  });

  it("TS 私有字段 # 不被剥离（旧正则 this.#a 与 this.#b 同 id）", async () => {
    const a = project("ax4g", { "g.ts": "export class C {\n  #a = 1;\n  f() { return this.#a; }\n}\n" });
    const b = project("ax4h", { "g.ts": "export class C {\n  #b = 1;\n  f() { return this.#b; }\n}\n" });
    const idA = (await scanProject(a)).verdicts.find((v) => v.chunk.name === "C.f")!.chunk.id;
    const idB = (await scanProject(b)).verdicts.find((v) => v.chunk.name === "C.f")!.chunk.id;
    expect(idA).not.toBe(idB);
  });
});

describe("HOF 回调边（map/filter 吞回调效应修复）", () => {
  it("map(warn, xs) 中 warn 的 io 效应传播到调用方", async () => {
    const root = project("hof1", {
      "hof.py": "def warn(x):\n    print(x)\n\ndef run(xs):\n    return list(map(warn, xs))\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("hof.py::warn")!.purity).toBe(Purity.IMPURE);
    expect(b.get("hof.py::run")!.purity).toBe(Purity.IMPURE); // 修复前 PURE（假纯）
  });

  it("sorted(xs, key=warn) 关键字实参同样保留效应", async () => {
    const root = project("hof2", {
      "hof.py": "def warn(x):\n    print(x)\n\ndef run2(xs):\n    return sorted(xs, key=warn)\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("hof.py::run2")!.purity).toBe(Purity.IMPURE);
  });

  it("functools.reduce 模块成员 HOF", async () => {
    const root = project("hof3", {
      "hof.py": "import functools\ndef warn(a, b):\n    print(a)\n    return b\n\ndef run3(xs):\n    return functools.reduce(warn, xs, 0)\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("hof.py::run3")!.purity).toBe(Purity.IMPURE);
  });

  it("Array.from(xs, cb) TS 全局 HOF", async () => {
    const root = project("hof4", {
      "hof.ts": "function cb(x: number) { console.log(x); return x; }\nexport function run4(xs: number[]) { return Array.from(xs, cb); }\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("hof.ts::run4")!.purity).toBe(Purity.IMPURE);
  });
});

describe("标注回读（AI 标注闭环注入端）", () => {
  it("PURE 标注移除 chunk 自身 `?`，下游随之翻案", async () => {
    const root = project("ann1", {
      "a.py": "import weirdlib\ndef source():\n    weirdlib.run()\ndef caller():\n    source()\n",
    });
    const r0 = await scanProject(root);
    const src = r0.verdicts.find((v) => v.chunk.name === "source")!;
    expect(src.purity).toBe(Purity.UNKNOWN);
    expect(r0.verdicts.find((v) => v.chunk.name === "caller")!.purity).toBe(Purity.UNKNOWN);
    const r1 = await scanProject(root, { annotations: new Map([[src.chunk.id, "PURE"]]) });
    expect(r1.verdicts.find((v) => v.chunk.name === "source")!.purity).toBe(Purity.PURE);
    expect(r1.verdicts.find((v) => v.chunk.name === "caller")!.purity).toBe(Purity.PURE);
  });

  it("IMPURE 标注加直接效应并传播", async () => {
    const root = project("ann2", {
      "a.py": "import weirdlib\ndef source():\n    weirdlib.run()\ndef caller():\n    source()\n",
    });
    const r0 = await scanProject(root);
    const src = r0.verdicts.find((v) => v.chunk.name === "source")!;
    const r1 = await scanProject(root, { annotations: new Map([[src.chunk.id, "IMPURE"]]) });
    expect(r1.verdicts.find((v) => v.chunk.name === "source")!.purity).toBe(Purity.IMPURE);
    expect(r1.verdicts.find((v) => v.chunk.name === "caller")!.purity).toBe(Purity.IMPURE);
  });
});

describe("迭代1：影响面方向 + 模块导出面解析（D 四件套）", () => {
  it("影响面方向：标注 u 释放其调用方（a 调 b、b 含 ? → I(b)=2）", async () => {
    const root = project("infl1", {
      "a.py": "import b\ndef a():\n    b.source()\n",
      "b.py": "import weirdlib\ndef source():\n    weirdlib.run()\n",
    });
    const r = await scanProject(root);
    const chunks = r.verdicts.map((v) => v.chunk);
    const infl = influenceAnalysis(chunks);
    const bKey = chunks.find((c) => c.file.endsWith("b.py") && c.name === "source")!.key;
    expect(infl.get(bKey)).toBe(2); // b 自身 + 调用方 a
  });

  it("HOF 成员形回调不假纯：Array.from(xs, this.log)", async () => {
    const root = project("hofmem", {
      "ui.ts": "class UI {\n  log(x: string) { console.log(x); }\n  build(xs: string[]) { return Array.from(xs, this.log); }\n}\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("ui.ts::UI.build")!.purity).toBe(Purity.IMPURE);
  });

  it("from-import 类成员：from db import Conn; Conn.open() → 真边", async () => {
    const root = project("fm1", {
      "db.py": "class Conn:\n    def open(self):\n        print('io')\n",
      "use.py": "from db import Conn\ndef run():\n    Conn.open(Conn())\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("use.py::run")!.purity).toBe(Purity.IMPURE);
  });

  it("from-import 成员遮蔽守卫：绑定被重绑后不解析（防假纯）", async () => {
    const root = project("fm2", {
      "db.py": "class conn:\n    def execute(self):\n        pass\n",
      "use.py": "from db import conn\ndef run():\n    conn = make_evil()\n    conn.execute()\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("use.py::run")!.purity).toBe(Purity.UNKNOWN);
  });

  it("别名再导出：export { a as b } from → 消费者解析", async () => {
    const root = project("alias1", {
      "lib.ts": "export function a() { console.log('x'); }\n",
      "barrel.ts": "export { a as b } from './lib';\n",
      "use.ts": "import { b } from './barrel';\nexport function run() { b(); }\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("use.ts::run")!.purity).toBe(Purity.IMPURE);
  });

  it("export * as ns from → 命名空间绑定解析", async () => {
    const root = project("ns1", {
      "lib.ts": "export function go() { console.log('x'); }\n",
      "barrel.ts": "export * as ns from './lib';\n",
      "use.ts": "import { ns } from './barrel';\nexport function run() { ns.go(); }\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("use.ts::run")!.purity).toBe(Purity.IMPURE);
  });

  it("Python 点连模块：import a.b; a.b.fn() → 模块内解析", async () => {
    const root = project("dot1", {
      "pkg/a.py": "def fn():\n    print('io')\n",
      "pkg/__init__.py": "",
      "main.py": "import pkg.a\ndef run():\n    pkg.a.fn()\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("main.py::run")!.purity).toBe(Purity.IMPURE);
  });

  it("纯库 from-import 成员：immutable Map.isMap → PURE", async () => {
    const root = project("g2", {
      "use.ts": "import { Map } from 'immutable';\nexport function isM(x: unknown) { return Map.isMap(x); }\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("use.ts::isM")!.purity).toBe(Purity.PURE);
  });
});

describe("迭代2：module id 锚点 + egg 框架命名空间", () => {
  it("module chunk 的 id 按文件限定（标注不跨文件泄漏）", async () => {
    const root = project("modid", {
      "a.py": "def f():\n    return 1\n",
      "b.py": "def g():\n    return 2\n",
    });
    const r = await scanProject(root);
    const mods = r.verdicts.filter((v) => v.chunk.name === "<module>");
    expect(mods.length).toBe(2);
    expect(mods[0]!.chunk.id).not.toBe(mods[1]!.chunk.id);
    expect(mods[0]!.chunk.id).toContain("module@");
  });

  it("egg 框架命名空间：ctx.model.X → io", async () => {
    const root = project("egg1", {
      "c.js": "async function index() {\n  const { ctx } = this;\n  const users = await ctx.model.Orders.findAll();\n  ctx.body = users;\n}\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("c.js::index")!.purity).toBe(Purity.IMPURE);
  });
});

describe("标注会计：? 多重性 + 标注曲线", () => {
  it("unknownSites 保留未解析调用点数（calls 的 ? 是去重单哨兵）", async () => {
    const root = project("usites", {
      "a.py": "import weirdlib\ndef f():\n    weirdlib.a()\n    weirdlib.b()\n",
    });
    const r = await scanProject(root);
    const f = r.verdicts.find((v) => v.chunk.name === "f")!;
    expect(f.chunk.calls.has("?")).toBe(true);
    expect(f.chunk.unknownSites).toBe(2);
  });

  it("标注曲线精确：a 调 b、b 含 ? → 标 b 释放 a 和 b", async () => {
    const root = project("curve1", {
      "a.py": "import b\ndef a():\n    b.source()\n",
      "b.py": "import weirdlib\ndef source():\n    weirdlib.run()\n",
    });
    const r = await scanProject(root);
    const chunks = r.verdicts.map((v) => v.chunk);
    const budget = annotationBudget(chunks);
    const bKey = chunks.find((c) => c.file.endsWith("b.py") && c.name === "source")!.key;
    const curve = annotationCurve(budget, [bKey]);
    expect(curve[0]).toBe(2); // a + b 都 UNKNOWN
    expect(curve[1]).toBe(0); // 标 b 后全部释放
    expect(budget.deps.get(bKey)).toBe(1); // b 依赖自身 1 个源
  });
});

describe("步骤2：字面量接收者（三方评审最小形态）", () => {
  it("硬纯方法判纯：\"x\".upper() / (5).bit_length() / b\"x\".decode()", async () => {
    const root = project("lit1", {
      "a.py": "def a():\n    return \"x\".upper()\n\ndef b():\n    return (5).bit_length()\n\ndef c():\n    return b'x'.decode()\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("a.py::a")!.purity).toBe(Purity.PURE);
    expect(b.get("a.py::b")!.purity).toBe(Purity.PURE);
    expect(b.get("a.py::c")!.purity).toBe(Purity.PURE);
  });

  it("表外方法 → 诚实未知（F9）；协议分派方法（join）表外", async () => {
    const root = project("lit2", {
      "a.py": "def a():\n    return \"x\".custom_method()\n\ndef b(xs):\n    return \" \".join(xs)\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("a.py::a")!.purity).toBe(Purity.UNKNOWN);
    expect(b.get("a.py::b")!.purity).toBe(Purity.UNKNOWN); // join 对参数 __iter__ 分派 → 层 2 表外
  });

  it("数组字面量 HOF：cb 的 io 经 [1,2,3].map(cb) 传播，不被本地同名 map 劫持", async () => {
    const root = project("lit3", {
      "lib.ts": "function map(xs: number[], cb: any) { return xs; }\nexport function log(x: number) { console.log(x); }\nexport function run(xs: number[]) { return [1, 2, 3].map(log); }\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("lib.ts::run")!.purity).toBe(Purity.IMPURE); // 经 log 的 io；本地 map 未被错连
  });

  it("template 字面量：插值内调用的 io 独立捕获", async () => {
    const root = project("lit4", {
      "a.ts": "export function danger() { console.log('x'); }\nexport function run(n: number) { return `${danger()}`.trim(); }\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("a.ts::run")!.purity).toBe(Purity.IMPURE);
  });

  it("标识符接收者不变：xs.map(cb) 仍 UNKNOWN", async () => {
    const root = project("lit5", {
      "a.ts": "export function cb(x: number) { return x; }\nexport function run(xs: number[]) { return xs.map(cb); }\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("a.ts::run")!.purity).toBe(Purity.UNKNOWN);
  });
});

describe("公理审计修复：健全性缺口（A6 形式化后的通道闭合）", () => {
  it("标注按 (file, id) 锚定：同内容跨文件不误放行", async () => {
    const root = project("annfile", {
      "a.py": "import weirdlib\ndef f():\n    weirdlib.run()\n",
      "b.py": "import weirdlib\ndef f():\n    weirdlib.run()\n",
    });
    const r = await scanProject(root);
    const a = r.verdicts.find((v) => v.chunk.file === "a.py" && v.chunk.name === "f")!;
    const b = r.verdicts.find((v) => v.chunk.file === "b.py" && v.chunk.name === "f")!;
    expect(a.chunk.id).toBe(b.chunk.id); // 同内容同 id（公理4）
    // 带 file 的标注只放行 a.py 实例（同 id⇒同判定为假：import 上下文可不同）
    const r1 = await scanProject(root, { annotations: new Map([[`${a.chunk.file}\u0000${a.chunk.id}`, "PURE"]]) });
    expect(r1.verdicts.find((v) => v.chunk.file === "a.py" && v.chunk.name === "f")!.purity).toBe(Purity.PURE);
    expect(r1.verdicts.find((v) => v.chunk.file === "b.py" && v.chunk.name === "f")!.purity).toBe(Purity.UNKNOWN);
  });

  it("裸名遮蔽守卫：局部赋值后不解析到顶层同名函数", async () => {
    const root = project("shadow", {
      "a.py": "def helper():\n    print('io')\n\ndef run():\n    helper = local()\n    helper()\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("a.py::run")!.purity).toBe(Purity.UNKNOWN); // helper 是局部变量，不连顶层 helper
  });

  it("裸名调用不指向类方法（方法不在裸名作用域）", async () => {
    const root = project("methodbare", {
      "a.py": "class C:\n    def run(self):\n        pass\n\ndef call():\n    run()\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("a.py::call")!.purity).toBe(Purity.UNKNOWN);
  });

  it("无条件 HOF 实参未解析 → 记未知（const f = console.log; [1].map(f)）", async () => {
    const root = project("hofunres", {
      "a.ts": "export function run() { const f = console.log; return [1].map(f); }\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("a.ts::run")!.purity).toBe(Purity.UNKNOWN); // f 是变量实参 → 不能证明纯
  });

  it("不变量机检在真实扫描上为零违规（健全性证书）", async () => {
    const root = project("inv0", { "a.py": "import os\ndef f():\n    os.getcwd()\n" });
    const r = await scanProject(root);
    expect(r.stats.invariantViolations).toBe(0);
  });

  it("模块级重绑遮蔽 import：conn = other 后不解析到 db 的纯方法", async () => {
    const root = project("modrebind", {
      "db.py": "class conn:\n    def execute(self):\n        pass\n",
      "use.py": "from db import conn\nconn = make_evil()\ndef f():\n    conn.execute()\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("use.py::f")!.purity).toBe(Purity.UNKNOWN); // 模块级重绑 → 不解析
  });

  it("参数遮蔽命名空间 import：def f(math): math.foo() → 未知", async () => {
    const root = project("paramshadow", {
      "a.py": "import math\ndef f(math):\n    math.foo()\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("a.py::f")!.purity).toBe(Purity.UNKNOWN); // math 是参数 → 遮蔽 import
  });

  it("构造器体 io 并入 class chunk（S1 修复）：def f(): return Conn() → IMPURE", async () => {
    const root = project("ctorio", {
      "a.py": "class Conn:\n    def __init__(self):\n        print('io')\ndef f():\n    return Conn()\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("a.py::f")!.purity).toBe(Purity.IMPURE);
    expect(b.get("a.py::Conn")!.purity).toBe(Purity.IMPURE); // 类 chunk 含构造器效应
  });

  it("熵/时钟/PRNG 判 io（跨语言一致）：crypto.randomBytes / datetime.now / Date.now / Math.random / secrets", async () => {
    const root = project("io-tables", {
      "a.ts": "import { randomBytes } from 'crypto';\nexport function f() { return randomBytes(16); }\nexport function g() { return Date.now(); }\nexport function r() { return Math.random(); }\n",
      "b.py": "from datetime import datetime\nimport secrets\ndef h():\n    return datetime.now()\ndef s():\n    return secrets.token_hex()\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("a.ts::f")!.purity).toBe(Purity.IMPURE);
    expect(b.get("a.ts::g")!.purity).toBe(Purity.IMPURE);
    expect(b.get("a.ts::r")!.purity).toBe(Purity.IMPURE); // Math.random 与 random.random 同源判 io
    expect(b.get("b.py::h")!.purity).toBe(Purity.IMPURE);
    expect(b.get("b.py::s")!.purity).toBe(Purity.IMPURE); // secrets = os.urandom 熵读取
  });

  it("协议内建判未知：hash(x) → UNKNOWN（与 builtinTypeEffects 协议表外纪律一致）", async () => {
    const root = project("proto", {
      "a.py": "def f(x):\n    return hash(x)\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("a.py::f")!.purity).toBe(Purity.UNKNOWN);
  });

  it("原型链键不崩溃（迭代2 B1）：hasOwnProperty/toString 作接收者不再 TypeError", async () => {
    const root = project("protochain", {
      "a.ts": "export function safeGet(obj: any, key: string) {\n  if (!hasOwnProperty.call(obj, key)) return null;\n  return obj[key];\n}\n",
    });
    const r = await scanProject(root); // 修复前此调用 TypeError（frameworkIo 继承查找）→ 整扫崩溃
    expect(r.verdicts.some((v) => v.chunk.name === "safeGet")).toBe(true);
    const b = by(r);
    expect(b.get("a.ts::safeGet")!.purity).toBe(Purity.UNKNOWN); // 未解析接收者 → 诚实未知
  });

  it("parseError 文件 chunk 降级 UNKNOWN（迭代2 H1）：未闭合字符串吞调用不再假纯", async () => {
    const root = project("parsedeck", {
      "a.py": "def f():\n    return \"unterminated\nimport os\nos.system(\"ls\")\n",
    });
    const r = await scanProject(root);
    expect(r.stats.parseErrors).toBe(1);
    const b = by(r);
    expect(b.get("a.py::f")!.purity).toBe(Purity.UNKNOWN); // 修复前 PURE（调用被吞）
  });

  it("from-import HOF 回调边（迭代2 维护）：from functools import reduce; reduce(write, xs) → IMPURE", async () => {
    const root = project("hoffrom", {
      "a.py": "from functools import reduce\ndef write(x):\n    print(x)\ndef f(xs):\n    return reduce(write, xs)\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("a.py::f")!.purity).toBe(Purity.IMPURE); // write 的 io 经回调边保留
  });
});

describe("定义性事实族（用户覆写会议否决后实施）", () => {
  it("A 模块级值绑定：from db import conn; conn.execute()（实例绑定 → 类成员边）", async () => {
    const root = project("dfa", {
      "db.py": "class DB:\n    def execute(self):\n        print('io')\nconn = DB()\n",
      "use.py": "from db import conn\ndef f():\n    conn.execute()\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("use.py::f")!.purity).toBe(Purity.IMPURE);
  });

  it("A2 TS 导出单例：export const db = new Pool(); db.query()", async () => {
    const root = project("dfa2", {
      "db.ts": "export class Pool { query(q: string) { console.log(q); } }\nexport const db = new Pool();\n",
      "use.ts": "import { db } from './db';\nexport function run() { db.query('DELETE'); }\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("use.ts::run")!.purity).toBe(Purity.IMPURE);
  });

  it("B 构造器接收者：new Conn().open() → 类成员真边", async () => {
    const root = project("dfb", {
      "db.ts": "export class Conn { open() { console.log('io'); } }\n",
      "use.ts": "import { Conn } from './db';\nexport function run() { return new Conn().open(); }\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("use.ts::run")!.purity).toBe(Purity.IMPURE);
  });

  it("C 链式返回类型：' x '.strip().upper() / ' a '.trim().toLowerCase() → PURE", async () => {
    const root = project("dfc", {
      "a.py": "def f():\n    return ' x '.strip().upper()\n",
      "b.ts": "export function g() { return ' a '.trim().toLowerCase(); }\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("a.py::f")!.purity).toBe(Purity.PURE);
    expect(b.get("b.ts::g")!.purity).toBe(Purity.PURE);
  });

  it("D require 解构：const { go } = require('./lib') → 导出签名解析", async () => {
    const root = project("dfd", {
      "lib.js": "function go() { console.log('x'); }\nmodule.exports = { go };\n",
      "use.js": "const { go } = require('./lib');\nfunction run() { go(); }\nmodule.exports = { run };\n",
    });
    const b = by(await scanProject(root));
    expect(b.get("use.js::run")!.purity).toBe(Purity.IMPURE);
  });
});
