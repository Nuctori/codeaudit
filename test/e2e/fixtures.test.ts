import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { Purity, Verdict } from "../../src/core/types";

const FIX = join(__dirname, "..", "fixtures");

function index(report: { verdicts: Verdict[] }): Map<string, Verdict> {
  const m = new Map<string, Verdict>();
  for (const v of report.verdicts) {
    m.set(`${v.chunk.file}::${v.chunk.name}`, v);
  }
  return m;
}

describe("E2E: pyshop（Python）", () => {
  it("传染链：db→service→api 逐层加深，纯函数保持纯，跨文件环终止", async () => {
    const report = await scanProject(join(FIX, "pyshop"));
    const by = index(report);

    // 种子：connect 直接触 sqlite3 → chain 0
    const connect = by.get("db.py::connect")!;
    expect(connect.purity).toBe(Purity.IMPURE);
    expect(connect.chain).toBe(0);
    expect(connect.effects.has("io")).toBe(true);

    // save_user -> connect → chain 1
    expect(by.get("db.py::save_user")!.chain).toBe(1);
    // create_user -> save_user → chain 2
    expect(by.get("service.py::create_user")!.chain).toBe(2);
    // batch_create → chain 3；handle_request → chain 4（副作用藏得最深，排最前）
    expect(by.get("service.py::batch_create")!.chain).toBe(3);
    expect(by.get("api.py::handle_request")!.chain).toBe(4);

    // 纯函数
    expect(by.get("utils.py::validate_user")!.purity).toBe(Purity.PURE);
    expect(by.get("api.py::deep_nesting")!.purity).toBe(Purity.PURE);
    expect(by.get("api.py::deep_nesting")!.chunk.nesting).toBeGreaterThanOrEqual(5);

    // 跨文件相互递归：终止且保持纯
    expect(by.get("cyc_a.py::ping")!.purity).toBe(Purity.PURE);
    expect(by.get("cyc_b.py::pong")!.purity).toBe(Purity.PURE);

    // 未知第三方：weirdlib / mystery 不在任何表 → UNKNOWN
    expect(by.get("worker.py::engage")!.purity).toBe(Purity.UNKNOWN);

    // 排序：IMPURE 组最前者是 chain 最大的 handle_request
    const impures = report.verdicts.filter((v) => v.purity === Purity.IMPURE);
    expect(impures[0]!.chunk.name).toBe("handle_request");
  });
});

describe("E2E: tsapp（TypeScript）", () => {
  it("命名空间导入效应、桶文件再导出跟随、this 方法边、console 效应", async () => {
    const report = await scanProject(join(FIX, "tsapp"));
    const by = index(report);

    // fs.writeFileSync 经 import * as fs → io，chain 0
    const save = by.get("src/db.ts::saveUser")!;
    expect(save.purity).toBe(Purity.IMPURE);
    expect(save.chain).toBe(0);

    // service.ts 从桶文件 ./index 导入 saveUser → 再导出跟随到 db.ts
    const svcSave = by.get("src/service.ts::UserService.save")!;
    expect(svcSave.chain).toBe(1);

    // this.save 解析为类内方法 → batch chain 2
    const batch = by.get("src/service.ts::UserService.batch")!;
    expect(batch.chain).toBe(2);

    // console.log → io（handle 自己是效应源）
    const handle = by.get("src/handler.ts::handle")!;
    expect(handle.purity).toBe(Purity.IMPURE);
    expect(handle.chain).toBe(0);

    // 未知名词 some-lib → UNKNOWN
    expect(by.get("src/handler.ts::risky")!.purity).toBe(Purity.UNKNOWN);

    // 纯工具
    expect(by.get("src/util.ts::titleCase")!.purity).toBe(Purity.PURE);

    // 环终止且纯
    expect(by.get("src/cycA.ts::stepA")!.purity).toBe(Purity.PURE);
    expect(report.stats.cycles).toBeGreaterThanOrEqual(1);
  });
});

describe("E2E: jsapp（JavaScript / CommonJS）", () => {
  it("require 命名空间解析 + fs 效应传播", async () => {
    const report = await scanProject(join(FIX, "jsapp"));
    const by = index(report);

    expect(by.get("store.js::write")!.chain).toBe(0);
    expect(by.get("handler.js::handlePut")!.chain).toBe(1);
    expect(by.get("handler.js::normalize")!.purity).toBe(Purity.PURE);
  });
});

describe("E2E: 缓存", () => {
  it("第二次扫描全部命中缓存且结果一致", async () => {
    const dir = join(FIX, "pyshop");
    const r1 = await scanProject(dir, { useCache: true, cacheDir: join(dir, ".codeaudit-test") });
    const r2 = await scanProject(dir, { useCache: true, cacheDir: join(dir, ".codeaudit-test") });
    expect(r2.stats.cachedFiles).toBe(r1.stats.files);
    expect(JSON.stringify(r1.verdicts.map((v) => [v.chunk.key, v.chain, v.purity]))).toBe(
      JSON.stringify(r2.verdicts.map((v) => [v.chunk.key, v.chain, v.purity])),
    );
  });
});
