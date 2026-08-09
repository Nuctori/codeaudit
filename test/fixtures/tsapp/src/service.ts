import { saveUser } from "./index";
import { isValid, titleCase } from "./util";

export class UserService {
  save(raw: { id: number; name: string }): boolean {
    if (!isValid(raw)) {
      return false;
    }
    const user = { id: raw.id, name: titleCase(raw.name) };
    saveUser(user);
    return true;
  }

  batch(items: Array<{ id: number; name: string }>): number {
    let ok = 0;
    for (const item of items) {
      if (this.save(item)) {
        ok++;
      }
    }
    return ok;
  }
}

export function makeService(): UserService {
  return new UserService();
}
