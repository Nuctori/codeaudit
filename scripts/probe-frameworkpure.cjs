// 探针：验证 frameworkPure 在 InitDeity 真实形态下生效
// 用 scanProject 直接扫一个合成目录（与测试同构但走 dist 构建产物）
const { scanProject } = require("../dist/index.js");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ca-iter30-"));
  fs.writeFileSync(path.join(dir, "U.cs"), [
    "public class U {",
    '    public string Encode(string s) { return System.Uri.EscapeDataString(s); }',
    "    public string Linq(int[] xs) { return System.Linq.Enumerable.ToDictionary(xs, x => x, x => x).Count.ToString(); }",
    "}",
  ].join("\n"));
  const r = await scanProject(dir, { useCache: false });
  for (const v of r.verdicts) {
    console.log(`${v.chunk.file}::${v.chunk.name} purity=${v.purity} effects=[${[...v.effects].join(",")}]`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
