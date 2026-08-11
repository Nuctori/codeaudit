#!/usr/bin/env node
/**
 * 标注生成侧护栏（迭代21 T2——ground truth 驱动：PURE 标注 24-32% 准确率根因）：
 * 标注前预检——PURE 目标方法体含 Unity 状态操作/日志/await RPC/资产加载 → 标记风险；
 * IMPURE 目标方法体无任何效应 token → 标记风险。防白费标注（接收侧 annotationRejected 已兜底）。
 *
 * 用法：node scripts/guard-annotations.cjs <scan-report.json> <annotations.json>
 * 输出：风险标注清单（stderr）+ 退出码 0（仅报告，不自动改——标注者裁决）。
 */
const fs = require("fs");
const path = require("path");

const [reportPath, annPath] = process.argv.slice(2);
if (!reportPath || !annPath) {
  console.error("用法: guard-annotations.cjs <scan-report.json> <annotations.json>");
  process.exit(2);
}

let report;
let ann;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  ann = JSON.parse(fs.readFileSync(annPath, "utf8"));
} catch (e) {
  console.error(`读取失败: ${e.message}`);
  process.exit(2);
}
const byId = new Map(report.verdicts.map((v) => [v.chunk.id, v]));
const root = report.root ?? ".";

// PURE 风险信号（ground truth 误标主力：Unity 状态操作/日志/异步/资产/遥测）
const PURE_RISK = [
  /\.SetActive\(/i, /Destroy\(/i, /Instantiate\(/i, /transform\./i, /DOTween|DOFade|DOAnchor/i,
  /\.position\s*=/i, /\.rotation\s*=/i, /Debug\.(Log|LogError|LogWarning)/i,
  /await\s+\w+.*(Async|Rpc|RPC)/i, /DataCollect|\.Track\(/i, /Resources\.Load/i,
  /AssetBundle|LoadCachedSprites|LoadAsset/i, /PlayerPrefs/i, /File\./i,
  /EditorPrefs|ApplyModifiedProperties/i, /\.localScale\s*=/i, /\.isKinematic/i,
];
// IMPURE 风险信号（误标主力：纯字符串/遍历/pass-through 被整类标）
const IMPURE_RISK = [/^\s*(return|throw|if|for|foreach|while)\b/i];

let riskCount = 0;
for (const a of ann) {
  const v = byId.get(a.id);
  if (!v) continue;
  let body = "";
  try {
    body = fs.readFileSync(path.join(root, v.chunk.file), "utf8")
      .split("\n").slice(v.chunk.startLine - 1, v.chunk.endLine).join("\n");
  } catch { continue; }
  const risks = [];
  if (a.verdict === "PURE") {
    for (const re of PURE_RISK) if (re.test(body)) { risks.push(re.source); break; }
  } else if (a.verdict === "IMPURE") {
    if (IMPURE_RISK.every((re) => re.test(body))) risks.push("方法体无效应调用迹象（纯字符串/遍历？）");
  }
  if (risks.length > 0) {
    riskCount++;
    console.error(`⚠ ${a.verdict} ${v.chunk.name} @ ${v.chunk.file}:${v.chunk.startLine} — ${risks[0]}`);
  }
}
console.error(`护栏检查：${ann.length} 条标注，${riskCount} 条风险（标注者复核——不自动改）`);
