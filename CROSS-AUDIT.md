# 交叉审计报告（5 维度独立 subagent）

审计时间：2026-08-09。方法：5 个独立 reviewer（fresh context，互不可见，只读）分别从算法正确性、安全健壮性、语言解析、工程契约、测试质量五个维度审计同一代码库，各自运行测试/探针后汇总结论。交叉确认标记：`[×N]` = N 个独立 agent 各自证实。

## 一、交叉确认的发现（高置信）

### [×4] Windows 路径分隔符泄漏进 chunk.file/key —— 3 个测试在 Windows 必挂

- 位置：`src/engine/scan.ts:46`（`normalize(relative(root, full))`）
- 现象：`chunk.key` 在 Windows 为 `src\db.ts::saveUser`，测试断言硬编码正斜杠。全量测试 73 个中 3 个失败：`test/e2e/fixtures.test.ts:60`、`test/e2e/edge.test.ts:50`、`test/audit/lang-features.test.ts:90`（本会话实测复现：3 failed / 70 passed）。
- 影响：README「两次扫描逐字节一致」仅同机成立；JSON 输出、`--unknowns` 导出、AI 标注锚点、缓存键全部随平台漂移。
- 修复：`discoverFiles` 一处 `relative(...).split(path.sep).join("/")`，python/ts 的 `resolveModule` 候选路径在 `projectFiles.has()` 前同样规范化。

### [×3] hash.ts 注释剥离正则无词法感知 → chunk id 碰撞（公理4 被破坏）

- 位置：`src/core/hash.ts:10-12`（块注释 :10、`//` :11、`#` :12，均为无词法感知的 replace）
- 三个 agent 独立实测的碰撞对：Python `x // 2` vs `x // 3`（整除被当注释）；URL 字符串 `"http://a/x"` vs `"http://b/y"`；TS 私有字段 `this.#a` vs `this.#b`；字符串 `"#tag1"` vs `"#tag2"`；`"/*"+x+"*/"` 中间文本被吞；JS 字符串尾被截断（`"a#b"` 规范化为 `"a`）。
- 影响：内容不同的函数获得同一 `chunk.id` → AI 标注按 id 寻址会落到错误函数上；hash.test.ts 自称「对真实改动敏感」不成立。
- 修复：最简——`chunkId` 直接哈希原始 sourceText（注释/缩进改动会让 id 变，但永不塌缩，保单射方向）；或利用 extractor 已有的 tree-sitter 语法树按节点类型剥离真实注释。

### [×2] 不可扁平化的调用点被静默删除 → 假纯（公理1 边守恒被绕过）

- 位置：`src/lang/extractor.ts:113-115`（`callOf` 对 `flattenCallTarget` 返回 null 直接 return null）
- 场景：`super().save(x)`（子类继承父类效应边整条消失）、`factory()()`、`new X().go()`、`d["k"]()`。实测 `Child.save` 调 `super().save(x)` → calls=[], PURE, chainCertain=true —— 不是 dynamic/UNKNOWN，是什么都不记。
- 附带：`link.ts:140` 的 `dynamicCalls` 只内部计数，从不暴露到报告——动态丢弃完全不可观测。
- 修复：`callOf` 对不可展平 target 至少产出哨兵调用走 markUnknown/markDynamic（保住 audit 悲观性 + 守恒可观测）。

### [×2] 核心算法正确（对照朴素参考验证）

- Tarjan 迭代实现、逆拓扑序、凝聚 DAG 效应传播、audit/dev 双跑语义：agent1 用 300 张随机图对照朴素可达性实现逐一相等；50k 深链 87ms 不爆栈。无 critical 级算法错误。

## 二、单 agent 发现（已动态验证，未交叉复核）

### 安全维度（agent2 重跑）

| 级别 | 发现 | 位置 |
| --- | --- | --- |
| High | **缓存投毒可伪造审计结果**：`.codeaudit/cache.json` 只校验 contentHash+语言名，注入 `chunks:[]` 可使含 `print` 的文件从报告消失（实测）。无签名/结构校验 | `scan.ts:82-91` |
| High | **形状合法但畸形的 cache.json 使整个扫描崩溃**：`facts: null` → `TypeError` 不在 try 内，全扫失败（实测） | `scan.ts:60-64` |
| Med | discoverFiles 无深度上限：8000 层目录 → 栈溢出崩全扫；readdirSync EACCES 未捕获 | `scan.ts:36-49` |
| Med | 无资源上限：10GB 单文件/10 万文件/GB 级缓存 → OOM；`--unknowns` 无边界 | `scan.ts:76,117` |
| Med | 缓存无工具版本/数据表指纹：`version:999` 实测照常命中，升级后陈旧结论静默复用 | `scan.ts:25-28` |
| Med | 缓存写非原子（无 tmp+rename），可被符号链接劫持覆盖文件 | `scan.ts:114-121` |
| Med | Python 绝对导入 O(F) 全扫 projectFiles，10k 文件 × 10 import → 10⁹ 比较 | `python.ts:126-133` |
| Low | 块注释正则恶意输入超线性：1MB 恶意 .py 实测 5.3s（正常 <200ms） | `hash.ts:10` |
| Low | readFileSync 失败静默 continue，用户不知情 | `scan.ts:77-79` |
| Low | parseError 占位也写缓存，瞬时失败永久化 | `scan.ts:111` |
| — | 已验证安全：符号链接/junction 不跟随（Dirent 语义）、无 `..`/glob 穿越、再导出环有深度上限、解析器栈溢出隔离在 try/catch 内、报告不含源码 | |

### 语言维度（agent3）

| 级别 | 发现 | 位置 |
| --- | --- | --- |
| Critical | **from-import 成员调用被静默丢弃 → 假纯（漏报）**：TS `import { db }; db.query()`、Python `from .store import conn; conn.execute()` 的 io 全部丢失（实测 PURE）。README 辩解「obj 是局部变量边不可知」，但这里 obj 是已解析的 import 绑定——把文档限定场景扩大到了可解析场景 | `link.ts:236` |
| High | `export { a as b } from` 别名再导出跟随失败 → 假 UNKNOWN（条件要求 `imported===name`，别名场景永不成立） | `link.ts:106` |
| Med | Python 点连模块 `import a.b; a.b.fn()` 无法解析 → 假 UNKNOWN（`import a.b as b` 却正常） | `link.ts:214-221` |
| Med | `export default <标识符>` 不解析 → 假 UNKNOWN | `extractor.ts` findDefaultExport |
| Med | `export * as ns from` 绑定丢失（ns.alpha() 被当 dynamic 丢弃，`:59-61` 的 `*` 检查吞掉绑定） | `typescript.ts:59-61` |
| Med | nesting 指标箭头函数差一（同逻辑 `function` nest=1 vs `const f=()=>` nest=2），排序键漂移 | `extractor.ts:87-95` |
| Low | `os.path.join()` 纯调用记 io（噪音）；`node:os` 的 `homedir()` 记 UNKNOWN 而 Python `os` 记 io（跨语言不一致）；绝对导入可能错连同名项目文件 | |

### 工程契约维度（agent4）

| 级别 | 发现 | 位置 |
| --- | --- | --- |
| High | **`--strict` 在 Windows + TS/TSX/JS 项目上崩溃**：`:117` 的 `process.exit(1)` 与 web-tree-sitter wasm 句柄关闭竞态 → Assertion failed / exit 127 / 0xC0000409。Python-only 项目正常。改 `process.exitCode = 1` 即修（`:122` 的 exit(2) 同理） | `cli.ts:117` |
| Med | `--top N` 在 JSON 模式被静默忽略（`:87` 的 slice 只在文本分支） | `cli.ts:86-87` |
| Med | unknowns 导出缺 `chunk.id`——公理4 声称「AI 标注按 id 寻址不漂移」，实际导出只有 symbol/file/line | `cli.ts:102-113` |
| Med | 未知旗标吞值：typo 旗标的值被当作扫描目录（`:35` `else if (!a.startsWith("-")) args.dir = a`）→ 误导性 ENOENT | `cli.ts:34-35` |
| Med | README「npm test 73 个测试」在 Windows 不成立；vitest@4 engines 需 Node ≥20 而 package.json 声明 ≥18 | |
| Low | 版本号硬编码 `codeaudit 0.1.0`；无 LICENSE 文件却声明 MIT；cache version 写入不校验 | |
| — | 已验证契约：--help exit 0、不存在目录 exit 2、--strict 退出码矩阵（非 TS 项目）、JSON schema、unknowns 结构、确定性、缓存热扫、tarball 打包、API 与 d.ts 一致 | |

### 测试质量维度（agent5）

| 级别 | 发现 | 位置 |
| --- | --- | --- |
| High | AUDIT.md「维度4 守恒公理」无任何对应测试；且 `analyze.ts:36` 存在静默丢弃陈旧边的路径 | `property.test.ts` |
| Med | 维度25 声称「计入 dynamicCalls」——实际被静默丢弃（与语言维度交叉证实） | `lang-features.test.ts:179-200` |
| Med | 维度17 声称「与朴素参考一致」——测试只断言 chunk 数+耗时，无参考对照 | `adversarial.test.ts:187-204` |
| Med | 维度18/23 断言近乎恒真：`expect([PURE, UNKNOWN]).toContain(...)` 只要不崩溃就过 | `adversarial.test.ts:215-219` |
| Med | link 深度上限（depth>6）可达但零测试；scan 读失败路径、缓存写失败路径零覆盖；pureModules/数组效应表规则零测试 | |
| Low | hash.test.ts「确定性」断言是恒真式（自己比自己）；fixture 缓存残留 `.codeaudit-test` 不清理；id 正则缺 `$` 锚点；时间敏感断言低概率 flaky | |
| — | 声称核实：73 数量准、五层结构实、45 用例准、300 文件/2702 chunks/cycles=1 实、性能实测 ~400ms（声称 1.3s 偏保守）、3 条 bug 修复均有回归测试 ✓ | |

## 三、声称 vs 事实（汇总）

| README/AUDIT.md 声称 | 事实 |
| --- | --- |
| 「73 个测试全部通过」 | 仅 POSIX 成立；Windows 上 3 失败（路径分隔符） |
| 「两次扫描逐字节一致」 | 仅同机成立；跨 OS chunk.file 字节不同 |
| 「audit 模式可靠、不漏报」 | from-import 成员调用、不可扁平化调用静默丢弃 → 存在假纯漏报 |
| 「`--strict` 存在 IMPURE 时退出码 1」 | Windows + TS 项目实际崩溃 exit 127 |
| 「AI 标注按 id 寻址不漂移」 | unknowns 导出不含 id；且 hash 正则碰撞使 id 本身不可靠 |
| 「身份即内容（公理4）」 | 注释剥离正则无词法感知，真实改动可产生同 id |
| 「排序只用字典序（公理5）」 | 实际是多键比较（纯度→chain→nesting→key），确定性但表述不准 |
| 「先凝聚后计算（公理2）/ 纯度三值（公理3）」 | 核心算法经随机图对拍验证正确 ✓ |

## 四、修复优先级（按根因聚合，一处修复覆盖多处）

