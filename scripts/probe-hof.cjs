// 诊断 T3：Enumerable.ForEach(xs, Save) 回调边
// 用法: node scripts/probe-hof.cjs
const { scanProject } = require("../dist/index.js");
const fs = require("fs");
const os = require("os");
const path = require("path");

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ca-hof-"));
  fs.writeFileSync(path.join(dir, "H.cs"), [
    "public class H {",
    "    static void Save(int x) { System.Console.WriteLine(x); }",
    "    public void Run() { System.Linq.Enumerable.ForEach(new int[] { 1 }, Save); }",
    "}",
  ].join("\n"));
  const r = await scanProject(dir, { useCache: false });
  for (const v of r.verdicts) {
    console.log(v.chunk.name, "purity", v.purity, "effects", [...v.effects], "calls", [...v.chunk.calls].slice(0, 5), "key", v.chunk.key);
  }
  // 检查 H.Save 是否可被裸名解析（bySimple 应该含 "Save"）
  console.log("H.Save key:", r.verdicts.find((v) => v.chunk.name === "H.Save")?.chunk.key);
  // 直接看 H.Run 的原始 calls（含 argFns）
  const run = r.verdicts.find((v) => v.chunk.name === "H.Run");
  console.log("H.Run calls is Set:", run?.chunk.calls instanceof Set, "size:", run?.chunk.calls.size);
  console.log("H.Run calls:", [...(run?.chunk.calls ?? [])].slice(0, 5));
  // 用 analyzeChange 的中间产物看 callOf 提取
  const { defaultPacks } = require("../dist/index.js");
  console.log("packs:", defaultPacks.map((p) => p.name).join(","));
}
main().catch((e) => { console.error(e); process.exit(1); });
