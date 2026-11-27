import { describe, expect, it } from "vitest";
import type { BusEnvelope } from "../../dispatcher/core/event-bus";
import { waitingItemsOf } from "./wire-waiting";

const lunch: BusEnvelope = {
  source: "timer_scheduler",
  event_name: "schedule.lunch",
  ts: 1_000,
  payload: { cue_id: "lunch", label: "Lunch", time: "12:00" },
};
const screen: BusEnvelope = {
  source: "screen_watcher",
  event_name: "proactive.screen_app_switched",
  ts: 2_000,
  payload: { transition: "app_switched", app: "Slack", dwell_min: 2 },
};
const addressed: BusEnvelope = {
  source: "addressed_source",
  event_name: "addressed.character",
  ts: 3_000,
  payload: { name: "alice", line: "bob, you took my chair" },
};
const group = {
  envelope: {
    source: "github",
    event_type: "pr_review",
    delivery: "batched" as const,
    event_id: "d-42",
    occurred_at: 4_000,
  },
  items: [{ pr: 12 }],
};

describe("waitingItemsOf", () => {
  it("maps each waiting entry through the projection and adds each buffered signal group", () => {
    expect(
      waitingItemsOf({
        dispatcher: {
          waiting: () => [
            { id: "w1", env: lunch, cls: "scheduled" },
            { id: "w2", env: screen, cls: "room" },
            { id: "w3", env: addressed, cls: "now" },
          ],
        },
        signals: { peek: () => [group] },
      }),
    ).toEqual([
      {
        id: "w1",
        kind: "schedule",
        label: "Lunch",
        at: 1_000,
        detail: { kind: "schedule", at: 1_000, cue: { label: "Lunch" } },
      },
      {
        id: "w2",
        kind: "screen",
        label: "Slack",
        at: 2_000,
        detail: {
          kind: "proactive",
          at: 2_000,
          screen: { transition: "app_switched", app: "Slack", dwell_min: 2 },
        },
      },
      {
        id: "w3",
        kind: "addressed",
        label: "alice",
        at: 3_000,
        detail: {
          kind: "addressed",
          at: 3_000,
          addressed: { from: "alice", text: "bob, you took my chair", ts: 3_000 },
        },
      },
      { id: "sig:d-42", kind: "signal", label: "github/pr_review", at: 4_000, detail: group },
    ]);
  });
});
