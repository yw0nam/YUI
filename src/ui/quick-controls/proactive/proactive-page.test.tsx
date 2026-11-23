// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Logger } from "../../../logger";
import { createActiveHoursSettings } from "../../../settings/active-hours/active-hours-settings";
import { createBasePaceSettings } from "../../../settings/active-hours/base-pace-settings";
import type { Span } from "../../../settings/active-hours/spans";
import { createAgentNotifySettings } from "../../../settings/backend/agent-notify-settings";
import { createAgentSettings } from "../../../settings/backend/agent-settings";
import { createGuardrailsSettings } from "../../../settings/backend/guardrails-settings";
import { createWorkflowSettings } from "../../../settings/backend/workflow-settings";
import {
  createScreenKnobSettings,
  type ScreenOverrides,
} from "../../../settings/capture/screen-settings";
import { createProactiveSettings } from "../../../settings/cues/proactive-settings";
import { createScheduleSettings } from "../../../settings/cues/schedule-settings";
import { createFlagSettings } from "../../../settings/persisted-store";
import { createPacerGapStore, createPresenceStore } from "../../../settings/settings-stores";
import { createThreadReactionThresholdsSettings } from "../../../settings/threads/thread-reaction-thresholds-settings";
import { createThreadTurnsSettings } from "../../../settings/threads/thread-turns-settings";
import { createFillerSettings } from "../../../settings/voice/filler-settings";
import { setLocale } from "../../i18n";
import { createSwitchRows } from "../switch-row";
import { countSubscriptions, inMemoryAgentStorage } from "../test-helpers";
import { createProactivePage } from "./proactive-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Deps = Parameters<typeof createProactivePage>[0];

const pages: ReturnType<typeof createProactivePage>[] = [];

const memoryValueStorage = () => {
  let value: { value: number } | null = null;
  return {
    load: () => value,
    save: (next: { value: number }) => {
      value = next;
    },
  };
};

