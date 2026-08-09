import { createHash } from "node:crypto";

/** 内容哈希：sha256 前缀 16 hex。 */
export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

/**
 * chunk 内容身份：hash(已令牌级规范化的源码)。
 * 规范化在 extractor（有 AST，见 normalizeCode），此处只哈希——
 * 正则剥离注释无词法感知会塌缩真实改动（x//2 vs x//3、URL、私有字段），
 * 违反公理4 单射；令牌级规范化保留字符串原样，两方向都成立。
 */
export function chunkId(normalized: string): string {
  return contentHash(normalized);
}
