import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SignalEnvelope, SignalGroup } from "../../contract";
import type { SignalRecord } from "../../io/chat/conversation/signal-history-store";
import { createSignalChipsModel } from "./signal-chips-model";

const MIN = 60_000;

function group(event_id: string, over: Partial<SignalEnvelope> = {}): SignalGroup {
  return {
    envelope: {
      source: "github",
      event_type: "ci.failed",
      delivery: "batched",
      event_id,
      occurred_at: 1,
      ...over,
    },
    items: [{ run: event_id }],
  };
}

function fakeHistory() {
  let rows: SignalRecord[] = [];
  const subs = new Set<() => void>();
  return {
    records: () => rows,
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    set(next: SignalRecord[]) {
      rows = next;
      for (const cb of subs) cb();
    },
  };
}

const row = (event_id: string, said: string | null): SignalRecord => ({
  turn_id: "t1",
  event_id,
  source: "github",
  event_type: "ci.failed",
  label: null,
  delivery: "batched",
  ts: 1,
  said,
});

describe("createSignalChipsModel", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it("lists the newest group first", () => {
    const model = createSignalChipsModel({ history: fakeHistory() });
    model.add(group("a"));
    model.add(group("b"));

    expect(model.list().map((i) => i.group.envelope.event_id)).toEqual(["b", "a"]);
  });

  it("a repeated event id replaces the group in place and keeps the first received time", () => {
    const model = createSignalChipsModel({ history: fakeHistory() });
    model.add(group("a"));
    model.add(group("b"));
    vi.advanceTimersByTime(5 * MIN);
    model.add(group("a", { label: "again" }));

    const [first, second] = model.list();
    expect(first!.group.envelope.event_id).toBe("b");
    expect(second!.group.envelope.label).toBe("again");
    expect(second!.received_at).toBe(1_000_000);
  });

  it("dismiss removes the chip and tells subscribers", () => {
    const model = createSignalChipsModel({ history: fakeHistory() });
    const seen = vi.fn();
    model.add(group("a"));
    model.subscribe(seen);

    model.dismiss("a");

    expect(model.list()).toEqual([]);
    expect(seen).toHaveBeenCalledOnce();
  });

  it("reads the deprecated immediate delivery as batched", () => {
    const model = createSignalChipsModel({ history: fakeHistory() });
    model.add(group("a", { delivery: "immediate" }));

    expect(model.list()[0]!.delivery).toBe("batched");
    expect(model.list()[0]!.group.envelope.delivery).toBe("immediate");
  });

  it.each([
    "batched",
    "immediate",
  ] as const)("a %s chip leaves 30 minutes after it arrived while an urgent one stays", (delivery) => {
    const model = createSignalChipsModel({ history: fakeHistory() });
    model.add(group("slow", { delivery }));
    model.add(group("hot", { delivery: "urgent" }));

    vi.advanceTimersByTime(29 * MIN);
    expect(model.list()).toHaveLength(2);

    vi.advanceTimersByTime(MIN);
    expect(model.list().map((i) => i.group.envelope.event_id)).toEqual(["hot"]);

    vi.advanceTimersByTime(24 * 60 * MIN);
    expect(model.list()).toHaveLength(1);
  });

  it("said follows the history record with the same event id", () => {
    const history = fakeHistory();
    const model = createSignalChipsModel({ history });
    const seen = vi.fn();
    model.add(group("a"));
    model.subscribe(seen);
    expect(model.list()[0]!.said).toBeNull();

    history.set([row("a", null), row("zzz", "elsewhere")]);
    expect(model.list()[0]!.said).toBeNull();

    history.set([row("a", null), row("a", "Build broke."), row("zzz", "elsewhere")]);
    expect(model.list()[0]!.said).toBe("Build broke.");
    expect(seen).toHaveBeenCalledTimes(2);
  });

  it("a group added after its turn was recorded reads the said already stored", () => {
    const history = fakeHistory();
    history.set([row("a", "Already said.")]);
    const model = createSignalChipsModel({ history });

    model.add(group("a"));

    expect(model.list()[0]!.said).toBe("Already said.");
  });
});
