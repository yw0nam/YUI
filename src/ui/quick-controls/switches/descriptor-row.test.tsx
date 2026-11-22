// @vitest-environment jsdom
/** descriptor-row.test.tsx — the message-window row's lock, through the Voice page that renders it. */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMessageWindowSettings } from "../../../settings/panels/message-window-settings";
import { createFlagSettings } from "../../../settings/persisted-store";
import { createFillerSettings } from "../../../settings/voice/filler-settings";
import { createSwitchRows } from "../switch-row";
import { makeSpeakerSelection } from "../test-helpers";
import { createVoicePage, type VoicePage } from "../voice/voice-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pages: VoicePage[] = [];

beforeEach(() => {
  // The message-window row renders only where a second window can exist.
  (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {};
});

afterEach(() => {
  act(() => {
    for (const page of pages.splice(0)) page.dispose();
  });
  document.body.innerHTML = "";
  delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

/** A voice page whose message-window row is locked while `shown` holds. */
function build(messageWindowSettings: ReturnType<typeof createMessageWindowSettings>) {
  let shown = true;
  const listeners = new Set<(shown: boolean) => void>();
  const fillerSettings = createFillerSettings();
  const page = createVoicePage({
    rows: createSwitchRows({
      idleThrottleSettings: createFlagSettings(true),
      fillerSettings,
      messageWindowSettings,
      unifiedShown: {
        get: () => shown,
        subscribe: (cb) => {
          listeners.add(cb);
          return () => listeners.delete(cb);
        },
      },
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
    log: { debug() {}, info() {}, warn() {}, error() {} },
    refreshTooltip: () => {},
    isOpen: () => true,
  });
  pages.push(page);
  document.body.append(page.el);
  const unlock = () =>
    act(() => {
      shown = false;
      for (const cb of listeners) cb(false);
    });
  return { el: page.el, unlock };
}

describe("DescriptorRow — the message-window lock", () => {
  it("locks the message window row with its reason while the unified window shows", () => {
    const messageWindowSettings = createMessageWindowSettings();
    const { el, unlock } = build(messageWindowSettings);
    const button = el.querySelector<HTMLButtonElement>(".yui-message-window-switch")!;
    const sub = () => button.closest(".yui-row")?.querySelector(".yui-row__sub")?.textContent;

    expect(button.disabled).toBe(true);
    expect(sub()).toBe("Off while the unified chat window shows");
    act(() => button.click());
    expect(messageWindowSettings.get().mode).toBe("docked");

    unlock();

    expect(button.disabled).toBe(false);
    expect(sub()).toBe("Speech and typing live in a window you can drag anywhere");
  });

  it("shows a locked message window row off and its stored popped mode again once unlocked", () => {
    const messageWindowSettings = createMessageWindowSettings();
    messageWindowSettings.setMode("popped");
    const { el, unlock } = build(messageWindowSettings);
    const button = el.querySelector<HTMLButtonElement>(".yui-message-window-switch")!;

    expect(button.getAttribute("aria-checked")).toBe("false");
    expect(messageWindowSettings.get().mode).toBe("popped");

    unlock();

    expect(button.getAttribute("aria-checked")).toBe("true");
  });
});
