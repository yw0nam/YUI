// @vitest-environment jsdom

/**
 * voice-input-indicator.test.ts
 *
 * The indicator must render the translated state label via i18n (voice.state.*),
 * not the baked snapshot.label const from voice-input-status. This keeps it
 * correct after a locale change + host re-mount.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERACTIVE_OVERLAY_SELECTORS } from "../bootstrap-configured";
import { setLocale, t } from "./i18n";
import { createVoiceInputIndicator } from "./voice-input-indicator";
import { createVoiceInputStatus } from "./voice-input-status";

describe("createVoiceInputIndicator — translated state labels", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("en");
  });

  it("shows the i18n state label, not the baked snapshot.label", () => {
    const status = createVoiceInputStatus();
    createVoiceInputIndicator({ mount, status, onActivate: () => {}, onOpenSettings: () => {} });

    status.set("listening");
    const labelEl = mount.querySelector<HTMLSpanElement>(".yui-voice__label")!;
    expect(labelEl.textContent).toBe(t("voice.state.listening"));
  });

  it("derives the aria-label from the translated state label", () => {
    const status = createVoiceInputStatus();
    const { el } = createVoiceInputIndicator({
      mount,
      status,
      onActivate: () => {},
      onOpenSettings: () => {},
    });

    status.set("listening");
    expect(el.getAttribute("aria-label")).toBe(
      t("aria.voice_input", { label: t("voice.state.listening") }),
    );
  });

  it("renders the translated label for the active locale", () => {
    setLocale("ko");
    const status = createVoiceInputStatus();
    createVoiceInputIndicator({ mount, status, onActivate: () => {}, onOpenSettings: () => {} });

    status.set("listening");
    const labelEl = mount.querySelector<HTMLSpanElement>(".yui-voice__label")!;
    expect(labelEl.textContent).toBe(t("voice.state.listening"));
  });

  it("maps each voice state directly to its voice.state.<state> key", () => {
    const status = createVoiceInputStatus();
    createVoiceInputIndicator({ mount, status, onActivate: () => {}, onOpenSettings: () => {} });
    const labelEl = mount.querySelector<HTMLSpanElement>(".yui-voice__label")!;

    for (const state of ["listening", "asr", "fired", "error"] as const) {
      status.set(state);
      expect(labelEl.textContent).toBe(t(`voice.state.${state}`));
    }
  });
});

/**
 * A voice-sourced not_configured failure is the one error the settings panel can
 * resolve, so in that state the chip stops being a status tell and becomes the fix.
 */
