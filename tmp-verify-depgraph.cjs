const vm = require("node:vm");
const { renderModuleGraphPanel } = require("./dist/core/depgraph.js");
const v = (file, name) => ({
	chunk: {
		id: name, key: `${file}::${name}`, name, file, line: 1, endLine: 1,
		nesting: 0, complexity: 1, kind: "function", direct: [], calls: [],
		unknownSites: 0, unknownCalls: [], thrownTypes: [], catches: [], stateWrites: [],
	},
	purity: 0, effects: [], chain: 0, chainDev: 0, chainCertain: true,
	chainPath: [], throwsTypes: [], stateDeps: [], provenance: "unknown",
});
const verdicts = [
	v("__proto__/B.cs", "B"), v("__proto__/C.cs", "C"), v("__proto__/D.cs", "D"),
];
const html = renderModuleGraphPanel(verdicts);
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.log("no script block"); process.exit(1); }
const run = (code) => {
	const holder = { innerHTML: "" }, win = {};
	new vm.Script(code).runInNewContext({
		window: win, document: { getElementById: () => holder },
	});
	return { holder, win };
};
// 场景 A：删掉函数声明（模拟 a39fadf 的 Blocker-1）→ 编译期 SyntaxError
try {
	run(m[1].replace("function depgraphNav(id, parentPath) {", ""));
	console.log("A: NO THROW (bad)");
} catch (e) {
	console.log(`A: throws ${e.constructor.name} (good, test would be red)`);
}
// 场景 B：pos 改回普通对象（模拟修复前原型污染）→ 运行期 TypeError
try {
	run(m[1].replaceAll("var pos = Object.create(null);", "var pos = {};"));
	console.log("B: NO THROW (bad)");
} catch (e) {
	console.log(`B: throws ${e.constructor.name} (good, test would be red)`);
}
// 场景 C：当前修复状态应正常执行
try {
	const { holder, win } = run(m[1]);
	console.log(`C: renders ok, DEPGRAPH_DATA set: ${!!win.__DEPGRAPH_DATA}, holder has __proto__: ${holder.innerHTML.includes("__proto__")}`);
} catch (e) {
	console.log(`C: throws ${e.message}`);
}
