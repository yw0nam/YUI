// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActiveHoursSettings } from "../../../settings/active-hours/active-hours-settings";
import { createBasePaceSettings } from "../../../settings/active-hours/base-pace-settings";
import type { Span } from "../../../settings/active-hours/spans";
import { createAgentSettings } from "../../../settings/backend/agent-settings";
import { createGuardrailsSettings } from "../../../settings/backend/guardrails-settings";
import { createProactiveSettings } from "../../../settings/cues/proactive-settings";
import { createScheduleSettings } from "../../../settings/cues/schedule-settings";
import { createPacerGapStore, createPresenceStore } from "../../../settings/settings-stores";
import { setLocale } from "../../i18n";
import { countSubscriptions, inMemoryAgentStorage } from "../test-helpers";
import { createProactivePage } from "./proactive-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deps = Parameters<typeof createProactivePage>[0];

const pages: ReturnType<typeof createProactivePage>[] = [];
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const memoryValueStorage = () => {
  let value: { value: number } | null = null;
  return {
    load: () => value,
    save: (next: { value: number }) => {
      value = next;
    },
  };
};

function build(extra?: Partial<Deps>) {
  const deps = {
    agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
    scheduleSettings: createScheduleSettings({ locale: "en" }),
    proactiveSettings: createProactiveSettings({ locale: "en" }),
    openPersona: vi.fn(),
    log,
    ...extra,
  };
  const page = createProactivePage(deps);
  pages.push(page);
  document.body.append(page.el);
  return { page, ...deps };
}

beforeEach(() => {
  setLocale("en");
});

