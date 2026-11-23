// @vitest-environment jsdom
/**
 * connection-page.detail.test.ts — Detailed settings through the page facade: the TTS provider select, the STT model
 * field persisting and resetting with the service, the model list read, and dispose committing.
 */
import { act, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../../../contract";
import type { ServerCheck } from "../../../io/chat/models/server-check";
import type { PushSocketState } from "../../../io/chat/push/push-socket";
import { createAgentSettings } from "../../../settings/backend/agent-settings";
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
import { createProactiveSettings } from "../../../settings/cues/proactive-settings";
import { createScheduleSettings } from "../../../settings/cues/schedule-settings";
import { setLocale, t } from "../../i18n";
import {
  inMemoryAgentStorage,
  inMemoryApiKeyStorage,
  optionNames,
  pickOption,
} from "../test-helpers";
import { createConnectionPage, type PushSocketPanelPort } from "./connection-page";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Types into a field the way a user does, then commits it with Enter as a native change would. */
function commitTyped(input: HTMLInputElement, value: string): void {
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("createConnectionPage — Detailed settings", () => {
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

  function build(extra?: {
    pushSocket?: PushSocketPanelPort;
    getEndpointDefaults?: () => EndpointOverrides | undefined;
    getChatApiKey?: () => Promise<string | undefined>;
    getFetch?: () => Promise<typeof globalThis.fetch>;
    checkSttServer?: () => Promise<ServerCheck | null>;
    checkTtsServer?: () => Promise<ServerCheck | null>;
    getEndpoints?: () => EndpointsConfig | null;
  }) {
    const host = document.body.appendChild(document.createElement("div"));
    host.innerHTML = '<h1 class="yui-tabpanel__title">Connection</h1>';
    const tab = createConnectionPage({
      host,
      scope: null,
      initial: "detail",
      quick: {
        endpointsSettings,
        chatKeySettings,
        proactiveSettings: createProactiveSettings({ locale: "en" }),
        scheduleSettings: createScheduleSettings({ locale: "en" }),
        getFetch: async () => undefined,
        onConnected: () => {},
        showHelp: false,
      },
      detail: {
        endpointsSettings,
        chatKeySettings,
        ttsKeySettings: createTtsKeySettings({ storage: inMemoryApiKeyStorage() }),
        sttKeySettings: createSttKeySettings({ storage: inMemoryApiKeyStorage() }),
        agentSettings: createAgentSettings({ storage: inMemoryAgentStorage() }),
        isOpen: () => true,
        ...extra,
        log: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      },
    });
    return {
      ...tab,
      entered: () => act(() => tab.entered()),
      close: () => act(() => tab.close()),
      dispose: () => act(() => tab.dispose()),
    };
  }

  function fakeSocket(state: PushSocketState): PushSocketPanelPort {
    return {
      getState: () => state,
      onState: () => () => {},
      sendReset: () => true,
      reconnectNow: () => {},
    };
  }

  // ── TTS provider ──────────────────────────────────────────────────────────────────────────

  it("offers Irodori, OpenAI and Fish as TTS providers above a model field", async () => {
    const tab = build();

    const select = tab.el.querySelector<HTMLButtonElement>("#yui-svc-tts-provider")!;
    expect(select.disabled).toBe(false);
    expect(await optionNames(select)).toEqual(["Irodori", "OpenAI", "Fish Audio"]);
    expect(tab.el.querySelector("#yui-ep-tts_model")).not.toBeNull();

    tab.dispose();
  });

  it("selecting Fish writes the provider, its URL and default model in one store write", async () => {
    const tab = build();

    await pickOption(tab.el.querySelector("#yui-svc-tts-provider")!, "Fish Audio");

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

  it("selecting OpenAI writes the provider, its URL and default model in one store write", async () => {
    const tab = build();
    const writes = vi.fn();
    endpointsSettings.subscribe(writes);

    await pickOption(tab.el.querySelector("#yui-svc-tts-provider")!, "OpenAI");

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

  it("the provider select shows the override, else the bundled default", () => {
    const defaults = endpointDefaultsFromConfig({
      chat_base_url: "",
      stt_base_url: "",
      tts_base_url: "",
      tts_provider: "openai",
    });
    const tab = build({ getEndpointDefaults: () => defaults });
    tab.refresh();
    const select = tab.el.querySelector<HTMLElement>("#yui-svc-tts-provider")!;
    expect(select.textContent).toBe("OpenAI");

    act(() => endpointsSettings.set({ tts_provider: "irodori" }));
    expect(select.textContent).toBe("Irodori");

    tab.dispose();
  });

  it("an open select's popup closes when a focus request shows the other view", async () => {
    const tab = build();
    const shown = () =>
      [...document.querySelectorAll('[role="option"]')].filter((o) => !o.closest("[hidden]"));
    await act(async () => {
      fireEvent.click(tab.el.querySelector(".yui-chat-preset")!);
    });
    expect(shown()).toHaveLength(7);

    act(() => tab.focusKey());

    expect(tab.el.querySelector<HTMLElement>('.yui-conn-view[data-view="quick"]')!.hidden).toBe(
      false,
    );
    expect(shown()).toEqual([]);
    expect(document.activeElement?.id).toBe("yui-start-key");
    tab.dispose();
  });

  // ── Shared STT model field ────────────────────────────────────────────────────────────────

  it("persists stt_model to the store and resets it with the STT service", () => {
    const tab = build();

    const model = tab.el.querySelector<HTMLInputElement>("#yui-ep-stt_model")!;
    commitTyped(model, "whisper-large-v3-turbo");
    expect(endpointsSettings.get().stt_model).toBe("whisper-large-v3-turbo");

    fireEvent.click(tab.el.querySelector<HTMLButtonElement>('[data-svc-reset="stt"]')!);
    expect(endpointsSettings.get().stt_model).toBe("");
    expect(model.value).toBe("");

    tab.dispose();
  });

  it("offers Auto / en / ja for the STT language field and says an empty field auto-detects", () => {
    const tab = build();

    const lang = tab.el.querySelector<HTMLInputElement>("#yui-ep-stt_language")!;
    const options = [
      ...tab.el.querySelectorAll<HTMLOptionElement>(`#${lang.getAttribute("list")} option`),
    ];
    expect(options.map((o) => o.value)).toEqual(["auto", "en", "ja"]);
    const sub = tab.el.querySelector('[data-ep-field="stt_language"] .yui-input-row__sub');
    expect(sub?.textContent).toBe(t("endpoints.stt_language.sub"));

    tab.dispose();
  });

  // ── Close contract ────────────────────────────────────────────────────────────────────────

  it("dispose() commits dirty key and endpoint inputs", () => {
    const tab = build();

    const url = tab.el.querySelector<HTMLInputElement>("#yui-ep-chat_base_url")!;
    fireEvent.input(url, { target: { value: "wss://example.test/ws" } });
    const key = tab.el.querySelector<HTMLInputElement>("#yui-chatkey-input")!;
    fireEvent.input(key, { target: { value: "throwaway-key-7731" } });

    tab.dispose();

    expect(endpointsSettings.get().chat_base_url).toBe("wss://example.test/ws");
    expect(chatKeySettings.get().apiKey).toBe("throwaway-key-7731");
  });

  describe("model list read", () => {
    const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

    function modelReadDeps() {
      const calls: { url: string; init: RequestInit }[] = [];
      const resolvers: ((res: Response) => void)[] = [];
      const fetchImpl: typeof globalThis.fetch = (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return new Promise<Response>((res) => {
          resolvers.push(res);
        });
      };
      return {
        calls,
        settle: () =>
          resolvers.forEach((r) => {
            r(
              new Response(JSON.stringify({ data: [{ id: "m1" }, { id: "m2" }] }), { status: 200 }),
            );
          }),
        getFetch: async () => fetchImpl,
        getChatApiKey: async () => "key-1",
      } as const;
    }

    const defaults = endpointDefaultsFromConfig({
      chat_base_url: "https://def.test/v1",
      chat_model: "m1",
      stt_base_url: "",
      tts_base_url: "",
    });

    function statusOf(tab: { el: HTMLElement }): HTMLElement {
      return tab.el.querySelector<HTMLElement>(".yui-chat-status")!;
    }

    it("reads when the tab is entered — effective URL, chat key, status shows the result", async () => {
      const deps = modelReadDeps();
      const tab = build({ ...deps, getEndpointDefaults: () => defaults });

      tab.entered();
      await tick();
      await tick();
      deps.settle();
      await tick();

      expect(deps.calls).toHaveLength(1);
      expect(deps.calls[0]?.url).toBe("https://def.test/v1/models");
      expect(new Headers(deps.calls[0]?.init.headers).get("authorization")).toBe("Bearer key-1");
      expect(statusOf(tab).textContent).toContain(t("svc.chat_models_read", { n: 2 }));
      tab.dispose();
    });

    it("Enter on an unchanged chat URL starts no read", async () => {
      const deps = modelReadDeps();
      endpointsSettings.set({ chat_base_url: "https://stored.test/v1" });
      const tab = build({ ...deps, getEndpointDefaults: () => defaults });

      fireEvent.keyDown(tab.el.querySelector<HTMLInputElement>("#yui-ep-chat_base_url")!, {
        key: "Enter",
      });
      await tick();
      await tick();

      expect(deps.calls).toEqual([]);
      tab.dispose();
    });

    it("reads after the URL input commits, with the committed value", async () => {
      const deps = modelReadDeps();
      const tab = build({ ...deps, getEndpointDefaults: () => defaults });

      const url = tab.el.querySelector<HTMLInputElement>("#yui-ep-chat_base_url")!;
      commitTyped(url, "https://typed.test/v1");
      await tick();
      await tick();
      deps.settle();
      await tick();

      expect(deps.calls.map((c) => c.url)).toEqual(["https://typed.test/v1/models"]);
      tab.dispose();
    });

    it("reads after the chat key input commits on blur", async () => {
      const deps = modelReadDeps();
      const tab = build({
        ...deps,
        getEndpointDefaults: () => defaults,
        // The key resolves the way a turn's would: from the key store the SecretProvider reads.
        getChatApiKey: async () => chatKeySettings.get().apiKey || undefined,
      });

      const key = tab.el.querySelector<HTMLInputElement>("#yui-chatkey-input")!;
      fireEvent.input(key, { target: { value: "typed-key" } });
      fireEvent.blur(key);
      await tick();
      await tick();
      deps.settle();
      await tick();

      expect(deps.calls).toHaveLength(1);
      expect(new Headers(deps.calls[0]?.init.headers).get("authorization")).toBe(
        "Bearer typed-key",
      );
      tab.dispose();
    });

    it("reads when a provider preset commits its URL", async () => {
      const deps = modelReadDeps();
      const tab = build({ ...deps });

      await pickOption(tab.el.querySelector(".yui-chat-preset")!, "Ollama");
      await tick();
      await tick();

      expect(deps.calls.map((c) => c.url)).toEqual(["http://localhost:11434/v1/models"]);
      tab.dispose();
    });

    it("picking from the model list commits the id through the model field", async () => {
      const deps = modelReadDeps();
      const tab = build({ ...deps, getEndpointDefaults: () => defaults });
      tab.entered();
      await tick();
      await tick();
      deps.settle();
      await tick();

      const model = tab.el.querySelector<HTMLInputElement>("#yui-ep-chat_model")!;
      act(() => model.focus());
      // The first arrow opens the shut list; the second highlights its first id.
      await act(async () => {
        fireEvent.keyDown(model, { key: "ArrowDown" });
      });
      await act(async () => {
        fireEvent.keyDown(model, { key: "ArrowDown" });
      });
      await act(async () => {
        fireEvent.keyDown(model, { key: "Enter" });
      });

      expect(model.value).toBe("m1");
      expect(endpointsSettings.get().chat_model).toBe("m1");
      tab.dispose();
    });

    it("choosing the push preset aborts the read and shows the push state", async () => {
      const deps = modelReadDeps();
      const tab = build({
        ...deps,
        getEndpointDefaults: () => defaults,
        pushSocket: fakeSocket({ kind: "ready", chat_id: "yui-7731" }),
      });
      tab.entered();
      await tick();

      await pickOption(tab.el.querySelector(".yui-chat-preset")!, "Hermes Agent");
      await tick();

      expect((deps.calls[0]?.init.signal as AbortSignal).aborted).toBe(true);
      const status = statusOf(tab);
      expect(status.classList.contains("is-ready")).toBe(true);
      expect(status.textContent).toContain(t("svc.chat_status_connected", { id: "yui-7731" }));
      tab.dispose();
    });

    it("resetting the Chat service re-reads against the default URL", async () => {
      const deps = modelReadDeps();
      const tab = build({ ...deps, getEndpointDefaults: () => defaults });

      const url = tab.el.querySelector<HTMLInputElement>("#yui-ep-chat_base_url")!;
      commitTyped(url, "https://typed.test/v1");
      await tick();
      await tick();
      deps.settle();
      await tick();
      expect(deps.calls[0]?.url).toBe("https://typed.test/v1/models");

      fireEvent.click(tab.el.querySelector<HTMLButtonElement>('[data-svc-reset="chat"]')!);
      await tick();
      await tick();

      expect(deps.calls[1]?.url).toBe("https://def.test/v1/models");
      tab.dispose();
    });

    it("reads the trimmed effective URL a chat turn would use", async () => {
      const deps = modelReadDeps();
      const tab = build({ ...deps });

      const url = tab.el.querySelector<HTMLInputElement>("#yui-ep-chat_base_url")!;
      commitTyped(url, "https://typed.test/v1 ");
      await tick();
      await tick();

      expect(deps.calls[0]?.url).toBe("https://typed.test/v1/models");
      tab.dispose();
    });

    it("the status follows the model input while typing, without a new request", async () => {
      const deps = modelReadDeps();
      const tab = build({
        ...deps,
        getEndpointDefaults: () => ({ ...defaults, chat_model: "" }),
      });
      tab.entered();
      await tick();
      await tick();
      deps.settle();
      await tick();
      expect(statusOf(tab).textContent).toContain(t("svc.chat_models_pick", { n: 2 }));

      const model = tab.el.querySelector<HTMLInputElement>("#yui-ep-chat_model")!;
      fireEvent.input(model, { target: { value: "m1" } });

      const text = statusOf(tab).textContent ?? "";
      expect(text).toContain(t("svc.chat_models_read", { n: 2 }));
      expect(text).not.toContain(t("svc.chat_models_pick", { n: 2 }));
      expect(deps.calls).toHaveLength(1);
      tab.dispose();
    });

    it("typing two absent names keeps the status text node untouched (announced once)", async () => {
      const deps = modelReadDeps();
      const tab = build({
        ...deps,
        getEndpointDefaults: () => ({ ...defaults, chat_model: "" }),
      });
      tab.entered();
      await tick();
      await tick();
      deps.settle();
      await tick();

      const model = tab.el.querySelector<HTMLInputElement>("#yui-ep-chat_model")!;
      fireEvent.input(model, { target: { value: "zz" } });
      expect(statusOf(tab).textContent).toBe(t("svc.chat_models_absent"));
      const textNode = tab.el.querySelector<HTMLElement>(".yui-chat-status__text")!.firstChild;

      fireEvent.input(model, { target: { value: "zz9" } });

      expect(tab.el.querySelector<HTMLElement>(".yui-chat-status__text")!.firstChild).toBe(
        textNode,
      );
      tab.dispose();
    });

    it("clears an invalid URL instead of reading", async () => {
      const deps = modelReadDeps();
      const tab = build({ ...deps, getEndpointDefaults: () => defaults });
      tab.entered();
      await tick();
      await tick();
      expect(deps.calls).toHaveLength(1);

      const url = tab.el.querySelector<HTMLInputElement>("#yui-ep-chat_base_url")!;
      commitTyped(url, "not-a-url");
      await tick();
      await tick();

      expect(deps.calls).toHaveLength(1);
      expect(statusOf(tab).hidden).toBe(true);
      tab.dispose();
    });

    it("switching to push aborts the read and shows the push state", async () => {
      const deps = modelReadDeps();
      const tab = build({
        ...deps,
        getEndpointDefaults: () => defaults,
        pushSocket: fakeSocket({ kind: "ready", chat_id: "yui-7731" }),
      });
      tab.entered();
      await tick();

      await pickOption(tab.el.querySelector(".yui-chat-type")!, "Push · persistent connection");
      await tick();

      expect(deps.calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
      expect((deps.calls[0]?.init.signal as AbortSignal).aborted).toBe(true);
      const status = statusOf(tab);
      expect(status.classList.contains("is-ready")).toBe(true);
      expect(status.textContent).toContain(t("svc.chat_status_connected", { id: "yui-7731" }));
      tab.dispose();
    });

    it("aborting on panel close drops the in-flight read", async () => {
      const deps = modelReadDeps();
      const tab = build({ ...deps, getEndpointDefaults: () => defaults });
      tab.entered();
      await tick();

      tab.close();

      expect((deps.calls[0]?.init.signal as AbortSignal).aborted).toBe(true);
      tab.dispose();
    });

    it("offers Reconnect on an unreachable read, and clicking it reads again", async () => {
      let calls = 0;
      const fetchImpl: typeof globalThis.fetch = () => {
        calls += 1;
        return Promise.reject(new TypeError("fetch failed"));
      };
      const tab = build({
        getEndpointDefaults: () => defaults,
        getChatApiKey: async () => "key-1",
        getFetch: async () => fetchImpl,
      });

      tab.entered();
      await tick();
      await tick();

      const status = statusOf(tab);
      expect(status.textContent).toContain(t("svc.chat_models_unreachable", { host: "def.test" }));
      const action = status.querySelector<HTMLButtonElement>(".yui-chat-status__action")!;
      expect(action.hidden).toBe(false);
      expect(action.textContent).toBe(t("svc.chat_status_reconnect"));

      fireEvent.click(action);
      await tick();
      await tick();

      expect(calls).toBe(2);
      tab.dispose();
    });
  });

  describe("server lines", () => {
    const tick = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

    function endpointsWith(field: "stt_base_url" | "tts_base_url", url: string): EndpointsConfig {
      return {
        chat_base_url: "",
        stt_base_url: field === "stt_base_url" ? url : "",
        tts_base_url: field === "tts_base_url" ? url : "",
      };
    }

    it("the TTS line shows Could not reach with Reconnect, and clicking it checks the server again", async () => {
      const checkTtsServer = vi.fn(
        async (): Promise<ServerCheck | null> => ({
          kind: "unreachable",
        }),
      );
      const tab = build({
        checkTtsServer,
        getEndpoints: () => endpointsWith("tts_base_url", "https://tts.test"),
      });

      tab.entered();
      await tick();
      await tick();

      const line = tab.el.querySelector<HTMLElement>('[data-svc="tts"] .yui-chat-status');
      expect(line?.hidden).toBe(false);
      const action = line!.querySelector<HTMLButtonElement>(".yui-chat-status__action")!;

      fireEvent.click(action);
      await tick();
      await tick();

      expect(checkTtsServer).toHaveBeenCalledTimes(2);
      tab.dispose();
    });

    it("the STT line shows the server the check reached", async () => {
      const checkSttServer = vi.fn(async (): Promise<ServerCheck | null> => ({ kind: "ok" }));
      const tab = build({
        checkSttServer,
        getEndpoints: () => endpointsWith("stt_base_url", "https://stt.test/v1"),
      });

      tab.entered();
      await tick();
      await tick();

      const line = tab.el.querySelector<HTMLElement>('[data-svc="stt"] .yui-chat-status');
      expect(line?.hidden).toBe(false);
      expect(line!.textContent).toContain(t("svc.server_connected", { host: "stt.test" }));
      tab.dispose();
    });
  });
});