function makeLog(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function build(extra?: Partial<Deps>) {
  const deps = {
    agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
    scheduleSettings: createScheduleSettings({ locale: "en" }),
    proactiveSettings: createProactiveSettings({ locale: "en" }),
    openPersona: vi.fn(),
    rows: [],
    workflowSettings: createWorkflowSettings(),
    log: makeLog(),
    ...extra,
  };
  const page = createProactivePage(deps);
  pages.push(page);
  document.body.append(page.el);
  return { page, ...deps };
}

/** Disposes a page the afterEach must not dispose again. */
function disposeNow(page: ReturnType<typeof createProactivePage>) {
  const index = pages.indexOf(page);
  if (index >= 0) pages.splice(index, 1);
  act(() => page.dispose());
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
  vi.unstubAllGlobals();
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
      rows: [],
      workflowSettings: createWorkflowSettings(),
      log: makeLog(),
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

describe("createProactivePage — the cue lists", () => {
  /** A cue list's master switch, found by its title, and the fold of its group. */
  function cueGroup(page: ReturnType<typeof createProactivePage>, title: string) {
    const toggle = within(page.el).queryByRole("switch", { name: title });
    const fold = toggle
      ?.closest(".yui-group")
      ?.querySelector<HTMLDetailsElement>(":scope > details");
    return { toggle, fold };
  }

  it.each([
    ["Quiet for a while", "proactiveSettings"],
    ["Scheduled greetings", "scheduleSettings"],
  ] as const)("%s: the master switch shows its store's state and a click flips it", (title, key) => {
    const built = build();
    const { toggle } = cueGroup(built.page, title);

    expect(toggle?.getAttribute("aria-checked")).toBe("true");
    if (!toggle) return;
    fireEvent.click(toggle);

    expect(built[key].get().enabled).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("follows both stores switched off from outside: switches off, folds dimmed and reading Off", () => {
    const { page, proactiveSettings, scheduleSettings } = build();

    act(() => {
      proactiveSettings.setEnabled(false);
      scheduleSettings.setEnabled(false);
    });

    const groups = ["Quiet for a while", "Scheduled greetings"].map((title) =>
      cueGroup(page, title),
    );
    expect(
      groups.map(({ toggle, fold }) => [
        toggle?.getAttribute("aria-checked"),
        fold?.classList.contains("yui-fold--off"),
        fold?.querySelector(".yui-fold__aside")?.textContent,
      ]),
    ).toEqual([
      ["false", true, "Off"],
      ["false", true, "Off"],
    ]);
  });

  it("reads Add check-in on the Quiet for a while add row", () => {
    const { page } = build();
    const { fold } = cueGroup(page, "Quiet for a while");

    expect(fold?.querySelector("[data-testid='cue-add']")?.textContent).toBe("Add check-in");
  });

  it("redraws the rows when an entry is added from outside", () => {
    const { page, proactiveSettings } = build();
    const { fold } = cueGroup(page, "Quiet for a while");

    expect(fold?.querySelectorAll("[data-testid='cue-row']").length).toBe(3);
    act(() => {
      proactiveSettings.addCue();
    });

    expect(fold?.querySelectorAll("[data-testid='cue-row']").length).toBe(4);
  });
});

describe("createProactivePage — the source groups", () => {
  const SCREEN_DEFAULTS: ScreenOverrides = {
    prev_dwell_ms: 600_000,
    settle_ms: 90_000,
    long_session_ms: 2_700_000,
    recent_cap: 5,
  };

  function sourceRows(stores: {
    screenSettings?: ReturnType<typeof createFlagSettings>;
    screenKnobSettings?: ReturnType<typeof createScreenKnobSettings>;
    agentNotifySettings?: ReturnType<typeof createAgentNotifySettings>;
    threadReactionsSettings?: ReturnType<typeof createFlagSettings>;
  }) {
    return createSwitchRows({
      idleThrottleSettings: createFlagSettings(true),
      fillerSettings: createFillerSettings(),
      ...stores,
    }).filter((row) => row.tab === "react");
  }

  function buildSources(
    options: {
      stores?: {
        screenSettings?: ReturnType<typeof createFlagSettings>;
        screenKnobSettings?: ReturnType<typeof createScreenKnobSettings>;
        agentNotifySettings?: ReturnType<typeof createAgentNotifySettings>;
        threadTurnsSettings?: ReturnType<typeof createThreadTurnsSettings>;
        threadReactionsSettings?: ReturnType<typeof createFlagSettings>;
        threadReactionThresholdsSettings?: ReturnType<
          typeof createThreadReactionThresholdsSettings
        >;
      };
      boundId?: string | null;
    } = {},
  ) {
    const screenSettings = options.stores?.screenSettings ?? createFlagSettings(true);
    const screenKnobSettings = options.stores?.screenKnobSettings ?? createScreenKnobSettings();
    const agentNotifySettings = options.stores?.agentNotifySettings ?? createAgentNotifySettings();
    const threadTurnsSettings = options.stores?.threadTurnsSettings ?? createThreadTurnsSettings();
    const threadReactionsSettings =
      options.stores?.threadReactionsSettings ?? createFlagSettings(true);
    const threadReactionThresholdsSettings =
      options.stores?.threadReactionThresholdsSettings ?? createThreadReactionThresholdsSettings();
    const workflowSettings = createWorkflowSettings();
    const built = build({
      rows: sourceRows({
        screenSettings,
        screenKnobSettings,
        agentNotifySettings,
        threadReactionsSettings,
      }),
      screenKnobSettings,
      getScreenDefaults: () => SCREEN_DEFAULTS,
      agentNotifySettings,
      threadTurnsSettings,
      threadReactionThresholdsSettings,
      workflowSettings,
      boundId: options.boundId ?? null,
    });
    return {
      ...built,
      screenSettings,
      screenKnobSettings,
      agentNotifySettings,
      threadTurnsSettings,
      threadReactionsSettings,
      threadReactionThresholdsSettings,
      workflowSettings,
    };
  }

  function foldOf(page: ReturnType<typeof createProactivePage>, selector: string) {
    return page.el
      .querySelector(selector)
      ?.closest(".yui-group")
      ?.querySelector<HTMLDetailsElement>(":scope > details");
  }

  it("renders the three source switch rows in order and flips a store on click", () => {
    const { page, screenSettings } = buildSources();
    const switches = [
      ".yui-screen-switch",
      ".yui-thread-reactions-switch",
      ".yui-agentnotify-switch",
    ].map((selector) => page.el.querySelector<HTMLButtonElement>(selector));

    expect(switches.map((button) => button?.getAttribute("aria-checked"))).toEqual([
      "true",
      "true",
      "false",
    ]);
    expect(
      switches.map(
        (button) => button?.closest(".yui-row")?.querySelector(".yui-row__label")?.textContent,
      ),
    ).toEqual(["Screen changes", "Thread reactions", "External signals"]);
    expect(
      switches.map(
        (button) => button?.closest(".yui-row")?.querySelector(".yui-row__sub")?.textContent,
      ),
    ).toEqual([
      "Notices app switches and long stretches, then speaks up first",
      "When you tap the chip or Threads pile up, she sits on the Threads window.",
      "Speaks up when a coding agent, a workflow, or another program on your machine sends a signal.",
    ]);
    expect(switches.map((button) => button?.getAttribute("aria-label"))).toEqual([
      "Screen changes",
      "Thread reactions",
      "External signals",
    ]);

    const toggle = switches[0];
    if (!toggle) return;
    fireEvent.click(toggle);
    expect(screenSettings.get().enabled).toBe(false);
    expect(toggle.getAttribute("aria-checked")).toBe("false");
  });

  it("dims the External signals fold while it is off and keeps Thread turns editable inside", () => {
    const { page, agentNotifySettings, threadTurnsSettings } = buildSources();
    const fold = foldOf(page, ".yui-agentnotify-switch");

    expect(fold?.classList.contains("yui-fold--off")).toBe(true);
    expect(fold?.querySelector(".yui-fold__aside")?.textContent).toBe("Off");
    const cells = [
      ...(fold?.querySelectorAll<HTMLButtonElement>(".yui-threadturns-seg [role=radio]") ?? []),
    ];
    expect(cells.map((cell) => cell.disabled)).toEqual([false, false, false]);
    const notable = cells.find((cell) => cell.textContent === "When it needs her");
    expect(notable).toBeDefined();
    if (!notable) return;
    fireEvent.click(notable);
    expect(threadTurnsSettings.get().level).toBe("notable");

    act(() => agentNotifySettings.setEnabled(true));
    expect(fold?.classList.contains("yui-fold--off")).toBe(false);
    expect(fold?.querySelector(".yui-fold__aside")?.textContent).toBe("8770");
    expect(
      page.el.querySelector("#yui-agent-port")?.closest(".yui-row")?.querySelector(".yui-row__sub")
        ?.textContent,
    ).toBe("Restart the app to apply this change");
  });

  it("summarises the effective screen knobs in the fold and follows a committed edit", () => {
    const { page } = buildSources();
    const fold = foldOf(page, ".yui-screen-switch");

    expect(fold?.querySelector(".yui-fold__aside")?.textContent).toBe(
      "10 min · 90 s · 45 min · 5 entries",
    );
    const input = page.el.querySelector<HTMLInputElement>("#yui-screen-settle");
    expect(input).not.toBeNull();
    if (!input) return;
    input.value = "30";
    act(() => input.dispatchEvent(new Event("change")));

    expect(fold?.querySelector(".yui-fold__aside")?.textContent).toBe(
      "10 min · 30 s · 45 min · 5 entries",
    );
  });

  describe("screen changes", () => {
    function buildScreens(
      options: {
        screenSettings?: ReturnType<typeof createFlagSettings>;
        screenKnobSettings?: ReturnType<typeof createScreenKnobSettings>;
      } = {},
    ) {
      const screenSettings = options.screenSettings ?? createFlagSettings(true);
      const screenKnobSettings = options.screenKnobSettings ?? createScreenKnobSettings();
      return {
        ...build({
          rows: sourceRows({ screenSettings, screenKnobSettings }),
          screenKnobSettings,
          getScreenDefaults: () => SCREEN_DEFAULTS,
        }),
        screenKnobSettings,
      };
    }

    const shown = (page: ReturnType<typeof createProactivePage>, id: string) =>
      page.el.querySelector<HTMLInputElement>(id)?.value;

    function commit(input: HTMLInputElement | null, value: string) {
      if (!input) return;
      input.value = value;
      act(() => input.dispatchEvent(new Event("change")));
    }

    it("renders the screen group only with both its stores", () => {
      const screenSettings = createFlagSettings(true);
      const screenKnobSettings = createScreenKnobSettings();
      const cases = [
        { stores: { screenSettings, screenKnobSettings }, present: true },
        { stores: { screenSettings }, present: false },
        { stores: { screenKnobSettings }, present: false },
      ];

      for (const { stores, present } of cases) {
        const { page } = build({ rows: sourceRows(stores), ...stores });
        expect(page.el.querySelector("#yui-screen-settle") !== null).toBe(present);
        disposeNow(page);
      }
    });

    it("shows the config defaults in display units while nothing is overridden", () => {
      const { page } = buildScreens();

      expect(shown(page, "#yui-screen-prev-dwell")).toBe("10");
      expect(shown(page, "#yui-screen-settle")).toBe("90");
      expect(shown(page, "#yui-screen-long-session")).toBe("45");
    });

    it("shows the stored override instead of the config default", () => {
      const screenKnobSettings = createScreenKnobSettings();
      screenKnobSettings.set({ settle_ms: 30_000 });
      const { page } = buildScreens({ screenKnobSettings });

      expect(shown(page, "#yui-screen-settle")).toBe("30");
      expect(shown(page, "#yui-screen-prev-dwell")).toBe("10");
    });

    it("reflects an external knob edit", () => {
      const { page, screenKnobSettings } = buildScreens();

      act(() => screenKnobSettings.set({ settle_ms: 30_000 }));

      expect(shown(page, "#yui-screen-settle")).toBe("30");
    });

    it("shows recent_cap as a bare count and commits it unconverted", () => {
      const { page, screenKnobSettings } = buildScreens();
      const input = page.el.querySelector<HTMLInputElement>("#yui-screen-recent-cap");

      expect(input?.value).toBe("5");
      expect(input?.min).toBe("0");
      expect(input?.max).toBe("20");
      commit(input, "3");

      expect(screenKnobSettings.get().recent_cap).toBe(3);
      expect(input?.value).toBe("3");
    });

    it("clamps a typed recent_cap into its 0-20 row bounds", () => {
      const { page, screenKnobSettings } = buildScreens();

      commit(page.el.querySelector("#yui-screen-recent-cap"), "50");

      expect(screenKnobSettings.get().recent_cap).toBe(20);
      expect(shown(page, "#yui-screen-recent-cap")).toBe("20");
    });

    it("commits a numeric knob on change, converted to ms", () => {
      const { page, screenKnobSettings } = buildScreens();

      commit(page.el.querySelector("#yui-screen-long-session"), "30");

      expect(screenKnobSettings.get().long_session_ms).toBe(1_800_000);
    });

    it("clamps a typed knob into the range its row advertises", () => {
      const { page, screenKnobSettings } = buildScreens();
      const input = page.el.querySelector<HTMLInputElement>("#yui-screen-settle");

      commit(input, "5000"); // the row's max is 600 s
      expect(screenKnobSettings.get().settle_ms).toBe(600_000);
      expect(input?.value).toBe("600");

      commit(input, "2"); // the row's min is 5 s
      expect(screenKnobSettings.get().settle_ms).toBe(5_000);
    });

    it("clears the override when the knob is emptied, falling back to the config default", () => {
      const { page, screenKnobSettings } = buildScreens();
      const input = page.el.querySelector<HTMLInputElement>("#yui-screen-settle");

      commit(input, "30");
      expect(screenKnobSettings.get().settle_ms).toBe(30_000);

      commit(input, "");
      expect(screenKnobSettings.get().settle_ms).toBe(0);
      expect(input?.value).toBe("90");
    });

    it("does not commit a numeric knob on every keystroke", () => {
      const { page, screenKnobSettings } = buildScreens();
      const setSpy = vi.spyOn(screenKnobSettings, "set");
      const input = page.el.querySelector<HTMLInputElement>("#yui-screen-settle");

      expect(input).not.toBeNull();
      if (!input) return;
      input.focus();
      for (const partial of ["3", "30"]) {
        input.value = partial;
        act(() => input.dispatchEvent(new Event("input", { bubbles: true })));
      }
      expect(setSpy).not.toHaveBeenCalled();
      expect(screenKnobSettings.get().settle_ms).toBe(0);

      act(() => input.dispatchEvent(new Event("change")));
      expect(screenKnobSettings.get().settle_ms).toBe(30_000);
    });

    it("carries the footnote about screenshot pixels and do-not-disturb", () => {
      const { page } = buildScreens();

      expect(page.el.querySelector(".yui-field-hint")?.textContent).toBe(
        "Sending screen pixels follows the screenshot toggle on the Permissions page. Nothing is said while do-not-disturb is on.",
      );
    });

    it("detaches the knob listeners on dispose", () => {
      const { page, screenKnobSettings } = buildScreens();
      const input = page.el.querySelector<HTMLInputElement>("#yui-screen-settle");
      expect(input).not.toBeNull();

      disposeNow(page);
      commit(input, "30");

      expect(screenKnobSettings.get().settle_ms).toBe(0);
    });

    it("releases every flag and knob subscription on dispose", () => {
      const screenSettings = createFlagSettings(true);
      const screenKnobSettings = createScreenKnobSettings();
      const counts = [screenSettings, screenKnobSettings].map(countSubscriptions);
      const { page } = buildScreens({ screenSettings, screenKnobSettings });

      disposeNow(page);

      for (const { taken, released } of counts) {
        expect(taken).toBeGreaterThan(0);
        expect(released).toBe(taken);
      }
    });
  });

  describe("the signals", () => {
    const port = (page: ReturnType<typeof createProactivePage>) =>
      page.el.querySelector<HTMLInputElement>("#yui-agent-port");

    it.each([
      null,
      "abc12345",
    ] as const)("shows this window's ingress URL (%s) and updates the stored port", (boundId) => {
      const { page, agentNotifySettings } = buildSources({ boundId });
      const suffix = boundId ? `/presets/${boundId}/signals` : "/signals";

      expect(page.el.querySelector("#yui-ingress-url")?.textContent).toBe(
        `http://127.0.0.1:8770${suffix}`,
      );
      act(() => agentNotifySettings.setPort(9100));
      expect(page.el.querySelector("#yui-ingress-url")?.textContent).toBe(
        `http://127.0.0.1:9100${suffix}`,
      );
    });

    it("renders the listener port from its store", () => {
      const { page } = buildSources();

      expect(port(page)?.value).toBe("8770");
    });

    it("reflects an external port change", () => {
      const { page, agentNotifySettings } = buildSources();

      act(() => agentNotifySettings.setPort(9100));

      expect(port(page)?.value).toBe("9100");
    });

    it("sets the port on change and snaps a rejected value back", () => {
      const { page, agentNotifySettings } = buildSources();
      const setSpy = vi.spyOn(agentNotifySettings, "setPort");
      const input = port(page);

      expect(input?.value).toBe("8770");
      if (!input) return;
      input.value = "9000";
      act(() => input.dispatchEvent(new Event("change")));
      expect(setSpy).toHaveBeenCalledWith(9000);
      expect(input.value).toBe("9000");

      input.value = "80"; // below the 1024 minimum
      act(() => input.dispatchEvent(new Event("change")));
      expect(setSpy).toHaveBeenCalledWith(80);
      expect(agentNotifySettings.get().port).toBe(9000);
      expect(input.value).toBe("9000");
    });

    it("sets the waiting Threads count from its segment, also while Thread reactions is off", () => {
      const threadReactionsSettings = createFlagSettings(false);
      const { page, threadReactionThresholdsSettings } = buildSources({
        stores: { threadReactionsSettings },
      });
      const cells = [
        ...page.el.querySelectorAll<HTMLButtonElement>(
          ".yui-reaction-thresholds-count-seg [role=radio]",
        ),
      ];

      expect(cells.map((cell) => cell.dataset.value)).toEqual(["0", "2", "3", "5"]);
      if (!cells[3]) return;
      fireEvent.click(cells[3]);

      expect(threadReactionThresholdsSettings.get()).toEqual({ count: 5, wait_min: 10 });
      expect(cells.map((cell) => cell.getAttribute("aria-checked"))).toEqual([
        "false",
        "false",
        "false",
        "true",
      ]);
    });

    it("releases every agent-port and thread-turns subscription on dispose", () => {
      const agentNotifySettings = createAgentNotifySettings();
      const threadTurnsSettings = createThreadTurnsSettings();
      const counts = [agentNotifySettings, threadTurnsSettings].map(countSubscriptions);
      const { page } = buildSources({ stores: { agentNotifySettings, threadTurnsSettings } });

      disposeNow(page);

      for (const { taken, released } of counts) {
        expect(taken).toBeGreaterThan(0);
        expect(released).toBe(taken);
      }
    });
  });

  describe("workflows", () => {
    const WORKFLOW = { label: "Morning digest", url: "https://example.com/hook" };

    function addWorkflow(
      store: ReturnType<typeof createWorkflowSettings>,
      entry: { label: string; url: string } = WORKFLOW,
    ) {
      act(() => {
        store.addWorkflow(entry);
      });
      return store.get().entries.at(-1)!;
    }

    it("renders an empty state or one row per entry with fire and delete actions", () => {
      const { page, workflowSettings } = buildSources();

      expect(page.el.querySelector(".yui-wf-empty")?.textContent).toBe(
        "No workflows yet; add one below.",
      );

      addWorkflow(workflowSettings);
      addWorkflow(workflowSettings, { label: "Deploy notify", url: "https://example.com/deploy" });

      expect(page.el.querySelectorAll(".yui-wf")).toHaveLength(2);
      expect(page.el.querySelector(".yui-wf__name")?.textContent).toBe("Morning digest");
      expect(page.el.querySelector(".yui-wf__fire")?.getAttribute("aria-label")).toBe(
        "Fire Morning digest",
      );
      expect(page.el.querySelector(".yui-wf__delete")?.getAttribute("aria-label")).toBe(
        "Delete Morning digest",
      );
    });

    it("posts without reading the response body and shows success feedback", async () => {
      const fetchFn = vi.fn().mockResolvedValue({});
      vi.stubGlobal("fetch", fetchFn);
      const { page, workflowSettings } = buildSources();
      addWorkflow(workflowSettings);
      const fire = page.el.querySelector<HTMLButtonElement>(".yui-wf__fire");
      expect(fire).not.toBeNull();
      if (!fire) return;

      fireEvent.click(fire);
      await act(async () => {
        await Promise.resolve();
      });

      expect(page.el.querySelector(".yui-wf")?.classList.contains("yui-wf--fired-ok")).toBe(true);
      expect(fetchFn).toHaveBeenCalledWith(
        WORKFLOW.url,
        expect.objectContaining({ method: "POST", mode: "no-cors", body: "{}" }),
      );
      expect(fetchFn.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    });

    it("logs a rejected post and shows error feedback", async () => {
      const fetchFn = vi.fn().mockRejectedValue(new Error("offline"));
      vi.stubGlobal("fetch", fetchFn);
      const { page, log, workflowSettings } = buildSources();
      const entry = addWorkflow(workflowSettings);
      const fire = page.el.querySelector<HTMLButtonElement>(".yui-wf__fire");
      expect(fire).not.toBeNull();
      if (!fire) return;

      fireEvent.click(fire);
      await act(async () => {
        await Promise.resolve();
      });

      expect(page.el.querySelector(".yui-wf")?.classList.contains("yui-wf--fired-err")).toBe(true);
      expect(log.debug).toHaveBeenCalledWith("workflow_fire_failed", {
        id: entry.id,
        error: "Error: offline",
      });
    });

    it("keeps a fired row, its button and its flash when another entry is added", async () => {
      const fetchFn = vi.fn().mockResolvedValue({});
      vi.stubGlobal("fetch", fetchFn);
      const { page, workflowSettings } = buildSources();
      addWorkflow(workflowSettings);
      const row = page.el.querySelector<HTMLElement>(".yui-wf");
      const fire = row?.querySelector<HTMLButtonElement>(".yui-wf__fire");
      expect(row).not.toBeNull();
      if (!row || !fire) return;
      fireEvent.click(fire);
      await act(async () => {
        await Promise.resolve();
      });
      expect(row.classList.contains("yui-wf--fired-ok")).toBe(true);

      addWorkflow(workflowSettings, { label: "Other", url: "https://example.com/other" });

      expect(page.el.querySelectorAll(".yui-wf")).toHaveLength(2);
      expect(page.el.querySelector(".yui-wf")).toBe(row);
      expect(row.querySelector(".yui-wf__fire")).toBe(fire);
      expect(row.classList.contains("yui-wf--fired-ok")).toBe(true);
      fireEvent.click(fire);
      expect(fetchFn).toHaveBeenLastCalledWith(WORKFLOW.url, expect.anything());
    });

    it("opens the form on Add workflow, with focus on Label", () => {
      const { page } = buildSources();
      const open = page.el.querySelector<HTMLButtonElement>(".yui-wf-add-btn");

      expect(open?.textContent).toBe("Add workflow");
      if (!open) return;
      fireEvent.click(open);

      expect(page.el.querySelector("#yui-wf-label")).not.toBeNull();
      expect(page.el.querySelector("#yui-wf-url")).not.toBeNull();
      expect(document.activeElement).toBe(page.el.querySelector("#yui-wf-label"));
    });

    it("validates the URL, adds the workflow, and focuses the add row again", () => {
      const { page, workflowSettings } = buildSources();
      const open = page.el.querySelector<HTMLButtonElement>(".yui-wf-add-btn");
      expect(open).not.toBeNull();
      if (!open) return;
      fireEvent.click(open);
      const label = page.el.querySelector<HTMLInputElement>("#yui-wf-label");
      const url = page.el.querySelector<HTMLInputElement>("#yui-wf-url");
      expect(url).not.toBeNull();
      if (!label || !url) return;

      fireEvent.change(label, { target: { value: "Morning digest" } });
      const add = page.el.querySelector<HTMLButtonElement>(".yui-wf-form .yui-wf-add-btn");
      expect(add?.disabled).toBe(true);

      fireEvent.change(url, { target: { value: "not-a-url" } });
      expect(url.closest(".yui-row")?.classList.contains("is-invalid")).toBe(true);
      expect(add?.disabled).toBe(true);
      if (!add) return;

      fireEvent.change(url, { target: { value: WORKFLOW.url } });
      expect(url.closest(".yui-row")?.classList.contains("is-invalid")).toBe(false);
      expect(add.disabled).toBe(false);

      fireEvent.click(add);

      expect(workflowSettings.get().entries).toHaveLength(1);
      expect(workflowSettings.get().entries[0]).toMatchObject(WORKFLOW);
      expect(page.el.querySelector("#yui-wf-label")).toBeNull();
      expect(page.el.querySelector<HTMLInputElement>(".yui-wf-add-btn")?.textContent).toBe(
        "Add workflow",
      );
      expect(document.activeElement).toBe(page.el.querySelector(".yui-wf-add-btn"));
    });

    it("closes the form on Cancel and focuses the add row again", () => {
      const { page, workflowSettings } = buildSources();
      const open = page.el.querySelector<HTMLButtonElement>(".yui-wf-add-btn");
      expect(open).not.toBeNull();
      if (!open) return;
      fireEvent.click(open);
      const label = page.el.querySelector<HTMLInputElement>("#yui-wf-label");
      fireEvent.change(label!, { target: { value: "Morning digest" } });
      const form = page.el.querySelector<HTMLElement>(".yui-wf-form");
      expect(form).not.toBeNull();
      if (!form) return;

      fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));

      expect(page.el.querySelector("#yui-wf-label")).toBeNull();
      expect(document.activeElement).toBe(page.el.querySelector(".yui-wf-add-btn"));
      expect(workflowSettings.get().entries).toEqual([]);
      fireEvent.click(page.el.querySelector<HTMLButtonElement>(".yui-wf-add-btn")!);
      expect(page.el.querySelector<HTMLInputElement>("#yui-wf-label")?.value).toBe("");
    });

    it("opens an inline delete confirm with focus on Cancel, and removes the entry on Delete", () => {
      const { page, workflowSettings } = buildSources();
      addWorkflow(workflowSettings);
      const del = page.el.querySelector<HTMLButtonElement>(".yui-wf__delete");
      expect(del).not.toBeNull();
      if (!del) return;

      fireEvent.click(del);
      const confirm = page.el.querySelector<HTMLElement>(".yui-confirm");
      expect(confirm).not.toBeNull();
      if (!confirm) return;
      expect(del.hidden).toBe(true);
      expect(document.activeElement).toBe(within(confirm).getByRole("button", { name: "Cancel" }));

      fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
      expect(page.el.querySelector(".yui-confirm")).toBeNull();
      expect(del.hidden).toBe(false);
      expect(document.activeElement).toBe(del);

      fireEvent.click(del);
      const reopened = page.el.querySelector<HTMLElement>(".yui-confirm");
      expect(reopened).not.toBeNull();
      if (!reopened) return;
      fireEvent.click(within(reopened).getByRole("button", { name: "Delete" }));

      expect(workflowSettings.get().entries).toEqual([]);
      expect(page.el.querySelector(".yui-wf-empty")).not.toBeNull();
    });

    it("stops redrawing the rows after dispose", () => {
      const workflowSettings = createWorkflowSettings();
      const page = createProactivePage({
        agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
        scheduleSettings: createScheduleSettings({ locale: "en" }),
        proactiveSettings: createProactiveSettings({ locale: "en" }),
        openPersona: vi.fn(),
        rows: sourceRows({
          agentNotifySettings: createAgentNotifySettings(),
          screenSettings: createFlagSettings(true),
          screenKnobSettings: createScreenKnobSettings(),
        }),
        agentNotifySettings: createAgentNotifySettings(),
        workflowSettings,
        log: makeLog(),
      });
      document.body.append(page.el);
      act(() => {
        workflowSettings.addWorkflow(WORKFLOW);
      });
      expect(page.el.querySelector(".yui-wf")).not.toBeNull();

      act(() => page.dispose());
      act(() => {
        workflowSettings.addWorkflow({ label: "Late", url: "https://example.com/late" });
      });

      expect(page.el.querySelector(".yui-wf")).toBeNull();
    });
  });
});
