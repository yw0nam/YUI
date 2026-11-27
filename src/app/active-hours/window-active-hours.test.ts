/**
 * window-active-hours.test.ts — one pet window's pacing and hold.
 *
 * Pins the gap the base and span paces scale, the minute-boundary recompute, the
 * off span's do-not-disturb, Rest and quiet with their ends, edited spans over the card,
 * and per-window independence.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validatePersona } from "../../config/validators/persona/persona";
import type { PersonaConfig } from "../../config/validators/persona/types";
import { createActiveHoursSettings } from "../../settings/active-hours/active-hours-settings";
import {
  type BasePace,
  createBasePaceSettings,
} from "../../settings/active-hours/base-pace-settings";
import type { Span } from "../../settings/active-hours/spans";
import { createAgentSettings } from "../../settings/backend/agent-settings";
import type { PersistedStorage } from "../../settings/persisted-store";
import type { RestChoice } from "../../settings/rest/rest-choices";
import { createRestSettings } from "../../settings/rest/rest-settings";
import { createPacerGapStore } from "../../settings/settings-stores";
import { setLocale } from "../../ui/i18n";
import { createWindowActiveHours, type WindowActiveHours } from "./window-active-hours";

const PERSONA: PersonaConfig = validatePersona(
  "configs/persona.json",
  JSON.parse(readFileSync(resolve(process.cwd(), "configs/persona.json"), "utf-8")),
);

function memoryStorage<T>(): PersistedStorage<T> {
  let saved: T | null = null;
  return {
    load: () => saved,
    save: (s) => {
      saved = s;
    },
  };
}

const handles: WindowActiveHours[] = [];

function build(opts: { spans?: Span[]; rest?: RestChoice; gapMs?: number; base?: BasePace } = {}) {
  const activeHoursSettings = createActiveHoursSettings({ storage: memoryStorage() });
  const basePaceSettings = createBasePaceSettings({ storage: memoryStorage() });
  const agentSettings = createAgentSettings({ storage: memoryStorage() });
  const pacerGapSettings = createPacerGapStore(memoryStorage());
  const restSettings = createRestSettings({ storage: memoryStorage() });
  if (opts.rest) restSettings.start(opts.rest);
  if (opts.gapMs !== undefined) pacerGapSettings.set(opts.gapMs);
  if (opts.spans) activeHoursSettings.setSpans(opts.spans);
  if (opts.base) basePaceSettings.setPace(opts.base);
  const handle = createWindowActiveHours({
    activeHoursSettings,
    basePaceSettings,
    agentSettings,
    pacerGapSettings,
    restSettings,
  });
  handle.setPersona(PERSONA);
  handles.push(handle);
  return {
    handle,
    activeHoursSettings,
    basePaceSettings,
    agentSettings,
    pacerGapSettings,
    restSettings,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  setLocale("en");
});

afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  vi.useRealTimers();
});

describe("createWindowActiveHours", () => {
  it.each([
    [9, 1_800_000],
    [14, 600_000],
    [23, 300_000],
  ])("at %i:00 a 10-minute gap reads %i ms by Yui's card spans", (hour, expected) => {
    vi.setSystemTime(new Date(2026, 10, 19, hour, 0, 0));
    const { handle } = build({ gapMs: 600_000 });

    expect(handle.gapMs()).toBe(expected);
  });

  it.each([
    [9, 3],
    [14, 1],
    [23, 0.5],
  ])("at %i:00 the pace factor is %f by Yui's card spans", (hour, expected) => {
    vi.setSystemTime(new Date(2026, 10, 19, hour, 0, 0));
    const { handle } = build({ gapMs: 600_000 });

    expect(handle.paceFactor()).toBe(expected);
  });

  it("crossing 12:00 fires subscribeGap once and the gap becomes 10 minutes", () => {
    vi.setSystemTime(new Date(2026, 10, 19, 11, 59, 30));
    const { handle } = build({ gapMs: 600_000 });
    const cb = vi.fn();
    handle.subscribeGap(cb);
    expect(handle.gapMs()).toBe(1_800_000);

    vi.advanceTimersByTime(30_000);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(handle.gapMs()).toBe(600_000);
  });

  it("an off span enables this pet window's do-not-disturb at 13:00 and clears it at 14:00", () => {
    vi.setSystemTime(new Date(2026, 10, 19, 12, 59, 0));
    const { handle } = build({ spans: [{ start: "13:00", end: "14:00", pace: "off" }] });
    expect(handle.dnd.get()).toEqual({ enabled: false });
    const cb = vi.fn();
    handle.dnd.subscribe(cb);

    vi.advanceTimersByTime(60_000);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenNthCalledWith(1, { enabled: true });

    vi.advanceTimersByTime(3_600_000);
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(2, { enabled: false });
  });

  it("with Rest on, the off span's boundaries notify nothing", () => {
    vi.setSystemTime(new Date(2026, 10, 19, 12, 59, 0));
    const { handle } = build({
      rest: "until_off",
      spans: [{ start: "13:00", end: "14:00", pace: "off" }],
    });
    const cb = vi.fn();
    handle.dnd.subscribe(cb);
    expect(handle.dnd.get()).toEqual({ enabled: true });

    vi.advanceTimersByTime(60_000 + 3_600_000);

    expect(handle.dnd.get()).toEqual({ enabled: true });
    expect(cb).not.toHaveBeenCalled();
  });

  it("edited spans override the card, and reset() returns to the card's spans with a notification", () => {
    vi.setSystemTime(new Date(2026, 10, 19, 9, 0, 0));
    const { handle, activeHoursSettings } = build({ gapMs: 600_000 });
    const cb = vi.fn();
    handle.subscribeGap(cb);
    expect(handle.gapMs()).toBe(1_800_000);

    activeHoursSettings.setSpans([{ start: "08:00", end: "12:00", pace: "high" }]);
    expect(handle.gapMs()).toBe(300_000);

    activeHoursSettings.reset();
    expect(handle.gapMs()).toBe(1_800_000);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("two pet windows with different spans pace independently at the same time", () => {
    vi.setSystemTime(new Date(2026, 10, 19, 9, 0, 0));
    const a = build({ gapMs: 600_000, spans: [{ start: "08:00", end: "12:00", pace: "high" }] });
    const b = build({ gapMs: 600_000, spans: [{ start: "08:00", end: "12:00", pace: "low" }] });

    expect(a.handle.gapMs()).toBe(300_000);
    expect(b.handle.gapMs()).toBe(1_800_000);
  });

  it("a low base pace and the 23:00 span read a 1.5 factor and a 15-minute gap", () => {
    vi.setSystemTime(new Date(2026, 10, 19, 23, 0, 0));
    const { handle } = build({ gapMs: 600_000, base: "low" });

    expect(handle.paceFactor()).toBe(1.5);
    expect(handle.gapMs()).toBe(900_000);
  });

  it("a base pace change fires subscribeGap once and rescales the gap", () => {
    vi.setSystemTime(new Date(2026, 10, 19, 23, 0, 0));
    const { handle, basePaceSettings } = build({ gapMs: 600_000 });
    const cb = vi.fn();
    handle.subscribeGap(cb);
    expect(handle.gapMs()).toBe(300_000);

    basePaceSettings.setPace("low");

    expect(cb).toHaveBeenCalledTimes(1);
    expect(handle.gapMs()).toBe(900_000);
  });

  it("a gap store edit fires subscribeGap with the scaled value", () => {
    vi.setSystemTime(new Date(2026, 10, 19, 9, 0, 0));
    const { handle, pacerGapSettings } = build({ gapMs: 600_000 });
    const cb = vi.fn();
    handle.subscribeGap(cb);

    pacerGapSettings.set(1_200_000);

    expect(cb).toHaveBeenCalledTimes(1);
    expect(handle.gapMs()).toBe(3_600_000);
  });
});

const at = (h: number, m: number, s = 0) => new Date(2026, 10, 19, h, m, s).getTime();

describe("rest()", () => {
  it("reads a Rest until its exact end, then null", () => {
    vi.setSystemTime(at(21, 10));
    const { handle } = build({ rest: "hour", spans: [] });

    expect([handle.rest(at(22, 9, 59) + 999), handle.rest(at(22, 10))]).toEqual([
      { kind: "rest", choice: "hour", startedAt: at(21, 10), endsAt: at(22, 10) },
      null,
    ]);
  });

  it("reads null past the end when a late timer has not fired yet", () => {
    vi.setSystemTime(at(21, 10));
    const { handle } = build({ rest: "hour", spans: [] });
    const running = handle.rest()?.choice;

    vi.setSystemTime(at(23, 0));

    expect([running, handle.rest(), handle.dnd.get()]).toEqual(["hour", null, { enabled: false }]);
  });

  it("reads quiet with the span's end once a Rest ends inside an off span", () => {
    vi.setSystemTime(at(13, 30));
    const { handle } = build({
      rest: "hour",
      spans: [{ start: "13:00", end: "15:00", pace: "off" }],
    });

    expect(handle.rest(at(14, 40))).toEqual({ kind: "quiet", endsAt: at(15, 0) });
  });

  it.each([
    [
      "overlapping off spans",
      [
        { start: "13:00", end: "14:00", pace: "off" },
        { start: "13:30", end: "16:00", pace: "off" },
      ],
      at(13, 10),
      at(16, 0),
    ],
    [
      "contiguous off spans across midnight",
      [
        { start: "22:00", end: "00:00", pace: "off" },
        { start: "00:00", end: "07:00", pace: "off" },
      ],
      at(23, 0),
      new Date(2026, 10, 20, 7, 0).getTime(),
    ],
  ] as const)("reads quiet to the end of %s", (_name, spans, now, endsAt) => {
    vi.setSystemTime(now);
    const { handle } = build({ spans: [...spans] });

    expect(handle.rest()).toEqual({ kind: "quiet", endsAt });
  });

  it("reads an all-day quiet with no end", () => {
    vi.setSystemTime(at(10, 0));
    const { handle } = build({ spans: [{ start: "00:00", end: "00:00", pace: "off" }] });

    expect(handle.rest()).toEqual({ kind: "quiet" });
  });
});

describe("subscribeRest", () => {
  it("notifies a Focus at each elapsed minute since it started, not at the clock's minute", () => {
    vi.setSystemTime(at(10, 0, 20));
    const { handle } = build({ rest: "focus_25", spans: [] });
    const cb = vi.fn();
    handle.subscribeRest(cb);

    vi.advanceTimersByTime(40_000);
    const atMinute = cb.mock.calls.length;
    vi.advanceTimersByTime(20_000);

    expect([atMinute, cb.mock.calls.length]).toEqual([0, 1]);
  });

  it("notifies at a Rest's end without a click", () => {
    vi.setSystemTime(at(21, 10, 30));
    const { handle } = build({ rest: "hour", spans: [] });
    const cb = vi.fn();
    handle.subscribeRest(cb);

    vi.advanceTimersByTime(3_599_999);
    const before = cb.mock.calls.length;
    vi.advanceTimersByTime(1);

    expect([before, cb.mock.calls.length, handle.rest()]).toEqual([0, 1, null]);
  });

  it.each([
    ["00:00", at(23, 59, 30)],
    ["08:00", at(7, 59, 30)],
  ])("notifies at %s, where the Rest list's rows change, with nothing else changing", (_clock, now) => {
    vi.setSystemTime(now);
    const { handle } = build({ spans: [] });
    const cb = vi.fn();
    handle.subscribeRest(cb);

    vi.advanceTimersByTime(30_000);

    expect(cb).toHaveBeenCalledTimes(1);
  });
});