describe("createVoiceInputIndicator — not_configured settings affordance", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("en");
  });

  const chip = (): HTMLButtonElement => mount.querySelector<HTMLButtonElement>(".yui-voice")!;
  const label = (): HTMLSpanElement => mount.querySelector<HTMLSpanElement>(".yui-voice__label")!;

  it('marks the chip data-fix="settings" and swaps in the reason-specific label', () => {
    const status = createVoiceInputStatus();
    createVoiceInputIndicator({ mount, status, onActivate: () => {}, onOpenSettings: () => {} });

    status.set("error", "not_configured");

    expect(chip().dataset.fix).toBe("settings");
    expect(chip().dataset.state).toBe("error");
    expect(label().textContent).toBe(t("voice.error.not_configured"));
    expect(label().textContent).not.toBe(t("voice.state.error"));
  });

  it("renders the gear glyph, hidden from assistive tech", () => {
    const status = createVoiceInputStatus();
    createVoiceInputIndicator({ mount, status, onActivate: () => {}, onOpenSettings: () => {} });

    status.set("error", "not_configured");

    const glyph = mount.querySelector(".yui-voice__fix-glyph")!;
    expect(glyph).not.toBeNull();
    expect(glyph.getAttribute("aria-hidden")).toBe("true");
  });

  it("names the destination in aria-label, not just the state", () => {
    const status = createVoiceInputStatus();
    const { el } = createVoiceInputIndicator({
      mount,
      status,
      onActivate: () => {},
      onOpenSettings: () => {},
    });

    status.set("error", "not_configured");

    expect(el.getAttribute("aria-label")).toBe(
      t("aria.voice_input", { label: t("voice.error.not_configured_fix") }),
    );
  });

  it("routes the click to settings instead of the default activation", () => {
    const status = createVoiceInputStatus();
    const onActivate = vi.fn();
    const onOpenSettings = vi.fn();
    createVoiceInputIndicator({ mount, status, onActivate, onOpenSettings });

    status.set("error", "not_configured");
    chip().click();

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("returns the chip to listening once the click has taken the user to settings", () => {
    const status = createVoiceInputStatus();
    createVoiceInputIndicator({ mount, status, onActivate: () => {}, onOpenSettings: () => {} });

    status.set("error", "not_configured");
    chip().click();

    expect(status.get().state).toBe("listening");
    expect(chip().dataset.fix).toBeUndefined();
  });

  it("leaves every other state untouched — generic label, no fix, default click", () => {
    const status = createVoiceInputStatus();
    const onActivate = vi.fn();
    const onOpenSettings = vi.fn();
    createVoiceInputIndicator({ mount, status, onActivate, onOpenSettings });

    for (const [state, detail] of [
      ["error", "network_drop"],
      ["listening", undefined],
      ["asr", undefined],
      ["fired", undefined],
    ] as const) {
      status.set(state, detail);
      expect(chip().dataset.fix).toBeUndefined();
      expect(label().textContent).toBe(t(`voice.state.${state}`));
    }

    chip().click();
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it("keeps the default activation on a transient error — that chip has no fix to offer", () => {
    const status = createVoiceInputStatus();
    const onActivate = vi.fn();
    const onOpenSettings = vi.fn();
    createVoiceInputIndicator({ mount, status, onActivate, onOpenSettings });

    status.set("error", "network_drop");
    chip().click();

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(status.get()).toMatchObject({ state: "error", detail: "network_drop" });
  });

  it("drops the fix marking when the error is replaced by a transient one", () => {
    const status = createVoiceInputStatus();
    createVoiceInputIndicator({ mount, status, onActivate: () => {}, onOpenSettings: () => {} });

    status.set("error", "not_configured");
    status.set("error", "network_drop");

    expect(chip().dataset.fix).toBeUndefined();
    expect(label().textContent).toBe(t("voice.state.error"));
  });

  it("renders the affordance in the active locale", () => {
    setLocale("ko");
    const status = createVoiceInputStatus();
    createVoiceInputIndicator({ mount, status, onActivate: () => {}, onOpenSettings: () => {} });

    status.set("error", "not_configured");

    expect(label().textContent).toBe(t("voice.error.not_configured"));
  });
});

/**
 * The overlay is pointer-events:none passthrough; the window-level hit test only
 * grants OS clicks to rects collected from INTERACTIVE_OVERLAY_SELECTORS. Without a
 * registered selector the DOM handler never fires, so the affordance is two changes.
 */
describe("voice indicator — hit-test registration", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    mount = document.createElement("div");
    document.body.appendChild(mount);
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    setLocale("en");
  });

  const matchAny = (): Element | null => {
    for (const selector of INTERACTIVE_OVERLAY_SELECTORS) {
      const el = mount.querySelector(selector);
      if (el) return el;
    }
    return null;
  };

  it("the not_configured chip matches a registered interactive selector", () => {
    const status = createVoiceInputStatus();
    const { el } = createVoiceInputIndicator({
      mount,
      status,
      onActivate: () => {},
      onOpenSettings: () => {},
    });

    status.set("error", "not_configured");

    expect(matchAny()).toBe(el);
  });

  it("every other voice state stays click-through", () => {
    const status = createVoiceInputStatus();
    createVoiceInputIndicator({ mount, status, onActivate: () => {}, onOpenSettings: () => {} });

    for (const [state, detail] of [
      ["error", "network_drop"],
      ["listening", undefined],
      ["asr", undefined],
      ["fired", undefined],
      ["idle", undefined],
    ] as const) {
      status.set(state, detail);
      expect(matchAny()).toBeNull();
    }
  });
});
