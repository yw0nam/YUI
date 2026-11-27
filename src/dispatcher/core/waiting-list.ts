// Test-commit stub, replaced in the implementation commit.
import type { BusEnvelope } from "./event-bus";

type Entry = { id: string; env: BusEnvelope; cls: string };

export function createWaitingList() {
  return {
    add: (_env: BusEnvelope) => ({ entry: undefined as never as Entry, evicted: [] as Entry[] }),
    expire: (_now: number): Entry[] => [],
    expireOnActivity: (): Entry[] => [],
    take: (_pred: (e: Entry) => boolean): Entry[] => [],
    putBack: (_entries: Entry[]): void => {},
    snapshot: (): Entry[] => [],
  };
}
