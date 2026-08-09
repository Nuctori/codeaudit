export function isValid(u: { name?: string }): boolean {
  return typeof u.name === "string" && u.name.length > 0;
}

export function titleCase(s: string): string {
  return s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
