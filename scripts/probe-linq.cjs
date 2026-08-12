// 探针2：区分 Linq 带 lambda 与不带 lambda 的判定
const { scanProject } = require("../dist/index.js");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ca-iter30b-"));
  fs.writeFileSync(path.join(dir, "L.cs"), [
    "public class L {",
    "    public int Count1(int[] xs) { return System.Linq.Enumerable.Count(xs); }",
    "    public int Count2(int[] xs) { return System.Linq.Enumerable.Count(xs, x => x > 0); }",
    "}",
  ].join("\n"));
  const r = await scanProject(dir, { useCache: false });
  for (const v of r.verdicts) {
    if (v.chunk.name.startsWith("L.") || v.chunk.name === "L") {
      console.log(`${v.chunk.name} purity=${v.purity} effects=[${[...v.effects].join(",")}]`);
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
