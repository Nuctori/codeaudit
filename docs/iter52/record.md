# Iter-52 record

## 变更文件（本次仅这 4 个 + 本记录；仓库内其他脏文件不动）

- `src/core/topology.ts` — graphMetrics 同名族过滤（4 处同口径）
- `src/core/htmlreport.ts` — 纠缠环 edgeSet 同名族过滤
- `test/unit/topology.test.ts` — 3 个新用例 + v() 支持 name
- `test/unit/htmlreport.test.ts` — 纠缠环排除用例
- `docs/iter52/00-plan.md` — 分析/盲区证据/决策链

## 验证命令

```
npm run build                    → exit 0
npx vitest run                   → 44 files / 412 tests passed
node .codeaudit/_rings2.cjs      → 旧口径复现 83/47/Event.Track 影响42；新口径 30/15
node .codeaudit/_render.cjs      → report-iter52.html（42794 bytes）
```

## 未提交的他人改动（隔离，不夹带）

`src/engine/scan.ts`、`examples/effect-override-example.json`、`test/audit/robustness.test.ts`、
`test/unit/packConsistency.test.ts`、`.audit-scratch/`、`nul`。