1. **scan.ts 路径规范化**（`[×4]`）：正斜杠统一 → 修 3 个测试 + 跨平台确定性。
2. **scan.ts 缓存信任边界**（安全 H1/H2/H3）：命中后结构校验 + 工具版本/数据表指纹 + 原子写 → 堵投毒、崩溃、陈旧复用三件事，全在一个文件。
3. **extractor/link 调用守恒**（`[×2]` + 语言 C1）：不可展平 target 产哨兵走 UNKNOWN；from-import 成员调用尝试 `resolveSymbol(target, attr)` → 消除主要假纯来源。
4. **hash.ts 注释剥离**（`[×3]`）：直接哈希原文或按语言选择注释规则 → 修公理4。
5. **cli.ts `process.exitCode`**（工程 H1）：一行修 Windows `--strict` 崩溃。
6. **测试补缺**（测试 H2/M4/M5）：守恒公理断言、深度上限用例、读失败路径。

## 五、残余风险与过程说明

- agent5 修复了损坏的 node_modules（`rm -rf node_modules package-lock.json && npm install`）；**package-lock.json 被重新生成**，仓库无 git 无法比对原内容（依赖版本同 semver 范围，vitest 仍 4.1.10）。
- `--strict` 崩溃仅在 Windows + Node 24 复现；Linux/macOS 行为未实测（根因 `process.exit` + wasm 竞态，跨平台可能均受影响）。
- Node 18 实机运行未验证（本机 v24）；vitest 4 本身要求 Node ≥20。
- 探针均在系统临时目录运行，仓库零改动（除上述 node_modules/lockfile 修复）。
- 行号引用经决策审计轮 `grep -n` 实测复核后修正（python.ts 原引用越界、cli.ts 多处偏移 16-28 行）；机制与结论均不变。

---

# 迭代 2 交叉审计记录（2026-08-10，5 全新视角）

方法：5 个新 reviewer（测试质量/对抗输入/文档消费者/统计数学/维护债务，fresh context 只读）复审 a9d97c9 基线。结论：**不收敛但快速收敛中**——2/5 判收敛（文档消费者、统计），3/5 判不收敛（对抗输入发现 1 Blocker 崩溃、测试质量发现缓存穿透 High、维护债务发现 from-import HOF 假纯 Med）。全部发现已修复（16051d2）。

## 已修复（16051d2，逐项对应）

| 来源 | 级别 | 发现 | 修复 |
| --- | --- | --- | --- |
| 对抗输入 | Blocker | `frameworkIo[call.obj]` 裸下标命中 Object.prototype 继承键（hasOwnProperty/toString/constructor 作接收者）→ `for...of` 函数崩溃，单文件 DoS 整扫 | resolveCall + rootOf 改 `Object.hasOwn` 守卫（link.ts:327,155） |
| 对抗输入 | High | hasError 文件 chunk 以"干净"面貌参与判定：未闭合字符串吞掉后续 import/调用 → 假纯 | parseError 文件 chunk 整体降级 UNKNOWN（`?` 经 eff 集传导给调用者）；修复无标注路径绕过降级的 fallback bug |
| 对抗输入 | Med | 语料 method/root 继承查找 → NaN 先验 + `__proto__` 键污染原型 | bump 用 defineProperty + hasOwn；priorFor/siteShapeInfo 同款守卫 |
| 对抗输入 | Med | Python 绝对导入 O(F×M)（distinct 模块逐文件全扫） | 已记录，basename 索引延后（有界 CPU DoS） |
| 对抗输入 | Med | 缓存投毒可注入任意规模 facts + facts.file 指向兄弟文件 | validFacts 预算（50k chunks/200k calls）+ 要求 `<module>` 伪块 + `facts.file === 缓存键` |
| 文档消费者 | Med | `--top N --json` 含 PURE 条目（text 先滤） | json 分支同样先滤非 PURE |
| 文档消费者 | 低 | README 缺 shape/prior/batchable/file 锚定；测试数 114→132；report.root Windows 反斜杠混用 | README 补齐 + root 正斜杠统一 + types.ts state 注释 |
| 测试质量 | High | validFacts 可被 `chunks:[]` 穿透（同对抗输入，合并修复） | `<module>` 伪块必在 |
| 测试质量 | Med | Math.random()（PURE）≠ random.random()（IMPURE）跨语言不一致；secrets 不在表 | Math.random → impureGlobals；secrets → impureModules；io-tables 测试补双向断言 |
| 测试质量 | Med | 多处 `toContain([PURE, UNKNOWN])` 弱断言（实现已确定性） | 收紧为 `toBe`（wildcard 链实测 PURE） |
| 统计 | Med | 层次收缩双重计数（cell ⊆ method 同源入账） | leave-one-out：θ̂_m 剔除本 cell 计数 |
| 统计 | Med | 跨键形式去重失效（裸 id / file\0id 换格式重复入账） | seen 双写两键 + 双键去重 |
| 统计 | Med | EVSI 排序键=总影响面 vs 曲线目标=剩余 UNKNOWN | 排序键改 UNKNOWN 密集影响面（导出与曲线同序） |
| 统计 | Med | 冷 attr 先验来自 root 异质池借力，n 误导 | 冷 attr（方法级零证据）拒绝提示 |
| 维护 | Med | from-import HOF 回调边丢失：`from functools import reduce; reduce(write,xs)` → 假纯 | from-import 分支补 hofCallsArgs 钩子（与命名空间分支对称） |
| 维护 | 低 | dynamicCalls/reexport 死字段；.tmp/ctor-check.test.ts 陈旧探针 | 删除 |

## 收敛信号

- 新增 9 回归测试（B1 崩溃、H1 降级、from-import HOF、io-tables、proto-hash、isCorpus 守卫等），135/135 全绿。
- swagger 实测：pure 310→307、unknown 432→435（假纯减少，方向正确）。
- 迭代 1 的 Blocker 级假纯洞与迭代 2 的崩溃级 DoS 均已闭合；后续发现级别递减（Blocker → Med/Low）。
- 统计评审明示「核心数学自洽收敛」；文档评审明示「闭环正确性无阻断」。

---

# 迭代 3 收敛复审记录（2026-08-10，5 全新视角：形式化/语言语义/安全复测/性能实测/收敛仲裁）

方法：复审 16051d2 基线。结论：**不收敛但快速收敛中**——4/5 判不收敛（形式化 1 High+3 Med、语言 1 Blocker+残余、安全 2 Med、性能 4 项），仲裁者判**收敛**（迭代 1+2 全部 19 项声称经代码+实测核验为真修）。全部发现已修复（e893dda），7 新回归测试，142/142。

## 已修复（e893dda）

