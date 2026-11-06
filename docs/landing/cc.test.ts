import { expect, it } from "vitest";
import recording from "./cc.json";
import type { Recording } from "./session/thread-store";

const CC = recording as unknown as Record<"allow" | "deny", Recording>;
const asks = (s: Recording["snapshots"][number]) => s.threads.flatMap((th) => th.ask?.prompt ?? []);

it.each([
  "allow",
  "deny",
] as const)("the %s recording leaves the permission ask open until the closing ask", (name) => {
  const { snapshots } = CC[name];
  const ask = snapshots.findIndex((s) => asks(s).includes("Allow Bash?"));
  const next = snapshots.findIndex((s) => asks(s).includes("What next?"));
  expect(ask).toBeGreaterThanOrEqual(0);
  expect(next).toBeGreaterThan(ask);
  expect(snapshots.slice(ask + 1, next).filter((s) => asks(s).length === 0)).toEqual([]);
});
