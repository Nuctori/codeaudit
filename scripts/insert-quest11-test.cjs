// 在 AutopilotPureDecisionsTests.cs 类闭合前插入新测试（CRLF 兼容）
const fs = require("fs");
const p = "J:/旧宇宙/代码仓库/InitDeity/Assets/InitDeity/Tests/Unit/AutopilotPureDecisionsTests.cs";
let s = fs.readFileSync(p, "utf8");
const nl = s.includes("\r\n") ? "\r\n" : "\n";
const newTest = nl + "        [Test]" + nl +
  "        public void Quest11Priority_OutsideEntrance_ReturnsDefaultPlus1000()" + nl +
  "        {" + nl +
  "            // 迭代36 converge 审计：非山洞世界 + 入口触发器路径 → defaultPriority + 1000" + nl +
  "            // （生产 RuntimeMainlineAutopilot.cs L7835-7837 末分支——外部靠近入口的引导提升）" + nl +
  "            Assert.AreEqual(1005, AutopilotPureDecisions.GetQuest11InteractivePriority(" + nl +
  "                11," + nl +
  '                "LingWorld/区域2/区块0_初始之地/区块0_初始之地/入口/触发器",' + nl +
  "                5, \"区块0_初始之地\"));" + nl +
  "        }" + nl;
const marker = "    }" + nl + "}" + nl;
const idx = s.lastIndexOf(marker);
if (idx === -1) { console.error("marker not found; tail:", JSON.stringify(s.slice(-40))); process.exit(1); }
s = s.slice(0, idx) + newTest + nl + "    }" + nl + "}" + nl;
fs.writeFileSync(p, s);
console.log("inserted at", idx, "nl:", JSON.stringify(nl));
