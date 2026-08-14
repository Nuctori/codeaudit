import { describe, expect, it } from "vitest";
import {
	moduleGraph,
	moduleKeyOf,
	renderModuleGraphPanel,
	renderModuleGraphSvg,
} from "../../src/core/depgraph";
import type { Verdict } from "../../src/core/types";

const v = (file: string, name: string, calls: string[]): Verdict =>
	({
		chunk: {
			id: name,
			key: `${file}::${name}`,
			name,
			file,
			line: 1,
			endLine: 1,
			nesting: 0,
			complexity: 1,
			kind: "function",
			direct: [],
			calls,
			unknownSites: 0,
			unknownCalls: [],
			thrownTypes: [],
			catches: [],
			stateWrites: [],
		},
		purity: 0,
		effects: [],
		chain: 0,
		chainDev: 0,
		chainCertain: true,
		chainPath: [],
		throwsTypes: [],
		stateDeps: [],
		provenance: "unknown",
	}) as unknown as Verdict;

// 每个模块 ≥3 chunks 才不被并入 "…其他" 桶（聚合门槛与生产口径一致）
const fw = (name: string, calls: string[] = []) =>
	v(`Assets/InitDeity/Framework/${name}.cs`, name, calls);
const wd = (name: string, calls: string[] = []) =>
	v(`Assets/InitDeity/Worlds/${name}.cs`, name, calls);
const ui = (name: string, calls: string[] = []) =>
	v(`Assets/InitDeity/UIs/${name}.cs`, name, calls);

describe("moduleKeyOf", () => {
	it("第一方按 Assets/InitDeity/<二级> 聚合", () => {
		expect(moduleKeyOf("Assets/InitDeity/Framework/Module/UI/UI.cs")).toBe(
			"InitDeity/Framework",
		);
		expect(moduleKeyOf("Assets/InitDeity/Worlds/StartWorld/X.cs")).toBe(
			"InitDeity/Worlds",
		);
	});
	it("Tests 并入统一桶", () => {
		expect(moduleKeyOf("Assets/InitDeity/Tests/Editor/X.cs")).toBe(
			"InitDeity/Tests",
		);
		expect(moduleKeyOf("Assets/InitDeity/Tests/PlayMode/Y.cs")).toBe(
			"InitDeity/Tests",
		);
	});
	it("根文件与第三方归顶层", () => {
		expect(moduleKeyOf("Assets/InitDeity/README.md")).toBe("InitDeity");
		expect(moduleKeyOf("Assets/ChillyRoomSdkClient/ApiClientHelper.cs")).toBe(
			"ChillyRoomSdkClient",
		);
		expect(moduleKeyOf("LocalPackages/com.cysharp.unitask/Runtime/T.cs")).toBe(
			"LocalPackages/com.cysharp.unitask",
		);
		expect(moduleKeyOf("Assets/Plugins/Demigiant/DOTween/DOTween.cs")).toBe(
			"Plugins/Demigiant",
		);
		expect(moduleKeyOf("Tools/HeadlessValidationRunner/Program.cs")).toBe(
			"Tools/HeadlessValidationRunner",
		);
		// 交叉审计 D1：*.g.cs 生成代码统一归生成桶，防冒充模块（API.g.cs 2503 chunks 单文件）
		expect(moduleKeyOf("Assets/ChillyRoomSdkClient/InitDeity/API.g.cs")).toBe(
			"InitDeity/Generated",
		);
	});
});

