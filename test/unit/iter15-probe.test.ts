import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../../src/index";
import { Purity } from "../../src/core/types";

function dump(r: { verdicts: Array<{ chunk: { file: string; name: string; key: string; calls: Set<string>; stateWrites: string[] }; purity: Purity }> }, label: string) {
  console.log(`--- ${label}`);
  for (const v of r.verdicts) {
    console.log(
      `${v.chunk.file}::${v.chunk.name} purity=${v.purity} calls=[${[...v.chunk.calls].join(",")}] writes=[${v.chunk.stateWrites.join(",")}]`,
    );
  }
}

describe("iter-15 probe: CJS export chunk boundary (extractor.cjsExportName @1ed878a)", () => {
  it("a) arrow / anonymous function / two-level member forms build chunks; identifier RHS does not", async () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-a-"));
    writeFileSync(
      join(dir, "forms.js"),
      [
        "exports.arrow = () => { return 1; };",
        "exports.anon = function () { return 2; };",
        "module.exports.qual = function () { return 3; };",
        "module.exports.ident = importedFn;",
        "function importedFn() { return 4; }",
      ].join("\n"),
    );
    writeFileSync(join(dir, "use.js"), [
      "const { arrow, anon, qual, ident } = require('./forms');",
      "function use() { return arrow() + anon() + qual() + ident(); }",
      "module.exports = { use };",
    ].join("\n"));
    const r = await scanProject(dir, { useCache: false });
    dump(r as never, "probe a");
    const names = new Set(r.verdicts.map((v) => v.chunk.name));
    expect(names.has("arrow")).toBe(true); // arrow_function RHS → chunk
    expect(names.has("anon")).toBe(true); // function expression RHS → chunk
    expect(names.has("qual")).toBe(true); // two-level member + function literal → chunk
    expect(names.has("ident")).toBe(false); // identifier RHS → NO chunk (documented boundary)
    expect(names.has("importedFn")).toBe(true); // function_declaration chunk unaffected
    const use = r.verdicts.find((v) => v.chunk.name === "use")!;
    const arrow = r.verdicts.find((v) => v.chunk.name === "arrow")!;
    const anon = r.verdicts.find((v) => v.chunk.name === "anon")!;
    const qual = r.verdicts.find((v) => v.chunk.name === "qual")!;
    // destructure-require resolution: arrow/anon/qual resolve (from-import), ident cannot
    expect(use.chunk.calls.has(arrow.chunk.key)).toBe(true);
    expect(use.chunk.calls.has(anon.chunk.key)).toBe(true);
    expect(use.chunk.calls.has(qual.chunk.key)).toBe(true);
    expect(use.purity).toBe(Purity.UNKNOWN); // ident() unresolvable → honest ?
    rmSync(dir, { recursive: true, force: true });
  });

  it("b) same-name conflict: exports.foo = fn + function foo(){}", async () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-b-"));
    writeFileSync(
      join(dir, "conflict.js"),
      [
        "exports.foo = () => { return 1; };",
        "function foo() { return 2; }",
        "function caller() { return foo(); }",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "use.js"),
      "const { foo } = require('./conflict');\nfunction use() { return foo(); }\n",
    );
    const r = await scanProject(dir, { useCache: false });
    dump(r as never, "probe b");
    const foos = r.verdicts.filter((v) => v.chunk.name === "foo");
    expect(foos.length).toBe(2); // two chunks, same display name
    expect(new Set(foos.map((v) => v.chunk.key)).size).toBe(2); // distinct content-hash keys → no key collision
    // bare-name call inside file and from-import both pick bySimple[0] (first in AST order)
    const caller = r.verdicts.find((v) => v.chunk.name === "caller")!;
    const firstFoo = foos[0]!;
    expect(caller.chunk.calls.has(firstFoo.chunk.key)).toBe(true);
    expect(caller.chunk.calls.size).toBe(1); // second foo silently shadowed
    const use = r.verdicts.find((v) => v.chunk.name === "use")!;
    expect(use.chunk.calls.has(firstFoo.chunk.key)).toBe(true);
    expect(use.chunk.calls.size).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it("c) exports.x = require('./y') (RHS non-function) builds no chunk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "probe-c-"));
    writeFileSync(join(dir, "y.js"), "module.exports = function yf() { return 9; };\n");
    writeFileSync(join(dir, "reexp.js"), "exports.x = require('./y');\n");
    const r = await scanProject(dir, { useCache: false });
    dump(r as never, "probe c");
    const reexp = r.verdicts.filter((v) => v.chunk.file.endsWith("reexp.js"));
    expect(reexp.some((v) => v.chunk.name === "x")).toBe(false); // no chunk from reexport
    const mod = reexp.find((v) => v.chunk.name === "<module>")!;
    expect(mod.chunk.calls.size).toBeGreaterThanOrEqual(1); // require('./y') call kept
    rmSync(dir, { recursive: true, force: true });
  });
});
