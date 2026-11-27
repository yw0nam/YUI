/** waiting-api.test.ts — yui.waiting lists the waiting rows and reads one in full. */

process.env.TZ = "UTC";

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWaitingApi, type WaitingItem } from "./waiting-api";

const previousTz = process.env.TZ;
afterAll(() => {
  process.env.TZ = previousTz;
});

const NOW = Date.UTC(2026, 0, 3, 5, 6); // 2026-01-03 05:06 local
const MIN = 60_000;
const signal = new AbortController().signal;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const GROUP = {
  envelope: {
    source: "github",
    event_type: "pr_review",
    delivery: "batched" as const,
    event_id: "d-42",
    occurred_at: NOW - 9 * MIN,
  },
  items: [{ pr: 12 }],
};

const entry = (over: Partial<WaitingItem> = {}): WaitingItem => ({
  id: "w3",
  kind: "schedule",
  label: "Lunch",
  at: NOW - 40 * MIN,
  detail: { kind: "schedule", at: NOW - 40 * MIN, cue: { label: "Lunch" } },
  ...over,
});

const api = (items: WaitingItem[]) => createWaitingApi({ waiting: () => items });

describe("yui.waiting.list", () => {
  it("writes one short row per entry and signal group with the local clock and minutes waited", async () => {
    const list = api([
      entry(),
      entry({ id: "w5", kind: "milestone", label: "first_activity", at: NOW - 120 * MIN }),
      {
        id: "sig:d-42",
        kind: "signal",
        label: "github/pr_review",
        at: GROUP.envelope.occurred_at,
        detail: GROUP,
      },
    ]).methods.list;

    expect(await list(signal)).toEqual([
      'w3 schedule "Lunch" 04:26 local, 40min',
      'w5 milestone "first_activity" 03:06 local, 120min',
      "sig:d-42 signal github/pr_review 04:57 local, 9min",
    ]);
    expect(await api([]).methods.list(signal)).toEqual([]);
  });
});

describe("yui.waiting.read", () => {
  it("answers one entry or one signal group in full, and an unknown id as an error value", async () => {
    const waiting = api([
      entry(),
      {
        id: "sig:d-42",
        kind: "signal",
        label: "github/pr_review",
        at: GROUP.envelope.occurred_at,
        detail: GROUP,
      },
    ]);

    expect(await waiting.methods.read(signal, "w3")).toEqual(entry().detail);
    expect(await waiting.methods.read(signal, "sig:d-42")).toEqual(GROUP);
    expect(await waiting.methods.read(signal, "nope")).toBe("error: unknown waiting item: nope");
  });

  it("throws for an id that is not a non-empty string", async () => {
    await expect(api([entry()]).methods.read(signal, 5)).rejects.toThrow(
      new TypeError("yui.waiting.read: id must be a non-empty string"),
    );
  });
});
