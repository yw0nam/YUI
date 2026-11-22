// @vitest-environment jsdom
/**
 * filler-section.test.tsx — the thinking-filler section of the Voice page: language segment,
 * the eight pool textareas, and the store→DOM redraw.
 */

import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFlagSettings } from "../../../../settings/persisted-store";
import {
  createFillerSettings,
  type FillerSettings,
} from "../../../../settings/voice/filler-settings";
import { setLocale } from "../../../i18n";
import { createSwitchRows } from "../../switch-row";
import { makeSpeakerSelection } from "../../test-helpers";
import { createVoicePage, type VoicePage } from "../voice-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pages: VoicePage[] = [];

type FillerSettingsStore = ReturnType<typeof createFillerSettings>;

const TEXTAREAS = [
  "first",
  "repeat",
  "long-wait",
  "timeout",
  "unreachable",
  "threads-open",
  "threads-raise",
  "tool",
] as const;

function seededFiller(over: Partial<FillerSettings> = {}): FillerSettingsStore {
  const settings: FillerSettings = { enabled: true, language: "ja", customPools: {}, ...over };
  return createFillerSettings({ storage: { load: () => settings, save: () => {} } });
}

/** The Voice page as the shell renders it, with the filler store injected. */
function buildRoot(fillerSettings: FillerSettingsStore) {
  const page = createVoicePage({
    rows: createSwitchRows({
      idleThrottleSettings: createFlagSettings(false),
      fillerSettings,
    }).filter((row) => row.tab === "voice"),
    fillerSettings,
    speakerSelection: makeSpeakerSelection(),
    swapSpeaker: vi.fn(async () => {}),
    refreshSpeaker: vi.fn(async () => {}),
    pickVoiceImport: vi.fn(async () => null),
    commitVoiceImport: vi.fn(async () => {}),
    removeVoice: vi.fn(async () => {}),
    canManageVoices: () => true,
    canReuploadVoices: () => true,
    canPasteVoiceId: () => false,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    refreshTooltip: () => {},
    isOpen: () => true,
  });
  pages.push(page);
  document.body.append(page.el);
  return page;
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
  threads_open: ["Opening Threads"],
  threads_raise: ["Bringing it up"],
  tool: { web_search: ["searching"], _default: ["checking..."] },
};
const EN_VALUES = [
  "Hmm...",
  "Still thinking...",
  "This is taking a while",
  "I gave up",
  "No connection",
  "Opening Threads",
  "Bringing it up",
  "checking...\nweb_search = searching",
];

describe("the thinking-filler section", () => {
  beforeEach(() => {
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    setLocale("ko");
  });

  afterEach(() => {
    act(() => {
      for (const page of pages.splice(0)) page.dispose();
    });
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("a click on a language button persists it, moves aria-checked/tabindex and writes the eight textareas", () => {
    const fs = seededFiller({ customPools: { ja: { first: ["うーん"] }, en: EN_POOL } });
    const { el: root } = buildRoot(fs);
    const btns = langButtons(root);
    expect(btns.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);

    act(() => btns[1].click());

    expect(fs.get().language).toBe("en");
    expect(btns.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(btns.map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    expect(values(root)).toEqual(EN_VALUES);
  });

  it("an arrow key on the language segment does the same and moves focus", () => {
    const fs = seededFiller({ customPools: { en: EN_POOL } });
    const { el: root } = buildRoot(fs);
    const btns = langButtons(root);

    act(() =>
      btns[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );

    expect(fs.get().language).toBe("en");
    expect(btns.map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(btns.map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    expect(values(root)).toEqual(EN_VALUES);
    expect(document.activeElement).toBe(btns[1]);
  });

  it("textarea input persists the parsed pool for the current language, tool lines included", () => {
    const fs = seededFiller({ language: "ko" });
    const page = buildRoot(fs);
    const root = page.el;

    textarea(root, "first").value = "음…\n\n  글쎄…  \n";
    textarea(root, "tool").value = "checking...\nterminal = running it";
    act(() => {
      fireEvent.input(textarea(root, "tool"));
    });

    expect(fs.get().customPools).toEqual({
      ko: {
        first: ["음…", "글쎄…"],
        repeat: [],
        long_wait: [],
        timeout: [],
        unreachable: [],
        threads_open: [],
        threads_raise: [],
        tool: { _default: ["checking..."], terminal: ["running it"] },
      },
    });
    // The stored tool tier serializes back to the text that produced it.
    textarea(root, "tool").value = "";
    act(() => page.refresh());
    expect(textarea(root, "tool").value).toBe("checking...\nterminal = running it");
  });

  it("an open writes the store's values over the textareas", () => {
    const fs = seededFiller({ customPools: { ja: { first: ["うーん"] } } });
    const page = buildRoot(fs);
    textarea(page.el, "first").value = "unsaved edit";

    act(() => page.refresh());

    expect(textarea(page.el, "first").value).toBe("うーん");
  });

  it("a store change redraws the segment and textareas", () => {
    const fs = seededFiller({ customPools: { en: EN_POOL } });
    const { el: root } = buildRoot(fs);

    act(() => fs.setLanguage("en"));

    expect(langButtons(root).map((b) => b.getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(langButtons(root).map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    expect(values(root)).toEqual(EN_VALUES);
  });
});
