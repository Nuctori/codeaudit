// AST probe: how does `this.gameObject.SetActive(false)` parse in tree-sitter-c_sharp?
import { initParser, loadLanguage } from "./dist/loader.js";

const ParserCtor = await initParser();
const lang = await loadLanguage({ wasm: "tree-sitter-c_sharp.wasm" }, ParserCtor);
const parser = new ParserCtor();
parser.setLanguage(lang);
const src = `public class M : MonoBehaviour {
    void Update() { this.gameObject.SetActive(false); this.transform.Translate(1,0,0); }
}`;
const tree = parser.parse(src);
const dump = (n, depth) => {
  console.log("  ".repeat(depth) + n.type + (n.type === "identifier" || n.type === "property_identifier" || n.type === "this" || n.type === "this_expression" ? ` [${n.text}]` : ""));
  for (const c of n.children) dump(c, depth + 1);
};
const inv = [];
const walk = (n) => { if (n.type === "invocation_expression") inv.push(n); for (const c of n.children) walk(c); };
walk(tree.rootNode);
for (const i of inv) {
  const fn = i.childForFieldName("function") ?? i.children[0];
  console.log("--- invocation, function type =", fn.type, "text=", fn.text);
  dump(fn, 1);
}
