// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoiceMode } from "../../../../../settings/voice/voice-mode";
import { setLocale, t } from "../../../../i18n";
import { createVoiceSection } from "./voice-section";

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function build(initial: "tap" | "always" = "tap") {
  const voiceMode = createVoiceMode({
    storage: { load: () => ({ mode: initial }), save: () => {} },
  });
  const selectVoiceMode = vi.fn();
  const section = createVoiceSection({ voiceMode, selectVoiceMode, log });
  document.body.append(section.el);
  const mode = (m: string): HTMLButtonElement =>
    section.el.querySelector<HTMLButtonElement>(`.yui-seg__btn[data-mode="${m}"]`)!;
  return { section, voiceMode, selectVoiceMode, mode };
}

describe("createVoiceSection", () => {
  beforeEach(() => {
    setLocale("en");
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the title, the two-option radio segment and the note", () => {
    const { section, mode } = build();

    expect(section.el.querySelector(".yui-sec__title")!.textContent).toBe(t("phone.voice.section"));
    expect(section.el.querySelector(".yui-voice-seg")!.getAttribute("role")).toBe("radiogroup");
    expect(mode("tap").getAttribute("role")).toBe("radio");
    expect(mode("tap").textContent).toBe("Tap to toggle");
    expect(mode("always").textContent).toBe("Keep listening");
    expect(section.el.querySelector(".yui-voice-note")!.textContent).toBe(
      "Keep listening runs while YUI is open and stops in the background.",
    );
  });

  it.each([
    ["tap", "tap", "always"],
    ["always", "always", "tap"],
  ] as const)("checks the stored %s mode", (stored, checked, other) => {
    const { mode } = build(stored);

    expect(mode(checked).getAttribute("aria-checked")).toBe("true");
    expect(mode(other).getAttribute("aria-checked")).toBe("false");
  });

  it("hands a click to selectVoiceMode and leaves the checked button to the store", () => {
    const { selectVoiceMode, voiceMode, mode } = build();

    mode("always").click();

    expect(selectVoiceMode).toHaveBeenCalledWith("always");
    expect(mode("tap").getAttribute("aria-checked")).toBe("true");

    voiceMode.set("always");
    expect(mode("always").getAttribute("aria-checked")).toBe("true");
  });

  it("stops following the store after dispose", () => {
    const { section, voiceMode, mode } = build();
    section.dispose();

    voiceMode.set("always");

    expect(mode("always").getAttribute("aria-checked")).toBe("false");
  });
});
