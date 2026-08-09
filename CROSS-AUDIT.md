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
