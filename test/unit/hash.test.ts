import { describe, it, expect } from "vitest";
import { chunkId, normalizeSource } from "../../src/core/hash";

describe("chunkId（公理4：身份即内容）", () => {
  it("对注释不敏感", () => {
    const a = "def f(x):\n    return x + 1";
    const b = "def f(x):\n    # 加一\n    return x + 1";
    expect(chunkId(a)).toBe(chunkId(b));
  });

  it("对空白/缩进风格不敏感", () => {
    const a = "function f() { return 1; }";
    const b = "function f() {\n    return 1;\n}";
    expect(chunkId(a)).toBe(chunkId(b));
  });

  it("对真实改动敏感", () => {
    const a = "def f(x):\n    return x + 1";
    const b = "def f(x):\n    return x + 2";
    expect(chunkId(a)).not.toBe(chunkId(b));
  });

  it("normalizeSource 确定性", () => {
    const s = "a /* x */ b // y\n# z\nc";
    expect(normalizeSource(s)).toBe(normalizeSource(s));
  });
});
