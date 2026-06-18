// @vitest-environment jsdom

/**
 * voice-input-indicator.test.ts
 *
 * The indicator must render the translated state label via i18n (voice.state.*),
 * not the baked snapshot.label const from voice-input-status. This keeps it
 * correct after a locale change + host re-mount.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    createVoiceInputIndicator({ mount, status, onActivate: () => {} });

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
    });

    status.set("listening");
    expect(el.getAttribute("aria-label")).toBe(
      t("aria.voice_input", { label: t("voice.state.listening") }),
    );
  });

  it("renders the translated label for the active locale", () => {
    setLocale("ko");
    const status = createVoiceInputStatus();
    createVoiceInputIndicator({ mount, status, onActivate: () => {} });

    status.set("listening");
    const labelEl = mount.querySelector<HTMLSpanElement>(".yui-voice__label")!;
    expect(labelEl.textContent).toBe(t("voice.state.listening"));
  });

  it("maps each voice state directly to its voice.state.<state> key", () => {
    const status = createVoiceInputStatus();
    createVoiceInputIndicator({ mount, status, onActivate: () => {} });
    const labelEl = mount.querySelector<HTMLSpanElement>(".yui-voice__label")!;

    for (const state of ["listening", "asr", "fired", "error"] as const) {
      status.set(state);
      expect(labelEl.textContent).toBe(t(`voice.state.${state}`));
    }
  });
});
