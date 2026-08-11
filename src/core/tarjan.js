"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tarjan = tarjan;
/**
 * Tarjan SCC —— 迭代实现（生产环境不允许递归爆栈）。
 *
 * 输出契约：强连通分量按**逆拓扑序**返回，即对任意跨分量边 u -> v，
 * v 所在分量先于 u 所在分量出现。此后所有不动点计算只需一次顺序扫描，
 * 终止性由构造保证（公理2）。
 */
function tarjan(nodes, edges) {
    const index = new Map();
    const low = new Map();
    const onStack = new Set();
    const stack = [];
    const out = [];
    let counter = 0;
    const successors = (v) => edges.get(v) ?? EMPTY_SET;
    for (const root of nodes) {
        if (index.has(root))
            continue;
        index.set(root, counter);
        low.set(root, counter);
        counter++;
        stack.push(root);
        onStack.add(root);
        const work = [
            [root, successors(root).values()],
        ];
        while (work.length > 0) {
            const frame = work[work.length - 1];
            const [v, it] = frame;
            const next = it.next();
            if (!next.done) {
                const w = next.value;
                if (!index.has(w)) {
                    index.set(w, counter);
                    low.set(w, counter);
                    counter++;
                    stack.push(w);
                    onStack.add(w);
                    work.push([w, successors(w).values()]);
                }
                else if (onStack.has(w)) {
                    low.set(v, Math.min(low.get(v), index.get(w)));
                }
            }
            else {
                work.pop();
                if (work.length > 0) {
                    const parent = work[work.length - 1][0];
                    low.set(parent, Math.min(low.get(parent), low.get(v)));
                }
                if (low.get(v) === index.get(v)) {
                    const scc = [];
                    for (;;) {
                        const w = stack.pop();
                        onStack.delete(w);
                        scc.push(w);
                        if (w === v)
                            break;
                    }
                    out.push(scc);
                }
            }
        }
    }
    return out;
}
const EMPTY_SET = new Set();
