/**
 * Endpoints section — owns endpoint URL fields in Advanced tab, chat/STT/TTS API key rows (secret),
 * TTS engine (tts_provider) dropdown, Chat API (chat_api) dropdown, and per-service resets.
 * Same pattern as VRM/speaker sections: explicit deps + wired from shell. reflect (store→DOM) handled by reflect layer;
 * this module owns inputs, handlers, subscriptions, teardown only.
 */
import "./endpoints-section.css";

import type { ApiKeySettingsStore } from "../../io/api-key-settings";
import type { ChatKeySettingsStore } from "../../io/chat-key-settings";
import {
  type createEndpointsSettings,
  ENDPOINT_FIELD_SPECS,
  type EndpointOverrides,
} from "../../io/endpoints-settings";
import type { Logger } from "../../logger";
import { t } from "../i18n";
import {
  CHAT_PROVIDER_PRESETS,
  CHATKEY_EYE_OFF_SVG,
  CHATKEY_EYE_SVG,
  ENDPOINT_FIELDS,
} from "./constants";
import { validateEndpointInput } from "./reflect";

type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;

interface EndpointsSectionDeps {
  /** Panel root (el) — query endpoint inputs/key rows/dropdowns here. */
  root: HTMLElement;
  endpointsSettings: EndpointsSettingsStore;
  /** chat API key overrides store. Value is secret — no logging. */
  chatKeySettings: ChatKeySettingsStore;
  /** STT API key overrides store. Value is secret — no logging. */
  sttKeySettings: ApiKeySettingsStore;
  /** TTS (openai-compatible) API key overrides store. Value is secret — no logging. */
  ttsKeySettings: ApiKeySettingsStore;
  /** Default bundled-config endpoints to show as placeholder (undefined if not loaded). */
  getEndpointDefaults?: () => EndpointOverrides | undefined;
  /** On blur, reflect pending remote changes to input (reflectEndpoints from reflect layer). */
  reflectEndpoints: () => void;
  /** Key row store subscription checks open state before redrawing (popover.isOpen). */
  isOpen: () => boolean;
  log: Logger;
}

// Per-service API key row (secret). Value lives only in input.value; sublabel/aria only expose state.
// Typing doesn't commit to store (prevents mid-prefix becoming live key). Commit once on blur/close/dispose.
interface KeyRow {
  reflect(): void;
  commitIfDirty(): void;
  subscribe(): () => void;
  addListeners(): void;
  removeListeners(): void;
}

export interface EndpointsSection {
  /** Per-service key rows — reflect layer's reflectKeyRows calls each row's reflect(). */
  keyRows: readonly KeyRow[];
  /** Commit pending key inputs to store (on panel close). */
  commitDirtyKeys(): void;
  /** Permanent teardown — commit pending keys + unsubscribe all listeners. */
  dispose(): void;
}

