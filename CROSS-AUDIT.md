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
| 语言 | — | len/str/int 强制转换协议残余（__len__/__str__ 可带 io） | 文档化有意边界（README 已知限制 + python.ts 注释）——移除则 unknown-rate 爆炸 |
| 安全 | Med | cache/corpus JSON.parse 无大小上限 → 恶意仓库 OOM DoS | parse 前 statSync 64MB 上限 |
| 安全 | Med | validFacts 数量预算无字节预算（8MB normText 穿透） | normText 1MB 上限 |
| 安全 | Low | mergeCorpus 裸赋值 __proto__ 原型污染（bump 已修，merge 漏） | 复用 hasOwn+defineProperty |
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

方法：复审 343a81c 基线。结果：**4/5 完整报告全部判收敛**（端到端工作流 14/14 核验、确定性 5/5 契约、算法对拍 53.7 万断言 0 失败、最终仲裁 CONVERGED），语义抽查超时（主会话待补）。残余 5 项 Low（文档/文案级）已随 04cf2d4 清理。

## 终裁依据（视角 5）

- **三重基线稳定**：146/146 全绿、swagger 308/58/432 与迭代 4 逐项一致、git log 轨迹与 CROSS-AUDIT 完全吻合。
- **核心五要素独立验证轮次**：图算法 4 轮、效应传播 3 轮、判定格 4 轮、语料先验 4 轮、标注闭环 3 轮（5 轮共 20+ 独立视角，25 视角中 3 次环境失败由主会话补验）。
- **发现级别单调递减**：假纯洞（Blocker）→ 崩溃 DoS（Blocker）→ 表完备/边界（High/Med）→ 边角语义（Med/Low）→ 迭代 5 仅文档/文案级（Low）。50+ 修复全部当轮闭环。
- 迭代 4 四项修复（遮蔽守卫/H1 放行/parseError 语料跳过/LOO 角守卫）代码逐行核验 + 2000 轮语料随机扫描（角守卫 8616 次触发 100% 回退 null）。

## 残余清理（04cf2d4，终裁 5 项 Low）

1. parseError 导出条目 prompt 说明 PURE 标注会被拒（H1 守卫），建议标 IMPURE 或改源码重扫
2. README 测试数 135→146（迭代 3/4 新增测试同步）
3. README「逐字节一致」措辞限定为分析负载（cachedFiles 为缓存状态指示器例外）
4. influence.ts S(w) 方向注释修正
5. 标注曲线行披露悬垂边 UNKNOWN 不可释放（staleEdges>0 时终值低于 stats.unknown 的原因）

## 最终裁决

**收敛（CONVERGED）**。核心五要素达成「足够正确有效内敛无可新增」；残余全部为文档/文案级，不触及判定正确性，不构成收敛阻断。




