import { stepB } from "./cycB";

export function stepA(n: number): number {
  if (n <= 0) {
    return 0;
  }
  return stepB(n - 1);
}
