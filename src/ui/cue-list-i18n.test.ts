// @vitest-environment jsdom

/**
 * cue-list-i18n.test.ts
 *
 * The aria/label strings baked into cue-list render functions (not exposed via
 * its options API) must come from i18n keys, not Korean literals.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProactiveCue } from "../io/proactive-settings";
import type { ScheduledCue } from "../io/schedule-settings";
import { createCueList } from "./cue-list";
import { setLocale, t } from "./i18n";

vi.mock("./cue-list.css", () => ({}));

function scheduleStore(entries: ScheduledCue[]) {
  const state = { enabled: true, entries };
  return {
    get: () => ({ ...state, entries: [...state.entries] }),
    setEnabled: () => {},
    addCue: () => entries[0],
    updateCue: () => {},
    removeCue: () => {},
    subscribe: () => () => {},
  };
}

function proactiveStore(entries: ProactiveCue[]) {
  const state = { enabled: true, entries };
  return {
    get: () => ({ ...state, entries: [...state.entries] }),
    setEnabled: () => {},
    addCue: () => entries[0],
    updateCue: () => {},
    removeCue: () => {},
    subscribe: () => () => {},
  };
}

describe("cue-list — i18n internal labels", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    setLocale("en");
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("en");
  });

  it("keys the time-trigger aria-label and editor labels", () => {
    createCueList({
      mount,
      store: scheduleStore([
        {
          id: "a",
          label: "Morning",
          context: "ctx",
          time: "09:00",
          enabled: true,
        },
      ]),
      title: "Scheduled greeting",
      sub: "sub",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ Add",
    });

    const timeInput = mount.querySelector("[data-testid='cue-trigger-input']")!;
    expect(timeInput.getAttribute("aria-label")).toBe(t("cue.time_aria"));

    const delBtn = mount.querySelector("[data-testid='cue-delete']")!;
    expect(delBtn.getAttribute("aria-label")).toBe(t("cue.delete"));
  });

  it("keys the cue toggle aria-label with the cue name", () => {
    createCueList({
      mount,
      store: scheduleStore([
        {
          id: "a",
          label: "Morning",
          context: "ctx",
          time: "09:00",
          enabled: true,
        },
      ]),
      title: "Scheduled greeting",
      sub: "sub",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ Add",
    });

    const toggle = mount.querySelector("[data-testid='cue-switch']")!;
    expect(toggle.getAttribute("aria-label")).toBe(t("cue.toggle_aria", { name: "Morning" }));
  });

  it("keys the minutes word, aria, and suffix", () => {
    createCueList({
      mount,
      store: proactiveStore([
        { id: "a", label: "Break", context: "ctx", idle_min: 5, enabled: true },
      ]),
      title: "Proactive",
      sub: "sub",
      icon: "sparkle",
      trigger: { kind: "minutes", field: "idle_min" },
      addLabel: "+ Add",
    });

    const numInput = mount.querySelector("[data-testid='cue-trigger-input']")!;
    expect(numInput.getAttribute("aria-label")).toBe(t("cue.minutes_aria"));

    const suffix = mount.querySelector("[data-testid='cue-minutes-suffix']")!;
    expect(suffix.textContent).toBe(t("cue.minutes_suffix"));
  });

  it("keys the context textarea aria-label and placeholder", () => {
    createCueList({
      mount,
      store: scheduleStore([
        {
          id: "a",
          label: "Morning",
          context: "ctx",
          time: "09:00",
          enabled: true,
        },
      ]),
      title: "Scheduled greeting",
      sub: "sub",
      icon: "clock",
      trigger: { kind: "time", field: "time" },
      addLabel: "+ Add",
    });

    const ta = mount.querySelector<HTMLTextAreaElement>(".yui-cue__ctx-textarea")!;
    expect(ta.getAttribute("aria-label")).toBe(t("cue.ctx_aria"));
    expect(ta.placeholder).toBe(t("cue.ctx_placeholder"));
  });
});
