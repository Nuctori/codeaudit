// iter-19 review probe (read-only, temp file outside repo tree? no—in repo, deleted after)
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanProject } from "./dist/index.js";

const dir = mkdtempSync(join(tmpdir(), "iter19-probe-"));
const root = join(dir, "p");
function w(f, c) { const p = join(root, f); mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, c); }

// 1. dead table entries: bare Instantiate/Destroy (obj=null)
w("A.cs", `public class A {
    public void Spawn() { Instantiate(null); Destroy(null); }
    public void Log() { Debug.Log("x"); }
}`);
// 2. cross-language: Python class Foo; C# calls Foo.bar() (no using/import)
w("Foo.py", `class Foo:
    def bar(self):
        return 1
`);
w("B.cs", `public class B {
    public void Run() { Foo.bar(); }
}`);
// 3. same-name class in two files -> ambiguity
w("C1.cs", `public class Dup { public void M() { } }`);
w("C2.cs", `public class Dup { public void M() { } }`);
w("C3.cs", `public class D { public void Run() { Dup.M(); } }`);
// 4. moduleAssigned shadow: module-level rebinding of class name
w("E.cs", `public class Svc { public void Save() { File.WriteAllText("x", "y"); } }
public class E { public void Run() { Svc.Save(); } }
`);
// module-level reassign can't happen in C# at module scope like JS... skip, probe via python instead
// 5. implicitThis + this.x branch1 + frameworkIo this
w("M.cs", `public class Mono : UnityEngine.MonoBehaviour {
    void Update() { Tick(); this.Help(); this.gameObject.SetActive(false); this.transform.Translate(1,0,0); }
    void Tick() { }
    void Help() { }
}`);
// 6. DateTime.Parse / Path.Combine over-judgment
w("D.cs", `using System;
public class D2 {
    public DateTime Parse(string s) { return DateTime.Parse(s); }
    public string C(string a, string b) { return System.IO.Path.Combine(a, b); }
    public DateTime Now() { return DateTime.Now; }
}`);
// 7. project class colliding with pureGlobals: "Math" with impure method
w("Math.cs", `public class Math {
    public int F() { System.Console.WriteLine("side"); return 1; }
}`);
w("M2.cs", `public class M2 { public int Run() { return Math.F(); } }`);
// 8. TS implicitThis unaffected: bare call in class method resolves to top-level only
w("t.ts", `function top() { return 1; }
class T { m() { return top() + q(); } q() { return 2; } }`);
// 9. multi-file same class name via python too, plus globalClasses python->csharp cross-lang
w("Net.cs", `public class Net { public void Send() { } }`);
w("u.py", `class Net:
    def send(self):
        pass
def go():
    Net.send()
`);

const r = await scanProject(root, { useCache: false });
const byN = new Map();
for (const v of r.verdicts) byN.set(v.chunk.file + "::" + v.chunk.name, v);
const show = (f, n) => { const v = byN.get(f + "::" + n); console.log(`${f}::${n} purity=${v?.purity} effects=${v ? [...v.effects].join(",") : "???"} unknownSites=${v?.unknownSites}`); };

console.log("== 1 bare Instantiate/Destroy (dead table entries?)");
show("A.cs", "A.Spawn"); show("A.cs", "A.Log");
console.log("== 2 cross-language: python Foo, C# Foo.bar()");
show("B.cs", "B.Run");
console.log("== 3 same-name Dup in C1+C2, D.Run calls Dup.M()");
show("C3.cs", "D.Run");
console.log("== 5 implicitThis + this.x branch1 + frameworkIo");
show("M.cs", "Mono.Update");
console.log("== 6 DateTime/Path over-judgment");
show("D.cs", "D2.Parse"); show("D.cs", "D2.C"); show("D.cs", "D2.Now");
console.log("== 7 project Math class vs pureGlobals");
show("Math.cs", "Math.F"); show("M2.cs", "M2.Run");
console.log("== 8 TS implicitThis false: T.m should NOT resolve q() to method");
show("t.ts", "T.m");
console.log("== 9 cross-lang python Net vs csharp Net; python go()");
show("u.py", "go");
console.log("== stats:", JSON.stringify(r.stats));
rmSync(dir, { recursive: true, force: true });
