import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: 120_000,
    include: ["test/**/*.test.ts"],
    // 迭代21：Windows threads 池偶发 worker 崩溃（sources.test.ts 子进程并发）——固定 forks 池
    pool: "forks",
  },
});
