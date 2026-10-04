// @vitest-environment jsdom
/**
 * connection-tab.test.ts — the extracted Connection tab: the phone rows render and bind only the
 * push fields; the shared STT model field persists and resets with the service; dispose commits.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushSocketState } from "../../../io/chat/push/push-socket";
import {
  createChatKeySettings,
  createSttKeySettings,
  createTtsKeySettings,
} from "../../../settings/backend/api-key-settings";
import {
  createEndpointsSettings,
  type EndpointOverrides,
  endpointDefaultsFromConfig,
} from "../../../settings/backend/endpoints-settings";
import { setLocale } from "../../i18n";
import { inMemoryApiKeyStorage } from "../test-helpers";
import {
  type ConnectionRows,
  createConnectionTab,
  type PushSocketPanelPort,
} from "./connection-tab";

const DESKTOP_ROWS: ConnectionRows = { chat: "full", tts: "full", broker: true };
const PHONE_ROWS: ConnectionRows = { chat: "push", tts: "provider-url-key", broker: false };

describe("createConnectionTab", () => {
  let endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  let chatKeySettings: ReturnType<typeof createChatKeySettings>;

  beforeEach(() => {
    setLocale("en");
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    endpointsSettings = createEndpointsSettings();
    chatKeySettings = createChatKeySettings();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function build(
    rows: ConnectionRows,
    extra?: {
      pushSocket?: PushSocketPanelPort;
      getEndpointDefaults?: () => EndpointOverrides | undefined;
    },
  ) {
    return createConnectionTab({
      endpointsSettings,
      chatKeySettings,
      sttKeySettings: createSttKeySettings({ storage: inMemoryApiKeyStorage() }),
      ttsKeySettings: createTtsKeySettings({ storage: inMemoryApiKeyStorage() }),
      rows,
      isOpen: () => true,
      ...extra,
      log: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    });
  }

  function fakeSocket(state: PushSocketState): PushSocketPanelPort {
    return {
      getState: () => state,
      onState: () => () => {},
      sendReset: () => true,
      reconnectNow: () => {},
    };
  }

  // ── Phone rows (push chat, no protocol/provider/model/broker rows) ────────────────────────

  it("with the phone rows, renders and binds only push URL/key/status, STT URL/model/key, TTS provider/URL/key", () => {
    // Constructing alone must not throw, even though fields like chat_model have no node here.
    const tab = build(PHONE_ROWS);

    expect(tab.el.querySelector("#yui-ep-chat_base_url")).not.toBeNull();
    expect(tab.el.querySelector('[data-key-prefix="chatkey"]')).not.toBeNull();
    expect(tab.el.querySelector(".yui-chat-status")).not.toBeNull();
    expect(tab.el.querySelector("#yui-ep-stt_base_url")).not.toBeNull();
    expect(tab.el.querySelector("#yui-ep-stt_model")).not.toBeNull();
    expect(tab.el.querySelector('[data-key-prefix="sttkey"]')).not.toBeNull();
    expect(tab.el.querySelector("#yui-svc-tts-provider")).not.toBeNull();
    expect(tab.el.querySelector("#yui-ep-tts_base_url")).not.toBeNull();
    expect(tab.el.querySelector('[data-key-prefix="ttskey"]')).not.toBeNull();

    expect(tab.el.querySelector(".yui-chat-type")).toBeNull();
    expect(tab.el.querySelector(".yui-chat-preset")).toBeNull();
    expect(tab.el.querySelector('[data-ep-field="chat_model"]')).toBeNull();
    expect(tab.el.querySelector('[data-svc="broker"]')).toBeNull();
    expect(tab.el.querySelector('[data-ep-field="tts_model"]')).toBeNull();
    // The disabled type row is desktop-only.
    expect(tab.el.querySelector("#yui-svc-stt-type")).toBeNull();

    // A rendered field binds; the old all-fields reflection would have thrown on the missing ones.
    const url = tab.el.querySelector<HTMLInputElement>("#yui-ep-chat_base_url")!;
    url.value = "wss://example.test/ws";
    url.dispatchEvent(new Event("change", { bubbles: true }));
    expect(endpointsSettings.get().chat_base_url).toBe("wss://example.test/ws");

    tab.dispose();
  });

  it("shows the push status line on the phone rows", () => {
    const tab = build(PHONE_ROWS, {
      pushSocket: fakeSocket({ kind: "ready", chat_id: "yui-7731" }),
    });
    tab.refresh();

    const status = tab.el.querySelector<HTMLElement>(".yui-chat-status")!;
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain("yui-7731");

    tab.dispose();
  });

  // ── TTS provider ──────────────────────────────────────────────────────────────────────────

  it("offers Irodori, OpenAI and Fish as TTS providers above a model field (desktop rows)", () => {
    const tab = build(DESKTOP_ROWS);

    const select = tab.el.querySelector<HTMLSelectElement>("#yui-svc-tts-provider")!;
    expect(select.disabled).toBe(false);
    expect([...select.options].map((o) => o.value)).toEqual(["irodori", "openai", "fish"]);
    expect(tab.el.querySelector("#yui-ep-tts_model")).not.toBeNull();

    tab.dispose();
  });

  it("selecting Fish writes the provider, its URL and default model in one store write", () => {
    const tab = build(DESKTOP_ROWS);

    const select = tab.el.querySelector<HTMLSelectElement>("#yui-svc-tts-provider")!;
    select.value = "fish";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(endpointsSettings.get()).toMatchObject({
      tts_provider: "fish",
      tts_base_url: "https://api.fish.audio",
      tts_model: "s2.1-pro-free",
    });
    expect(tab.el.querySelector<HTMLInputElement>("#yui-ep-tts_base_url")!.value).toBe(
      "https://api.fish.audio",
    );
    expect(tab.el.querySelector<HTMLInputElement>("#yui-ep-tts_model")!.value).toBe(
      "s2.1-pro-free",
    );

    tab.dispose();
  });

  it("selecting OpenAI writes the provider, its URL and default model in one store write", () => {
    const tab = build(DESKTOP_ROWS);
    const writes = vi.fn();
    endpointsSettings.subscribe(writes);

    const select = tab.el.querySelector<HTMLSelectElement>("#yui-svc-tts-provider")!;
    select.value = "openai";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(writes).toHaveBeenCalledOnce();
    expect(endpointsSettings.get()).toMatchObject({
      tts_provider: "openai",
      tts_base_url: "https://api.openai.com",
      tts_model: "gpt-4o-mini-tts",
    });
    expect(tab.el.querySelector<HTMLInputElement>("#yui-ep-tts_base_url")!.value).toBe(
      "https://api.openai.com",
    );
    expect(tab.el.querySelector<HTMLInputElement>("#yui-ep-tts_model")!.value).toBe(
      "gpt-4o-mini-tts",
    );

    tab.dispose();
  });

  it("selecting a provider on the phone also sets the model it shows no field for", () => {
    const tab = build(PHONE_ROWS);

    const select = tab.el.querySelector<HTMLSelectElement>("#yui-svc-tts-provider")!;
    select.value = "openai";
    select.dispatchEvent(new Event("change", { bubbles: true }));

    expect(endpointsSettings.get().tts_model).toBe("gpt-4o-mini-tts");

    tab.dispose();
  });

  it("the provider select shows the override, else the bundled default", () => {
    const defaults = endpointDefaultsFromConfig({
      chat_base_url: "",
      stt_base_url: "",
      tts_base_url: "",
      tts_provider: "openai",
    });
    const tab = build(DESKTOP_ROWS, { getEndpointDefaults: () => defaults });
    tab.refresh();
    const select = tab.el.querySelector<HTMLSelectElement>("#yui-svc-tts-provider")!;
    expect(select.value).toBe("openai");

    endpointsSettings.set({ tts_provider: "irodori" });
    expect(select.value).toBe("irodori");

    tab.dispose();
  });

  // ── Shared STT model field ────────────────────────────────────────────────────────────────

  it("persists stt_model to the store and resets it with the STT service (desktop rows)", () => {
    const tab = build(DESKTOP_ROWS);

    const model = tab.el.querySelector<HTMLInputElement>("#yui-ep-stt_model")!;
    model.value = "whisper-large-v3-turbo";
    model.dispatchEvent(new Event("change", { bubbles: true }));
    expect(endpointsSettings.get().stt_model).toBe("whisper-large-v3-turbo");

    tab.el.querySelector<HTMLButtonElement>('[data-svc-reset="stt"]')!.click();
    expect(endpointsSettings.get().stt_model).toBe("");
    expect(model.value).toBe("");

    tab.dispose();
  });

  // ── Close contract ────────────────────────────────────────────────────────────────────────

  it("dispose() commits dirty key and endpoint inputs", () => {
    const tab = build(PHONE_ROWS);

    const url = tab.el.querySelector<HTMLInputElement>("#yui-ep-chat_base_url")!;
    url.value = "wss://example.test/ws";
    url.dispatchEvent(new Event("input", { bubbles: true }));
    const key = tab.el.querySelector<HTMLInputElement>("#yui-chatkey-input")!;
    key.value = "throwaway-key-7731";
    key.dispatchEvent(new Event("input", { bubbles: true }));

    tab.dispose();

    expect(endpointsSettings.get().chat_base_url).toBe("wss://example.test/ws");
    expect(chatKeySettings.get().apiKey).toBe("throwaway-key-7731");
  });

  describe("focusStt", () => {
    it("scrolls the STT section into view and focuses its URL field", () => {
      const tab = build(PHONE_ROWS);
      document.body.append(tab.el);
      const scroll = vi.fn();
      const section = tab.el.querySelector<HTMLElement>('[data-svc="stt"]')!;
      section.scrollIntoView = scroll;

      tab.focusStt();

      expect(scroll).toHaveBeenCalledWith({ block: "start" });
      expect(document.activeElement).toBe(
        tab.el.querySelector('[data-ep-field="stt_base_url"] input'),
      );
      tab.dispose();
    });

    it("still focuses where the webview has no scrollIntoView", () => {
      const tab = build(PHONE_ROWS);
      document.body.append(tab.el);

      tab.focusStt();

      expect(document.activeElement?.id).toBe("yui-ep-stt_base_url");
      tab.dispose();
    });
  });
});
