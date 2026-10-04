// @vitest-environment jsdom
/**
 * create-phone-top-row.test.ts — the phone top row's openers: the history and settings icon
 * buttons open the view on their tabs, and the delegation chip's lost-state tap opens Connection.
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { DelegationsStore } from "../../../io/bridge/delegations/delegations-store";
import type { PushSocket, PushSocketState } from "../../../io/chat/push/push-socket";
import { createVoiceInputStatus } from "../../../ui/chips/voice-input-status";
import { setLocale, t } from "../../../ui/i18n";
import type { PhoneSettingsTab } from "../../../ui/phone/settings/phone-settings-view";
import { createPhoneTopRow } from "./create-phone-top-row";

describe("createPhoneTopRow — openers", () => {
  let state: PushSocketState;
  let listeners: ((s: PushSocketState) => void)[];

  beforeEach(() => {
    setLocale("en");
    state = { kind: "ready", chat_id: "yui-1" };
    listeners = [];
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function pushSocket(): Pick<PushSocket, "getState" | "onState"> {
    return {
      getState: () => state,
      onState: (cb) => {
        listeners.push(cb);
        return () => {
          listeners = listeners.filter((l) => l !== cb);
        };
      },
    };
  }

  function delegations(): DelegationsStore {
    return {
      get: () => [],
      runningCount: () => 0,
      subscribe: () => () => {},
    } as unknown as DelegationsStore;
  }

  function emit(next: PushSocketState): void {
    state = next;
    for (const cb of listeners) cb(next);
  }

  function build() {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    const onOpenView: Mock<(tab: PhoneSettingsTab) => void> = vi.fn();
    const onFixVoice = vi.fn();
    const onToggleVoice = vi.fn();
    const voice = createVoiceInputStatus();
    const row = createPhoneTopRow({
      mount,
      voice,
      pushSocket: pushSocket() as PushSocket,
      delegations: delegations(),
      onOpenView,
      onFixVoice,
      onToggleVoice,
    });
    return { mount, onOpenView, onFixVoice, onToggleVoice, voice, row };
  }

  it("the history button opens the view on History, the settings button on Connection", () => {
    const { mount, onOpenView, row } = build();

    const [historyBtn, settingsBtn] = mount.querySelectorAll<HTMLButtonElement>(".yui-phone__open");
    expect([historyBtn, settingsBtn].map((b) => b!.getAttribute("aria-label"))).toEqual([
      t("phone.open_history"),
      t("phone.open_settings"),
    ]);
    historyBtn!.click();
    settingsBtn!.click();

    expect(onOpenView.mock.calls).toEqual([["hist"], ["conn"]]);

    row.dispose();
  });

  it("the pill's voice button toggles the voice while it listens, and its setup-needed fix goes to the voice fix port", () => {
    const { mount, voice, onFixVoice, onToggleVoice, row } = build();
    voice.set("listening");

    mount.querySelector<HTMLButtonElement>(".yui-status__voice")!.click();

    expect(onToggleVoice).toHaveBeenCalledTimes(1);

    voice.set("error", "not_configured");
    mount.querySelector<HTMLElement>(".yui-status")!.click();

    expect(onFixVoice).toHaveBeenCalledTimes(1);
    expect(onToggleVoice).toHaveBeenCalledTimes(1);
    row.dispose();
  });

  it("the delegation chip sits before the openers once it shows", () => {
    const { mount, row } = build();
    row.chip.create();
    emit({ kind: "failed", code: 4401 });
    const top = mount.querySelector(".yui-phone__top")!;
    const order = [...top.querySelectorAll(".yui-deleg__chip, .yui-phone__open")];
    expect(order[0]?.classList.contains("yui-deleg__chip")).toBe(true);
  });

  it("the delegation chip's lost-state tap opens the view on Connection", () => {
    const { mount, onOpenView, row } = build();
    row.chip.create();

    emit({ kind: "failed", code: 4401 });
    mount.querySelector<HTMLButtonElement>(".yui-deleg__chip")!.click();

    expect(onOpenView).toHaveBeenCalledWith("conn");

    row.dispose();
  });
});
