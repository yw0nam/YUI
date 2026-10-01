// @vitest-environment jsdom
/**
 * wire-phone-settings.test.ts — the phone settings wiring's lifecycle: disposing it lands typed
 * input and releases every subscription the tabs took.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushSocket } from "../../../io/chat/push-socket";
import { createSettingsStores } from "../../../settings/settings-stores";
import { setLocale } from "../../../ui/i18n";
import { createConversationStores } from "../../settings/conversation-stores";
import { createPhoneSettings } from "./wire-phone-settings";

describe("createPhoneSettings", () => {
  beforeEach(() => {
    setLocale("en");
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("dispose commits dirty input and removes the tabs' subscriptions", () => {
    const stores = createSettingsStores();
    const conversation = createConversationStores();
    const unsubscribeState = vi.fn();
    const pushSocket = {
      getState: () => ({ kind: "offline" }),
      onState: () => unsubscribeState,
      sendReset: () => true,
      reconnectNow: () => {},
    } as unknown as PushSocket;
    const mount = document.createElement("div");
    document.body.append(mount);
    const phoneSettings = createPhoneSettings({
      mount,
      stores,
      conversation,
      pushSocket,
      stopTurn: () => {},
      getEndpoints: () => ({
        chat_base_url: "",
        stt_base_url: "",
        tts_base_url: "",
        chat_api: "push",
      }),
      config: {
        get() {
          throw new Error("config not loaded");
        },
      },
    });
    phoneSettings.open("conn");
    // Typed but never blurred — only a commit on dispose lands it.
    const sttUrl = mount.querySelector<HTMLInputElement>("#yui-ep-stt_base_url")!;
    sttUrl.value = "http://stt.test/v1";
    sttUrl.dispatchEvent(new Event("input", { bubbles: true }));

    phoneSettings.dispose();

    expect(stores.endpointsSettings.get().stt_base_url).toBe("http://stt.test/v1");
    expect(unsubscribeState).toHaveBeenCalledTimes(1);
    expect(mount.querySelector(".yui-phone-settings")).toBeNull();
  });
});
