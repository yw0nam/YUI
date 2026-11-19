/**
 * window-active-hours.test.ts — one pet window's pacing and hold.
 *
 * Pins the gap the base and span paces scale, the minute-boundary recompute, the
 * off span's do-not-disturb, edited spans over the card, and per-window independence.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validatePersona } from "../../config/validators/persona/persona";
import type { PersonaConfig } from "../../config/validators/persona/types";
import { createActiveHoursSettings } from "../../settings/active-hours/active-hours-settings";
import { createBasePaceSettings, type BasePace } from "../../settings/active-hours/base-pace-settings";
import type { Span } from "../../settings/active-hours/spans";
import { createAgentSettings } from "../../settings/backend/agent-settings";
import { createFlagSettings, type PersistedStorage } from "../../settings/persisted-store";
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

function build(opts: { spans?: Span[]; dnd?: boolean; gapMs?: number; base?: BasePace } = {}) {
  const activeHoursSettings = createActiveHoursSettings({ storage: memoryStorage() });
  const basePaceSettings = createBasePaceSettings({ storage: memoryStorage() });
  const agentSettings = createAgentSettings({ storage: memoryStorage() });
  const pacerGapSettings = createPacerGapStore(memoryStorage());
  const dndSettings = createFlagSettings(opts.dnd ?? false, { storage: memoryStorage() });
  if (opts.gapMs !== undefined) pacerGapSettings.set(opts.gapMs);
  if (opts.spans) activeHoursSettings.setSpans(opts.spans);
  if (opts.base) basePaceSettings.setPace(opts.base);
  const handle = createWindowActiveHours({
    activeHoursSettings,
    basePaceSettings,
    agentSettings,
    pacerGapSettings,
    dndSettings,
  });
  handle.setPersona(PERSONA);
  handles.push(handle);
  return { handle, activeHoursSettings, basePaceSettings, agentSettings, pacerGapSettings, dndSettings };
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

  it("with the device switch on, the off span's boundaries notify nothing", () => {
    vi.setSystemTime(new Date(2026, 10, 19, 12, 59, 0));
    const { handle } = build({
      dnd: true,
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