afterEach(() => {
  act(() => {
    for (const page of pages.splice(0)) page.dispose();
  });
  document.body.innerHTML = "";
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("createProactivePage — how often she speaks up", () => {
  function buildPace() {
    const basePaceSettings = createBasePaceSettings();
    const built = build({ basePaceSettings });
    const cell = (label: string) =>
      [
        ...built.page.el.querySelectorAll<HTMLButtonElement>(".yui-base-pace-seg .yui-seg__btn"),
      ].find((b) => b.textContent === label);
    return { ...built, basePaceSettings, cell };
  }

  it("shows Normal selected and writes the high pace when More is pressed", () => {
    const { basePaceSettings, cell } = buildPace();

    expect(cell("Normal")?.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(cell("More")!);

    expect(basePaceSettings.get()).toEqual({ pace: "high" });
    expect(cell("More")?.getAttribute("aria-checked")).toBe("true");
  });

  it("opens the Persona page from the Active hours link", () => {
    const { page, openPersona } = buildPace();
    const link = [...page.el.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Persona › Active hours",
    );

    expect(link?.className).toBe("yui-link-btn yui-base-pace__link");
    fireEvent.click(link!);

    expect(openPersona).toHaveBeenCalledOnce();
  });
});

describe("createProactivePage — her day", () => {
  function buildDay(spans: Span[] | null) {
    localStorage.setItem(
      "yui.presets",
      JSON.stringify({ active: "mio", list: [{ id: "mio", name: "Mio" }] }),
    );
    const activeHoursSettings = createActiveHoursSettings();
    if (spans) activeHoursSettings.setSpans(spans);
    return {
      ...build({ basePaceSettings: createBasePaceSettings(), activeHoursSettings }),
      activeHoursSettings,
    };
  }
  const texts = (root: HTMLElement, selector: string) =>
    [...root.querySelectorAll(selector)].map((el) => el.textContent);

  it.each([
    [
      "an evening span",
      [
        { start: "09:00", end: "18:00", pace: "normal" },
        { start: "18:00", end: "23:00", pace: "low" },
      ],
      ["Normal", "Less", "Normal"],
      ["09:00", "12:00", "18:00", "23:00"],
    ],
    ["no spans and no card spans", null, ["Normal"], ["09:00", "12:00", "18:00", "23:00"]],
    [
      "an off night",
      [{ start: "22:00", end: "06:00", pace: "off" }],
      ["Off", "Normal", "Off"],
      ["09:00", "12:00", "18:00"],
    ],
  ] as const)("draws the edited character's day with %s", (_name, spans, runs, greetings) => {
    const { page } = buildDay(spans ? [...spans] : null);
    const day = within(page.el).queryByRole("group", { name: "Mio's day" });

    expect(day?.querySelector(".yui-day__name")?.textContent).toBe("Mio's day");
    expect(texts(page.el, ".yui-day__run")).toEqual(runs);
    expect(texts(page.el, ".yui-day__marks .yui-day__at")).toEqual(greetings);
    expect(page.el.querySelectorAll(".yui-day__greeting")).toHaveLength(greetings.length);
    expect(page.el.querySelector(".yui-sec__foot")?.textContent).toBe(
      "Scheduled greetings keep their times at every pace.",
    );
  });

  it("re-spaces the check-ins after quiet when Less is pressed", () => {
    const { page } = buildDay(null);
    const less = [...page.el.querySelectorAll<HTMLButtonElement>(".yui-seg__btn")].find(
      (b) => b.textContent === "Less",
    );

    expect(page.el.querySelector(".yui-day__vals")?.textContent).toBe("5 · 10 · 30 min");
    fireEvent.click(less!);

    expect(page.el.querySelector(".yui-day__vals")?.textContent).toBe("15 · 30 · 90 min");
  });

  it("drops the greeting marks and reads the check-ins Off while both cue lists are off", () => {
    const { page, scheduleSettings, proactiveSettings } = buildDay(null);

    expect(page.el.querySelectorAll(".yui-day__greeting")).toHaveLength(4);
    act(() => {
      scheduleSettings.setEnabled(false);
      proactiveSettings.setEnabled(false);
    });

    expect(page.el.querySelectorAll(".yui-day__greeting")).toHaveLength(0);
    expect(page.el.querySelector(".yui-day__vals")?.textContent).toBe("Off");
  });

  it("redraws the runs when the spans change", () => {
    const { page, activeHoursSettings } = buildDay(null);

    expect(texts(page.el, ".yui-day__run")).toEqual(["Normal"]);
    act(() => activeHoursSettings.setSpans([{ start: "09:00", end: "18:00", pace: "low" }]));

    expect(texts(page.el, ".yui-day__run")).toEqual(["Normal", "Less", "Normal"]);
  });
});

describe("createProactivePage — Advanced", () => {
  const RATE_LIMIT_DEFAULTS = {
    tier2_max: 24,
    urgent_max: 120,
    overall_max: 40,
    addressed_chain_max: 2,
    cooldown_ms: 600_000,
  };

  function advancedDeps() {
    return {
      pacerGapSettings: createPacerGapStore(memoryValueStorage()),
      presenceSettings: createPresenceStore(memoryValueStorage()),
      rateLimitSettings: createGuardrailsSettings(),
      getRateLimitDefaults: () => RATE_LIMIT_DEFAULTS,
    };
  }
  type AdvancedDeps = ReturnType<typeof advancedDeps>;

  const FIELDS = [
    {
      name: "the wait after a conversation",
      id: "#yui-pacer-gap",
      read: (d: AdvancedDeps) => d.pacerGapSettings.get().value,
      initial: 600_000,
      shown: "10",
      typed: "25",
      committed: 1_500_000,
      external: (d: AdvancedDeps) => d.pacerGapSettings.set(1_800_000),
      externalShown: "30",
      outOfRange: "200",
    },
    {
      name: "presence",
      id: "#yui-presence",
      read: (d: AdvancedDeps) => d.presenceSettings.get().value,
      initial: 180_000,
      shown: "180",
      typed: "300",
      committed: 300_000,
      external: (d: AdvancedDeps) => d.presenceSettings.set(60_000),
      externalShown: "60",
      outOfRange: "5",
    },
    {
      name: "an hourly limit",
      id: "#yui-rate-tier2",
      read: (d: AdvancedDeps) => d.rateLimitSettings.get().tier2_max,
      initial: 0,
      shown: "24",
      typed: "30",
      committed: 30,
      external: (d: AdvancedDeps) => d.rateLimitSettings.set({ tier2_max: 50 }),
      externalShown: "50",
      outOfRange: "1000",
    },
  ];

  function buildAdvanced(id: string) {
    const deps = advancedDeps();
    const { page } = build(deps);
    return { deps, page, input: page.el.querySelector<HTMLInputElement>(id) };
  }

  it.each(FIELDS)("commits $name on change, converted", ({ id, read, shown, typed, committed }) => {
    const { deps, input } = buildAdvanced(id);

    expect(input?.value).toBe(shown);
    input!.value = typed;
    act(() => input!.dispatchEvent(new Event("change")));

    expect(read(deps)).toBe(committed);
    expect(input!.value).toBe(typed);
  });

  it.each(FIELDS)("does not commit $name on each keystroke", ({
    id,
    read,
    initial,
    shown,
    typed,
    committed,
  }) => {
    const { deps, input } = buildAdvanced(id);

    expect(input?.value).toBe(shown);
    input!.focus();
    for (const partial of [typed.slice(0, 1), typed]) {
      input!.value = partial;
      act(() => input!.dispatchEvent(new Event("input", { bubbles: true })));
    }
    expect(read(deps)).toBe(initial);

    act(() => input!.dispatchEvent(new Event("change")));
    expect(read(deps)).toBe(committed);
  });

  it.each(FIELDS)("follows an outside change of $name", ({ id, external, externalShown }) => {
    const { deps, input } = buildAdvanced(id);

    act(() => external(deps));

    expect(input?.value).toBe(externalShown);
  });

  it.each(FIELDS)("snaps an out-of-range $name back on change", ({
    id,
    read,
    initial,
    shown,
    outOfRange,
  }) => {
    const { deps, input } = buildAdvanced(id);

    expect(input?.value).toBe(shown);
    input!.value = outOfRange;
    act(() => input!.dispatchEvent(new Event("change")));

    expect(read(deps)).toBe(initial);
    expect(input!.value).toBe(shown);
  });

  // 0 is the off position, not a rejected value: the pacer holds nothing at that setting.
  it("commits 0 from the wait after a conversation, turning the pacer off", () => {
    const { deps, input } = buildAdvanced("#yui-pacer-gap");

    expect(input?.value).toBe("10");
    input!.value = "0";
    act(() => input!.dispatchEvent(new Event("change")));

    expect(deps.pacerGapSettings.get().value).toBe(0);
    expect(input!.value).toBe("0");
  });

  it("keeps a focused edit through an outside change, then commits it", () => {
    const { deps, input } = buildAdvanced("#yui-presence");

    expect(input?.value).toBe("180");
    input!.focus();
    input!.value = "300";
    act(() => deps.presenceSettings.set(60_000));
    expect(input!.value).toBe("300");

    act(() => input!.dispatchEvent(new Event("change")));
    act(() => input!.blur());
    expect(deps.presenceSettings.get().value).toBe(300_000);
    expect(input!.value).toBe("300");
  });

  it("shows an outside change made while focused once an unedited field blurs", () => {
    const { deps, input } = buildAdvanced("#yui-presence");

    expect(input?.value).toBe("180");
    input!.focus();
    act(() => deps.presenceSettings.set(60_000));
    expect(input!.value).toBe("180");

    act(() => input!.blur());
    expect(deps.presenceSettings.get().value).toBe(60_000);
    expect(input!.value).toBe("60");
  });

  it.each([
    ["pacerGapSettings", [false, true, true]],
    ["presenceSettings", [true, false, true]],
    ["rateLimitSettings", [true, true, false]],
  ] as const)("renders no row without %s", (absent, present) => {
    const deps: Partial<AdvancedDeps> = advancedDeps();
    delete deps[absent];
    const { page } = build(deps);

    expect(
      ["#yui-pacer-gap", "#yui-presence", "#yui-rate-tier2"].map(
        (id) => page.el.querySelector(id) !== null,
      ),
    ).toEqual(present);
  });

  it("clears a cap's override when its field is emptied and shows the default", () => {
    const deps = advancedDeps();
    deps.rateLimitSettings.set({ tier2_max: 30 });
    const { page } = build(deps);
    const input = page.el.querySelector<HTMLInputElement>("#yui-rate-tier2");

    expect(input?.value).toBe("30");
    input!.value = "";
    act(() => input!.dispatchEvent(new Event("change")));

    expect(deps.rateLimitSettings.get().tier2_max).toBe(0);
    expect(input!.value).toBe("24");
  });

  it("names the configured cooldown in the total and urgent rows", () => {
    const { page } = build(advancedDeps());
    const sub = (id: string) =>
      page.el.querySelector(id)?.closest(".yui-row")?.querySelector(".yui-input-row__sub")
        ?.textContent;

    expect([sub("#yui-rate-overall"), sub("#yui-rate-urgent")]).toEqual([
      "Crossing it pauses every source for 10 minutes",
      "Signals marked urgent; the 10-minute pause after the total limit never holds them",
    ]);
  });

  it("releases every subscription of its stores and stops committing on dispose", () => {
    const deps = advancedDeps();
    const counts = [deps.pacerGapSettings, deps.presenceSettings, deps.rateLimitSettings].map(
      countSubscriptions,
    );
    const page = createProactivePage({
      agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
      scheduleSettings: createScheduleSettings({ locale: "en" }),
      proactiveSettings: createProactiveSettings({ locale: "en" }),
      openPersona: vi.fn(),
      log,
      ...deps,
    });
    const input = page.el.querySelector<HTMLInputElement>("#yui-pacer-gap");

    act(() => page.dispose());
    input!.value = "25";
    input!.dispatchEvent(new Event("change"));

    expect(counts.map(({ taken, released }) => [taken > 0, released === taken])).toEqual([
      [true, true],
      [true, true],
      [true, true],
    ]);
    expect(deps.pacerGapSettings.get().value).toBe(600_000);
  });
});
