import type { Thread } from "../../../src/contract";
import recording from "../cc.json";
export type Recording = {
  cols: number;
  rows: number;
  marks: { ready: number; answer: number; end: number };
  events: [number, string][];
  snapshots: { t: number; threads: Thread[] }[];
};
export const CC = recording as unknown as Record<"allow" | "deny", Recording>;
for (const r of Object.values(CC)) {
  const ask = r.snapshots.findIndex((s) =>
    s.threads.some((th) => th.ask?.prompt === "Allow Bash?"),
  );
  const own = r.snapshots.findIndex((s, i) => i > ask && s.threads.every((th) => !th.ask));
  if (ask >= 0 && own > ask) r.snapshots.splice(own, 1);
}
