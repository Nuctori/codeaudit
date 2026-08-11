#!/usr/bin/env node
/**
 * codeaudit 库 API 示例（生产用法）：扫描 + 影响面 + 回归风险 + 证明完整度。
 *
 * 运行：node examples/api-demo.js [目录]（缺省扫描自身 src）
 */
const path = require("node:path");
const { scanProject, analyzeChange, riskOfChange, proofCompleteness, graphMetrics } = require("..");

async function main() {
  const root = process.argv[2] ?? path.join(__dirname, "..", "src");

  // 1. 扫描（纯度判定 + 传染链）
  const report = await scanProject(root, { useCache: false });
  const { pure, impure, unknown, unknownRate } = report.stats;
  console.log(`[scan] ${report.stats.chunks} chunks / ${report.stats.files} files`);
  console.log(`  pure ${pure} / impure ${impure} / unknown ${unknown} (unknown-rate ${(unknownRate * 100).toFixed(1)}%)`);

  // 2. diff 影响面：改动哪些文件，直接/传递影响哪些调用者
  const changed = report.verdicts.slice(0, 3).map((v) => v.chunk.file);
  const impact = await analyzeChange(root, changed);
  console.log(`[analyzeChange] ${changed.join(", ")} → ${impact.summary.affectedChunks} 个受影响调用者`);

  // 3. 回归风险（六因子 L×C）
  const risk = riskOfChange(report.verdicts, new Set(changed));
  console.log(`[riskOfChange] ${risk.risk.toFixed(1)}/100 [${risk.grade}]`);
  console.log(`  因子: ${JSON.stringify(risk.factors)}`);
  console.log(`  证据质量: 未知率 ${(risk.evidence.unknownRate * 100).toFixed(1)}% / 未解析站点 ${(risk.evidence.missingSiteRate * 100).toFixed(1)}%`);

  // 4. 证明完整度（Θ：标注多少未知到完整）
  const proof = proofCompleteness(report.verdicts, { weighted: true, targetTheta: 0.9 });
  console.log(`[proofCompleteness] Θ=${proof.theta.toFixed(3)} 标到 0.9 需 ${proof.budgetToTarget ?? "不可达"} 条`);

  // 5. 拓扑健康度
  const topo = graphMetrics(report.verdicts);
  console.log(`[graphMetrics] 密度 ${topo.density.toFixed(3)} / 环 ${topo.cyclicComponents} / 深度 ${topo.dagDepth} / 自环 ${topo.selfLoopCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
