import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 120_000,
    include: ["test/**/*.test.ts"],
    // 迭代21：Windows threads 池偶发 worker 崩溃（sources.test.ts 子进程并发）——固定 forks 池
    pool: "forks",
    // 迭代40 P0-3：B5 属性读取建边后 CLI 单进程内存增大——全并发 spawn 多个 CLI + tree-sitter
    // wasm 峰值超限（V8 Zone OOM 实证：默认并发崩、maxWorkers=2 稳）——限并发保 CI 稳定
    maxWorkers: 2,
  },
});
