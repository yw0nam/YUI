// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFillerSettings,
  type FillerSettings,
} from "../../../../settings/voice/filler-settings";
import { createVadSettings } from "../../../../settings/voice/vad-settings";
import { setLocale } from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import { defaultQcArgs } from "../../test-helpers";

/** A filler store hydrated from storage with the given settings. */
function seededFiller(settings: FillerSettings) {
  return createFillerSettings({ storage: { load: () => settings, save: () => {} } });
}

describe("createQuickControls — thinking filler section", () => {
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

  // ── Thinking filler section ──────────────────────────────────────────────────

  function makeFillerSettings(over?: { enabled?: boolean; language?: "ja" | "en" | "ko" }) {
    return seededFiller({ enabled: true, language: "ja", customPools: {}, ...over });
  }

  it("does not render filler section when fillerSettings is absent", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.el.querySelector(".yui-filler")).toBeNull();
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
    const fs = seededFiller({
      enabled: true,
      language: "ja",
      customPools: {
        ja: { first: ["うーん"], repeat: ["ええと"] },
        en: { first: ["Hmm..."], repeat: ["Still thinking..."] },
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

  it("editing the first-lines textarea calls setCustomPool with split first lines, preserving repeat", () => {
    const fs = seededFiller({
      enabled: true,
      language: "ja",
      customPools: { ja: { first: [], repeat: ["ええと"] } },
    });
    const spy = vi.spyOn(fs, "setCustomPool");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const first = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-first-textarea",
    )!;
    first.value = "うーん\n\nそうだね\n";
    first.dispatchEvent(new Event("input", { bubbles: true }));

    // Empty lines stripped; order preserved; every other field's current (empty) value written alongside.
    expect(spy).toHaveBeenCalledWith("ja", {
      first: ["うーん", "そうだね"],
      repeat: ["ええと"],
      long_wait: [],
      timeout: [],
      unreachable: [],
      tool: {},
    });

    qc.dispose();
  });

  it("editing the repeat-lines textarea calls setCustomPool with split repeat lines, preserving first", () => {
    const fs = seededFiller({
      enabled: true,
      language: "ja",
      customPools: { ja: { first: ["うーん"], repeat: [] } },
    });
    const spy = vi.spyOn(fs, "setCustomPool");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const repeat = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-repeat-textarea",
    )!;
    repeat.value = "ええと\n\nもう少し\n";
    repeat.dispatchEvent(new Event("input", { bubbles: true }));

    expect(spy).toHaveBeenCalledWith("ja", {
      first: ["うーん"],
      repeat: ["ええと", "もう少し"],
      long_wait: [],
      timeout: [],
      unreachable: [],
      tool: {},
    });

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

    expect(spy).toHaveBeenCalledWith("ja", {
      first: [],
      repeat: [],
      long_wait: [],
      timeout: [],
      unreachable: [],
      tool: {},
    });

    qc.dispose();
  });

  it("reflectFiller syncs both textareas from customPools for current language on open", () => {
    const fs = seededFiller({
      enabled: true,
      language: "ko",
      customPools: { ko: { first: ["음…", "글쎄…"], repeat: ["아직…"] } },
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

  // ── "More phrases" details (long_wait / timeout / unreachable / tool) ─────────

  it("wraps the four extra tiers in a closed-by-default <details class='yui-filler-more'>", () => {
    const qc = buildQc({ fillerSettings: makeFillerSettings() });
    qc.open();

    const details = qc.el.querySelector<HTMLDetailsElement>(".yui-filler .yui-filler-more")!;
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("더 보기"); // ko locale — see beforeEach
    for (const cls of [
      ".yui-filler-long-wait-textarea",
      ".yui-filler-timeout-textarea",
      ".yui-filler-unreachable-textarea",
      ".yui-filler-tool-textarea",
    ]) {
      expect(details.querySelector(cls)).not.toBeNull();
    }

    qc.dispose();
  });

  it("draws the more-phrases chevron as an inline svg with no text-glyph fallback in the css", () => {
    const qc = buildQc({ fillerSettings: makeFillerSettings() });
    qc.open();

    const summary = qc.el
      .querySelector<HTMLDetailsElement>(".yui-filler .yui-filler-more")!
      .querySelector("summary")!;
    expect(summary.querySelector("svg")).not.toBeNull();

    const css = readFileSync("src/ui/quick-controls/controls.css", "utf8");
    expect(css).not.toContain('content: "\u203A"');
    expect(css).not.toContain(".yui-filler-more > summary::before");

    qc.dispose();
  });

  it("editing the long_wait/timeout/unreachable textareas writes every other current field alongside", () => {
    const fs = seededFiller({
      enabled: true,
      language: "ja",
      customPools: { ja: { first: ["うーん"], repeat: ["ええと"] } },
    });
    const spy = vi.spyOn(fs, "setCustomPool");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const longWait = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-long-wait-textarea",
    )!;
    longWait.value = "まだかかりそう";
    longWait.dispatchEvent(new Event("input", { bubbles: true }));

    expect(spy).toHaveBeenCalledWith("ja", {
      first: ["うーん"],
      repeat: ["ええと"],
      long_wait: ["まだかかりそう"],
      timeout: [],
      unreachable: [],
      tool: {},
    });

    qc.dispose();
  });

  it("editing the tool textarea parses '_default' and 'tool_id = phrase' lines into the tool tier", () => {
    const fs = makeFillerSettings();
    const spy = vi.spyOn(fs, "setCustomPool");
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const tool = qc.el.querySelector<HTMLTextAreaElement>(".yui-filler .yui-filler-tool-textarea")!;
    tool.value = "checking...\nterminal = running it";
    tool.dispatchEvent(new Event("input", { bubbles: true }));

    expect(spy).toHaveBeenCalledWith("ja", {
      first: [],
      repeat: [],
      long_wait: [],
      timeout: [],
      unreachable: [],
      tool: { _default: ["checking..."], terminal: ["running it"] },
    });

    qc.dispose();
  });

  it("reflectFiller serializes the stored tool tier back into '_default' then 'key = phrase' lines", () => {
    const fs = seededFiller({
      enabled: true,
      language: "ja",
      customPools: {
        ja: {
          long_wait: ["まだかかりそう"],
          timeout: ["諦めちゃった"],
          unreachable: ["つながらない"],
          tool: { web_search: ["searching"], _default: ["checking..."] },
        },
      },
    });
    const qc = buildQc({ fillerSettings: fs });
    qc.open();

    const longWait = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-long-wait-textarea",
    )!;
    const timeout = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-timeout-textarea",
    )!;
    const unreachable = qc.el.querySelector<HTMLTextAreaElement>(
      ".yui-filler .yui-filler-unreachable-textarea",
    )!;
    const tool = qc.el.querySelector<HTMLTextAreaElement>(".yui-filler .yui-filler-tool-textarea")!;
    expect(longWait.value).toBe("まだかかりそう");
    expect(timeout.value).toBe("諦めちゃった");
    expect(unreachable.value).toBe("つながらない");
    expect(tool.value).toBe("checking...\nweb_search = searching");

    qc.dispose();
  });
});
