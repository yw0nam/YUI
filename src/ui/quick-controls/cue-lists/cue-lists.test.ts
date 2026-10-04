// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProactiveSettings } from "../../../settings/cues/proactive-settings";
import { createScheduleSettings } from "../../../settings/cues/schedule-settings";
import { mountCueLists } from "./cue-lists";

const SECTION = '[data-testid="cue-section"]';

type Subscribable = { subscribe(cb: never): () => void };

/** Counts the store's live listeners and logs `sub:`/`unsub:` per label. */
function watch(store: Subscribable, order: string[], label: string) {
  const state = { live: 0 };
  const real = store.subscribe.bind(store) as (cb: unknown) => () => void;
  vi.spyOn(store, "subscribe").mockImplementation(((cb: unknown) => {
    state.live++;
    order.push(`sub:${label}`);
    const off = real(cb);
    return () => {
      order.push(`unsub:${label}`);
      state.live--;
      off();
    };
  }) as never);
  return state;
}

function setup() {
  const scheduleMount = document.createElement("div");
  const proactiveMount = document.createElement("div");
  const scheduleSettings = createScheduleSettings();
  const proactiveSettings = createProactiveSettings();
  const order: string[] = [];
  const schedule = watch(scheduleSettings, order, "schedule");
  const proactive = watch(proactiveSettings, order, "proactive");
  const cueLists = mountCueLists({
    scheduleMount,
    proactiveMount,
    scheduleSettings,
    proactiveSettings,
  });
  return { cueLists, scheduleMount, proactiveMount, schedule, proactive, order };
}

describe("mountCueLists", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts the schedule list and the proactive list each into its own mount, replacing prior content", () => {
    const scheduleMount = document.createElement("div");
    const proactiveMount = document.createElement("div");
    scheduleMount.innerHTML = '<i class="stale"></i>';
    proactiveMount.innerHTML = '<i class="stale"></i>';

    mountCueLists({
      scheduleMount,
      proactiveMount,
      scheduleSettings: createScheduleSettings(),
      proactiveSettings: createProactiveSettings(),
    });

    expect(scheduleMount.querySelectorAll(SECTION)).toHaveLength(1);
    expect(proactiveMount.querySelectorAll(SECTION)).toHaveLength(1);
    expect(scheduleMount.querySelector(".stale")).toBeNull();
    expect(proactiveMount.querySelector(".stale")).toBeNull();
  });

  it("subscribes the schedule store before the proactive store", () => {
    const { order } = setup();

    expect(order).toEqual(["sub:schedule", "sub:proactive"]);
  });

  it("destroy removes both sections and leaves no listener on either store", () => {
    const { cueLists, scheduleMount, proactiveMount, schedule, proactive } = setup();
    expect([schedule.live, proactive.live]).toEqual([1, 1]);

    cueLists.destroy();

    expect(scheduleMount.querySelector(SECTION)).toBeNull();
    expect(proactiveMount.querySelector(SECTION)).toBeNull();
    expect([schedule.live, proactive.live]).toEqual([0, 0]);
  });

  it("destroys the schedule list before the proactive list", () => {
    const { cueLists, order } = setup();
    order.length = 0;

    cueLists.destroy();

    expect(order).toEqual(["unsub:schedule", "unsub:proactive"]);
  });
});
