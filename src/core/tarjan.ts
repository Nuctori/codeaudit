/**
 * Tarjan SCC —— 迭代实现（生产环境不允许递归爆栈）。
 *
 * 输出契约：强连通分量按**逆拓扑序**返回，即对任意跨分量边 u -> v，
 * v 所在分量先于 u 所在分量出现。此后所有不动点计算只需一次顺序扫描，
 * 终止性由构造保证（公理2）。
 */
export function tarjan(
  nodes: Iterable<string>,
  edges: ReadonlyMap<string, ReadonlySet<string>>,
): string[][] {
  // 幽灵目标守卫（范畴律：输出必须是输入节点集的划分）：边目标不在节点集时忽略——
  // 否则 tarjan 会把幽灵节点当成成员建分量（实测 tarjan(["a"], {a:["ghost"]}) → [["ghost"],["a"]]）。
  const nodeList = [...nodes];
  const nodeSet = new Set(nodeList);
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  let counter = 0;

  const successors = (v: string): ReadonlySet<string> =>
    edges.get(v) ?? EMPTY_SET;

  for (const root of nodeList) {
    if (index.has(root)) continue;
    index.set(root, counter);
    low.set(root, counter);
    counter++;
    stack.push(root);
    onStack.add(root);
    const work: Array<[string, Iterator<string>]> = [
      [root, successors(root).values()],
    ];

    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      const [v, it] = frame;
      const next = it.next();
      if (!next.done) {
        const w = next.value;
        if (!nodeSet.has(w)) continue; // 幽灵目标：不入图
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter++;
          stack.push(w);
          onStack.add(w);
          work.push([w, successors(w).values()]);
        } else if (onStack.has(w)) {
          low.set(v, Math.min(low.get(v)!, index.get(w)!));
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1]![0];
          low.set(parent, Math.min(low.get(parent)!, low.get(v)!));
        }
        if (low.get(v) === index.get(v)) {
          const scc: string[] = [];
          for (;;) {
            const w = stack.pop()!;
            onStack.delete(w);
            scc.push(w);
            if (w === v) break;
          }
          out.push(scc);
        }
      }
    }
  }
  return out;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
