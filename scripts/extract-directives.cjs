// 提取 tree-sitter-c_sharp.wasm 中的 directive 节点类型（O-C5/O-C6 机检数据源）
const fs = require("fs");
const data = fs.readFileSync(
	"node_modules/tree-sitter-wasms/out/tree-sitter-c_sharp.wasm",
);
const bytes = data.toString("latin1");
const re = /[a-z_]*directive[a-z_]*/g;
const names = new Set();
let m;
while ((m = re.exec(bytes))) names.add(m[0]);
console.log(JSON.stringify([...names].sort()));
