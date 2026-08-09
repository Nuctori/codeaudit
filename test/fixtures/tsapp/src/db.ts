import * as fs from "fs";

export interface User { id: number; name: string }

export function saveUser(u: User): void {
  fs.writeFileSync(`user-${u.id}.json`, JSON.stringify(u));
}

export function loadUser(id: number): User {
  const raw = fs.readFileSync(`user-${id}.json`, "utf8");
  return JSON.parse(raw) as User;
}
