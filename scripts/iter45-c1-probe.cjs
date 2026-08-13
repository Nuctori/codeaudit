// iter45 C1 反例探针 v12：类 chunk 字段结构（ownerClass/kind）
const { scanProject } = require("../dist/index.js");

const fixtureDir = "X:/tmp/iter45-c1-probe2";

scanProject(fixtureDir, { strict: false })
	.then((res) => {
		for (const item of res.verdicts) {
			const c = item.chunk;
			console.log(
				"name:",
				c.name,
				"| ownerClass:",
				JSON.stringify(c.ownerClass),
				"| kind:",
				JSON.stringify(c.kind),
				"| key:",
				c.key,
			);
		}
	})
	.catch((e) => {
		console.error("ERR", e);
		process.exit(1);
	});
