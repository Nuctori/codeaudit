import { makeService } from "./service";
import { obscure } from "some-lib";

interface Req { auth: boolean; users: Array<{ id: number; name: string }> }

export function handle(req: Req): number {
  console.log("incoming request");
  if (!req.auth) {
    return 0;
  }
  const svc = makeService();
  return svc.batch(req.users);
}

export function risky(input: string): unknown {
  return obscure(input);
}
