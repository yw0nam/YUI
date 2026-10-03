// @vitest-environment jsdom
/**
 * filler-section.test.ts — the thinking-filler section on the panel's real markup: language
 * segment, the six pool textareas, store→DOM reflect, and teardown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlagSettings } from "../../../../settings/persisted-store";
import {
  createFillerSettings,
  type FillerSettings,
} from "../../../../settings/voice/filler-settings";
import { createVadSettings } from "../../../../settings/voice/vad-settings";
import { setLocale } from "../../../i18n";
import { createSwitchRows } from "../../switch-row";
import { buildPanelHtml } from "../../template";
import { createFillerSection } from "./filler-section";

type FillerSettingsStore = ReturnType<typeof createFillerSettings>;

const TEXTAREAS = ["first", "repeat", "long-wait", "timeout", "unreachable", "tool"] as const;

function seededFiller(over: Partial<FillerSettings> = {}): FillerSettingsStore {
  const settings: FillerSettings = { enabled: true, language: "ja", customPools: {}, ...over };
  return createFillerSettings({ storage: { load: () => settings, save: () => {} } });
}

/** The panel markup as the shell renders it; the filler section renders only with a store. */
function buildRoot(fillerSettings?: FillerSettingsStore): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = buildPanelHtml({
    isWindow: false,
    hasSession: false,
    switchRows: createSwitchRows({
      idleThrottleSettings: createFlagSettings(false),
      vad: createVadSettings(),
      fillerSettings,
    }),
    showScreen: false,
    showPresence: false,
    showPacerGap: false,
    showRateLimits: false,
    showDevtools: false,
    showHelp: false,
    showMessage: false,
    showHistory: false,
  });
  document.body.append(root);
  return root;
}

function langButtons(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>(".yui-filler-lang-seg .yui-seg__btn"));
}

function textarea(root: HTMLElement, name: (typeof TEXTAREAS)[number]): HTMLTextAreaElement {
  return root.querySelector<HTMLTextAreaElement>(`.yui-filler-${name}-textarea`)!;
}

function values(root: HTMLElement): string[] {
  return TEXTAREAS.map((name) => textarea(root, name).value);
}

const EN_POOL = {
  first: ["Hmm..."],
  repeat: ["Still thinking..."],
  long_wait: ["This is taking a while"],
  timeout: ["I gave up"],
  unreachable: ["No connection"],
  tool: { web_search: ["searching"], _default: ["checking..."] },
};
const EN_VALUES = [
  "Hmm...",
  "Still thinking...",
  "This is taking a while",
  "I gave up",
  "No connection",
  "checking...\nweb_search = searching",
];

describe("createFillerSection", () => {
  beforeEach(() => {
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    setLocale("ko");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("a click on a language button persists it, moves aria-checked/tabindex and writes the six textareas", () => {
    const fs = seededFiller({ customPools: { ja: { first: ["うーん"] }, en: EN_POOL } });
    const root = buildRoot(fs);
    const section = createFillerSection({ root, fillerSettings: fs });
    section.reflect();
    const btns = langButtons(root);
    expect(btns.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);

    btns[1].click();

    expect(fs.get().language).toBe("en");
    expect(btns.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(btns.map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    expect(values(root)).toEqual(EN_VALUES);

    section.dispose();
  });

  it("an arrow key on the language segment does the same and moves focus", () => {
    const fs = seededFiller({ customPools: { en: EN_POOL } });
    const root = buildRoot(fs);
    const section = createFillerSection({ root, fillerSettings: fs });
    section.reflect();
    const btns = langButtons(root);

    btns[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));

    expect(fs.get().language).toBe("en");
    expect(btns.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(btns.map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    expect(values(root)).toEqual(EN_VALUES);
    expect(document.activeElement).toBe(btns[1]);

    section.dispose();
  });

  it("textarea input persists the parsed pool for the current language, tool lines included", () => {
    const fs = seededFiller({ language: "ko" });
    const root = buildRoot(fs);
    const section = createFillerSection({ root, fillerSettings: fs });
    section.reflect();

    textarea(root, "first").value = "음…\n\n  글쎄…  \n";
    textarea(root, "tool").value = "checking...\nterminal = running it";
    textarea(root, "tool").dispatchEvent(new Event("input", { bubbles: true }));

    expect(fs.get().customPools).toEqual({
      ko: {
        first: ["음…", "글쎄…"],
        repeat: [],
        long_wait: [],
        timeout: [],
        unreachable: [],
        tool: { _default: ["checking..."], terminal: ["running it"] },
      },
    });
    // The stored tool tier serializes back to the text that produced it.
    textarea(root, "tool").value = "";
    section.reflect();
    expect(textarea(root, "tool").value).toBe("checking...\nterminal = running it");

    section.dispose();
  });

  it("reflect() shows the store's values after a change made outside the section", () => {
    const fs = seededFiller();
    const root = buildRoot(fs);
    const section = createFillerSection({ root, fillerSettings: fs });
    section.reflect();

    fs.setCustomPool("en", EN_POOL);
    fs.setLanguage("en");
    expect(values(root)).toEqual(["", "", "", "", "", ""]);
    section.reflect();

    const btns = langButtons(root);
    expect(btns.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(btns.map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    expect(values(root)).toEqual(EN_VALUES);

    section.dispose();
  });

  it("is inert without a store: no listener, no throw", () => {
    const root = buildRoot(seededFiller());
    const seg = root.querySelector<HTMLDivElement>(".yui-filler-lang-seg")!;
    const segSpy = vi.spyOn(seg, "addEventListener");
    const textareaSpy = vi.spyOn(textarea(root, "first"), "addEventListener");

    const section = createFillerSection({ root });
    section.reflect();
    langButtons(root)[1].click();
    section.dispose();

    expect(segSpy).not.toHaveBeenCalled();
    expect(textareaSpy).not.toHaveBeenCalled();
    expect(langButtons(root)[1].getAttribute("aria-checked")).toBe("false");
  });

  it("is inert without the section markup: no throw, the store is left alone", () => {
    const fs = seededFiller();
    const commit = vi.fn();
    fs.subscribe(commit);
    const root = buildRoot();
    expect(root.querySelector(".yui-filler")).toBeNull();

    const section = createFillerSection({ root, fillerSettings: fs });
    section.reflect();
    section.dispose();

    expect(commit).not.toHaveBeenCalled();
  });

  it("dispose() removes the click, keydown and input listeners", () => {
    const fs = seededFiller();
    const root = buildRoot(fs);
    const section = createFillerSection({ root, fillerSettings: fs });
    section.reflect();
    const setLanguage = vi.spyOn(fs, "setLanguage");
    const setCustomPool = vi.spyOn(fs, "setCustomPool");

    section.dispose();
    const btns = langButtons(root);
    btns[1].click();
    btns[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    for (const name of TEXTAREAS) {
      textarea(root, name).value = "x";
      textarea(root, name).dispatchEvent(new Event("input", { bubbles: true }));
    }

    expect(setLanguage).not.toHaveBeenCalled();
    expect(setCustomPool).not.toHaveBeenCalled();
  });
});
