// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStageBackground } from "../../../../io/assets/stage/stage-background";
import { createFlagSettings } from "../../../../settings/persisted-store";
import { createVoiceMode } from "../../../../settings/voice/voice-mode";
import { setLocale, t } from "../../../i18n";
import { createGeneralTab } from "./general-tab";

const IMAGE = { id: "beach.jpg", path: "/data/stage/beach.jpg" };
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function build(importStageImage: () => Promise<void> = async () => {}) {
  const stageBackground = createStageBackground();
  const bubblePersistSettings = createFlagSettings(false);
  const voiceMode = createVoiceMode({ storage: { load: () => null, save: () => {} } });
  const selectVoiceMode = vi.fn();
  const tab = createGeneralTab({
    stageBackground,
    importStageImage,
    bubblePersistSettings,
    voiceMode,
    selectVoiceMode,
    log,
  });
  document.body.append(tab.el);
  const q = <T extends HTMLElement>(sel: string): T => tab.el.querySelector<T>(sel)!;
  const mode = (m: string): HTMLButtonElement => q(`.yui-seg__btn[data-mode="${m}"]`);
  return { tab, stageBackground, bubblePersistSettings, voiceMode, selectVoiceMode, q, mode };
}

function key(el: HTMLElement, k: string): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
}

describe("createGeneralTab", () => {
  beforeEach(() => {
    setLocale("en");
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the Voice input, Stage and Speech bubble sections with the segments, the row and the switch", () => {
    const { tab, q, mode } = build();
    const titles = Array.from(tab.el.querySelectorAll(".yui-sec__title")).map((n) => n.textContent);
    expect(titles).toEqual([
      t("phone.voice.section"),
      t("phone.general.stage_section"),
      t("phone.general.bubble_section"),
    ]);
    expect(q(".yui-stage-seg").getAttribute("role")).toBe("radiogroup");
    expect(mode("default").getAttribute("role")).toBe("radio");
    expect(mode("default").textContent).toBe("Default");
    expect(mode("image").textContent).toBe("Image");
    expect(q(".yui-stage-choose").textContent).toBe("Choose");
    expect(q(".yui-bubble-persist-switch").getAttribute("role")).toBe("switch");
  });

  it("the voice segment hands its choice to selectVoiceMode and follows the mode store", () => {
    const { voiceMode, selectVoiceMode, q } = build();

    q('.yui-voice-seg .yui-seg__btn[data-mode="always"]').click();
    expect(selectVoiceMode).toHaveBeenCalledWith("always");

    voiceMode.set("always");
    expect(q('.yui-voice-seg .yui-seg__btn[data-mode="always"]').getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("Image is disabled until an image is stored, and Default is selected", () => {
    const { stageBackground, mode } = build();
    expect(mode("image").disabled).toBe(true);
    expect(mode("default").getAttribute("aria-checked")).toBe("true");
    stageBackground.setImage(IMAGE);
    expect(mode("image").disabled).toBe(false);
    expect(mode("image").getAttribute("aria-checked")).toBe("true");
    expect(mode("default").getAttribute("aria-checked")).toBe("false");
  });

  it("clicking a segment button sets the stage mode", () => {
    const { stageBackground, mode } = build();
    stageBackground.setImage(IMAGE);
    mode("default").click();
    expect(stageBackground.get().mode).toBe("default");
    mode("image").click();
    expect(stageBackground.get().mode).toBe("image");
  });

  it("arrows move focus without selecting, Enter commits, and a disabled Image is skipped", () => {
    const { stageBackground, mode } = build();
    mode("default").focus();
    key(mode("default"), "ArrowRight");
    expect(document.activeElement).toBe(mode("default"));
    stageBackground.setImage(IMAGE);
    stageBackground.setMode("default");
    key(mode("default"), "ArrowRight");
    expect(document.activeElement).toBe(mode("image"));
    expect(stageBackground.get().mode).toBe("default");
    key(mode("image"), "Enter");
    expect(stageBackground.get().mode).toBe("image");
  });

  it("focus on Image moves to Default when Image becomes disabled", () => {
    const { stageBackground, mode } = build();
    stageBackground.setImage(IMAGE);
    mode("image").focus();
    stageBackground.clearImage();
    expect(mode("image").disabled).toBe(true);
    expect(document.activeElement).toBe(mode("default"));
  });

  it("Choose runs the import, is disabled meanwhile and no error shows on success", async () => {
    let finish: () => void = () => {};
    const importStageImage = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const { q } = build(importStageImage);
    q<HTMLButtonElement>(".yui-stage-choose").click();
    q<HTMLButtonElement>(".yui-stage-choose").click();
    expect(importStageImage).toHaveBeenCalledTimes(1);
    expect(q<HTMLButtonElement>(".yui-stage-choose").disabled).toBe(true);
    finish();
    await vi.waitFor(() => expect(q<HTMLButtonElement>(".yui-stage-choose").disabled).toBe(false));
    expect(q(".yui-stage__foot").hidden).toBe(true);
  });

  it("a failed import shows the error and logs it; the next attempt hides it", async () => {
    const importStageImage = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("bad"))
      .mockResolvedValueOnce();
    const { q } = build(importStageImage);
    q<HTMLButtonElement>(".yui-stage-choose").click();
    await vi.waitFor(() => expect(q(".yui-stage__foot").hidden).toBe(false));
    expect(q(".yui-stage__foot").textContent).toContain(t("phone.general.import_error"));
    expect(log.error).toHaveBeenCalled();
    q<HTMLButtonElement>(".yui-stage-choose").click();
    expect(q(".yui-stage__foot").hidden).toBe(true);
    await vi.waitFor(() => expect(q<HTMLButtonElement>(".yui-stage-choose").disabled).toBe(false));
  });

  it("an import that ends after dispose writes no DOM", async () => {
    let fail: (e: unknown) => void = () => {};
    const { tab, q } = build(() => new Promise<void>((_, rej) => (fail = rej)));
    const error = q(".yui-stage__foot");
    q<HTMLButtonElement>(".yui-stage-choose").click();
    tab.dispose();
    fail(new Error("late"));
    await new Promise((r) => setTimeout(r, 0));
    expect(error.hidden).toBe(true);
  });

  it("the bubble switch binds the store and refresh repaints it", () => {
    const { tab, bubblePersistSettings, q } = build();
    q<HTMLButtonElement>(".yui-bubble-persist-switch").click();
    expect(bubblePersistSettings.get().enabled).toBe(true);
    expect(log.info).toHaveBeenCalledWith("bubble_persist_toggle", { enabled: true });
    bubblePersistSettings.setEnabled(false);
    tab.refresh();
    expect(q(".yui-bubble-persist-switch").getAttribute("aria-checked")).toBe("false");
  });

  it("dispose removes the tab and stops following the store", () => {
    const { tab, stageBackground, mode } = build();
    const image = mode("image");
    tab.dispose();
    stageBackground.setImage(IMAGE);
    expect(document.body.contains(tab.el)).toBe(false);
    expect(image.disabled).toBe(true);
  });
});
