import { describe, expect, it } from "vitest";
import type { BusEnvelope } from "./event-bus";
import { createWaitingList } from "./waiting-list";

/** Local wall-clock epoch, so the day ends fall on local midnight in any zone. */
const at = (h: number, m = 0, day = 27): number => new Date(2026, 10, day, h, m).getTime();

const idle = (cue_id: string, ts: number): BusEnvelope => ({
  source: "timer_scheduler",
  event_name: `proactive.${cue_id}`,
  ts,
  payload: { cue_id, label: cue_id },
});
const screen = (ts: number): BusEnvelope => ({
  source: "screen_watcher",
  event_name: "proactive.screen_app_switched",
  ts,
  payload: { transition: "app_switched", app: "Code" },
});
const gesture = (ts: number): BusEnvelope => ({
  source: "os_event_watcher",
  event_name: "proactive.touch_face",
  ts,
  payload: { cue_id: "touch_face", label: "poked" },
});
const schedule = (ts: number, expires_at = at(14)): BusEnvelope => ({
  source: "timer_scheduler",
  event_name: "schedule.cue",
  ts,
  payload: { cue_id: "cue", label: "cue", time: "12:00", expires_at },
});
const milestone = (ts: number): BusEnvelope => ({
  source: "os_event_watcher",
  event_name: "time_milestone.first_activity",
  ts,
  payload: { name: "first_activity", local_time: "09:00" },
});
const addressed = (ts: number): BusEnvelope => ({
  source: "addressed_source",
  event_name: "addressed.character",
  ts,
  payload: { from: "perlica", name: "Perlica", line: "hi" },
});

const namesOf = (entries: { env: BusEnvelope }[]): string[] =>
  entries.map((e) => `${e.env.event_name}@${e.env.ts}`);

describe("waiting list — keep rules", () => {
  it("keeps the newest idle cue per cue id and evicts the older one", () => {
    const list = createWaitingList();
    list.add(idle("stretch", 1));
    list.add(idle("water", 2));
    const { evicted } = list.add(idle("stretch", 3));
    expect(namesOf(evicted)).toEqual(["proactive.stretch@1"]);
    expect(namesOf(list.snapshot())).toEqual(["proactive.water@2", "proactive.stretch@3"]);
  });

  it("keeps the newest three screen reactions", () => {
    const list = createWaitingList();
    for (const ts of [1, 2, 3]) list.add(screen(ts));
    const { evicted } = list.add(screen(4));
    expect(namesOf(evicted)).toEqual(["proactive.screen_app_switched@1"]);
    expect(list.snapshot().map((e) => e.env.ts)).toEqual([2, 3, 4]);
  });

  it("holds at most ten entries, evicting the lowest class first, then the oldest", () => {
    const list = createWaitingList();
    list.add(idle("a", 5));
    list.add(idle("b", 1));
    list.add(schedule(at(12)));
    for (let i = 0; i < 7; i++) list.add(gesture(10 + i));
    const { evicted } = list.add(gesture(20));
    expect(namesOf(evicted)).toEqual(["proactive.b@1"]);
    const second = list.add(gesture(21));
    expect(namesOf(second.evicted)).toEqual(["proactive.a@5"]);
    expect(list.snapshot()).toHaveLength(10);
  });
});

describe("waiting list — rank order and putBack", () => {
  it("takes in class order, then oldest first, and putBack keeps ids and times", () => {
    const list = createWaitingList();
    list.add(idle("stretch", 1));
    list.add(schedule(at(12)));
    list.add(gesture(3));
    list.add(milestone(2));
    const taken = list.take(() => true);
    expect(namesOf(taken)).toEqual([
      "time_milestone.first_activity@2",
      "proactive.touch_face@3",
      `schedule.cue@${at(12)}`,
      "proactive.stretch@1",
    ]);
    expect(taken.map((e) => e.cls)).toEqual(["now", "now", "scheduled", "room"]);
    expect(list.snapshot()).toEqual([]);

    list.putBack(taken);
    expect(list.snapshot()).toEqual(taken);
  });

  it("take leaves the entries the predicate refuses", () => {
    const list = createWaitingList();
    list.add(idle("stretch", 1));
    list.add(gesture(2));
    expect(namesOf(list.take((e) => e.cls === "now"))).toEqual(["proactive.touch_face@2"]);
    expect(namesOf(list.snapshot())).toEqual(["proactive.stretch@1"]);
  });
});

describe("waiting list — expiry", () => {
  it("expires the first meeting and an addressed line at the end of their local day", () => {
    const list = createWaitingList();
    list.add(milestone(at(9)));
    list.add(addressed(at(22)));
    expect(list.expire(at(23, 59))).toEqual([]);
    expect(namesOf(list.expire(at(0, 0, 28)))).toEqual([
      `time_milestone.first_activity@${at(9)}`,
      `addressed.character@${at(22)}`,
    ]);
  });

  it("expires a schedule cue at the expires_at its source stamped", () => {
    const list = createWaitingList();
    list.add(schedule(at(12, 30), at(14)));
    expect(list.expire(at(13, 59))).toEqual([]);
    expect(list.expire(at(14))).toHaveLength(1);
  });

  it("expires idle cues, gesture reactions and screen reactions on user activity, and keeps the rest", () => {
    const list = createWaitingList();
    list.add(idle("stretch", 1));
    list.add(gesture(2));
    list.add(screen(3));
    list.add(schedule(at(12)));
    list.add(milestone(at(9)));
    expect(namesOf(list.expireOnActivity())).toEqual([
      "proactive.touch_face@2",
      "proactive.stretch@1",
      "proactive.screen_app_switched@3",
    ]);
    expect(namesOf(list.snapshot())).toEqual([
      `time_milestone.first_activity@${at(9)}`,
      `schedule.cue@${at(12)}`,
    ]);
    expect(list.expire(at(13))).toEqual([]);
  });
});