export function createEndpointsSection(deps: EndpointsSectionDeps): EndpointsSection {
  const {
    root: el,
    endpointsSettings,
    chatKeySettings,
    sttKeySettings,
    ttsKeySettings,
    getEndpointDefaults,
    reflectEndpoints,
    isOpen,
    log,
  } = deps;

  // TTS engine dropdown + irodori/openai subviews (Advanced tab). Chat API dropdown (no subviews).
  const ttsTypeEl = el.querySelector<HTMLSelectElement>(".yui-tts-type")!;
  const chatTypeEl = el.querySelector<HTMLSelectElement>(".yui-chat-type")!;
  const chatPresetEl = el.querySelector<HTMLSelectElement>(".yui-chat-preset")!;

  // Endpoint inputs — map of input nodes by field key.
  const epInputs = new Map<keyof EndpointOverrides, HTMLInputElement>();
  for (const { key } of ENDPOINT_FIELDS) {
    epInputs.set(key, el.querySelector<HTMLInputElement>(`#yui-ep-${key}`)!);
  }
  // Per-section reset buttons — map of nodes by data-svc-reset.
  const svcResetBtns = new Map<string, HTMLButtonElement>();
  for (const btn of el.querySelectorAll<HTMLButtonElement>(".yui-svc-reset")) {
    svcResetBtns.set(btn.dataset.svcReset ?? "", btn);
  }

  function createKeyRow(idPrefix: string, i18nPrefix: string, store: ApiKeySettingsStore): KeyRow {
    const row = el.querySelector<HTMLDivElement>(`.yui-input-row[data-key-prefix="${idPrefix}"]`)!;
    const input = row.querySelector<HTMLInputElement>(".yui-chatkey__input")!;
    const subEl = row.querySelector<HTMLSpanElement>(".yui-input-row__sub")!;
    const toggleBtn = row.querySelector<HTMLButtonElement>(".yui-chatkey__toggle")!;
    const clearBtn = row.querySelector<HTMLButtonElement>(".yui-chatkey__clear")!;
    let dirty = false;

    function reflect(): void {
      const key = store.get().apiKey;
      if ((!document.hasFocus() || document.activeElement !== input) && input.value !== key) {
        input.value = key;
        dirty = false;
      }
      subEl.textContent = key ? t(`${i18nPrefix}.sub_override`) : t(`${i18nPrefix}.sub_default`);
    }
    function commitIfDirty(): void {
      if (!dirty) return;
      dirty = false;
      const v = input.value;
      if (v) store.setApiKey(v);
      else store.clear();
    }
    function handleInput(): void {
      dirty = true;
    }
    function handleBlur(): void {
      commitIfDirty();
      reflect();
    }
    function handleToggle(): void {
      const show = toggleBtn.getAttribute("aria-pressed") !== "true";
      toggleBtn.setAttribute("aria-pressed", String(show));
      input.type = show ? "text" : "password";
      toggleBtn.innerHTML = show ? CHATKEY_EYE_OFF_SVG : CHATKEY_EYE_SVG;
      const label = show ? t(`${i18nPrefix}.hide`) : t(`${i18nPrefix}.show`);
      toggleBtn.setAttribute("aria-label", label);
      toggleBtn.title = label;
    }
    function handleClear(): void {
      dirty = false;
      input.value = "";
      store.clear();
      log.info(`${idPrefix}_clear`);
    }
    return {
      reflect,
      commitIfDirty,
      subscribe: () =>
        store.subscribe(() => {
          if (isOpen()) reflect();
        }),
      addListeners() {
        input.addEventListener("input", handleInput);
        input.addEventListener("blur", handleBlur);
        toggleBtn.addEventListener("click", handleToggle);
        clearBtn.addEventListener("click", handleClear);
      },
      removeListeners() {
        input.removeEventListener("input", handleInput);
        input.removeEventListener("blur", handleBlur);
        toggleBtn.removeEventListener("click", handleToggle);
        clearBtn.removeEventListener("click", handleClear);
      },
    };
  }
  const chatKeyRow = createKeyRow("chatkey", "chatkey", chatKeySettings);
  const sttKeyRow = createKeyRow("sttkey", "sttkey", sttKeySettings);
  const ttsKeyRow = createKeyRow("ttskey", "ttskey", ttsKeySettings);
  const keyRows = [chatKeyRow, sttKeyRow, ttsKeyRow];

  // Endpoint placeholder — fill with bundled-config defaults (greyed) or leave empty if not loaded.
  const epDefaults = getEndpointDefaults?.();
  if (epDefaults) {
    for (const { key } of ENDPOINT_FIELDS) {
      epInputs.get(key)!.placeholder = epDefaults[key];
    }
  }

  // ── Advanced section: TTS engine dropdown (tts_provider) ──
  // Native select owns keyboard — write to store only on change event.
  function handleTtsTypeChange(): void {
    const provider = ttsTypeEl.value;
    if (provider !== "irodori" && provider !== "openai") return;
    endpointsSettings.set({ tts_provider: provider });
    log.info("voice_engine_change", { provider });
    // Store subscription (unsubscribeEndpoints) calls reflect.reflectVoiceEngine to update value/subviews/speaker-disabled.
  }

  // ── Advanced section: Chat API dropdown (chat_api) — no subviews (shared fields) ──
  function handleChatTypeChange(): void {
    const api = chatTypeEl.value;
    if (api !== "responses" && api !== "chat_completions") return;
    endpointsSettings.set({ chat_api: api });
    log.info("chat_api_change", { api });
    // Store subscription (unsubscribeEndpoints) calls reflect.reflectChatType to update value/summary hint.
  }

  // ── Advanced section: chat provider preset dropdown (chat_base_url autofill) ──
  // Custom autofills nothing — it is the state the dropdown lands in when the URL matches no preset.
  function handleChatPresetChange(): void {
    const preset = CHAT_PROVIDER_PRESETS.find((p) => p.id === chatPresetEl.value);
    if (!preset) return;
    commitEndpointField("chat_base_url", preset.url);
    log.info("chat_preset_select", { preset: preset.id });
    // Store subscription (unsubscribeEndpoints) calls reflect.reflectChatPreset to re-derive the selected preset.
  }

  // ── Endpoints section ──

  // Single write path for endpoint text fields — typing and the chat provider preset both land here.
  function commitEndpointField(key: keyof EndpointOverrides, value: string): void {
    const input = epInputs.get(key)!;
    // Skip the assignment while typing: rewriting an identical value moves the caret in some browsers.
    if (input.value !== value) input.value = value;
    endpointsSettings.set({ [key]: value });
    validateEndpointInput(key, input);
  }

  function handleEndpointInput(e: Event): void {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    const row = input.closest<HTMLDivElement>(".yui-input-row");
    const key = row?.dataset.epField as keyof EndpointOverrides | undefined;
    if (!key) return;
    commitEndpointField(key, input.value);
  }

  // On blur, reflect pending remote changes from mid-edit (same as instructions textarea).
  function handleEndpointBlur(): void {
    reflectEndpoints();
  }

  // ── Per-service resets ──
  // Each section clears its endpoint fields + key store. URLs/models reset to "", keys call .clear().
  const SVC_RESET_KEY: Record<string, ApiKeySettingsStore | undefined> = {
    chat: chatKeySettings,
    stt: sttKeySettings,
    tts: ttsKeySettings,
    broker: undefined,
  };

  function handleSvcReset(svc: string): void {
    // Fields to clear are every ENDPOINT_FIELD_SPECS row tagged with this service's resetGroup —
    // covers both text-input fields (chat_base_url, ...) and dropdown-enum fields (chat_api,
    // tts_provider), which is why the patch loop below isn't restricted to epInputs' keys.
    const fields = ENDPOINT_FIELD_SPECS.filter((s) => s.resetGroup === svc).map((s) => s.key);
    if (fields.length === 0) return;
    const patch: Partial<EndpointOverrides> = {};
    for (const key of fields) patch[key] = "";
    endpointsSettings.set(patch);
    // Only url/string-kind fields have a DOM input (epInputs); dropdown-enum fields (chat_api,
    // tts_provider) are re-rendered by reflect.reflectChatType/reflectVoiceEngine on store change.
    for (const key of fields) {
      const input = epInputs.get(key);
      if (!input) continue;
      input.value = "";
      validateEndpointInput(key, input);
    }
    SVC_RESET_KEY[svc]?.clear();
    log.info("svc_reset", { svc });
  }

  // ── Wiring ──
  ttsTypeEl.addEventListener("change", handleTtsTypeChange);
  chatTypeEl.addEventListener("change", handleChatTypeChange);
  chatPresetEl.addEventListener("change", handleChatPresetChange);
  for (const input of epInputs.values()) {
    input.addEventListener("input", handleEndpointInput);
    input.addEventListener("blur", handleEndpointBlur);
  }
  const svcResetListeners = new Map<HTMLButtonElement, () => void>();
  for (const [svc, btn] of svcResetBtns) {
    const handler = (): void => handleSvcReset(svc);
    svcResetListeners.set(btn, handler);
    btn.addEventListener("click", handler);
  }
  for (const r of keyRows) r.addListeners();
  const unsubscribeKeyRows = keyRows.map((r) => r.subscribe());

  function commitDirtyKeys(): void {
    for (const r of keyRows) r.commitIfDirty();
  }

  function dispose(): void {
    commitDirtyKeys();
    ttsTypeEl.removeEventListener("change", handleTtsTypeChange);
    chatTypeEl.removeEventListener("change", handleChatTypeChange);
    chatPresetEl.removeEventListener("change", handleChatPresetChange);
    for (const input of epInputs.values()) {
      input.removeEventListener("input", handleEndpointInput);
      input.removeEventListener("blur", handleEndpointBlur);
    }
    for (const [btn, handler] of svcResetListeners) btn.removeEventListener("click", handler);
    for (const r of keyRows) r.removeListeners();
    for (const unsub of unsubscribeKeyRows) unsub();
  }

  return { keyRows, commitDirtyKeys, dispose };
}
