import { createHash } from "node:crypto";

/**
 * 规范化源码文本：去注释、压缩空白。
 * 只要求确定性 + 对格式/注释不敏感，不要求语义保持（哈希用途）。
 * 效果：函数挪动行号、改注释、调整缩进，id 不变（公理4）。
 */
export function normalizeSource(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // 块注释
    .replace(/\/\/[^\n]*/g, " ")          // 行注释 //
    .replace(/#[^\n]*/g, " ")             // 行注释 #
    .replace(/\s+/g, " ")
    .trim();
}

export function contentHash(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex").slice(0, 16);
}

/** chunk 内容身份：hash(规范化源码)。 */
export function chunkId(sourceText: string): string {
  return contentHash(normalizeSource(sourceText));
}
