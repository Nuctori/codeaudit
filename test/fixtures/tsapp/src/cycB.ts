import { stepA } from "./cycA";

export function stepB(n: number): number {
  if (n <= 0) {
    return 1;
  }
  return stepA(n - 1);
}
