// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { AvatarOption } from "../../config/load";
import { createAgentSettings } from "../../io/agent-settings";
import { createSttKeySettings, createTtsKeySettings } from "../../io/api-key-settings";
import { createChatKeySettings } from "../../io/chat-key-settings";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { createLipsyncSettings } from "../../io/lipsync-settings";
import { createProactiveSettings } from "../../io/proactive-settings";
import { createScheduleSettings } from "../../io/schedule-settings";
import type { createSpeakerSelection, SpeakerOption } from "../../io/speaker-selection";
import type { createVrmSelection } from "../../io/vrm-selection";
import { setLocale } from "../i18n";
import { createQuickControls } from "../quick-controls";
import {
  defaultQcArgs,
  inMemoryAgentStorage,
  inMemoryApiKeyStorage,
  makeSpeakerSelection,
  makeVrmSelection,
} from "./test-helpers";

describe("createQuickControls — endpoints + API keys", () => {
  let mount: HTMLElement;
  let onGainPreview: Mock<(mouthOpen: number) => void>;
  let onGainPreviewEnd: Mock<() => void>;
  let lipsync: ReturnType<typeof createLipsyncSettings>;
  let agentSettings: ReturnType<typeof createAgentSettings>;
  let endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  let proactiveSettings: ReturnType<typeof createProactiveSettings>;
  let scheduleSettings: ReturnType<typeof createScheduleSettings>;
  let onPopOut: Mock<() => void>;
  let vrmSelection: ReturnType<typeof createVrmSelection>;
  let swapVrm: Mock<(option: AvatarOption) => Promise<void>>;
  let importVrm: Mock<() => Promise<void>>;
  let removeUserVrm: Mock<(id: string) => Promise<void>>;
  let speakerSelection: ReturnType<typeof createSpeakerSelection>;
  let swapSpeaker: Mock<(option: SpeakerOption) => Promise<void>>;
  let refreshSpeaker: Mock<(option: SpeakerOption) => Promise<void>>;
  let importVoice: Mock<() => Promise<void>>;
  let removeUserVoice: Mock<(id: string) => Promise<void>>;

  beforeEach(() => {
    // Make rAF synchronous so open() → is-open transition happens immediately in tests
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});

    mount = document.createElement("div");
    document.body.appendChild(mount);

    onGainPreview = vi.fn<(mouthOpen: number) => void>();
    onGainPreviewEnd = vi.fn<() => void>();
    lipsync = createLipsyncSettings();
    agentSettings = createAgentSettings({ storage: inMemoryAgentStorage() });
    endpointsSettings = createEndpointsSettings();
    proactiveSettings = createProactiveSettings();
    scheduleSettings = createScheduleSettings();
    onPopOut = vi.fn<() => void>();
    vrmSelection = makeVrmSelection();
    // default fake: commit the store on success (mirrors the real settings-window impl)
    swapVrm = vi.fn<(option: AvatarOption) => Promise<void>>(async (option) => {
      vrmSelection.select(option.id);
    });
    importVrm = vi.fn<() => Promise<void>>(async () => {});
    removeUserVrm = vi.fn<(id: string) => Promise<void>>(async () => {});
    speakerSelection = makeSpeakerSelection();
    // default fake: commit the store on success (mirrors the real settings-window impl)
    swapSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async (option) => {
      speakerSelection.select(option.id);
    });
    // refresh is server-side only — default fake resolves without touching the store.
    refreshSpeaker = vi.fn<(option: SpeakerOption) => Promise<void>>(async () => {});
    importVoice = vi.fn<() => Promise<void>>(async () => {});
    removeUserVoice = vi.fn<(id: string) => Promise<void>>(async () => {});
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    // Existing assertions pin Korean copy/selectors; render the panel in ko.
    setLocale("ko");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
      lipsync,
      onGainPreview,
      onGainPreviewEnd,
      agentSettings,
      endpointsSettings,
      proactiveSettings,
      scheduleSettings,
      onPopOut,
      vrmSelection,
      swapVrm,
      importVrm,
      removeUserVrm,
      speakerSelection,
      swapSpeaker,
      refreshSpeaker,
      importVoice,
      removeUserVoice,
      ...extra,
    });
  }

  // ── Endpoint section ─────────────────────────────────────────────────────

  it("renders four collapsible per-service sections (chat/stt/tts/broker), each with a yui-select", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const sections = Array.from(
      qc.el.querySelectorAll<HTMLDetailsElement>("#yui-panel-adv details.yui-svc"),
    );
    expect(sections.map((s) => s.dataset.svc)).toEqual(["chat", "stt", "tts", "broker"]);
    // collapsible (default collapsed) + each leads with a type dropdown.
    for (const s of sections) {
      expect(s.open).toBe(false);
      expect(s.querySelector(".yui-select")).not.toBeNull();
    }
    // single-option sections are inert (--single); STT is the only one left. Chat and TTS
    // are interactive dropdowns (chat_api / tts_provider).
    expect(sections[0].querySelector(".yui-select")!.classList.contains("yui-select--single")).toBe(
      false,
    );
    expect(sections[1].querySelector(".yui-select")!.classList.contains("yui-select--single")).toBe(
      true,
    );
    expect(sections[2].querySelector(".yui-select")!.classList.contains("yui-select--single")).toBe(
      false,
    );

    // each section carries its own URL field(s) inside it.
    const fieldIn = (svc: string, key: string): boolean =>
      !!qc.el.querySelector(`details[data-svc="${svc}"] .yui-input-row[data-ep-field="${key}"]`);
    expect(fieldIn("chat", "chat_base_url")).toBe(true);
    expect(fieldIn("chat", "chat_model")).toBe(true);
    expect(fieldIn("stt", "stt_base_url")).toBe(true);
    expect(fieldIn("tts", "irodori_base_url")).toBe(true);
    expect(fieldIn("tts", "tts_base_url")).toBe(true);
    expect(fieldIn("tts", "tts_voice")).toBe(true);
    expect(fieldIn("broker", "broker_base_url")).toBe(true);

    qc.dispose();
  });

  it("populates endpoint placeholders from getEndpointDefaults() on open even when defaults arrive after construction", () => {
    // Panel is created before config is loaded — defaults are absent at creation time and must be filled at open() time.
    let defaults: Record<string, string> | undefined;
    const qc = buildQc({ getEndpointDefaults: () => defaults as never });
    // Simulate config being loaded after creation.
    defaults = {
      chat_base_url: "http://localhost:8643/v1",
      stt_base_url: "http://localhost:5517/v1",
      tts_base_url: "http://localhost:8092",
      irodori_base_url: "http://localhost:8091",
      chat_model: "natsume",
    };
    qc.open();

    const ph = (key: string): string =>
      qc.el.querySelector<HTMLInputElement>(`.yui-input-row[data-ep-field="${key}"] .yui-ep-input`)!
        .placeholder;
    expect(ph("chat_base_url")).toBe("http://localhost:8643/v1");
    expect(ph("stt_base_url")).toBe("http://localhost:5517/v1");
    expect(ph("chat_model")).toBe("natsume");

    qc.dispose();
  });

  it("toggles inline invalid state on a url field via isValidEndpointUrl (empty = no error)", () => {
    const qc = buildQc();
    qc.open();

    const input = qc.el.querySelector<HTMLInputElement>(
      '.yui-input-row[data-ep-field="stt_base_url"] .yui-ep-input',
    )!;
    const row = input.closest<HTMLDivElement>(".yui-input-row")!;

    input.value = "localhost:5517"; // No scheme → invalid
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(row.classList.contains("is-invalid")).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");

    input.value = "https://localhost:5517/v1"; // Valid
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(row.classList.contains("is-invalid")).toBe(false);

    input.value = ""; // Empty value = no override → no error
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(row.classList.contains("is-invalid")).toBe(false);

    qc.dispose();
  });

  it("persists an endpoint override into the store and per-section reset clears that section's fields", () => {
    const qc = buildQc();
    qc.open();

    const input = qc.el.querySelector<HTMLInputElement>(
      '.yui-input-row[data-ep-field="chat_base_url"] .yui-ep-input',
    )!;
    input.value = "https://api.example.com/v1";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(endpointsSettings.get().chat_base_url).toBe("https://api.example.com/v1");

    qc.el.querySelector<HTMLButtonElement>('.yui-svc-reset[data-svc-reset="chat"]')!.click();
    expect(endpointsSettings.get().chat_base_url).toBe("");
    expect(input.value).toBe("");

    qc.dispose();
  });

  it("the chat reset clears chat_base_url + chat_model + chat_api + the chat key, leaving other sections intact", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-chat-1");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    endpointsSettings.set({
      chat_base_url: "https://c/v1",
      chat_model: "m",
      chat_api: "chat_completions",
      stt_base_url: "https://s",
    });

    qc.el.querySelector<HTMLButtonElement>('.yui-svc-reset[data-svc-reset="chat"]')!.click();
    expect(endpointsSettings.get().chat_base_url).toBe("");
    expect(endpointsSettings.get().chat_model).toBe("");
    expect(endpointsSettings.get().chat_api).toBe("");
    expect(chatKeySettings.get().apiKey).toBe("");
    // STT field is untouched by the chat reset.
    expect(endpointsSettings.get().stt_base_url).toBe("https://s");

    qc.dispose();
  });

  it("the tts reset clears irodori_base_url + tts_base_url + tts_voice + tts_provider + the tts key", () => {
    const ttsKeySettings = createTtsKeySettings({ storage: inMemoryApiKeyStorage() });
    ttsKeySettings.setApiKey("sk-tts-1");
    const qc = buildQc({ ttsKeySettings });
    qc.open();

    endpointsSettings.set({
      irodori_base_url: "http://i",
      tts_base_url: "http://t",
      tts_voice: "alloy",
      tts_provider: "openai",
    });

    qc.el.querySelector<HTMLButtonElement>('.yui-svc-reset[data-svc-reset="tts"]')!.click();
    expect(endpointsSettings.get().irodori_base_url).toBe("");
    expect(endpointsSettings.get().tts_base_url).toBe("");
    expect(endpointsSettings.get().tts_voice).toBe("");
    expect(endpointsSettings.get().tts_provider).toBe("");
    expect(ttsKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  it("the stt reset clears stt_base_url and the stt key", () => {
    const sttKeySettings = createSttKeySettings({ storage: inMemoryApiKeyStorage() });
    sttKeySettings.setApiKey("sk-stt-1");
    const qc = buildQc({ sttKeySettings });
    qc.open();

    endpointsSettings.set({ stt_base_url: "https://stt.example.com/v1" });

    qc.el.querySelector<HTMLButtonElement>('.yui-svc-reset[data-svc-reset="stt"]')!.click();
    expect(endpointsSettings.get().stt_base_url).toBe("");
    expect(sttKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  // ── chat API key field ────────────────────────────────────────────────────

  function chatKeyInput(qc: { el: HTMLElement }): HTMLInputElement {
    return qc.el.querySelector<HTMLInputElement>(".yui-chatkey__input")!;
  }

  it("renders a masked chat API-key field in the advanced panel with no autofill leakage", () => {
    const qc = buildQc();
    qc.open();

    const input = chatKeyInput(qc);
    expect(input).not.toBeNull();
    // Masked by default + no browser autofill of a secret.
    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("spellcheck")).toBe("false");
    expect(input.hasAttribute("name")).toBe(false);
    // Lives in the advanced tab, near the endpoint rows (chat credential).
    const advPanel = qc.el.querySelector<HTMLElement>("#yui-panel-adv")!;
    expect(advPanel.contains(input)).toBe(true);

    qc.dispose();
  });

  it("prefills from the store and signals 'default in use' without revealing any value", () => {
    const chatKeySettings = createChatKeySettings();
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    // No override → empty field, never a placeholder/sublabel that leaks a value.
    expect(input.value).toBe("");
    const row = input.closest<HTMLDivElement>(".yui-input-row")!;
    const sub = row.querySelector<HTMLElement>(".yui-input-row__sub")!;
    expect(sub.textContent).toContain("기본값");
    // The field communicates default-in-use via copy, not by surfacing a secret.
    expect(input.placeholder).not.toContain("sk-");

    qc.dispose();
  });

  it("reflects an existing override as a masked value and 'saved' sublabel", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-secret-123");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    // Value is present (so edits round-trip) but the field is masked.
    expect(input.value).toBe("sk-secret-123");
    expect(input.type).toBe("password");
    const sub = input
      .closest<HTMLDivElement>(".yui-input-row")!
      .querySelector<HTMLElement>(".yui-input-row__sub")!;
    expect(sub.textContent).not.toContain("기본값");

    qc.dispose();
  });

  it("does not persist intermediate prefixes per keystroke", () => {
    const chatKeySettings = createChatKeySettings();
    const setSpy = vi.spyOn(chatKeySettings, "setApiKey");
    const clearSpy = vi.spyOn(chatKeySettings, "clear");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    for (const v of ["s", "sk", "sk-", "sk-typed-456"]) {
      input.value = v;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // No prefix ever reaches the store while typing.
    expect(setSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(chatKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  it("commits the full key once on blur", () => {
    const chatKeySettings = createChatKeySettings();
    const setSpy = vi.spyOn(chatKeySettings, "setApiKey");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    input.value = "sk-typed-456";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Nothing persisted from typing alone.
    expect(setSpy).not.toHaveBeenCalled();

    input.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith("sk-typed-456");
    expect(chatKeySettings.get().apiKey).toBe("sk-typed-456");

    qc.dispose();
  });

  it("blurring an emptied field calls clear() (empty = no override)", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-secret-123");
    const clearSpy = vi.spyOn(chatKeySettings, "clear");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Emptying alone does not clear the override.
    expect(clearSpy).not.toHaveBeenCalled();

    input.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(clearSpy).toHaveBeenCalled();
    expect(chatKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  it("flushes a dirty typed key once on close() (never before close)", () => {
    const chatKeySettings = createChatKeySettings();
    const setSpy = vi.spyOn(chatKeySettings, "setApiKey");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    input.value = "sk-unblurred-789";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Typing without blur persists nothing yet.
    expect(setSpy).not.toHaveBeenCalled();

    qc.close();
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith("sk-unblurred-789");
    expect(chatKeySettings.get().apiKey).toBe("sk-unblurred-789");

    qc.dispose();
  });

  it("flushes a dirty typed key on close() in the window variant", () => {
    const chatKeySettings = createChatKeySettings();
    const setSpy = vi.spyOn(chatKeySettings, "setApiKey");
    const qc = buildQc({ chatKeySettings, variant: "window" });
    qc.open();

    const input = chatKeyInput(qc);
    input.value = "sk-window-321";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(setSpy).not.toHaveBeenCalled();

    qc.close();
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith("sk-window-321");
    expect(chatKeySettings.get().apiKey).toBe("sk-window-321");

    qc.dispose();
  });

  it("flushes a dirty typed key on dispose() without a prior blur", () => {
    const chatKeySettings = createChatKeySettings();
    const setSpy = vi.spyOn(chatKeySettings, "setApiKey");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    input.value = "sk-disposed-654";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(setSpy).not.toHaveBeenCalled();

    qc.dispose();
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledWith("sk-disposed-654");
    expect(chatKeySettings.get().apiKey).toBe("sk-disposed-654");
  });

  it("emptying a set key then close() clears the override", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-secret-123");
    const clearSpy = vi.spyOn(chatKeySettings, "clear");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const input = chatKeyInput(qc);
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Emptying without blur does not clear yet.
    expect(clearSpy).not.toHaveBeenCalled();

    qc.close();
    expect(clearSpy).toHaveBeenCalled();
    expect(chatKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  it("close() does not commit when no typing occurred", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-secret-123");
    const setSpy = vi.spyOn(chatKeySettings, "setApiKey");
    const clearSpy = vi.spyOn(chatKeySettings, "clear");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    qc.close();
    expect(setSpy).not.toHaveBeenCalled();
    expect(clearSpy).not.toHaveBeenCalled();
    expect(chatKeySettings.get().apiKey).toBe("sk-secret-123");

    qc.dispose();
  });

  it("a dedicated clear button empties the field and the store", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-secret-123");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-chatkey__clear")!.click();
    expect(chatKeySettings.get().apiKey).toBe("");
    expect(chatKeyInput(qc).value).toBe("");

    qc.dispose();
  });

  it("the show/hide toggle flips the input between password and text", () => {
    const qc = buildQc();
    qc.open();

    const input = chatKeyInput(qc);
    const toggle = qc.el.querySelector<HTMLButtonElement>(".yui-chatkey__toggle")!;
    expect(input.type).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    toggle.click();
    expect(input.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    toggle.click();
    expect(input.type).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    qc.dispose();
  });

  it("subscribes to the store so cross-window edits reflect into the field", () => {
    const chatKeySettings = createChatKeySettings();
    const qc = buildQc({ chatKeySettings });
    qc.open();

    chatKeySettings.setApiKey("sk-from-other-window");
    expect(chatKeyInput(qc).value).toBe("sk-from-other-window");

    chatKeySettings.clear();
    expect(chatKeyInput(qc).value).toBe("");

    qc.dispose();
  });

  it("never writes the key value into the DOM text or attributes", () => {
    const chatKeySettings = createChatKeySettings();
    chatKeySettings.setApiKey("sk-secret-123");
    const qc = buildQc({ chatKeySettings });
    qc.open();

    const row = chatKeyInput(qc).closest<HTMLDivElement>(".yui-input-row")!;
    // The secret may live only in input.value — never in rendered text or other attrs.
    expect(row.textContent).not.toContain("sk-secret-123");
    expect(row.innerHTML).not.toContain("sk-secret-123");

    qc.dispose();
  });

  // ── STT / TTS API key rows (mirror the chat key, own stores) ────────────────

  function keyInput(qc: { el: HTMLElement }, prefix: string): HTMLInputElement {
    return qc.el.querySelector<HTMLInputElement>(
      `.yui-input-row[data-key-prefix="${prefix}"] .yui-chatkey__input`,
    )!;
  }

  it("renders a masked STT key row in the STT section wired to the stt store", () => {
    const sttKeySettings = createSttKeySettings({ storage: inMemoryApiKeyStorage() });
    const setSpy = vi.spyOn(sttKeySettings, "setApiKey");
    const clearSpy = vi.spyOn(sttKeySettings, "clear");
    const qc = buildQc({ sttKeySettings });
    qc.open();

    const input = keyInput(qc, "sttkey");
    expect(input.type).toBe("password");
    expect(qc.el.querySelector('details[data-svc="stt"]')!.contains(input)).toBe(true);

    input.value = "sk-stt-abc";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith("sk-stt-abc");
    expect(sttKeySettings.get().apiKey).toBe("sk-stt-abc");

    qc.el
      .querySelector<HTMLButtonElement>(
        '.yui-input-row[data-key-prefix="sttkey"] .yui-chatkey__clear',
      )!
      .click();
    expect(clearSpy).toHaveBeenCalled();
    expect(sttKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  it("renders a masked TTS key row in the openai sub-view wired to the tts store", () => {
    const ttsKeySettings = createTtsKeySettings({ storage: inMemoryApiKeyStorage() });
    const setSpy = vi.spyOn(ttsKeySettings, "setApiKey");
    const clearSpy = vi.spyOn(ttsKeySettings, "clear");
    const qc = buildQc({ ttsKeySettings, getDefaultProvider: () => "openai" });
    qc.open();

    const input = keyInput(qc, "ttskey");
    expect(input.type).toBe("password");
    expect(qc.el.querySelector(".yui-tts-openai")!.contains(input)).toBe(true);

    input.value = "sk-tts-xyz";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    expect(setSpy).toHaveBeenCalledWith("sk-tts-xyz");
    expect(ttsKeySettings.get().apiKey).toBe("sk-tts-xyz");

    qc.el
      .querySelector<HTMLButtonElement>(
        '.yui-input-row[data-key-prefix="ttskey"] .yui-chatkey__clear',
      )!
      .click();
    expect(clearSpy).toHaveBeenCalled();
    expect(ttsKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  it("the three key rows are independent: editing chat does not touch stt/tts", () => {
    const sttKeySettings = createSttKeySettings({ storage: inMemoryApiKeyStorage() });
    const ttsKeySettings = createTtsKeySettings({ storage: inMemoryApiKeyStorage() });
    const qc = buildQc({ sttKeySettings, ttsKeySettings });
    qc.open();

    const chat = keyInput(qc, "chatkey");
    chat.value = "sk-chat-only";
    chat.dispatchEvent(new Event("input", { bubbles: true }));
    chat.dispatchEvent(new Event("blur", { bubbles: true }));

    expect(sttKeySettings.get().apiKey).toBe("");
    expect(ttsKeySettings.get().apiKey).toBe("");

    qc.dispose();
  });

  // ── TTS engine (tts_provider) dropdown + sub-views + broker URL row ─────────

  function ttsTypeSelect(qc: { el: HTMLElement }): HTMLSelectElement {
    return qc.el.querySelector<HTMLSelectElement>(".yui-tts-type")!;
  }

  it("renders an interactive TTS-engine dropdown (irodori/openai) in the TTS section", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const sel = ttsTypeSelect(qc);
    expect(sel).not.toBeNull();
    // lives in the advanced tab's TTS section, not the character panel.
    expect(qc.el.querySelector('#yui-panel-adv details[data-svc="tts"]')!.contains(sel)).toBe(true);
    expect(sel.classList.contains("yui-select--single")).toBe(false);
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(["irodori", "openai"]);

    qc.dispose();
  });

  it("reflects the effective provider on the dropdown: bundled default when no override", () => {
    const qc = buildQc({ getDefaultProvider: () => "openai" });
    qc.open();
    expect(ttsTypeSelect(qc).value).toBe("openai");
    qc.dispose();
  });

  it("reflects the effective provider on the dropdown: override wins over the default", () => {
    endpointsSettings.set({ tts_provider: "openai" });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();
    expect(ttsTypeSelect(qc).value).toBe("openai");
    qc.dispose();
  });

  it("irodori sub-view shows the speaker picker + irodori URL and NO TTS key row", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const irodori = qc.el.querySelector<HTMLElement>(".yui-tts-irodori")!;
    const openai = qc.el.querySelector<HTMLElement>(".yui-tts-openai")!;
    expect(irodori.hidden).toBe(false);
    expect(openai.hidden).toBe(true);
    // speaker picker relocated into the irodori sub-view.
    expect(irodori.querySelector(".yui-spk-scroll")).not.toBeNull();
    expect(
      irodori.querySelector('.yui-input-row[data-ep-field="irodori_base_url"]'),
    ).not.toBeNull();
    // no key row in the irodori sub-view.
    expect(irodori.querySelector('[data-key-prefix="ttskey"]')).toBeNull();
    // speaker controls are enabled for irodori.
    expect(qc.el.querySelector(".yui-spk-scroll")!.classList.contains("is-disabled")).toBe(false);
    expect(qc.el.querySelector<HTMLElement>(".yui-spks-hint")!.hidden).toBe(true);

    qc.dispose();
  });

  it("selecting 'openai' toggles to the openai sub-view: tts_voice field + TTS key row, speaker hidden", () => {
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const sel = ttsTypeSelect(qc);
    sel.value = "openai";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(endpointsSettings.get().tts_provider).toBe("openai");

    const irodori = qc.el.querySelector<HTMLElement>(".yui-tts-irodori")!;
    const openai = qc.el.querySelector<HTMLElement>(".yui-tts-openai")!;
    expect(irodori.hidden).toBe(true);
    expect(openai.hidden).toBe(false);
    expect(openai.querySelector('.yui-input-row[data-ep-field="tts_voice"]')).not.toBeNull();
    expect(openai.querySelector('[data-key-prefix="ttskey"]')).not.toBeNull();
    // speaker picker disabled + hint shown while openai is effective.
    expect(qc.el.querySelector(".yui-spk-scroll")!.classList.contains("is-disabled")).toBe(true);
    expect(qc.el.querySelector(".yui-spk-foot")!.classList.contains("is-disabled")).toBe(true);
    const hint = qc.el.querySelector<HTMLElement>(".yui-spks-hint")!;
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toContain("irodori 전용");

    qc.dispose();
  });

  it("selecting 'irodori' toggles back: speaker picker re-shown, hint hidden", () => {
    endpointsSettings.set({ tts_provider: "openai" });
    const qc = buildQc({ getDefaultProvider: () => "irodori" });
    qc.open();

    const sel = ttsTypeSelect(qc);
    sel.value = "irodori";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(endpointsSettings.get().tts_provider).toBe("irodori");

    expect(qc.el.querySelector<HTMLElement>(".yui-tts-irodori")!.hidden).toBe(false);
    expect(qc.el.querySelector<HTMLElement>(".yui-tts-openai")!.hidden).toBe(true);
    expect(qc.el.querySelector(".yui-spk-scroll")!.classList.contains("is-disabled")).toBe(false);
    expect(qc.el.querySelector<HTMLElement>(".yui-spks-hint")!.hidden).toBe(true);

    qc.dispose();
  });

  it("binds the openai tts_voice field to the endpoints store", () => {
    const qc = buildQc({ getDefaultProvider: () => "openai" });
    qc.open();

    const input = qc.el.querySelector<HTMLInputElement>(
      '.yui-input-row[data-ep-field="tts_voice"] .yui-ep-input',
    )!;
    input.value = "alloy";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(endpointsSettings.get().tts_voice).toBe("alloy");

    qc.dispose();
  });

  // ── Chat API type (chat_api) dropdown ───────────────────────────────────────

  function chatTypeSelect(qc: { el: HTMLElement }): HTMLSelectElement {
    return qc.el.querySelector<HTMLSelectElement>(".yui-chat-type")!;
  }

  it("renders an interactive Chat-API dropdown (responses/chat_completions) in the Chat section", () => {
    const qc = buildQc({ getDefaultChatApi: () => "responses" });
    qc.open();

    const sel = chatTypeSelect(qc);
    expect(sel).not.toBeNull();
    expect(qc.el.querySelector('#yui-panel-adv details[data-svc="chat"]')!.contains(sel)).toBe(
      true,
    );
    expect(sel.classList.contains("yui-select--single")).toBe(false);
    expect(sel.disabled).toBe(false);
    expect(Array.from(sel.options).map((o) => o.value)).toEqual(["responses", "chat_completions"]);

    qc.dispose();
  });

  it("reflects the effective chat_api on the dropdown: bundled default when no override", () => {
    const qc = buildQc({ getDefaultChatApi: () => "chat_completions" });
    qc.open();
    expect(chatTypeSelect(qc).value).toBe("chat_completions");
    qc.dispose();
  });

  it("reflects the effective chat_api on the dropdown: override wins over the default", () => {
    endpointsSettings.set({ chat_api: "chat_completions" });
    const qc = buildQc({ getDefaultChatApi: () => "responses" });
    qc.open();
    expect(chatTypeSelect(qc).value).toBe("chat_completions");
    qc.dispose();
  });

  it("falls back to 'responses' when no override and no default is available", () => {
    const qc = buildQc();
    qc.open();
    expect(chatTypeSelect(qc).value).toBe("responses");
    qc.dispose();
  });

  it("selecting 'chat_completions' persists the override and updates the summary hint", () => {
    const qc = buildQc({ getDefaultChatApi: () => "responses" });
    qc.open();

    const sel = chatTypeSelect(qc);
    sel.value = "chat_completions";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(endpointsSettings.get().chat_api).toBe("chat_completions");

    const hint = qc.el.querySelector<HTMLElement>(".yui-chat-summary-hint")!;
    expect(hint.textContent).not.toBe("");
    expect(hint.textContent).not.toBe(qc.el.querySelector(".yui-tts-summary-hint")!.textContent);

    qc.dispose();
  });

  it("selecting 'responses' toggles back and persists the override", () => {
    endpointsSettings.set({ chat_api: "chat_completions" });
    const qc = buildQc({ getDefaultChatApi: () => "chat_completions" });
    qc.open();

    const sel = chatTypeSelect(qc);
    sel.value = "responses";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    expect(endpointsSettings.get().chat_api).toBe("responses");

    qc.dispose();
  });

  it("renders a broker_base_url endpoint row that persists and clears on the broker reset", () => {
    const qc = buildQc();
    qc.open();

    const row = qc.el.querySelector<HTMLDivElement>(
      '.yui-input-row[data-ep-field="broker_base_url"]',
    );
    expect(row).not.toBeNull();
    const input = row!.querySelector<HTMLInputElement>(".yui-ep-input")!;
    expect(input.classList.contains("yui-ep-input--url")).toBe(true);

    input.value = "http://localhost:3201/mcp";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(endpointsSettings.get().broker_base_url).toBe("http://localhost:3201/mcp");

    qc.el.querySelector<HTMLButtonElement>('.yui-svc-reset[data-svc-reset="broker"]')!.click();
    expect(endpointsSettings.get().broker_base_url).toBe("");
    expect(input.value).toBe("");

    qc.dispose();
  });
});
