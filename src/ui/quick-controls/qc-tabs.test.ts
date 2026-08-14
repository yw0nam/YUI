// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFillerSettings } from "../../io/filler-settings";
import { createFlagSettings, localStorageStore } from "../../io/persisted-store";
import { createVadSettings, VAD_SILENCE_DEFAULT } from "../../io/vad-settings";
import { setLocale } from "../i18n";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs } from "./test-helpers";

describe("createQuickControls — tabs + VAD slider", () => {
  let mount: HTMLElement;
  let vad: ReturnType<typeof createVadSettings>;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    vad = createVadSettings();
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    // Existing assertions pin Korean copy/selectors; render the panel in ko.
    setLocale("ko");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
      vad,
      ...extra,
    });
  }

  function tabs(qc: ReturnType<typeof createQuickControls>): HTMLButtonElement[] {
    return Array.from(qc.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  }

  function panelFor(
    qc: ReturnType<typeof createQuickControls>,
    tab: HTMLButtonElement,
  ): HTMLElement {
    return qc.el.querySelector<HTMLElement>(`#${tab.getAttribute("aria-controls")}`)!;
  }

  it("renders a tablist with 5 tabs and 5 tabpanels", () => {
    const qc = buildQc();
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]');
    expect(tablist).not.toBeNull();
    const t = tabs(qc);
    expect(t.length).toBe(5);
    expect(qc.el.querySelectorAll('[role="tabpanel"]').length).toBe(5);

    // Each tab is wired to a panel and each panel back to its tab.
    for (const tab of t) {
      const panel = panelFor(qc, tab);
      expect(panel).not.toBeNull();
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    }

    qc.dispose();
  });

  it("defaults to the 대화 tab active; its panel visible, others hidden", () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    const active = t.find((tab) => tab.getAttribute("aria-selected") === "true")!;
    expect(active.textContent).toContain("대화");

    for (const tab of t) {
      const on = tab === active;
      expect(tab.getAttribute("aria-selected")).toBe(String(on));
      expect(tab.tabIndex).toBe(on ? 0 : -1);
      expect(panelFor(qc, tab).hidden).toBe(!on);
    }

    qc.dispose();
  });

  it("clicking a tab switches the active panel + aria-selected/hidden", () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    const target = t[2]; // Input
    target.click();

    expect(target.getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, target).hidden).toBe(false);
    for (const tab of t) {
      if (tab === target) continue;
      expect(tab.getAttribute("aria-selected")).toBe("false");
      expect(panelFor(qc, tab).hidden).toBe(true);
    }

    qc.dispose();
  });

  it("open({ tab }) lands directly on the requested tab", () => {
    const qc = buildQc();
    qc.open(undefined, { tab: "adv" });

    const adv = tabs(qc).find((tab) => tab.id === "yui-tab-adv")!;
    expect(adv.getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, adv).hidden).toBe(false);
    expect(qc.isOpen()).toBe(true);
    // Focus follows the requested tab, not the first control the popover would land on.
    expect(document.activeElement).toBe(adv);

    qc.dispose();
  });

  it("open({ tab }) switches an already-open panel to that tab", () => {
    const qc = buildQc();
    qc.open();
    qc.open(undefined, { tab: "adv" });

    const adv = tabs(qc).find((tab) => tab.id === "yui-tab-adv")!;
    expect(adv.getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, adv).hidden).toBe(false);

    qc.dispose();
  });

  it("ArrowRight / ArrowLeft move the active tab (roving tabindex)", () => {
    const qc = buildQc();
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]')!;
    const t = tabs(qc);
    t[0].focus();

    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(t[1].getAttribute("aria-selected")).toBe("true");
    expect(t[1].tabIndex).toBe(0);
    expect(t[0].tabIndex).toBe(-1);
    expect(panelFor(qc, t[1]).hidden).toBe(false);

    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(t[0].getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, t[0]).hidden).toBe(false);

    qc.dispose();
  });

  it("Home / End jump to the first / last tab", () => {
    const qc = buildQc();
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]')!;
    const t = tabs(qc);
    t[0].focus();

    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(t[4].getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, t[4]).hidden).toBe(false);

    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(t[0].getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, t[0]).hidden).toBe(false);

    qc.dispose();
  });

  it("keeps exactly one panel visible at all times", () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    for (const tab of t) {
      tab.click();
      const visible = t.filter((x) => !panelFor(qc, x).hidden);
      expect(visible.length).toBe(1);
      expect(visible[0]).toBe(tab);
    }

    qc.dispose();
  });

  // ── Silence threshold (VAD) slider — Input tab ──────────────────────────────

  it("renders the silence-window slider with min 500 / max 3000 / step 50", () => {
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>(
      '.yui-gain__slider[aria-label="침묵 기준"]',
    );
    expect(slider).not.toBeNull();
    expect(slider!.min).toBe("500");
    expect(slider!.max).toBe("3000");
    expect(slider!.step).toBe("50");

    qc.dispose();
  });

  it("reflects the vad store value (default 1500 ms) on the readout", () => {
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>(
      '.yui-gain__slider[aria-label="침묵 기준"]',
    )!;
    expect(slider.value).toBe(String(VAD_SILENCE_DEFAULT));
    const value = slider.closest(".yui-gain")!.querySelector<HTMLElement>(".yui-gain__value")!;
    expect(value.textContent).toBe("1500 ms");

    qc.dispose();
  });

  it("dragging the slider calls vad.setSilenceMs and updates the readout", () => {
    const setSpy = vi.spyOn(vad, "setSilenceMs");
    const qc = buildQc();
    qc.open();

    const slider = qc.el.querySelector<HTMLInputElement>(
      '.yui-gain__slider[aria-label="침묵 기준"]',
    )!;
    slider.value = "2000";
    slider.dispatchEvent(new Event("input", { bubbles: true }));

    expect(setSpy).toHaveBeenCalledWith(2000);
    expect(vad.get().silenceMs).toBe(2000);
    const value = slider.closest(".yui-gain")!.querySelector<HTMLElement>(".yui-gain__value")!;
    expect(value.textContent).toBe("2000 ms");

    qc.dispose();
  });

  it("does NOT render the legacy voice details (세부 설정) block", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.el.querySelector(".yui-voice-details")).toBeNull();
    expect(qc.el.querySelector(".yui-voice-status")).toBeNull();
    expect(qc.el.querySelector(".yui-setting-grid")).toBeNull();
    qc.dispose();
  });

  // ── Thinking filler section ──────────────────────────────────────────────────

  function makeFillerSettings(initial?: { enabled?: boolean; language?: "ja" | "en" | "ko" }) {
    return createFillerSettings({
      initial: { enabled: true, language: "ja", customPools: {}, ...initial },
    });
  }

  it("does not render filler section when fillerSettings is absent", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.el.querySelector(".yui-filler")).toBeNull();
    qc.dispose();
  });

  it("renders filler section in the talk tab when fillerSettings is provided", () => {
    const fs = makeFillerSettings();
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const section = qc.el.querySelector(".yui-filler");
    expect(section).not.toBeNull();
    // Must be inside the talk panel
    const talkPanel = qc.el.querySelector<HTMLElement>("#yui-panel-talk")!;
    expect(talkPanel.contains(section)).toBe(true);

    qc.dispose();
  });

  it("reflectFiller: enable toggle reflects initial enabled=true", () => {
    const fs = makeFillerSettings({ enabled: true });
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const sw = qc.el.querySelector<HTMLButtonElement>(".yui-filler .yui-filler-switch")!;
    expect(sw).not.toBeNull();
    expect(sw.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("reflectFiller: enable toggle reflects initial enabled=false", () => {
    const fs = makeFillerSettings({ enabled: false });
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const sw = qc.el.querySelector<HTMLButtonElement>(".yui-filler .yui-filler-switch")!;
    expect(sw.getAttribute("aria-checked")).toBe("false");

    qc.dispose();
  });

  it("clicking the filler switch calls setEnabled with toggled value", () => {
    const fs = makeFillerSettings({ enabled: true });
    const spy = vi.spyOn(fs, "setEnabled");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const sw = qc.el.querySelector<HTMLButtonElement>(".yui-filler .yui-filler-switch")!;
    sw.click();

    expect(spy).toHaveBeenCalledWith(false);
    expect(sw.getAttribute("aria-checked")).toBe("false");

    qc.dispose();
  });

  it("reflectFiller: language seg reflects initial language ja", () => {
    const fs = makeFillerSettings({ language: "ja" });
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const langSeg = qc.el.querySelector<HTMLElement>(".yui-filler .yui-filler-lang-seg")!;
    const btns = Array.from(langSeg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[0].getAttribute("aria-checked")).toBe("true"); // ja
    expect(btns[1].getAttribute("aria-checked")).toBe("false"); // en
    expect(btns[2].getAttribute("aria-checked")).toBe("false"); // ko

    qc.dispose();
  });

  it("reflectFiller: language seg reflects initial language en", () => {
    const fs = makeFillerSettings({ language: "en" });
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const langSeg = qc.el.querySelector<HTMLElement>(".yui-filler .yui-filler-lang-seg")!;
    const btns = Array.from(langSeg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[1].getAttribute("aria-checked")).toBe("true"); // en

    qc.dispose();
  });

  it("clicking a language segment calls setLanguage and reloads both textareas", () => {
    const fs = createFillerSettings({
      initial: {
        enabled: true,
        language: "ja",
        customPools: {
          ja: { first: ["うーん"], repeat: ["ええと"] },
          en: { first: ["Hmm..."], repeat: ["Still thinking..."] },
        },
      },
    });
    const spy = vi.spyOn(fs, "setLanguage");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const langSeg = qc.el.querySelector<HTMLElement>(".yui-filler .yui-filler-lang-seg")!;
    const btns = Array.from(langSeg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    // click "en" (index 1)
    btns[1].click();

    expect(spy).toHaveBeenCalledWith("en");
    // both textareas should now show the en custom pool
    const first = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-first-textarea",
    )!;
    const repeat = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-repeat-textarea",
    )!;
    expect(first.value).toBe("Hmm...");
    expect(repeat.value).toBe("Still thinking...");

    qc.dispose();
  });

  it("ArrowRight on the filler language seg moves selection, tabindex, and calls setLanguage", () => {
    const fs = makeFillerSettings({ language: "ja" });
    const spy = vi.spyOn(fs, "setLanguage");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const langSeg = qc.el.querySelector<HTMLElement>(".yui-filler .yui-filler-lang-seg")!;
    const btns = Array.from(langSeg.querySelectorAll<HTMLButtonElement>(".yui-seg__btn"));
    expect(btns[0].getAttribute("aria-checked")).toBe("true"); // ja
    expect(btns[0].tabIndex).toBe(0);

    btns[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(spy).toHaveBeenCalledWith("en");
    expect(btns[1].getAttribute("aria-checked")).toBe("true"); // en
    expect(btns[0].getAttribute("aria-checked")).toBe("false");
    expect(btns[1].tabIndex).toBe(0);
    expect(btns[0].tabIndex).toBe(-1);

    qc.dispose();
  });

  it("Space on a filler language seg button selects that language", () => {
    const fs = makeFillerSettings({ language: "ja" });
    const spy = vi.spyOn(fs, "setLanguage");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const langSeg = qc.el.querySelector<HTMLElement>(".yui-filler .yui-filler-lang-seg")!;
    const ko = langSeg.querySelector<HTMLButtonElement>(".yui-seg__btn[data-lang='ko']")!;
    ko.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

    expect(spy).toHaveBeenCalledWith("ko");
    expect(ko.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("editing 첫 대사 calls setCustomPool with split first lines, preserving repeat", () => {
    const fs = createFillerSettings({
      initial: {
        enabled: true,
        language: "ja",
        customPools: { ja: { first: [], repeat: ["ええと"] } },
      },
    });
    const spy = vi.spyOn(fs, "setCustomPool");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const first = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-first-textarea",
    )!;
    first.value = "うーん\n\nそうだね\n";
    first.dispatchEvent(new Event("input", { bubbles: true }));

    // Empty lines stripped; order preserved; repeat from the other textarea preserved.
    expect(spy).toHaveBeenCalledWith("ja", { first: ["うーん", "そうだね"], repeat: ["ええと"] });

    qc.dispose();
  });

  it("editing 반복 대사 calls setCustomPool with split repeat lines, preserving first", () => {
    const fs = createFillerSettings({
      initial: {
        enabled: true,
        language: "ja",
        customPools: { ja: { first: ["うーん"], repeat: [] } },
      },
    });
    const spy = vi.spyOn(fs, "setCustomPool");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const repeat = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-repeat-textarea",
    )!;
    repeat.value = "ええと\n\nもう少し\n";
    repeat.dispatchEvent(new Event("input", { bubbles: true }));

    expect(spy).toHaveBeenCalledWith("ja", { first: ["うーん"], repeat: ["ええと", "もう少し"] });

    qc.dispose();
  });

  it("clearing both textareas calls setCustomPool with empty lists", () => {
    const fs = makeFillerSettings({ language: "ja" });
    const spy = vi.spyOn(fs, "setCustomPool");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const first = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-first-textarea",
    )!;
    first.value = "";
    first.dispatchEvent(new Event("input", { bubbles: true }));

    expect(spy).toHaveBeenCalledWith("ja", { first: [], repeat: [] });

    qc.dispose();
  });

  it("reflectFiller syncs both textareas from customPools for current language on open", () => {
    const fs = createFillerSettings({
      initial: {
        enabled: true,
        language: "ko",
        customPools: { ko: { first: ["음…", "글쎄…"], repeat: ["아직…"] } },
      },
    });
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const first = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-first-textarea",
    )!;
    const repeat = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-repeat-textarea",
    )!;
    expect(first.value).toBe("음…\n글쎄…");
    expect(repeat.value).toBe("아직…");

    qc.dispose();
  });

  it("reflectFiller: both textareas are empty when customPools has no entry for the current language", () => {
    const fs = makeFillerSettings({ language: "en" }); // no customPools for en
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const first = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-first-textarea",
    )!;
    const repeat = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-repeat-textarea",
    )!;
    expect(first.value).toBe("");
    expect(repeat.value).toBe("");

    qc.dispose();
  });

  it("external fillerSettings store change reflects in the UI while open", () => {
    const fs = makeFillerSettings({ enabled: true, language: "ja" });
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const sw = qc.el.querySelector<HTMLButtonElement>(".yui-filler .yui-filler-switch")!;
    fs.setEnabled(false);
    expect(sw.getAttribute("aria-checked")).toBe("false");

    qc.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Settings rail — collapsible two-column layout (talk/character/input/adv/react)
// ─────────────────────────────────────────────────────────────────────────────

describe("createQuickControls — sections rail collapse", () => {
  const RAIL_COLLAPSED_KEY = "yui.quickControls.railCollapsed";
  let mount: HTMLElement;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
      railCollapsedSettings: createFlagSettings(false, {
        storage: localStorageStore("yui.quickControls.railCollapsed"),
      }),
      ...extra,
    });
  }

  it("renders expanded by default: aria-expanded=true, no is-rail-collapsed class", () => {
    const qc = buildQc();
    qc.open();

    const cols = qc.el.querySelector<HTMLElement>(".yui-quick__cols")!;
    const collapseBtn = qc.el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;
    expect(collapseBtn).not.toBeNull();
    expect(collapseBtn.getAttribute("aria-expanded")).toBe("true");
    expect(cols.classList.contains("is-rail-collapsed")).toBe(false);

    qc.dispose();
  });

  it("clicking the collapse button toggles is-rail-collapsed + aria-expanded, and persists to localStorage", () => {
    const qc = buildQc();
    qc.open();

    const cols = qc.el.querySelector<HTMLElement>(".yui-quick__cols")!;
    const collapseBtn = qc.el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;

    collapseBtn.click();
    expect(cols.classList.contains("is-rail-collapsed")).toBe(true);
    expect(collapseBtn.getAttribute("aria-expanded")).toBe("false");
    expect(globalThis.localStorage.getItem(RAIL_COLLAPSED_KEY)).toBe('{"enabled":true}');

    collapseBtn.click();
    expect(cols.classList.contains("is-rail-collapsed")).toBe(false);
    expect(collapseBtn.getAttribute("aria-expanded")).toBe("true");
    expect(globalThis.localStorage.getItem(RAIL_COLLAPSED_KEY)).toBe('{"enabled":false}');

    qc.dispose();
  });

  it("reads the persisted collapsed state on build, applied before first paint", () => {
    globalThis.localStorage.setItem(RAIL_COLLAPSED_KEY, '{"enabled":true}');
    const qc = buildQc();
    qc.open();

    const cols = qc.el.querySelector<HTMLElement>(".yui-quick__cols")!;
    const collapseBtn = qc.el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;
    expect(cols.classList.contains("is-rail-collapsed")).toBe(true);
    expect(collapseBtn.getAttribute("aria-expanded")).toBe("false");

    qc.dispose();
  });

  it("tabs stay clickable and switch panels while the rail is collapsed", () => {
    globalThis.localStorage.setItem(RAIL_COLLAPSED_KEY, '{"enabled":true}');
    const qc = buildQc();
    qc.open();

    const tabs = Array.from(qc.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const target = tabs[2];
    target.click();

    expect(target.getAttribute("aria-selected")).toBe("true");
    const panel = qc.el.querySelector<HTMLElement>(`#${target.getAttribute("aria-controls")}`)!;
    expect(panel.hidden).toBe(false);
    for (const tab of tabs) {
      if (tab === target) continue;
      expect(tab.getAttribute("aria-selected")).toBe("false");
    }

    qc.dispose();
  });

  it("the indicator still tracks the active tab (--tab custom property) while collapsed", () => {
    globalThis.localStorage.setItem(RAIL_COLLAPSED_KEY, '{"enabled":true}');
    const qc = buildQc();
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]')!;
    const tabs = Array.from(qc.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    tabs[3].click();

    expect(tablist.style.getPropertyValue("--tab")).toBe("3");

    qc.dispose();
  });

  it("every tab keeps an accessible name (title + aria-label) for the icon-only collapsed state", () => {
    const qc = buildQc();
    qc.open();

    const tabs = Array.from(qc.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs).toHaveLength(5);
    for (const tab of tabs) {
      expect(tab.getAttribute("aria-label")).toBeTruthy();
      expect(tab.getAttribute("title")).toBeTruthy();
    }

    qc.dispose();
  });

  it("guards localStorage access — a throwing localStorage does not break construction or the toggle", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });

    expect(() => {
      const qc = buildQc();
      qc.open();
      const collapseBtn = qc.el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;
      collapseBtn.click();
      qc.dispose();
    }).not.toThrow();

    if (original) Object.defineProperty(globalThis, "localStorage", original);
  });

  // ── a11y: the collapse button must not be an owned child of role=tablist ──

  it("the collapse button lives outside [role=tablist] (ARIA tablist owns only tabs)", () => {
    const qc = buildQc();
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]')!;
    expect(tablist).not.toBeNull();
    expect(tablist.querySelector(".yui-rail-collapse")).toBeNull();

    const collapseBtn = qc.el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;
    expect(collapseBtn).not.toBeNull();
    expect(tablist.contains(collapseBtn)).toBe(false);

    qc.dispose();
  });

  it("ArrowDown/ArrowRight pressed while the collapse button is focused does not change the selected tab", () => {
    const qc = buildQc();
    qc.open();

    const collapseBtn = qc.el.querySelector<HTMLButtonElement>(".yui-rail-collapse")!;
    const tabs = Array.from(qc.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const activeBefore = tabs.find((tab) => tab.getAttribute("aria-selected") === "true")!;

    collapseBtn.focus();
    collapseBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    collapseBtn.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    const activeAfter = tabs.find((tab) => tab.getAttribute("aria-selected") === "true")!;
    expect(activeAfter).toBe(activeBefore);

    qc.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Language picker (i18n)
// ─────────────────────────────────────────────────────────────────────────────
