# 迭代41 记录（record）

> 议题：LangPack 三颗果实（表一致性断言 / 分派完备性证明 / 签名半自动生成）+ 评审发现的第 4 颗果实
> （阴影守卫不对称——活假纯）。流程：00-plan → 01-math-review（formula-convergence）→ 02-jeff-review
> （reviewer）→ 03-synthesis → 实施 → 验证。

## 评审结论（03-synthesis.md 全文）

- 果实1 断言：**modify 版落地**（M1 通过；M2s/M3s 精化 string 值键——对齐 effectUsage P1；
  M4s 段级——C# System 双键合法分区；M5 通过但带数据修复；M6 修数据路线）。
- 果实2 证明：**modify 版落地**（边界声明「全总性 ≠ 判定健全性」+ markDynamic 配对修正 +
  判别字段补 prop/argFns + 互斥性改述控制流排他 + 行号锚定）。
- 果实3 生成器：**延后**（等疼再做；保守方向约束已写入：io 启发式只允许判 io，判纯必须人工 + 版本锚定；
  「返回原始类型 → 纯」是假纯向量（randomUUID 反例）——禁止）。
- **第 4 颗果实（评审发现，blocker）**：阴影守卫不对称——pureBuiltins/pureGlobals 通道无
  assigned 守卫，探针实证 `max = print` / `const Math = evil()` → 假 PURE（A6 S1 违反）。

## 实施（按合成裁决）

| 变更 | 文件 | 内容 |
| --- | --- | --- |
| 阴影守卫 | link.ts L1272/L1614 | pureGlobals/pureBuiltins 查询加 `assigned` + `fi.moduleAssigned` 守卫（函数内 + 模块级遮蔽,与 import/全局类通道同族机制） |
| M5 数据修复 | csharp.ts | pureCtor 删 3 死条目：GUILayout/Texture2D/SystemInfo（ctor 分支 impureGlobals 先查,删除零行为变化） |
| M6 数据修复 | typescript.ts | hofAlwaysArgs 12 名并入 hofCallsArgs（子集契约;union 双查点行为不变,单查点方向恒保守;350 测试零回归实证） |
| 断言 | pack.ts | `validatePackConsistency(pack): string[]`（M1/M2s/M3s/M4s/M5/M6,纯函数,生产路径不调用） |
| 合并后 warn | scan.ts | effectOverrides 合并点加一致性检查（用户数据可制造 M5 死条目——探针实证） |
| 回归测试 | lang-features.test.ts | 维度26 阴影守卫 3 用例（python 函数内遮蔽 / TS 模块级遮蔽 / 未遮蔽对照） |
| 断言测试 | packConsistency.test.ts | 5 用例（内置 5 注册 pack / initdeity 真夹具 / M5/M6/M3s 人为违反触发） |
| 证明 | 01-proof.md | S4 引理化：通道枚举 + 全总性结构归纳 + 控制流排他 + 判别字段穷举静态表 |

## 验证

- `npx vitest run`：**352/352 passed（32 files）**（迭代37 基线 305 → 迭代40 350 → 本迭代 +9 全绿,零回归;
  含 B1 回归）。
- `npx tsc --noEmit`：exit 0。
- 数学评审实测：基线 350/350 + 探针 7/7（M1-M6 现数据检查、override 违反、python/TS 假纯实证）——探针文件已删。
- Jeff Dean 评审：do-now/do-now/defer；基线失败未复现（瞬时状态,实测 350/350 绿）。

## 残余（诚实）

- **B1 事故（决策审计发现,已修复）**：M6 修数据 edit 误删 hofAlwaysArgs 的 `"map"` → link L416
  unconditional 判定恒 false → `[1].map(未解析回调)` 假 PURE（回开 axioms 修复 4）。修复：map 加回
  + 回归测试（`const f = writeFileSync; [1].map(f)` → UNKNOWN）。教训：跨块 edit 需逐行核对残留体。
- M6 修数据的行为变化评估基于「单表咨询点命中的纯对象无 hofAlways-only 成员名」（数学家论证）;
  全量测试零回归支持该结论。若未来出现 `arr.map(cb)` 经 pureGlobals 门形态,argFns 边会多报（方向保守）。
- 阴影守卫只修了纯侧（impure 侧无守卫是过近似方向,可接受——遮蔽 impure 全局仍报效应,不假纯）。
- M7（frameworkIo.gameObject 与 frameworkAttrPrefix.gameObject 双源）未做——iter37 已标注漂移风险,
  单源化或断言级候选留待数据维护疼痛时。
- 生成器（果实3）延后,保守方向约束在 00-plan.md/03-synthesis.md 有记录。

## 决策链

见 decision chain（D-0xx：迭代41 三果实裁决 + 第4果实纳入）。
