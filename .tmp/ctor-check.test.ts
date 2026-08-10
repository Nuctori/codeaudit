import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "../src/index";
import { Purity } from "../src/core/types";

describe("ctor body check", () => {
  it("Conn() with io in __init__", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ctor-"));
    const root = join(dir, "p");
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, "db.py"), "class Conn:\n    def __init__(self):\n        print('io')\n");
    writeFileSync(join(root, "use.py"), "from db import Conn\ndef f():\n    return Conn()\n");
    const r = await scanProject(root);
    const f = r.verdicts.find((v) => v.chunk.name === "f")!;
    console.log("f purity:", f.purity, "chain:", f.chain);
    expect(f.purity).toBe(Purity.PURE);
    rmSync(dir, { recursive: true, force: true });
  });
});
