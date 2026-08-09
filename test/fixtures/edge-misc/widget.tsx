import * as fs from "fs";

export function Widget(name: string) {
  return <div className="w">{name}</div>;
}

export function persist(name: string): void {
  fs.writeFileSync("w.txt", name);
}
