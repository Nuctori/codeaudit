export function f(): string {
  return new Date().toISOString();
}
export function g() {
  const d = new Date();
  return d.toISOString();
}
