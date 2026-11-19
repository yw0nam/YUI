// @vitest-environment jsdom
/**
 * active-hours-section.test.ts — the Persona page's Active hours editor.
 *
 * Pins the rows the section renders from the spans in use (the card's until
 * edited) with the next-day mark on a span that wraps midnight, and the pace
 * edit that writes the whole list back to the per-character store with Reset
 * to default beside the section title.
 */

import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type Card,
  EMPTY_CARD,
  type PersonaConfig,
} from "../../../../config/validators/persona/types";
import { createLogger } from "../../../../logger";
import {
  type ActiveHoursSettingsStore,
  createActiveHoursSettings,
} from "../../../../settings/active-hours/active-hours-settings";
import type { Span } from "../../../../settings/active-hours/spans";
import { createAgentSettings } from "../../../../settings/backend/agent-settings";
import type { PersistedStorage } from "../../../../settings/persisted-store";
import { setLocale } from "../../../i18n";
import { activeHoursSectionHtml, createActiveHoursSection } from "./active-hours-section";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const YUI_SPANS: Span[] = [
  { start: "08:00", end: "12:00", pace: "low" },
  { start: "12:00", end: "22:00", pace: "normal" },
  { start: "22:00", end: "03:00", pace: "high" },
];

const yuiCard = (): Card => ({
  ...EMPTY_CARD,
  name: "Yui",
  extensions: { yui: { active_hours: YUI_SPANS } },
});

const persona: PersonaConfig = {
  framing: { en: "f", ja: "f", ko: "f" },
  user_fallback: { en: "User", ja: "ユーザー", ko: "사용자" },
  cards: { en: yuiCard(), ja: yuiCard(), ko: yuiCard() },
};

function memoryStorage<T>(): PersistedStorage<T> {
  let saved: T | null = null;
  return {
    load: () => saved,
    save: (s) => {
      saved = s;
    },
  };
}

const sections: { dispose(): void }[] = [];

function build(): {
  host: HTMLElement;
  store: ActiveHoursSettingsStore;
  section: { dispose(): void };
} {
  const store = createActiveHoursSettings({ storage: memoryStorage() });
  const agentSettings = createAgentSettings({ storage: memoryStorage() });
  const host = document.createElement("div");
  host.innerHTML = activeHoursSectionHtml();
  document.body.appendChild(host);
  const section = createActiveHoursSection({
    root: host,
    activeHoursSettings: store,
    agentSettings,
    getPersona: () => persona,
    log: createLogger("active-hours"),
  });
  sections.push(section);
  return { host, store, section };
}

describe("createActiveHoursSection", () => {
  beforeEach(() => {
    setLocale("en");
    document.body.innerHTML = "";
  });

  afterEach(() => {
    for (const s of sections.splice(0)) s.dispose();
  });

  const rows = (host: HTMLElement) => host.querySelectorAll<HTMLElement>(".yui-hours__span");
  const timesOf = (row: HTMLElement) => row.querySelectorAll<HTMLInputElement>(".yui-time-input");
  const paceOf = (row: HTMLElement) => row.querySelector<HTMLSelectElement>(".yui-hours__pace")!;

  it("renders the card's three spans: start, end, pace, next day on the wrapped one", () => {
    const { host } = build();
    const list = rows(host);
    expect(list).toHaveLength(3);
    expect(timesOf(list[0]!)[0]!.value).toBe("08:00");
    expect(timesOf(list[0]!)[1]!.value).toBe("12:00");
    expect(paceOf(list[0]!).value).toBe("low");
    expect(paceOf(list[0]!).textContent).toContain("Less");
    expect(paceOf(list[1]!).value).toBe("normal");
    expect(paceOf(list[2]!).value).toBe("high");
    expect(timesOf(list[2]!)[1]!.value).toBe("03:00");
    expect(list[2]!.textContent).toContain("next day");
    expect(list[1]!.textContent).not.toContain("next day");
    // The card's spans are in use, so no reset action shows yet.
    expect(host.querySelector<HTMLButtonElement>(".yui-reset")!.hidden).toBe(true);
    expect(host.querySelector<HTMLElement>(".yui-sec__foot")!.textContent).toBe(
      "More: about twice as often when you're idle. Less: about a third as often. Off: she only replies. Unset hours are Normal.",
    );
  });

  it("renders no next-day mark on a span whose start equals its end", () => {
    const { host, store } = build();
    act(() => store.setSpans([{ start: "09:00", end: "09:00", pace: "normal" }]));
    const row = rows(host)[0]!;
    expect(timesOf(row)[0]!.value).toBe("09:00");
    expect(timesOf(row)[1]!.value).toBe("09:00");
    expect(row.textContent).not.toContain("next day");
  });

  it("drops the next-day mark when an edit makes the end equal the start", () => {
    const { host } = build();
    const row = rows(host)[2]!;
    expect(row.textContent).toContain("next day");
    const end = timesOf(row)[1]!;
    fireEvent.change(end, { target: { value: "22:00" } });
    expect(row.textContent).not.toContain("next day");
  });

  it("writes the whole list on a pace edit, shows Reset to default, and reset returns the store to null", () => {
    const { host, store } = build();
    expect(rows(host)).toHaveLength(3);
    const select = paceOf(rows(host)[1]!);
    fireEvent.change(select, { target: { value: "off" } });
    expect(store.get().spans).toEqual([
      { start: "08:00", end: "12:00", pace: "low" },
      { start: "12:00", end: "22:00", pace: "off" },
      { start: "22:00", end: "03:00", pace: "high" },
    ]);
    const reset = host.querySelector<HTMLButtonElement>(".yui-reset")!;
    expect(reset.hidden).toBe(false);
    fireEvent.click(reset);
    expect(store.get().spans).toBeNull();
    expect(reset.hidden).toBe(true);
  });
});