describe("moduleGraph", () => {
	it("聚合边 + 环内边标逆行", () => {
		// Framework ⇄ Worlds 双向调用 → 聚合环，环内边标 reverse
		const verdicts = [
			fw("A", [`Assets/InitDeity/Worlds/B.cs::B`]),
			fw("C"),
			fw("D"),
			wd("B", [`Assets/InitDeity/Framework/C.cs::C`]),
			wd("E"),
			wd("F"),
		];
		const g = moduleGraph(verdicts);
		expect(g.sccs.length).toBe(1);
		expect([...g.sccs[0]!].sort()).toEqual([
			"InitDeity/Framework",
			"InitDeity/Worlds",
		]);
		const rev = g.edges.filter((e) => e.reverse);
		expect(rev.length).toBe(1); // 双向聚合为单条边（a2b + b2a 双计数）
		const fwEdge = g.edges.find(
			(e) => e.from === "InitDeity/Framework" && e.to === "InitDeity/Worlds",
		);
		expect(fwEdge?.reverse).toBe(true);
		expect(fwEdge?.a2b).toBe(1);
		expect(fwEdge?.b2a).toBe(1);
	});
	it("单向依赖不标逆行", () => {
		const verdicts = [
			fw("A", [`Assets/InitDeity/UIs/B.cs::B`]),
			fw("C"),
			fw("D"),
			ui("B"),
			ui("E"),
			ui("F"),
		];
		const g = moduleGraph(verdicts);
		expect(g.sccs.length).toBe(0);
		expect(g.edges.every((e) => !e.reverse)).toBe(true);
	});
	it("未知目标与自调用不产生模块边", () => {
		const verdicts = [
			fw("A", ["?", `Assets/InitDeity/Framework/A.cs::A`]),
			fw("C"),
			fw("D"),
		];
		const g = moduleGraph(verdicts);
		expect(g.edges.length).toBe(0);
		expect(g.nodes.find((n) => n.id === "InitDeity/Framework")?.selfCalls).toBe(
			1,
		);
	});
	it("firstPartyOnly 折叠第三方内部互环为单桶", () => {
		// 第三方内部互环：unitask ⇄ unirx（只可升级不可重构）；第一方单向依赖 unitask
		const t = (n: string, calls: string[] = []) =>
			v(`LocalPackages/com.cysharp.unitask/Runtime/${n}.cs`, n, calls);
		const x = (n: string, calls: string[] = []) =>
			v(`LocalPackages/com.neuecc.unirx/Operators/${n}.cs`, n, calls);
		const verdicts = [
			fw("A", [`LocalPackages/com.cysharp.unitask/Runtime/T.cs::T`]),
			fw("C"),
			fw("D"),
			t("T", [`LocalPackages/com.cysharp.unitask/Runtime/U.cs::U`]),
			t("U", [`LocalPackages/com.neuecc.unirx/Operators/W.cs::W`]),
			t("V"),
			x("W", [`LocalPackages/com.cysharp.unitask/Runtime/T.cs::T`]),
			x("X"),
			x("Y"),
		];
		const all = moduleGraph(verdicts);
		expect(all.sccs.length).toBe(1); // 全量口径：unitask ⇄ unirx 互环（第三方噪音）
		const fp = moduleGraph(verdicts, { firstPartyOnly: true });
		expect(fp.nodes.some((n) => n.id === "第三方")).toBe(true);
		expect(fp.nodes.find((n) => n.id === "第三方")?.chunks).toBe(6);
		expect(fp.sccs.length).toBe(0); // 折叠后无环——第三方互环不污染第一方逆行
		expect(fp.edges.every((e) => !e.reverse)).toBe(true);
	});
	it("白名单反推：Assets 下未列入目录（UltimateSafeArea 插件）折叠进第三方", () => {
		const verdicts = [
			fw("A", [`Assets/UltimateSafeArea/Scripts/SafeArea.cs::S`]),
			fw("C"),
			fw("D"),
			v("Assets/UltimateSafeArea/Scripts/SafeArea.cs", "S", []),
			v("Assets/UltimateSafeArea/Scripts/Util.cs", "U", []),
			v("Assets/UltimateSafeArea/Scripts/Ext.cs", "E", []),
		];
		const fp = moduleGraph(verdicts, { firstPartyOnly: true });
		expect(fp.nodes.some((n) => n.id === "第三方")).toBe(true);
		expect(fp.nodes.some((n) => n.id === "UltimateSafeArea")).toBe(false);
		expect(fp.nodes.find((n) => n.id === "第三方")?.chunks).toBe(3);
	});
	it("孤立节点渲染虚线（静态盲区/真实孤立标注）", () => {
		const verdicts = [
			fw("A", [`Assets/InitDeity/UIs/B.cs::B`]),
			fw("C"),
			fw("D"),
			ui("B"),
			ui("E"),
			ui("F"),
			// 无任何跨模块边的模块：只有内部调用
			v("Assets/InitDeity/Vfx_Test/Test.cs", "T", ["?"]),
			v("Assets/InitDeity/Vfx_Test/Test2.cs", "T2", []),
			v("Assets/InitDeity/Vfx_Test/Test3.cs", "T3", []),
		];
		const g = moduleGraph(verdicts, { firstPartyOnly: true });
		const svg = renderModuleGraphSvg(g);
		expect(svg).toContain('stroke-dasharray="5,4"'); // 孤立节点虚线
		expect(svg).toContain("无跨模块边"); // tip 标注
	});
	it("双向边渲染反向虚线弧 + tip 逆行强度与节点 top 来源/去向", () => {
		const verdicts = [
			fw("A", [`Assets/InitDeity/Worlds/B.cs::B`]),
			fw("C"),
			fw("D"),
			fw("E"),
			wd("B", [`Assets/InitDeity/Framework/C.cs::C`]),
			wd("F"),
			wd("G"),
		];
		const g = moduleGraph(verdicts);
		const svg = renderModuleGraphSvg(g);
		expect(svg).toContain('stroke-dasharray="6,4"'); // 反向虚线弧
		expect(svg).toContain("逆行强度 50%"); // tip：反向 1/合计 2
		expect(svg).toContain("→ InitDeity/Worlds×2"); // 节点 top 去向
		expect(svg).toContain("← InitDeity/Framework×2"); // 节点 top 来源
	});
	it("scope 子图：scope 内模块级键 + scope 外折叠为外部桶", () => {
		const verdicts = [
			fw("A", [`Assets/InitDeity/UIs/B.cs::B`]), // scope 外调用 → 外部桶
			fw("C"),
			fw("D"),
			ui("B"), // scope 外目标文件（≥3 个外部文件才不进 …其他 桶）
			ui("E"),
			ui("F"),
			v("Assets/InitDeity/Framework/Module/Online/N.cs", "N", []),
			v("Assets/InitDeity/Framework/Module/Online/M.cs", "M", []),
			v("Assets/InitDeity/Framework/Module/Online/O.cs", "O", []),
			v("Assets/InitDeity/Framework/NonModule/P.cs", "P", []),
			v("Assets/InitDeity/Framework/NonModule/Q.cs", "Q", []),
			v("Assets/InitDeity/Framework/NonModule/R.cs", "R", []),
		];
		const sub = moduleGraph(verdicts, {
			firstPartyOnly: true,
			scope: "InitDeity/Framework",
		});
		expect(sub.nodes.some((n) => n.id === "InitDeity/Framework/Module")).toBe(
			true,
		);
		expect(sub.nodes.some((n) => n.id === "外部")).toBe(true); // UIs 调用折叠为外部
		expect(sub.nodes.some((n) => n.id === "InitDeity/Framework")).toBe(true); // Framework 根
	});
});

describe("render", () => {
	it("SVG 含环内红色边与节点，HTML panel 含图例", () => {
		const verdicts = [
			fw("A", [`Assets/InitDeity/Worlds/B.cs::B`]),
			fw("C"),
			fw("D"),
			wd("B", [`Assets/InitDeity/Framework/C.cs::C`]),
			wd("E"),
			wd("F"),
		];
		const g = moduleGraph(verdicts);
		const svg = renderModuleGraphSvg(g);
		expect(svg).toContain("<svg");
		expect(svg).toContain('stroke="#e5484d"'); // 逆行红色
		expect(svg).toContain("InitDeity/Framework");
		const html = renderModuleGraphPanel(verdicts);
		expect(html).toContain("逆行");
		expect(html).toContain("模块级环");
		expect(html).toContain("__DEPGRAPH_DATA"); // 交互数据内嵌
		expect(html).toContain("depgraphNav"); // + 下钻函数
		expect(html).toContain("‹ 返回上级"); // 面包屑返回
	});
});
