import { describe, it, expect } from "vitest";
import { contentHash, chunkId } from "../../src/core/hash";

describe("hash 基础（公理4 内容身份）", () => {
  it("16 位 hex", () => {
    expect(chunkId("def f(): pass")).toMatch(/^[0-9a-f]{16}$/);
    expect(contentHash("x")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("确定性", () => {
    const s = "def f(x):\n    return x + 1";
    expect(chunkId(s)).toBe(chunkId(s));
  });

  it("对输入敏感", () => {
    expect(chunkId("a")).not.toBe(chunkId("b"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });

  it("chunkId 是纯哈希（规范化在 extractor，见 lang-features 公理4 回归）", () => {
    expect(chunkId("x // 2")).not.toBe(chunkId("x // 3"));
  });
});