| 来源 | 级别 | 发现 | 修复 |
| --- | --- | --- | --- |
| 形式化 | High | H1 降级可被 PURE 标注撤销 → 假纯复辟（chainCertain=true 掩盖；标注协议以不可信的 body 为准） | scan.ts PURE 分支对 parseErrFiles chunk 拒绝标注（保持 UNKNOWN/chainCertain=false） |
| 形式化 | Med | LOO 用 root 边际冒充 cell 计数 → 负值/NaN 先验（15/15 例 pPure=−0.237；0/0=NaN 逃过阈值） | Math.max(0,·) clamp；归零退回 GLOBAL_THETA0 |
| 形式化 | Med | 双键 seen 的 `seen[c.id]` 门丢弃异判定实例证据（file 锚定意义即"同内容跨文件判定可不同"） | 去重门按键形式：实例锚定按 annKey，裸 id 按 c.id；双键写入保留 |
| 形式化 | Med | 解析优先级与特性意图相反：裸 id 对全部实例胜出，显式实例覆写全局死键 | scan.ts + corpus.ts 都改 (file,id) 优先 |
| 语言 | Blocker | TS/JS `new C()` 构造器效应完全不可见（new_expression 不是 call 节点）——Python 侧 S1 已修，跨语言不对称 | callNodes + new_expression + callOf constructor 字段 → 类 chunk 构造器边 |
| 语言 | Med | 裸 `Date()`/`new Date()` 时钟读取判纯；performance.now/setTimeout 不一致 | Date 移出 pureBuiltins（→UNKNOWN）、加入 pureGlobals（Date.parse/UTC 纯）；performance.now、定时器入表 |
| 语言 | Med | Python uuid 熵读取 UNKNOWN vs TS v4 IMPURE | python uuid: ["uuid1","uuid4"] |
| 语言 | 低 | list.copy/dict.copy/array slice/concat/charCodeAt 表缺口（假 UNKNOWN 噪音） | effects/returns 补齐 |
| 语言 | — | len/str/int 强制转换协议残余（**len**/**str** 可带 io） | 文档化有意边界（README 已知限制 + python.ts 注释）——移除则 unknown-rate 爆炸 |
| 安全 | Med | cache/corpus JSON.parse 无大小上限 → 恶意仓库 OOM DoS | parse 前 statSync 64MB 上限 |
| 安全 | Med | validFacts 数量预算无字节预算（8MB normText 穿透） | normText 1MB 上限 |
| 安全 | Low | mergeCorpus 裸赋值 **proto** 原型污染（bump 已修，merge 漏） | 复用 hasOwn+defineProperty |
| 安全 | Low | --unknowns 直写非原子（语料/缓存均原子，此处不一致） | tmp+rename + 父目录 mkdir |
| 性能 | High | Python 绝对导入 O(F×M_distinct)（100k 文件外推 9-11 分钟） | byLast 末段路径索引（resolveModule 可选参数，O(F+M)） |
| 性能 | Med | link 每 chunk 双 sha256；scan+extractor 文件级双 sha256 | WeakMap id 复用 + contentHash 透传 |
| 性能 | Low | module chunk split("\n") 生成 10M 元素数组 | 计数循环 |
| 仲裁 | Med | nesting 差一（箭头函数 tiebreak 漂移）→ 记录；export default identifier 不解析 | findDefaultExport 登记 identifier；nesting 记录已知限制 |

## 收敛信号

- 仲裁者核验迭代 1+2 全部 19 项声称：代码位置 + 实测行为全部为真修；半修 2 项（README 计数、死变量）已清。
- swagger：impure 56→58、unknown 435→432（new_expression/Date 诚实化方向）。
- 迭代 3 发现级别：1 Blocker（TS 构造器，跨语言对称性）+ 1 High + 残余 Med/Low——无新崩溃面（安全复测明示「无 Blocker、无崩溃面」）。
- 趋势：迭代 1 假纯洞 → 迭代 2 崩溃 DoS → 迭代 3 表完备性/边界纪律；核心算法经 3 轮五视角 × 3 组独立评审（形式化、统计、仲裁）均未再发现核心洞。

---

# 迭代 4 收敛判定记录（2026-08-10，5 全新视角：核心图/提取语言/语料闭环/安全输入面/端到端仲裁）

方法：复审 e893dda 基线。结果：2/5 完整报告（核心图、语料闭环）+ 3/5 环境失败（pi-tool-display 与 pi-lean-edit 扩展冲突阻塞 spawn；提取语言与端到端仲裁由主会话补验）。结论：**快速收敛中**——两报告均判"不收敛但快速收敛"，核心算法第 4 轮独立评审无洞；全部新发现已修复（3fe2117），146/146。

## 已修复（3fe2117）

| 来源 | 级别 | 发现 | 修复 |
| --- | --- | --- | --- |
| 核心图 | Med | `class:` 接收者分支缺 assigned 遮蔽守卫 → 局部变量遮蔽类名时错边 → 假 IMPURE（误报方向；分支 2/3 均有守卫，唯此缺） | 遮蔽守卫与分支 2/3 对称（诚实 UNKNOWN） |
| 核心图 | Low | H1 守卫过宽：parseError chunk 的 IMPURE 标注也被拒（保守方向无必要） | 守卫移到 IMPURE 分支之后（PURE 拒、IMPURE 放行） |
| 语料闭环 | Med | parseError chunk 标注被 scan 拒却被 updateCorpus 计入语料（body 不可信的标注累积先验——与 H1 意图冲突） | Chunk.parseError 字段 + --unknowns 导出 + updateCorpus 跳过 |
| 统计 | Low-Med | LOO clamp 角（mTotalLOO 归零 ∧ 方法 impure 残差 > 0）产出方向错误的虚假 PURE 建议（0.73） | 角冲突守卫回退 null（宁缺毋滥） |

## 主会话补验（视角 2/5）

- js/tsx 经 `...typescriptPack` spread 继承 callNodes（含 new_expression）：构造器 io 实测传播（JS 与 TSX 均 IMPURE）✓
- 6000 函数大文件：validFacts 预算不误拒、缓存命中正常（cached=1, 6001 chunks）✓
- 版本 999 + 伪造指纹缓存 → 全量重扫 ✓
- 端到端：146/146 全绿；swagger 稳定（58 impure / 432 unknown / 308 pure）；三轮 CROSS-AUDIT 轨迹与 git log 一致

## 收敛轨迹（4 轮汇总）

| 轮次 | 不收敛判定 | Blocker 级 | 核心算法独立评审 |
| --- | --- | --- | --- |
| 迭代 1 | 5/5 | 2 假纯洞（S1 构造器体、S4 静默丢边） | 数学对拍正确 |
| 迭代 2 | 3/5（2 判收敛） | 1 崩溃 DoS（B1 原型链） | 形式化/统计独立判收敛 |
| 迭代 3 | 4/5（仲裁判收敛） | 1 跨语言 Blocker（TS 构造器） | 3 组独立评审无核心洞 |
| 迭代 4 | 2/2 报告（快速收敛） | 0 | 第 4 轮无核心洞（边角语义） |

每轮发现级别递减（假纯洞 → 崩溃 → 表完备/边角语义），核心五要素（图算法/效应传播/判定格/语料先验/标注闭环）经 4 轮 15+ 独立评审视角持续无核心洞；新发现均为 Med/Low 边角且当轮闭环。

---

# 迭代 5 收敛判定记录（2026-08-11，5 全新视角：端到端工作流/确定性/算法对拍/语义抽查/最终仲裁）

方法：复审 343a81c 基线。结果：**5/5 完整报告全部判收敛**（端到端工作流 14/14 核验、确定性 5/5 契约、算法对拍 53.7 万断言 0 失败、语义抽查 0 例"真 io 判 PURE"、最终仲裁 CONVERGED）。残余 5 项 Low（文档/文案级）已随 04cf2d4 清理。

## 终裁依据（视角 5）

- **三重基线稳定**：146/146 全绿、swagger 308/58/432 与迭代 4 逐项一致、git log 轨迹与 CROSS-AUDIT 完全吻合。
- **核心五要素独立验证轮次**：图算法 4 轮、效应传播 3 轮、判定格 4 轮、语料先验 4 轮、标注闭环 3 轮（5 轮共 20+ 独立视角，25 视角中 3 次环境失败由主会话补验）。
- **发现级别单调递减**：假纯洞（Blocker）→ 崩溃 DoS（Blocker）→ 表完备/边界（High/Med）→ 边角语义（Med/Low）→ 迭代 5 仅文档/文案级（Low）。50+ 修复全部当轮闭环。
- 迭代 4 四项修复（遮蔽守卫/H1 放行/parseError 语料跳过/LOO 角守卫）代码逐行核验 + 2000 轮语料随机扫描（角守卫 8616 次触发 100% 回退 null）。
- 语义抽查唯一语义级瑕疵 F1（py lambda 体 io 归模块伪 chunk → 保守假 IMPURE，低危）：已以 `ponytail:` 注释落档于 python.ts callNodes 处（等真实误报再修）。

## 残余清理（04cf2d4，终裁 5 项 Low）

1. parseError 导出条目 prompt 说明 PURE 标注会被拒（H1 守卫），建议标 IMPURE 或改源码重扫
2. README 测试数 135→146（迭代 3/4 新增测试同步）
3. README「逐字节一致」措辞限定为分析负载（cachedFiles 为缓存状态指示器例外）
4. influence.ts S(w) 方向注释修正
5. 标注曲线行披露悬垂边 UNKNOWN 不可释放（staleEdges>0 时终值低于 stats.unknown 的原因）

## 最终裁决

**收敛（CONVERGED）**。核心五要素达成「足够正确有效内敛无可新增」；残余全部为文档/文案级，不触及判定正确性，不构成收敛阻断。

---

# 迭代 6 审计记录（2026-08-11，5 全新视角：语言表/语料 v2/端到端/数学对拍/终裁）

背景：用户「继续进行有解的工程项迭代和开会审计循环，直到剩余工作除了标记外都是无解的」。实施 4 项有解工程项后开审计轮验证。

## 已实施（有解工程项）

| 项 | 提交 | 行为 |
| --- | --- | --- |
| lambda 归属 | d7155b5 | 赋值 RHS lambda → 命名 chunk（module 不再假 IMPURE）；实参 lambda 归外层（正确语义） |
| Promise executor / nesting 差一 / :p 纯成员 | 736e05b | new Promise(executor) 回调边；箭头/function 同 nest；json.dumps/crypto.createHash 等 → PURE |
| os/time 拆表 | f731285 + c06868f | os: 99 项 io 成员 + os.path 纯子模块（:p 15 项）+ 别名表（12 项）；time 时钟 io（11）+ mktime/strptime 纯（2） |
| corpus v2 cell 维度 | f731285 | (attr, root) 真格计数——priorFor n/LOO 精确化，root 桶虚高根治；v1 拒收幂等重建 |

## 审计结论

- **语言表**：不收敛（1 Med B1：time 表 5 个 `:p` 成员无参形式读时钟 → 假纯，本轮引入）→ **已修复 c06868f**（移除 :p 落 UNKNOWN；mktime/strptime 保留）
- **语料 v2**：收敛（41 断言 0 失败；2000 轮随机 0 越界/0 NaN；角守卫在良构数据下死代码、畸形数据 10.7% 触发全安全回退）
- **端到端**：收敛（全链路闭环、确定性、swagger 精确 308/58/432）
- **数学对拍**：收敛（25.2 万断言 0 失败：priorFor 公式逐位相等、cell⊆method 恒等式 300 轮、tarjan 200 图互达）
- **终裁**：收敛（有解工程项 4 项做尽；残余全为卡数据/成本/类型层，非代码可解，落档）

## 有解工程项终态

**做尽**：lambda 归属、Promise/nesting/:p、os/time 拆表、corpus v2 cell。
**剩余全为"标记"（无解）**：跨项目分层基率（卡数据——需多项目标注）、曲线边际最优（O(n²) 成本取舍）、第三方库递归（依赖闭包不可行）、动态分派/实例状态写/协议方法（不可判定，`?` 即形式化正确）、实参 lambda 独立判定单元（现状归外层即正确语义）。

---

# 迭代 7/8 审计记录（2026-08-11，数学家评审循环：用户盲区解决 + 效应分化/状态写/可解释性验证）

背景：用户「进行数学家开会，迭代循环，尽可能解决我提出问题。直到没有算法方案」。5 项盲区：#1 异常传播 #2 状态写 #3 数据流 #4 动态分派 #5 测试耦合。

## 已实施（用户需求 + 盲区可解项）

| 项 | 提交 | 内容 |
| --- | --- | --- |
| 效应分化 | 565bbf5 | {io} → {net,fs,db,random,clock,state,io} 7 类（A7 原子集） |
| 状态写 | c33d6d0 | self.x=/this.x=/global/nonlocal → state 效应（S1 假纯漏报闭合） |
| 可解释性 | eacf831 | chainPath 传染路径 + compareReports 判定变化 |
| 外部对象写 | 8939454 | user.status='banned' → state（数据流写侧） |
| 异常传播 | 518ecf1 | throw/raise 提取 + 保守向上传播（throwsTypes 元数据） |
| 异常 catch 细化 | efead79 + 571a5a1 | catch 减法（方向安全）+ F2 重抛保留 + TS += 修复 |
| 读方传播 | c33ca0d | stateDeps 全项目名基匹配（读方耦合，纯元数据不进判定） |

## 评审结论（迭代 7 三视角 + 迭代 8 三视角）

- 迭代 7：效应/状态写数学收敛（850 图对拍）、chainPath/compareReports 收敛（5100 chunk 对拍）、盲区评估（④ 可做、① 有条件、②③ 无解）；3 发现（datetime 点连、globals :p、死代码）全修。
- 迭代 8：数学复审收敛（28.9 万检查 0 失败）、读方传播可实施设计（判定"做"）、端到端 2 blocker（TS += 漏检、catch-and-rethrow 签名被吞）全修 + compareReports 判等守卫恢复。
- 剩余盲区最终判定：#4 动态分派无解（真实数据 91% 不可救，标注管线覆盖）、#5 测试耦合无解（不可判定）；#1/#2/#3 全部有解且已实现。

## 终态

162/162；swagger 稳定（151 impure / 365 unknown / 282 pure——状态写/外部写使类方法 this.x= 大量可见）；用户盲区中所有有算法方案项已实现，无解项（动态分派/测试耦合）经数学家评审严谨判定并文档化。

---

# 迭代 9 终审记录（2026-08-11，数学家终审：stateDeps + 全套收敛）

## 评审结论

- **视角 1（stateDeps 数学）**：收敛。200 随机图 vs 独立 oracle 0 不一致；19 项定向边界全过；判定隔离 100 图逐字节 0 不一致；500 图传播单调/链三角/异常减法 0 违规；性能 O(R·depth + T·W) 实测（10k chunk 精确读 18ms、⊤ 读 683ms 受输出规模主导）。3 发现：Verdict 类型声明缺口（Med-1）、state.ts docstring 精度、chainPath SCC 代表输入序——全部已修（bfb2156）。
- **视角 2（收敛终裁）**：**CONVERGED**——用户「直到没有算法方案」停止条件达成。5 项盲区：#1/#2/#3 有算法方案且实现（代码+测试逐项核验）；#4/#5 无解判定与迭代 7 视角 3 一致（91% 真实数据不可救 / 不可判定）。残余全为已知限制（文档化）；唯一应修项（Verdict 类型声明）已修。

## 用户停止条件达成（自 2026-08-11 深夜连续工作）

- **3 项需求**：效应分化（7 类 A7 原子集）、状态写（self.x=/this.x=/global/外部对象写 → state）、可解释性（chainPath/compareReports/analyzeChange 库 API）——全部落地。
- **5 项盲区**：#1 异常（提取+传播+catch 减法+重抛保留）、#2 状态写、#3 数据流（写侧+读方 stateDeps）——有解全部实现；#4 动态分派、#5 测试耦合——无解（数学上不可判定/工程不可行），经 3 轮数学家评审严谨判定。
- **评审循环**：迭代 7/8/9 六视角，28.9 万 + 850 + 500 图对拍 0 失败；发现全部当轮闭环。
- **终态**：HEAD bfb2156，162/162，swagger 稳定（151/365/282），CROSS-AUDIT 完整轨迹。

---

# 迭代 10/11 审计记录（2026-08-11，回归风险控制实现：用户核心目标）

背景：用户「核心点是"通过目前的关注点，实现回归风险控制"，继续做开会实现的迭代。直到没意见」「5独立审计 不是3」。设计裁决（L×C 风险矩阵 + 证明义务派生层）后实施，5 独立审计迭代。

## 已实施

| 项 | 提交 | 内容 |
| --- | --- | --- |
| riskOfChange L×C | fcde5ca + b86ed03 | 五因子（impact 反向闭包/purity 双通道/cycle 对数/SCC 平凡排除/depth 饱和/fog 计数单调）+ L=1-(1-p)(1-f)（可证保守上界）、C=0.5i+0.3c+0.2d、risk=100·L·C、阈值 30/60/85、invalid 契约 |
| forwardClosure | fcde5ca | 正向可达闭包（R_fog/proof 加权唯一新计算，O(V+E)） |
| proofCompleteness | 5245e5b + b86ed03 | Θ/MPS 派生报告层：annotationCurve 释放语义（deps 倒计时）、 | Fwd(c) | 枢纽加权、budgetToTarget 边界 |
| CLI --changed | 5245e5b + b0812a8 + 315b4c3 | 相对 root 路径语义（git diff cwd 路径）、invalid exit 1 |

## 5 独立审计（用户要求，全部运行）

- 视角 1（概率/聚合）：发现 fog 双计（0.5→1.0 高估）、unmatchedFiles 单位错（file vs chunk，静默旁路 invalid）、O(V²)——全修
- 视角 2（proofCompleteness）：2 blocker（释放语义与 annotationCurve 不一致→θ 系统性低估/1 不可达；budgetToTarget 浮点边界）——全修
- 视角 3（端到端）：收敛；Note（--changed 与 --json 混合流、invalid exit 0）——invalid exit 已修
- 视角 4（一致性）：proofCompleteness 非换名（释放语义错）——已修；affectedChunks 口径/fog 注释残留/README——已文档化
- 视角 5（终裁）：**收敛、可上线、核心目标达成**——5 因子全部从现有扫描数据派生（零外部数据）、CLI 开箱即用、proofCompleteness 升级审计工具为证明完整度会计层；2 个 Low 应修（invalid exit code、README 测试数）已补

## 终态

HEAD 315b4c3，176/176，swagger 稳定（151/365/282）；回归风险控制经 5 独立审计收敛，无 blocker，可上线。

---

# 迭代 12 审计记录（2026-08-11，回归风险 5 视角交叉复审 + 新特性 5 视角设计审计 + 拓扑 3 视角设计评审）

## 回归风险交叉复审（5 视角，迭代 12）

- 视角 1（风险×状态写×异常交互）：因子数学收敛；2 设计级 Medium——① 阈值 30/60/85 与实测分布脱节（1233 模拟改动集 0 high/critical，risk 集中 [0,35]，C 轴 cycle 权重死重 + impact≤0.32 结构上限；建议按分位重标 LOW<15/MEDIUM 15-35/HIGH 35-60/CRITICAL ≥60）② stateDeps 状态耦合回归路径五因子全不覆盖（建议 R_state 独立因子）；3 Note（fog 闭环非单调、weighted N_U×O(V+E) 外推分钟级、R_cycle 实测死重）
- 视角 2（proof×标注闭环）：收敛；budgetToTarget 与 CLI 百分位分母不一致（Med）
- 视角 3（端到端）：收敛；混合流修复验证（--changed json stdout 纯净）
- 视角 4（正确内聚最简）：收敛；S1-S3 重复实现 + D1-D5 死代码清单
- 视角 5（终裁）：**收敛、可上线、核心目标达成**

## 新特性设计审计（数据流 + 并发 + 增强效应格，5 视角）

- Jeff Dean：条件收敛——2 做（{closure} 折叠进 state：TS 裸标识符状态写/读漏检假纯洞；异步边：定时器进 hofAlwaysArgs）+ 2 简化（mutatesParams/sharedWriters metadata）+ 5 砍（{global}/{escape}/{async}/{thread}/{lock}/{signal} 原子、不可变性语料维度）
- 范畴论：代数内核全部正确（并集交换幺半群、传播保序函子、判定 join-同态）；2 blocker——「{?} 与任何非空集组合仍为 UNKNOWN」破坏单调性/健全性（S2 被绕过、--strict 放行不纯代码）必须否决；「? 是零对象/吸收元」范畴误称（唯一自洽 = A7 现状）；N1 恒等式（f(S)=⋁f({a})）为新原子机检门槛
- 终裁：**条件收敛可实施**——2 做 + 4 简化 + 6 砍 + 原子清单 7 不变 + 2 规格 blocker 改述消解；实施路线 Step 0（规格修订）→ Step 1（{closure} P0）→ Step 2（异步边 P1）→ Step 3（metadata P2）

## 拓扑健康度设计评审（3 视角）

- 数学：指标集（CYC/M1b 自环/M2/M3'/H/M5 层数/M6 分层流动指数/M7 跨层跨度/M8 可达性占比）；**F1 光谱是二维**（路径图反例：树但 ρ=0.5）；**F2 原始密度 |E|/n² 尺寸支配否决**；**F4 自环盲区**（现有 cycleCount 只计 |SCC|>1，自递归不可见）；谱指数/λ₂ 维持否决
- 一致性：数据 90% 现成（outDegree/tarjan/forwardClosure）；API = graphMetrics(verdicts) 派生层纯函数（与 riskOfChange 同构）
- 实施：graphMetrics 路线图（标量/SCC/深度分层 3 步）；密度自环口径修正；纯 JSON 形状；--topology 旗标

## 决策链

D-082（迭代 12 收敛）、D-083（拓扑采纳）、D-084（7cab482 测试闭环）、D-085（证明系统 + 新设计 5 视角审计 in-flight）

## 迭代 14 复审（5 视角，聚焦未决项正确解决）

- 视角 1（未决项数学设计）：**不收敛（3 未决项均未解决）**——R_state 正确设计（s=|broken(Δ)|/|R| 入 L ∏ 保守上界 + impact'=Back∪broken 入 C；单调性完备证明；探针 1 写者+278 无调用边读者 risk 0→50 HIGH——必须拓宽 impact 才有判别力，仅 ∏ 入 L 只到 0.53）；budgetToTarget 分母统一方案（CLI 分母改 |U| + proof order 收窄为 ?-源）；D 矩阵无校准数据（语料 cell 无跨版本翻转记录）→ 四序公理文档化裁决 + README 阈值漂移（README 仍 30/60/85，代码已 15/35/60）
- 视角 2（最简性）：**收敛**——S1-S3 全做（S1 复用 changedImpact 唯一陷阱：必须 changed+affected 计数非 affectedChunks；S2 annotationCurve 初值改全量累计 weight 对齐 cli/proof；S3 共享比较器向公理5对齐）、D1-D5 全删（D3 并入 S2 复活 import）
- 视角 3（拓扑 graphMetrics 实施）：**收敛**——可实施 API 完整（nodes/knownEdges/unknownEdges/selfLoopCount(F4)/cyclicComponents(=stats.cycles)/dagDepth(边数口径)/density(扣自环)/layer+chain 直方图(∞单列桶)/evidence）；算法逐条对照既有实现（tarjan 逆拓扑契约、analyze runOnce 边口径）；测试计划 8 例（自环/链树/完全图/随机 DAG 对拍/cycles 一致性）
- 视角 4（Step1-2+证明系统验证）：**收敛但 1 major**——**F1：setTimeout 异步边死配置**（hofAlwaysArgs 在 link.ts 零消费——impureBuiltins 分支从不调用 addArgEdges，S4 声称未实现；定时器回调反向闭包不可见）；evidence.unknownRate 同源同口径 ✓；阈值边界 ✓；swagger 188→180 由解构绑定修复解释（-8 impure）
- 视角 5（终裁）：**收敛**——未决项分类（R_state/分母/D 矩阵→文档化、最简性→可选清扫、拓扑→采纳）；前 4 视角 3 个被 120s 超时杀死后 resume 补位，终裁基于源码级交叉验证

### 未决项最终处置（用户「思考如何正确解决」→ 实施）

- **R_state：实施**（D-094 覆写终裁文档化分类）——视角 1 数学实证（278 读者 risk=0 真实盲区，终裁理由只覆盖写者侧）；s 入 L + impact' 入 C；单调性测试 + 278 读者场景测试；阈值与 R_state 联合体接受保守膨胀（文档化）
- **budgetToTarget 分母：文档化**（视角 5 裁决）——CLI（chunks 基）与 Θ（UNKNOWN 基）两指标各自合法，CLI 注释声明语义
- **D 矩阵/权重：文档化裁决**（四序公理组 + 基数裁决声明 + 校准路径=配对扫描 git 历史；(W,阈值,R_state) 联合体纪律）
- **拓扑 graphMetrics：实施**（D-083 落地）——topology.ts 纯函数 + index 导出 + --topology 旗标（json additive + text 摘要）+ 8 单测；自扫实测：125 nodes/88 edges/密度 0.006/自环 8/深度 7
- **最简性 S1-S3/D1-D5：记录待下轮**（S1 与 R_state 交集已减小——R_state 需 backSeen 集合）

### 本迭代修复

- F1/D-092：定时器异步边触发门 hofAlwaysArgs ∪ hofCallsArgs（link.ts 效应表两分支）+ hofedge.test.ts 4 例回归（193/193）
- 解构绑定 declaredNames（73aa6e1，迭代 13 已含）；证据质量 evidence 字段 + 阈值 15/35/60（73aa6e1）
- README 六因子 + 阈值 15/35/60 同步；D 矩阵公理组注释（54c3df8）

### 决策链

D-086（Step1-2 落地）、D-087（证据字段+阈值重标+解构绑定）、D-088（迭代 14 5 视角）、D-089（终裁文档化分类）、D-090（R_state 实施，审计判偏离）、D-091（拓扑实施，审计判偏离——旗标已补）、D-092（setTimeout 修复无效——已由 D-093 修正）、D-093（异步边门修正）、D-094（R_state 覆写裁决）

## 迭代 15（剩余工作执行轮：最简性 + 盲区修复 + 可解释性 + 极小性）

- **最简性清扫**（e8327d5）：S1（riskOfChange 复用 changedImpact，backSeen 由 changed+affected 重建）、S2（annotationCurve 加权参数 + 初值全量累计——对齐 proof θ 的 deps=0 口径）、S3（annotationCompare/unknownKeysOf 三处共享）、D1（maxReachable 删）、D2（gap 删）、D5（UNKNOWN_COUNT 单遍）
- **分母统一**（528f176）：CLI 标注曲线分母 chunks → |U|，对齐 proof Θ（1−rem/|U|）——覆写视角 5「两指标合法」裁决
- **CJS 解构 require 盲区**（f2adb62 + 5e52793）：exports.x=fn 建命名 chunk（from-import 可解析）；导出赋值不再算 chunk 体状态写（arrow 导出 PURE）；边界校准（同名歧义 → ? 诚实、重导出走 importMap）
- **F2 参数重绑**（cf45f17）：参数重绑非外部状态写（纯局部），参数对象属性写保留外部
- **gradeOf 验证**（无代码改动）：src 真实语料 120 集 0 high/critical、p95 26.6 vs 迭代 12 的 29.4——R_state 后阈值 15/35/60 保持有效；合成随机图模拟器偏差（critical 1232）记录不用于校准
- **发布面**（8ca8615）：package.json repository；exports/types/bin/files 已齐
- **可解释性层**（8ca8615 + 1ed878a + 5e52793）：grade action 行 + 证据置信度警告 + 拓扑人类解读（视角 4 文本修正：无门禁措辞、未知边限定、dagDepth 结构深度非效应链）
- **极小性（视角 5）**：A（src/core/*.js 689 行构建产物误提交——已删）、B（Verdict inDegree/outDegree 死字段——已删）、C（F2 回归测试——已补）、D（README global/nonlocal 矛盾——已修）、E（--topology 文档——已补 help/README）、F（GraphMetrics.evidence 断言——已补）

### 决策链

D-097（迭代 15 剩余工作执行——最简性+盲区+可解释性+极小性闭环）

## 迭代 16（生产就绪轮：真实项目验证 + 能力增量 + CI + 测试盲区 + 发布验证）

- **真实项目验证**（用户提供 J:/旧宇宙/代码仓库 2818 chunks/179 files/549 impure + express/axios）：无崩溃、秒级；**背锅者分析**——手写代码腐化主力（42% IMPURE：BaseInitDeityUser {io,state}、ActionRunner {random,state}、SimpleRedisClient），generated 场景传播放大层（83% UNKNOWN），枢纽 reward_refresh_single_box/_op_refresh_single_box 解锁 6-7 下游
- **--sources 旗标**（背锅者查找）：chain=0 IMPURE 效应源按调用点排序（README/--help 同步）
- **CI**（.github/workflows/ci.yml）：Node 20 + build + 203 测试 + 自扫描 --strict 门禁 + require 冒烟；actions pin SHA
- **测试盲区补齐**（历史 Med 行 82）：impureModules 效应表规则、数组接收者效应、link 深度上限（10 层 re-export 链 → ? 不崩溃）、缓存写失败只读目录、损坏缓存回退
- **npm pack 验证**：43 文件/79.6kB；消费者安装测试通过（wasm 经 tree-sitter-wasms 依赖解析、scanProject 可用）
- **文档同步**：README 导出清单补全（forwardClosure/gradeOf/graphMetrics/defaultPacks/ScanStats/GraphMetrics）；axioms 四·七补阈值-因子联合体

### 决策链

D-106（迭代 16 生产就绪轮——真实验证+CI+测试+发布+文档闭环）

## 迭代 18（真实项目驱动审计修复循环：旧宇宙标注工作流重播）

- **漏检定位**（用户：以旧宇宙为例找工具没正确分析到的）：① os.environ.get → UNKNOWN（两级成员链只查末段）② Locust self.client.* → ?（框架模式缺失；self.client 是参数进 assigned 拦截 2.5 遮蔽守卫）③ PURE 标注移除 ? 不减 unknownSites → graphMetrics.unknownEdges/evidence.missingSiteRate 失真（实测标注后未知边不变）
- **修复 3 项**：effectFromModule 两级成员链前缀回退（os.environ.get→io、os.path.join :p 保留）；Locust HTTP 客户端模式（python frameworkIo self→[client,session,http] 段级前缀 + link 分支 1 多级链放行 + 2.5 selfNames 豁免 assigned）；scan.ts PURE 标注同步减 unknownSites
- **标注工作流重播**（用户：全标）：869 条（IMPURE 109/PURE 760：ApiClient._request IMPURE、NotImplementedError 占位 722 PURE、TDOpenHarmonyProxy 分析 SDK 108 IMPURE）→ unknown-rate **73.3%→14.4%**、unknownEdges 7940→6394；剩余 284 为动态分派诚实未知（self.api.* 设计边界）
- **全图**：拓扑结构不变（标注不建边——判定层语义），未知边反映标注
- 回归测试 4 例（iter18-real-driven），210/210

## 迭代 19（C# 语言包——InitDeity Unity 真实项目驱动，工具最大盲区闭合）

- **盲区**：3028 个 C# 文件（Unity 游戏）完全不可扫——跨语言纯度审计对 C#/Unity 主流工作零覆盖
- **实现**（csharp.ts + 引擎扩展）：类/结构/接口/方法/构造/局部函数 chunk；member_access_expression + generic_name（Resources.Load<GameObject>）+ this_expression flatten；implicitThis（C# 类内裸名=this 方法——LangPack 接口扩展，4 语言零破坏）；Unity/.NET 60+ 类名效应表（Debug io/PlayerPrefs state/File fs/GameObject/SceneManager/Animator state/AudioSource io/UnityWebRequest net/Time clock/Random random）；全局类名索引（C# namespace 跨文件类调用——moduleAssigned 遮蔽守卫）；frameworkIo["this"]+gameObject/transform（Unity 隐式组件属性链）
- **InitDeity 验证**：23800 chunks/3004 文件/18s；unknown 8159→7706（三轮修复：跨文件类 +365、frameworkIo +83、标注 -979）；impure 7156→7604；10 环/72 自环（PushStone.Push 递归）；背锅者 RuntimeMainlineAutopilot.BuildSnapshot（33 调用）
- **标注工作流**（InitDeity）：692 条（PURE 664 集合操作/IMPURE 28 网络诊断）→ unknown 7790→6811（标注后）
- **诚实局限**：中文标识符 parse-error 77 文件（WorldRegion.草木之森——wasm Unicode 缺陷，方向安全 UNKNOWN）；协程/LINQ 链/事件订阅第一版不建模；<unresolved> 2206（不可拍平调用设计边界）
- 测试 +6（csharp-lang 6 例），216/216

## 迭代 20-21（标注清零 + 数学解 + 生产就绪 DAG）

- **迭代 20**：中文标识符 wasm 硬限制确认（外部债 D1）；工具修复 4 项（predefined_type/conditional_access/Unity 裸全局/string 纯）；标注 928+ 条 → InitDeity unknown 8159→5124（-37%）
- **交叉审计**：ground truth PURE 24-32%（标注质量差——接收侧 annotationRejected 护栏落地）；阈值重验（C# 效应表未推高分布——真问题是纯度饱和×后果饥饿）
- **迭代 21 数学解 A/B/C**：A 标注一致性验证器（多站点记账 latent bug 修复——置 0 + annotationRejected + 语料防污染）；B 效应表使用率（effectTableUsage 三分类 + missSlots 补表候选）；C-缺口 1 annotatable
- **发散 AI（22 发现）**：F13 files 加 scripts/docs、F14 --version、F16 效应表注入（平台化）、F19 pathlib 拆表、F20 :p 审计（Path.cwd/home 假纯闭合）
- **DAG 生产就绪**：T1 forks 池、T2 标注护栏、T3 真实 fixture（8 文件 8 断言）、T4 missSlots 补表（nameof/System/UnityEngine 前缀）、T5 链式诚实结论（设计边界）、T6 resolveCall 拆分
- InitDeity：unknown 8159→5761（工具+标注-29%）、226/226

## 迭代 22（真实校准 + 合入门禁 + InitDeity 重构验证）

- **F9 分层基率落地**（pipeline.md 四/六兑现，corpus 面 API 首度导出）：`fitBaseRate(corpora)` → `BaseRateModel{mu,kappa,projects}`——μ 加权均值（**不纯率**语义，与 GLOBAL_THETA0=0.25 同口径裁决）、κ=μ(1−μ)/Var−1 方差反解、冷启动 `projects<2 → {mu:0.25,kappa:12,projects:0}`（含 []/单项目/空项目）；`priorFor(corpus, site, baseRate?)` 第三参（`baseRate?.mu ?? 0.25`，缺省路径逐位兼容）；index.ts 补齐 `emptyCorpus/updateCorpus/mergeCorpus/summarize/siteShapeInfo/isCorpus` 导出
- **实测**：InitDeity 语料（method 表 4264 样本 1847P/2417I，纯率 0.433）单项目 → 冷启动（projects=1<2，判定正确）；+swaggerSim(65条51P) 双项目 → `{mu:0.5616, kappa:133.8, projects:2}`（μ 被大样本主导，κ 显项目间方差）；fitted κ 不接 priorFor（显式设计决定——priorFor 在单项目内做 method→cell 两层收缩，无项目层可接）
- **F5 --gate 落地**（Debtmap 外部参考）：`riskOfChange` grade ≥ HIGH → exit 1（比 --strict 语义正确——针对新引入 IMPURE）；gateExit 纯函数（high/critical/invalid→1、low/medium→0）入 risk.ts；`--gate` 无 `--changed` 报错 exit 2（不静默失效）；与 --strict 共存 `Math.max` 保序
- **InitDeity 安全重构验证**（真实工程经验回流，严格限定审计清单内 2 项，未触碰 156 脏文件之外任何文件）：① SRList(IEnumerable) 构造器去 AddRange 内部环（一次性 List.ToArray 拷贝，语义等价论证）——chain 3→0，内部 3 环消除，字段写仍判 direct state；② ScreenShake.TestShake 删除（Vfx_Test 手测残留）——chunks 23800→23799、IMPURE 9449→9448；复扫对比 PURE 8590 不变
- **工具盲区（下轮待办）**：① **ConvertToString ×47 direct io 假阳**——frameworkIo.System 前缀表含 Reflection/Runtime/Globalization，纯反射元数据读取被标 io（全库最大单类假阳，修复方向：收紧前缀或方法名白名单）；② 纯数据结构构造器字段写判 state（假 IMPURE，方向安全，效应表口径已知保守）；③ **基线不可复现**——2654 条标注文件丢失，无标注口径 UNKNOWN 5761 vs 基线 3449，需归档标注文件或接受无标注基线为新基准
- **复审（verify 节点 4 轮独立复验）**：**BLOCKER 发现并修复**——impl 的 `--gate` 分支曾替换 `--topology` 分支（--topology 变未知选项 exit 2），主会话恢复三独立分支并补 CLI 回归测试「--topology 旗标仍可用」；fitBaseRate 数学 4 轮独立手算对拍逐位一致（T1 μ=0.6/κ=3.08510638；InitDeity 双项目 μ=0.56156/κ≈133.8）；247/247 全绿（24 文件）+ tsc 0 + README 门禁 OK

## 迭代 23（状态耦合图 + 效应表收紧）

- **状态耦合图（D-127，用户建议落地）**：`--state` 旗标输出 write→readers 映射——`stateCouplingOf(verdicts)` 纯函数反查 verdict.stateDeps（零重复传播、无双真值源；不重复调 stateDepsOf）；text 模式 top 15 按读者数降序 + 超限注记，json 顶层 `stateCoupling` additive（不破坏现有 schema）；⊤ 降级条目暴露 + text 注记；零读者写方不输出、空图 `[]`/「无」；与 risk R_state 的差异文档化（改动集视角 vs 全图视角）；stateDeps 盲区（下标写/调用结果写/项目外写者）→ 耦合图是**下界**，README 已知限制已文档化
- **frameworkIo.System 收紧（迭代 22 工具盲区①处置）**：删 5 条目（`Reflection`/`Text`/`Globalization`/`Runtime`/`RuntimeTypeHandle`），保留 9（Console/Environment/Diagnostics/IO/Net/Data/Threading/Process/GC）；移除后全限定 System.* 调用落 UNKNOWN 非 PURE（audit 公理 3，绝不假纯；MethodInfo.Invoke 双保险不假纯）
- **InitDeity 复扫验证（--no-cache 只读）**：ConvertToString ×47 direct-io **47→0**、purity 全 IMPURE→UNKNOWN；全库 IMPURE 9449→9349（−100）、UNKNOWN 5761→5860（+99 守恒）、PURE 8590 不变——收紧只消除假 io 零误伤（其余 53 个为 Text/Globalization/Runtime 类调用点同类假阳）
- **工具盲区处置**：① ConvertToString ×47 假阳**已闭环**（本迭代）；② 纯数据结构构造器字段写判 state（方向安全，效应表口径已知保守，记录不修）；③ 基线不可复现（标注文件丢失）→ 待办
- **复审（verify 节点）**：**BLOCKER 二次再现并修复**——`--state` 分支整行替换 `--table-usage` 分支（迭代 22 `--gate` 顶 `--topology` 同款 bug）；恢复 + **根因护栏**「全部布尔旗标可解析」CLI 回归测试（--strict/--topology/--sources/--state/--table-usage 逐一冒烟，顶替即 exit 2 失败）防三次复发；MEDIUM 修正——新增 csharp-lang 用例改全限定 `System.Reflection.*`（参数接收者不触达 obj="System" 前缀路径，修复前也通过=无效测试）；258/258 全绿（26 文件）+ tsc 0 + README 门禁 OK

## 迭代 24（状态耦合精度修复：提取层死代码根因闭环）

- **真实项目驱动发现**（--state 实战，InitDeity）：Singleton 写 `instance` 被 2600+ chunk 误认为读者——状态耦合图被全库调用目标噪音淹没。审计定位出比表象更深的根因链（docs/iter24/audit.md，全部实证）
- **根因① `===` 判等死代码（跨语言，自迭代 8 起）**：extractor.ts stateReadPos 用 `===` 做节点同一性比较（L188-189 赋值左值跳过 / L193-194 调用目标排除），web-tree-sitter 每次属性访问返回**新节点对象** → `===` 恒 false（`.equals()`/`.id` 才是正确判等）——「调用目标排除」「赋值左值跳过」对所有语言从未生效：`user.save()` 计入 stateReads、`user.status = x` 同时写+读
- **根因② C# 成员节点全覆盖缺口**：C# 的 `member_access_expression`/`conditional_access_expression` 不在 stateReadPos 过滤列表（只认 attribute/member_expression）→ C# 字段读位置永不产生；C#/Python 成员名是 `identifier` 类型 → `Foo.instance.x` 的 instance/成员名全部裸读（InitDeity 2633 读者虚高真实机制：22 写方/2633 读者，27 份抽样仅 1 份真实）
- **根因③ 写侧对偶缺失**：externalWritePos 只处理 attribute/member_expression → C# `this.x = v` 字段写完全不可见（`transform.position = x` 漏判 state）
- **修复**（stateReadPos 重写 + externalWritePos 补对偶）：`===`→`.id`；成员访问结构子标识符整体跳过；节点过滤补 C#；调用 parent 列表补 `invocation_expression`/`object_creation_expression`；`?.` 边缘（内层成员/双层链）；obj/attr 按类型分支（C# expression/name 字段）
- **InitDeity 复扫验证**：instance 写方读者 2633→**1005**（−62%，调用目标噪音消除，残余为真实单例调用 + 同名异对象——名基匹配设计上限）；判定分布 UNKNOWN 28.1%→25.0%、IMPURE 9449→10537（C# 字段写正确判 state——**正确化**，fixture UIWorldLink 断言 UNKNOWN→IMPURE 实证）
- **测试 +3**（csharp-lang T1 调用目标不产生 stateRead / T2 字段读保留 / T3 字段写可见，修复前均失败——防回归有效），261/261 全绿
- **工具盲区处置**：① 提取层死代码**已闭环**（本迭代最大正确性收益）；② C# 对象初始化器属性名裸写（Quest12 1949 读者）/ 类字段名裸写（ConfigSingleMenu 2674 读者）——类作用域字段应 self.x 语义，待下轮；③ C# 局部声明名/方法名裸读（assignedNames 对 C# 无效——variable_declarator 未列入）、`this.x++` 写不可见——既有噪音，记录待办
- **复审（verify 节点）**：根因修复实证通过（web-tree-sitter 语义 + AST dump + 端到端探针）；conditional_access 全链排除；JS/Python 回归（user.save() 不再读、user.status 读保留）；261/261 独立复跑 + tsc 0 + README 门禁 OK。无 blocker

## 迭代 25（C# 状态提取精度：对象初始化器 / 类字段 self / 局部声明 / ++ 写补）

- **真实项目驱动**（迭代 24 残余待办处置）：--state 实战揭示 C# 写侧三类假/漏——① 对象初始化器属性名裸写（Quest12* 1949 读者源头：`new C { A = v }` 的 initializer_expression 内 assignment_expression 触发外部写）② C# 类字段裸写 = 全局裸名（ConfigSingleMenu 2674 读者：`score = v` 无 this 前缀 → 外部写 "score"，与全库同名裸读假耦合）③ `this.x++`/`i++` 写不可见（postfix/prefix_unary_expression 不在 stateWritePos——字段自增方法被标纯，**假纯缺陷**）
- **修正任务前提**（审计实证）：declaredNames 已覆盖 C#（真正失效的是 assignedNames——C# variable_declarator 无 name/left 字段且未列入 assignmentTargets，局部声明名从不入 assigned → stateReadPos 裸读分支对局部失效）
- **修复**（全部 C# 门控零跨语言风险）：b 对象初始化器跳过（initializer_expression parent 检查，集合/匿名/数组/with 已证不触发）；d ++/-- 写侧补（**仅认 ++/-- 操作符**——`!x`/`-x`/`~x` 同为 prefix_unary_expression 但语义是读，误判会产 1450 假读者，RemoveWhere 假耦合清零实证）；c variable_declarator→assigned（children[0] fallback 仅 C# 触发，TS/JS 有 name 字段不触发）；a C# 类字段写→self.attr（inClassMemberBody 祖先爬：method/constructor→true，local_function/lambda/class→false——不用 ownerClass 因它对 local_function 也非 null）
- **InitDeity 复扫验证**（--no-cache 只读）：stateCoupling 6860→**5919**（−14%）；ConfigSingleMenu.DoParse 读者 2674→903（−66%，类字段写收敛 self 语义）；bare SegmentId/Name 裸写**清零**（Quest12 1949 读者源头消除）；PURE/IMPURE/UNKNOWN 8059/10545/5195→8106/10232/5461 方向一致（++ 写补→state 增、假裸写消→PURE 微升）；残余 top 读者均为真实耦合（PushStone self.hasInit 1139 / Demo_Shaders self.zoomFactor 1136）
- **测试 +4**（csharp-lang T1 初始化器不污染全局 / T2 ++写可见且局部不含 / T3 局部声明不假裸读 / T4 字段写 self 非全局 + 局部函数捕获不误映射，修复前均失败——防回归有效），265/265 全绿
- **工具盲区处置**：① 对象初始化器/类字段裸写**已闭环**（本迭代）；② 读侧不对称（裸字段读不映射 self，需类型解析——精度/召回权衡，purity 判定不受影响）→ 待办；③ lambda 参数名裸读（声明名裸读抑制）、element_access 左值写 → 记录待办
- **复审（verify 节点）**：逐项实证 a/b/c/d（declared/params 短路顺序、fallback 触发条件、isIncDec 操作符白名单、TS update_expression 未动）；修复前 T1-T4 4 败验证防回归有效；265/265 独立复跑 + tsc 0 + README 门禁 OK。无 blocker

## 迭代 26（声明名裸读抑制 + 下标/元素访问左值写）

- **迭代 25 残余待办处置**（audit §4.5/§4.6）：① 声明名（方法/类名）裸读抑制——跨全语言通用项，`identifier` 的 `parent.childForFieldName("name")?.id === node.id → []`（`.id` 判等防迭代 24 `===` 恒假陷阱；def foo/function foo/C# method name 不再当外部变量读）；② element_access/subscript 左值写（`arr[i]=v`/`this.arr[0]=x` 此前**完全不可见** = 假纯缺陷）——容器位置语义（非 "arr.⊤"：容器写精确/前缀双命中，读侧主模式不丢）；③ 裸字段读 self 映射明确不做（需类型解析）
- **②b 同族落地**：`d[k].x = v`（member + element-access obj）→ readTarget null 后镜像读侧 `subscriptRoot(obj)` → `"d.⊤"`——**调用结果写 `f().x = v` 由此覆盖**（此前记待办），与读侧 `f().x` → `f.⊤` 对偶；限定 obj.type ≠ identifier 防裸 identifier 误报局部（`o.x=1` 的 o 在 assigned 不误报）
- **实现陷阱 3 个**（worker 实证处理）：① subscriptRoot 对裸 identifier 直接返回文本会误报局部 → ②b 仅复杂 obj 启用；② Python for 变量 `item[k]=v` 局部（item 在 assigned——for_statement 是 Python assignmentTargets，declared 不含 for 变量）→ 非外部；③ C# 参数容器变异 `arr[0]=1` 是外部（params 短路不适用变异——裸重绑 F2 是局部但变异影响调用方）
- **InitDeity 复扫验证**（--no-cache 只读）：stateCoupling 5919→**6591**（+672：下标/元素访问写此前完全不可见的**正确化**揭示，非误报——T1 回退实证 stateWrites 空即证）；新揭示 951 ⊤ 降级写方（近似耦合，README 已知限制注记）；top 写方变更（BuglyAgent._UnregisterExceptionHandler 1888 System.⊤ 事件注册、UICommon.Awake 1255 ICommonUI.⊤ 接口契约——真实契约/事件状态写）
- **测试 +4**（csharp-lang T1 C# 下标写可见/self.items 门控 + Python for 变量局部、T2 Python for 局部 + TS 参数变异外部、T3 声明名不裸读、T4 d[k].x→d.⊤ + 局部 o.x 不误报，修复前均失败——防回归有效），269/269 全绿
- **复审（verify 节点）**：三项主查实证（① 声明名抑制 .id 精确零误伤、② 容器位置语义写读对偶、③ 269/269 独立复跑 + T1-T4 stash 回退恰 4 败）；3 个 minor 修复（T3 类名断言瞄错 chunk→移到类 chunk、state.ts/impl.md `f().x=` 待办声明过时→校正、②b 局部 subscript 根边界→明示有界）；无 blocker
- **下轮待办（残余记录）**：① C# variable_declarator 声明名裸读抑制（本轮只做 name 字段）；② 读侧不对称（裸字段读/裸 items[j] 读不映射 self，需类型解析——purity 判定不受影响）；③ Python `self[k]=1` 弱键 `"self"` 经前缀规则与全项目 self.x 读者耦合（与同名异对象同级，频率低）

## 迭代 27（声明名抑制收尾：pattern/foreach/catch/except 变量）

- **迭代 26 残余待办处置**（audit §4.6）：声明名裸读抑制补齐——迭代 26 只做了 name 字段抑制（method/class 声明名），迭代 27 扩展为**统一声明名抑制 5 规则**（全部 `.id` 判等，迭代 24 `===` 恒假教训）：① name 字段（保留原行为）；② `variable_declarator` children[0]（C# 无 name 字段——简单声明名已由迭代 25c assigned 覆盖冗余无害，真收益 = pattern 名）；③ pattern 名（C# `tuple_pattern`/TS `array_pattern` 的 identifier 子节点，限 depth-1——嵌套 pattern 不命中记局限）；④ C# `for_each_statement` `in` token **之前**的裸 identifier（`in` 之后集合 arr 是真读——位置判断防误伤，T1 锚）；⑤ TS/JS `catch_clause` 与 Python `as_pattern_target` 整类跳过（唯一 identifier 直接子节点即变量名，实证）
- **任务前提修正**（审计实证）：迭代 26 残余「C# variable_declarator 声明名仍裸读」只对一半——迭代 25c 已把 variable_declarator 并入 C# assignmentTargets，**简单声明名 `var q = 1` 已由 assigned 检查抑制**；真裸读是 4 类构造（tuple_pattern 解构名 / foreach 变量 / TS-JS catch(e) / Python except-as e）
- **② self[k]=1 弱键评估**（P3 记录不修）：写键产自 externalWritePos subscript 分支的 **params 短路**（self ∈ params → "self"），非 stateReadPos——修复点与迭代 26 容器语义裁决冲突（参数变异是外部），且只影响 stateDeps 元数据不进判定；顺带发现 TS `this[k]=v` 零写盲区（obj.type=this 漏过类型检查）P3 记录
- **InitDeity 复扫验证**（--no-cache 只读）：无崩溃、秒级；耦合图 top 写方结构与迭代 26 一致（BuglyAgent 1888 System.⊤ / UICommon.Awake 1255 ICommonUI.⊤ / BreakThunder.Update 1231）——声明名抑制未引入新噪音、未扰动既有耦合信号（裸读本就不进 stateDeps——stateDepsOf 前缀匹配要求存在同名写者）
- **测试 +4**（csharp-lang T1 C# tuple_pattern 解构名 + foreach 变量不裸读且集合 arr 读保留 / T2 TS catch 变量 + 解构声明名计数 / T3 Python except-as 变量不裸读且 Exception 类型名不动 / T4 JS catch 变量，修复前均失败——防回归有效），273/273 全绿
- **复审（verify 节点）**：5 抑制规则全部经真实 web-tree-sitter 解析验证（4 语言 × 15 构造）；值读零误伤（tuple_expression≠tuple_pattern、array≠array_pattern 的 children[0] 位置守卫实证）；④ in 位置判断保留集合读；⑤ catch_clause 唯一 identifier 子节点 + C# typed catch 经 ① name 字段 + Python as_pattern_target 覆盖 except-as/except*-as/with-as 全部绑定目标；273/273 独立复跑 + tsc 0 + README 门禁 OK。无 blocker
- **下轮待办（残余记录）**：① TS/JS object-pattern 声明名（`const {n: o} = obj` 的 o）与 for-of 解构名（`for (const [a,b] of pairs)`）仍裸读（迭代 26 既有行为，声明范围外）；② 方案 B（assignedNames 收 pattern 名连解构 use 读一起抑制）P3；③ Python `self[k]=1` 弱键 "self" + TS `this[k]=v` 零写盲区 P3；④ 读侧不对称（裸字段读不映射 self，需类型解析）

## 迭代 28（效应表注入平台化：F16 最小版）

- **长期待办 F16 落地**（F16 效应表注入平台化——效应表是硬编码在语言包的人工维护数据，D3 债：Unity 效应表人工维护；用户项目需扩展效应表而不改库代码）：`src/lang/effectOverride.ts`（新）——`EffectTables` 类型（**链接侧 10 表白名单**：impureBuiltins/pureBuiltins/impureModules/pureModules/impureGlobals/pureGlobals/frameworkIo/builtinTypeEffects/hofCallsArgs/hofAlwaysArgs）+ `validateEffectOverride`（语言名校验/表名白名单含提取侧拒绝/值形状校验含 record-array 双形态）+ `applyEffectOverrides`（**键只增不删**：Record 键合并 + 数组并集 + Set 并集 + builtinTypeEffects 两层深合并 + 空 override 短路原引用）+ `loadEffectOverrides`（JSON 加载，CLI 预留）
- **注入形态**（按语言名索引的 override 映射，非全局 Partial<LangPack>）：跨语言键语义不同（Debug/System 是 C#、self/client 是 Python）——全局 override 会把条目塞进所有语言，同一键跨语言含义不同是方向错误源；语言隔离纪律先例 link.ts:594 `lang === pack.name` 守卫
- **生效路径**：scan.ts ScanOptions 增 `effectOverrides?` 字段，link 前 validate（非法 → throw）+ apply 合并克隆入 packsByName——**link.ts 零改动**、提取/缓存/指纹零影响（链接侧表不缓存每次重跑，注入零缓存失效无需 bump CACHE_VERSION）；提取侧表（literalReceivers/builtinMethodReturns/chunkNodes 等参与缓存）**白名单显式拒绝**防缓存命中静默失效
- **index.ts**：scanProject opts 透传 effectOverrides + 导出 EffectTables/applyEffectOverrides/validateEffectOverride/loadEffectOverrides
- **测试 +9**（unit/effectOverride 6：Record 键合并+标量覆盖内置键全保留、frameworkIo 数组并集不重列内置前缀、Set 并集、builtinTypeEffects 两层深合并、空 override 短路原引用、校验拒绝未知语言/提取侧表/非法效应类/合法形态；e2e/effecttable 3：注入 impureGlobals MySdk:net → 外部 SDK 调用 UNKNOWN→IMPURE direct 含 net、空 override 两次扫描逐位一致、非法语言 scanProject rejects），282/282 全绿
- **实现裁决 2 个**（worker 实证）：① record-array 双形态校验（impureGlobals/impureModules 值支持标量效应类与成员数组两种形态，初版只验数组被单测捕获已修）；② E2E 用**非项目内** `MySdk.Send()`（项目类走 globalClasses 优先解析，效应表不命中——注入真实用例需绕开类解析）
- **merge 方向安全**：键只增不删 → override 不可能误删内置表；数组并集 → 扩展现有键（frameworkIo this）不重列内置前缀（重列 = 抄写漂移 = 漏前缀 = 假纯根源）；短路 → 无 override 返回原 pack 引用（零行为变化的静态保证）
- **复审（verify 节点）**：4 项主查实证（merge 追加不删内置/生效路径真实接线/无 override 逐位不变/282 独立复跑）；n1 重复注释已删（index.ts:19）；**n2 已修**——`"set"` 形态校验空操作 + mergeSet 对 JSON 对象形态原生 TypeError，加固为 Set/数组/对象键三形态 + 补 3 断言；n3 记录不修（校验时机偏晚非正确性）；无 blocker
- **下轮待办**：① CLI `--effect-table <json>`（loadEffectOverrides 已就绪，需新建 spawn 测试基础设施 ~1h）；② 语言事实义务转移风险（用户误标 io→纯 = 假纯方向不安全——缓解：校验挡形状错别字 + README 文档义务 + --table-usage corpus-inactive 可见未命中条目）；③ 无删除能力（override 只能追加，删内置表需改库——设计裁决，防误删）

## 迭代 29（--effect-table CLI：F16 补全）

- **迭代 28 待办①闭环**（CLI `--effect-table <json>`——F16 命令行补全；`loadEffectOverrides`/`validateEffectOverride`/`applyEffectOverrides` 迭代 28 已就绪，本轮只接线）：cli.ts 6 处（import `loadEffectOverrides` + `EffectTables` 类型、`CliArgs.effectTable: string | null`、parseArgs 分支、main 读文件块、scanProject opts 传 `effectOverrides`、printHelp 一行）
- **校验分工**（audit §2.1 兑现）：读文件/JSON 语法/顶层非对象 → `loadEffectOverrides` 抛（消息含路径）→ cli catch → exit 2（与 `--annotations` 同款先例）；形状校验（未知语言/提取侧表/非法效应类）→ scan.ts L233 `validateEffectOverride` → throw → main().catch → exitCode 2（**零额外代码**，天然达成）
- **测试 +3**（robustness 维度 28 CLI 对抗，复用既有 run() spawn helper——iter28 record 声称"需新建 spawn 基础设施"**已证过时**，维度 28 已有 8 个 spawn 先例）：① 注入生效正例（MySdk:net → IMPURE{net} vs 无 override UNKNOWN，同 fixture 判别力 + 复跑前重建 dist 防陈旧假绿）；② 读文件失败 exit 2（不存在路径 + 非法 JSON 两断言）；③ 校验失败 exit 2（非法效应类 IO → scan.ts 兜底 throw → exitCode 2 + "effectOverrides 非法"）
- **CLI 示例**：`node dist/cli.js scan ./src --effect-table overrides.json`（与库 API effectOverrides 同构 JSON：`{ "csharp": { "impureGlobals": { "MySdk": "net" }, "pureGlobals": ["MathUtility"] } }`）
- **测试 285/285 全绿**（28 文件）+ tsc 0 + README 门禁 OK 285（check-readme-tests.cjs）；CHANGELOG [Unreleased] 加迭代 29 条目
- **复审（verify 节点）**：链路完整真实（parseArgs → main 读文件 exit 2 → scanProject opts → scan.ts 校验 throw → link.ts impureGlobals 命中 addEffect net → IMPURE）；CLI 测试有判别力（真实进程 + 同 fixture 注入前后对照）；向后兼容（无 flag → undefined → scan.ts 短路零变化）；285/285 独立复跑。无 blocker
- **下轮待办**：① 语言事实义务转移风险（用户误标 io→纯 = 假纯——缓解已就绪：校验挡形状 + README 文档义务 + --table-usage corpus-inactive）；② 无删除能力（override 只能追加——设计裁决防误删）；③ 提取侧表白名单拒绝/未知语言错误路径未在 CLI 层断言（库层已有校验实现，CLI 层低价值可待）；④ 延续记录：F10 缓存分片、F18 英文文档、标注文件归档（基线不可复现）

## 迭代 30（System 命名空间回退：frameworkPure + 跨迭代复审）

- **数据驱动发现**（--table-usage missSlots）：InitDeity C# 效应表 miss 榜首 = `global:System` 1869 站点——全限定 `System.*` 调用（obj=首段命名空间 System、attr=剩余段）在 frameworkIo.System 9 条 io 前缀外全落 UNKNOWN。影响面分解实证：**94.1% 是纯类**（Uri 882 全 EscapeDataString / Linq 461 / Convert 238 / Enum 97 / Text 55 / Array/Math/TimeSpan/Guid），真实未入表 io 仅 2（`Reflection.Assembly.LoadFrom` fs）+ 1（`DateTimeOffset.UtcNow` clock）；316/318 chunks 可离 UNKNOWN、~213 转 PURE、UNKNOWN 24.7%→~20.5%（预估）
- **实现（方案 A）**：pack.ts 加**可选** `frameworkPure` 字段（TS/Python 无此键 = link 短路 no-op，零跨语言回归）+ link.ts 分支 2.5 io 先行纯回退（两表交叠 io 胜——保守）+ csharp.ts `System` 10 首段严格白名单（Uri/Linq/Convert/Enum/Text/Array/Math/TimeSpan/Guid/Collections，BCL 领域双重确证；**Reflection/Runtime/Activator/DateTimeOffset 明确排除**——iter23 裁定 + 假纯风险，漏条落 ? 非假纯）；hitTable 独立槽位 `pure:${obj}.${p}`（missSlots 计数不再计入 global:System miss）
- **InitDeity 复扫**：`global:System` miss **1869→0**（#1 槽消失）、missSlots 总站点 39049→37291；UNKNOWN 5103→5102 边际（audit 预估 213 未完全兑现——多数 System 调用点在含其他未知点的 chunk，**missSlots 层面完全生效**，判别力价值在标注工作流聚焦）
- **复审（verify 节点）抓到真假纯漏洞（CHANGES）**：`Enumerable.ForEach(xs, Save)`（Save 写 Console）修复前判 PURE 假纯——frameworkPure 命中直接 return 吞回调边。主会话三层修复：① link.ts 纯命中前 `hofCallsArgs` 末段匹配（call.attr 是完整点连 Linq.Enumerable.ForEach、表存短名 ForEach）+ addArgEdges；② csharp.ts hofCallsArgs 补 23 个 LINQ 静态运算符（此前**空表**——C2 只记变量 receiver 链，静态 obj=Enumerable 可建模）；③ extractor.ts argFnsOf 补 C# argument_list 形态 + argument 包装节点解包（probe 实证 C# 参数是 argument→identifier 两层，此前全漏）。T3 守卫（Save io 传染 Run → IMPURE=2）
- **测试 +3 → 288/288 全绿**（28 文件）：T1 `System.Uri.EscapeDataString`/`System.Collections.Generic.List.Add` 判 PURE、T2 `System.Net.Http.HttpClient.SendAsync` 首段 Net 仍 io（边界守卫）、T3 HOF 回调效应保留（假纯守卫）；tsc 0 + README 门禁 OK 288；iter23 Reflection 活守卫保持绿（白名单不含 Reflection 整体）；白名单严格性探针（MathF/UriBuilder 落 ?、System.IO/Net 仍 io）
- **迭代 30 附带：跨迭代整体一致性复审**（overview-review，独立 reviewer）：8 份迭代 record + CROSS-AUDIT 数字链交叉核对——2 MEDIUM 文档矛盾（iter24/impl.md 基线列误标 9449 实为迭代 22 报告值、UNKNOWN rate 28.1%/25.0% 无法复现）+ 3 追踪丢失（F4 sideEffects 认证静默消失、读侧不对称/方案 B 未注明处置）——主会话已勘误（iter24/impl.md 基线列 + 计数口径、iter28/record.md 处置注记）；无代码/测试级问题，测试数链 236→247→258→261→265→269→273→282→285→288 逐迭代衔接无断点
- **下轮待办**：① 语言事实义务转移风险（用户误标 io→纯 = 假纯——缓解已就绪）；② 无删除能力（override 只能追加，设计裁决防误删）；③ 延续记录：F10 缓存分片（InitDeity 缓存 38MB/64MB 上限 60%——评估为 YAGNI，触发需项目翻倍，28s 热扫可接受）、F18 英文文档、标注文件归档（基线不可复现）、C# 对象初始化器/字段声明属性名裸写（iter25 残余，类作用域 self.x 语义）

## 迭代 31（LINQ monad 建模审计 + S1 链修复 + S3 假纯堵洞）

- **用户提出 monad 建模方向**（LINQ 变量 receiver 链 HOF 本质是 monad 建模）：审计（docs/iter31/audit.md）核实——receiverTypeOf 不识别变量类型（无声明绑定）+ 缺 `invocation_expression`（C# 链全断）；**InitDeity 语料收益评估**：LINQ 变量链仅 359 站点（unknownCalls 0.6%）/287 chunks，top 变量形态是 Unity API（SetActive/Add/Invoke/GetComponent）非 LINQ——**monad 主体收益不支撑本轮**，A1（声明点类型绑定 + IEnumerable 表 + 字段绑定续接）记录待办；但审计抓到 2 个更急的活 bug（S1/S3）
- **S1 链断裂修复**：receiverTypeOf 加 `invocation_expression`（C# 调用节点名）→ C# 链式调用第二环起恢复解析（21,488 bare 站点大块受益）+ builtinMethodReturns/builtinTypeEffects 补 string 链方法（TrimStart/TrimEnd/ToLowerInvariant 等）
- **S3 假纯堵洞**（公理 3 违规活洞）：`System.Linq.Enumerable.Select(xs, Console.WriteLine)` 语句式 → PURE 假纯——hofAlwaysArgs 空表导致命名框架成员回调 io 被吞。修复：`linqHof` 表分离（31 算子）+ frameworkPure 分支回调保留 + **unconditional 门**（未解析回调必记 UNKNOWN）
- **复审（verify 节点）抓 HIGH-1/MEDIUM-2**：① HIGH-1——addArgEdges 的 UNKNOWN 门只查 hofAlwaysArgs，linqHof 差集 15 算子（Count/Any/First/Last/Sum/Min/Max…）命名回调仍被吞（`Enumerable.Last(xs, Console.WriteLine)` → PURE 假纯）——门同时认 linqHof；② MEDIUM-2——Join/GroupJoin 在全局 HOF 表，`String.Join(",", parts)` 值实参被 argFnsOf 误收 → 假 UNKNOWN——移出全局表（LINQ 上下文由 linqHof 覆盖）；③ 撞名守卫——Math.Max(a, score) 纯静态不被当 HOF（Max/Min/Sum/Count/First 与 LINQ 算子撞名）
- **记账不变量修复**（compromise-audit 附带发现）：addArgEdges 的 hofAlwaysArgs 兜底直接 `calls.add(?)` 不走 markUnknown → 违反 `scan.ts` L272 不变量 `calls.has("?") === (unknownSites > 0)` → 此类 UNKNOWN 对标注工作流/语料/missingSiteRate 不可见——补 unknownSites++ + unknownCalls 记录
- **builtinTypeEffects 补 monad 判定表**（A1 前置对齐）：IEnumerable（Select/Where/GroupBy 等 hof + Skip/Take/Distinct/ToList 等 pure）/List/Dictionary（Add/Remove/Contains/TryGetValue 等 pure）——与 builtinMethodReturns 键对齐，变量绑定启用后链式解析不落空
- **工程妥协综合审计**（compromise-audit，独立 reviewer）：识别 9 个妥协（C1-C9），3 个数学最小化候选：① frameworkPure 命名空间前缀 → 方法级白名单（假纯结构通道，iter30/31 两次活洞根因，**top1 下轮做**）；② HOF 表 → 上下文限定 + arity 感知（撞名结构性风险）；③ fitBaseRate 矩估计 → 经验贝叶斯 profile-MLE（数据门槛 ≥4 项目）；可接受 5 个（D_MATRIX 阈值/gateExit、stateDepsOf ⊤、merge 语义、stateReadPos 抑制——方向安全成本不抵）
- **测试 +5 → 293/293 全绿**（S1 链/S3 假纯/HIGH-1/MEDIUM-2/撞名守卫）；InitDeity 复扫 invariantViolations 0（记账不变量修复后全库一致）
- **下轮待办**：① **frameworkPure 方法级白名单（compromise-audit top1——两次引发假纯活洞，结构性收紧）**；② arity 感知 argFnsOf（Linq 非委托成员 Concat/Skip/Take/ToArray 带标识符实参 → ?）；③ fitBaseRate 经验贝叶斯（≥4 项目数据门槛）；④ 延续记录：A1 变量类型绑定（monad 主体）、F10 缓存分片、F18 英文文档、标注文件归档

## 迭代 32（frameworkPure 方法级白名单：compromise-audit C1 结构性收紧）

- **compromise-audit top1 落地**：frameworkPure 命名空间级前缀纯白名单（`System → [Uri, Linq, Convert, ...]` 命中即 PURE，无逐成员证明义务）是假纯结构通道——iter30/iter31 两次活洞（`Enumerable.ForEach(xs, Save)`、`Select(xs, Console.WriteLine)`）均源于"纯前缀命中吞回调 io"，靠 hof 表修补而非结构性收紧
- **方案选型**（docs/iter32/audit.md）：案 1 成员级白名单（推荐）vs 案 2 前缀级+例外表（方向不安全否决——C1 指控未结构性解决）。选**案 1**：`Record<ns, Record<type, "pure"|"hof"|Record<member, ...>>>` 两级结构（13 整类型键 pure + Linq 整类 hof + Text 3 子键 + Array 异质嵌套 17 成员）；**linqHof 表删除**（Linq:"hof" 1 键 + unconditional 门取代 29 算子表）；未列键落 ?（诚实，fall-through 到 missTable → UNKNOWN 已验证）
- **实现**：csharp.ts 两级结构 + link.ts 2.5 分支两级匹配（type 键段前缀 + Array 嵌套成员表剩余段查）+ `addArgEdges` 加 `unconditional` 参数（true → 未解析回调必记 UNKNOWN）+ pack.ts 类型演进 + classifyUsage 适配；**内建回调不变量**：hof 命中且 argFns 非空 → addArgEdges(unconditional) → 未解析记 UNKNOWN——"纯前缀吞回调"假纯结构通道关闭；pure 成员忽略 argFns（值实参常态，无委托形参语言事实）
- **复审（verify 节点）抓 Blocking**：**Text 3 个死键**——初版把 StringBuilder/Encoding/RegularExpressions 放 System 顶层散键，但匹配按 rest 首段 "Text" 查 → System.Text.* 整子树 miss 落 ?（55 站翻纯→?、global:System miss 111→166、TransportManager.RoomSharingCode 翻转）。修复：嵌套进 `Text: { StringBuilder/Encoding/RegularExpressions: pure }` + UTF8Encoding 补键 + T4 回归测试（System.Text.Encoding.UTF8.GetBytes → PURE）
- **测试 +4 → 297/297 全绿**（T1 未列成员落 ?/T2 Array 拆分/T3 Enumerable hof unconditional 门/T4 Text 嵌套）；tsc 0 + README 门禁 OK 297；iter30/31 全部回归绿（T1/T2/T3 + S1/S3/HIGH-1/MEDIUM-2/撞名守卫）
- **InitDeity 复扫（双 HEAD 对照）**：pure 8044/impure 10652/unknown 5103（−1/+1 未列成员正确化，方向安全）；global:System miss 保持 0（Text 修复后回落 111）；效应表 csharp 161 条目/80 命中（+2 Text 拆分，恢复迭代 31 基线）；chunk 级差分仅 TransportManager.RoomSharingCode（Text.Encoding.UTF8.GetBytes——修复后回纯）
- **下轮待办**：① Linq 非委托成员（Concat/Skip/Take/ToArray）带标识符实参 → ?（arity 感知 argFnsOf）；② pure 成员被传真正函数实参 → 假纯理论风险（语言事实缓解，无语料实证）；③ Linq.Expressions.* 收紧（Compile=动态执行，当前 PURE 是 iter30 基线延续）；④ 延续记录：A1 变量类型绑定（monad 主体）、fitBaseRate 经验贝叶斯、F10 缓存分片、F18 英文文档、标注文件归档
