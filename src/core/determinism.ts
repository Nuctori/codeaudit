/**
 * 跨平台确定性比较器。
 *
 * localeCompare 的结果依赖运行环境的 locale/ICU：Windows 本地与 Linux CI 的默认
 * locale 不同，同一文件名集合可能排出不同顺序——目录遍历序、报告并列项 tie-break
 * 随之漂移，产物快照无法跨平台复现（CI 漂移检测假红）。所有影响输出的排序一律用
 * 本比较器（纯 UTF-16 码点序，任何平台/Node 版本结果一致），禁止 localeCompare。
 */
export function compareCodepoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
