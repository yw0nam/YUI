import { describe, expect, it, vi } from "vitest";
import {
  createSignalHistoryStore,
  type SignalHistoryStorage,
  type SignalRecord,
} from "./signal-history-store";

function record(over: Partial<SignalRecord> = {}): SignalRecord {
  return {
    turn_id: "t1",
    source: "github",
    event_type: "issue.opened",
    label: null,
    delivery: "batched",
    ts: 1_000,
    said: null,
    ...over,
  };
}

/** Storage that hands back a pre-seeded value, well-formed or not. */
function seeded(records: unknown): SignalHistoryStorage {
  return { load: () => records as SignalRecord[], save: vi.fn() };
}

describe("createSignalHistoryStore", () => {
  it("append then records() returns the records oldest first", () => {
    const store = createSignalHistoryStore();
    store.append([record({ turn_id: "t1", ts: 1 }), record({ turn_id: "t2", ts: 2 })]);

    expect(store.records()).toEqual([
      record({ turn_id: "t1", ts: 1 }),
      record({ turn_id: "t2", ts: 2 }),
    ]);
  });

  it("records() returns a copy — mutating it leaves the store alone", () => {
    const store = createSignalHistoryStore();
    store.append([record()]);

    const copy = store.records();
    copy[0]!.said = "mutated";

    expect(store.records()).toEqual([record()]);
  });

  it("the 201st record evicts the oldest", () => {
    const store = createSignalHistoryStore();
    const records: SignalRecord[] = [];
    for (let i = 1; i <= 201; i++) records.push(record({ turn_id: `t${i}`, ts: i }));

    store.append(records);

    expect(store.records()).toHaveLength(200);
    expect(store.records()[0]).toEqual(record({ turn_id: "t2", ts: 2 }));
    expect(store.records()[199]).toEqual(record({ turn_id: "t201", ts: 201 }));
  });

  it("setSaid fills said of that turn's records that do not know it yet", () => {
    const store = createSignalHistoryStore();
    store.append([
      record({ turn_id: "t1", source: "a" }),
      record({ turn_id: "t1", source: "b", said: "kept" }),
      record({ turn_id: "t2", source: "c" }),
    ]);

    store.setSaid("t1", "hello");

    expect(store.records()).toEqual([
      record({ turn_id: "t1", source: "a", said: "hello" }),
      record({ turn_id: "t1", source: "b", said: "kept" }),
      record({ turn_id: "t2", source: "c" }),
    ]);
  });

  it("setSaid is a no-op when no record of the turn is stored", () => {
    const store = createSignalHistoryStore();
    store.append([record({ turn_id: "t1" })]);

    store.setSaid("t9", "hello");

    expect(store.records()).toEqual([record({ turn_id: "t1" })]);
  });

  it("a stored array with one malformed row keeps the good rows", () => {
    const store = createSignalHistoryStore({
      storage: seeded([
        record({ turn_id: "good" }),
        { turn_id: 7 },
        { ...record(), delivery: "bogus" },
        { ...record(), delivery: null },
      ]),
    });

    expect(store.records()).toEqual([record({ turn_id: "good" })]);
  });

  it("a stored non-array leaves the store empty", () => {
    const store = createSignalHistoryStore({ storage: seeded("corrupted") });

    expect(store.records()).toEqual([]);
  });

  it("a stored non-empty array with no good row is rejected whole", () => {
    const store = createSignalHistoryStore({ storage: seeded([{ turn_id: 7 }, { source: 1 }]) });

    expect(store.records()).toEqual([]);
  });

  it("a stored delivery of immediate is kept as batched", () => {
    const store = createSignalHistoryStore({
      storage: seeded([{ ...record(), delivery: "immediate" }]),
    });

    expect(store.records()).toEqual([record()]);
  });
});
