import type { Thread, ThreadsSnapshot } from "../../../src/contract";
export type Recording = {
  cols: number;
  rows: number;
  /** `final` is the time of the last snapshot. */
  marks: { ready: number; final: number; end: number };
  events: [number, string][];
  snapshots: { t: number; threads: Thread[] }[];
};

export const store = (() => {
  const threads = new Map<string, Thread>(),
    listeners = new Set<(snapshot: ThreadsSnapshot) => void>();
  let revision = 0,
    wall0 = 0;
  const publish = () => {
    const list = [...threads.values()]
      .sort((a, b) => b.updated_at - a.updated_at)
      .map((th) => ({ ...th, entries: th.entries.map((e) => ({ ...e })) }));
    revision += 1;
    for (const l of listeners) l({ revision, threads: list });
  };
  return {
    subscribe(l: (snapshot: ThreadsSnapshot) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    begin(at: number) {
      wall0 = Date.now() - at * 1000;
    },
    fromRecording(s: Recording["snapshots"][number], firstAt: number) {
      threads.clear();
      for (const th of s.threads) {
        const abs = (ms: number) => wall0 + firstAt * 1000 + ms;
        threads.set(th.id, {
          ...th,
          created_at: abs(th.created_at),
          updated_at: abs(th.updated_at),
          entries: th.entries.map((e) => ({ ...e, at: abs(e.at) })),
        });
      }
      publish();
    },
    read(id: string) {
      const th = threads.get(id);
      if (th) {
        th.read = true;
        publish();
      }
    },
  };
})();
