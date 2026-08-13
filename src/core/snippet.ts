import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Chunk } from "./types";

/** 迭代44-r3（标注工作台）：chunk 源码片段——unknowns 导出携带代码上下文，标注者无需打开文件。
 *  读取失败（文件被删/权限）→ 空串（不中断导出）。行区间含 endLine；超长截断防导出膨胀。 */
export function sourceSnippet(root: string, chunk: Chunk): string {
	try {
		const lines = readFileSync(join(root, chunk.file), "utf8").split("\n");
		const end = Math.min(lines.length, chunk.endLine);
		const start = Math.min(Math.max(0, chunk.line - 1), Math.max(0, end - 1));
		return lines.slice(start, end).join("\n").slice(0, 2000);
	} catch {
		return "";
	}
}
