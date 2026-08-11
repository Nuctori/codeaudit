import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "./dist/index.js";

const dir = mkdtempSync(join(tmpdir(), "iter19-probe2-"));
const root = join(dir, "p");
function w(f, c) { const p = join(root, f); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, c); }

// A: only this.Help() -> branch-1 path
w("A.cs", `public class A {
    public void Run() { this.Help(); }
    public void Help() { Debug.Log("x"); }
}`);
// B: only this.gameObject.SetActive -> frameworkIo path
w("B.cs", `public class B {
    public void Run() { this.gameObject.SetActive(false); }
}`);
// C: bare gameObject.SetActive (no this)
w("C.cs", `public class C {
    public void Run() { gameObject.SetActive(false); }
}`);
// D: fully-qualified System.IO.File.WriteAllText / System.Console.WriteLine
w("D.cs", `public class D {
    public void W() { System.IO.File.WriteAllText("x", "y"); }
    public void L() { System.Console.WriteLine("hi"); }
}`);
// E: bare File.WriteAllText with using
w("E.cs", `using System.IO;
public class E {
    public void W() { File.WriteAllText("x", "y"); }
}`);
// F: new GameObject()
w("F.cs", `public class F {
    public void Run() { var g = new GameObject(); }
}`);
// G: generic bare call GetComponent<T>()
w("G.cs", `public class G {
    public void Run() { GetComponent<UnityEngine.Collider>(); }
}`);
// H: implicitThis inside local function (ownerClass guard)
w("H.cs", `public class H {
    public void Run() {
        void inner() { Helper2(); }
        inner();
    }
    public void Helper2() { Debug.Log("x"); }
}`);
// I: static-vs-instance: static method bare-calling instance method (false edge possible)
w("I.cs", `public class I {
    public static void S() { Touch(); }
    public void Touch() { Debug.Log("t"); }
}`);

const r = await scanProject(root, { useCache: false });
const byN = new Map();
for (const v of r.verdicts) byN.set(v.chunk.file + "::" + v.chunk.name, v);
const show = (f, n) => { const v = byN.get(f + "::" + n); console.log(`${f}::${n} purity=${v?.purity} effects=${v ? [...v.effects].join(",") : "???"}`); };
show("A.cs", "A.Run");
show("B.cs", "B.Run");
show("C.cs", "C.Run");
show("D.cs", "D.W"); show("D.cs", "D.L");
show("E.cs", "E.W");
show("F.cs", "F.Run");
show("G.cs", "G.Run");
show("H.cs", "H.Run");
show("I.cs", "I.S");
console.log("stats:", JSON.stringify(r.stats));
rmSync(dir, { recursive: true, force: true });
