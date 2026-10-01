// @vitest-environment jsdom
/**
 * create-phone-top-row.test.ts — the phone top row's openers: the history and settings icon
 * buttons open the view on their tabs, and the delegation chip's lost-state tap opens Connection.
 */
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { DelegationsStore } from "../../../../io/bridge/delegations-store";
import type { PushSocket, PushSocketState } from "../../../../io/chat/push-socket";
import { createVoiceInputStatus } from "../../../../ui/chips/voice-input-status";
import { setLocale, t } from "../../../../ui/i18n";
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
    const onOpenView: Mock<(tab: "conn" | "hist") => void> = vi.fn();
    const row = createPhoneTopRow({
      mount,
      voice: createVoiceInputStatus(),
      pushSocket: pushSocket() as PushSocket,
      delegations: delegations(),
      onOpenView,
    });
    return { mount, onOpenView, row };
  }

  it("renders the history and settings icon buttons with their labels", () => {
    const { mount, row } = build();

    const buttons = Array.from(
      mount.querySelectorAll<HTMLButtonElement>(".yui-phone__open"),
    );
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      t("phone.open_history"),
      t("phone.open_settings"),
    ]);

    row.dispose();
  });

  it("the history button opens the view on History, the settings button on Connection", () => {
    const { mount, onOpenView, row } = build();

    const [historyBtn, settingsBtn] = mount.querySelectorAll<HTMLButtonElement>(
      ".yui-phone__open",
    );
    historyBtn!.click();
    settingsBtn!.click();

    expect(onOpenView.mock.calls).toEqual([["hist"], ["conn"]]);

    row.dispose();
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
