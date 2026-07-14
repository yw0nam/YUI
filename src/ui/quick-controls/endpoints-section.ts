/**
 * 엔드포인트 섹션 — 고급 탭의 엔드포인트 URL 필드, chat/STT/TTS API 키 행(시크릿),
 * TTS 엔진(tts_provider) 드롭다운, Chat API(chat_api) 드롭다운, 서비스별 초기화를 소유한다.
 * VRM/화자 섹션과 같은 패턴: 명시적 deps + shell에서 배선. reflect(store→DOM)는 reflect 레이어가 맡고,
 * 이 모듈은 입력·핸들러·구독·teardown만 맡는다.
 */
import type { ApiKeySettingsStore } from "../../io/api-key-settings";
import type { ChatKeySettingsStore } from "../../io/chat-key-settings";
import type { createEndpointsSettings, EndpointOverrides } from "../../io/endpoints-settings";
import type { Logger } from "../../logger";
import { t } from "../i18n";
import { CHATKEY_EYE_OFF_SVG, CHATKEY_EYE_SVG, ENDPOINT_FIELDS } from "./constants";
import { validateEndpointInput } from "./reflect";

type EndpointsSettingsStore = ReturnType<typeof createEndpointsSettings>;

export interface EndpointsSectionDeps {
  /** 패널 루트(el) — 엔드포인트 입력/키 행/드롭다운을 여기서 쿼리한다. */
  root: HTMLElement;
  endpointsSettings: EndpointsSettingsStore;
  /** chat API 키 오버라이드 store. 값은 시크릿 — 로깅 금지. */
  chatKeySettings: ChatKeySettingsStore;
  /** STT API 키 오버라이드 store. 값은 시크릿 — 로깅 금지. */
  sttKeySettings: ApiKeySettingsStore;
  /** TTS(openai 호환) API 키 오버라이드 store. 값은 시크릿 — 로깅 금지. */
  ttsKeySettings: ApiKeySettingsStore;
  /** placeholder로 보여줄 bundled config 기본 엔드포인트(미로드 시 undefined). */
  getEndpointDefaults?: () => EndpointOverrides | undefined;
  /** blur 시 보류된 원격 변경을 입력에 반영(reflect 레이어의 reflectEndpoints). */
  reflectEndpoints: () => void;
  /** 키 행 store 구독이 재그림 전에 확인하는 열림 여부(popover.isOpen). */
  isOpen: () => boolean;
  log: Logger;
}

// 서비스별 API 키 행(시크릿). 값은 input.value에만 살고, sublabel/aria는 상태만 노출한다.
// 타이핑은 store에 commit하지 않는다(중간 prefix가 라이브 키가 되는 걸 막음). blur·close·dispose에 한 번 commit.
interface KeyRow {
  reflect(): void;
  commitIfDirty(): void;
  subscribe(): () => void;
  addListeners(): void;
  removeListeners(): void;
}

export interface EndpointsSection {
  /** 서비스별 키 행 — reflect 레이어의 reflectKeyRows가 각 행의 reflect()를 호출한다. */
  keyRows: readonly KeyRow[];
  /** 보류된 키 입력을 store에 커밋(패널 close 시). */
  commitDirtyKeys(): void;
  /** 영구 teardown — 보류 키 커밋 + 모든 리스너/구독 해제. */
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

  // TTS 엔진 드롭다운 + irodori/openai 서브뷰(고급 탭). Chat API 드롭다운(서브뷰 없음).
  const ttsTypeEl = el.querySelector<HTMLSelectElement>(".yui-tts-type")!;
  const chatTypeEl = el.querySelector<HTMLSelectElement>(".yui-chat-type")!;

  // 엔드포인트 입력 — 필드 key별 input 노드 맵.
  const epInputs = new Map<keyof EndpointOverrides, HTMLInputElement>();
  for (const { key } of ENDPOINT_FIELDS) {
    epInputs.set(key, el.querySelector<HTMLInputElement>(`#yui-ep-${key}`)!);
  }
  // per-section reset 버튼 — data-svc-reset 별 노드 맵.
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
      if (document.activeElement !== input && input.value !== key) {
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

  // 엔드포인트 placeholder — bundled config 기본값(greyed)으로 채운다(미로드 시 빈 채로 둠).
  const epDefaults = getEndpointDefaults?.();
  if (epDefaults) {
    for (const { key } of ENDPOINT_FIELDS) {
      epInputs.get(key)!.placeholder = epDefaults[key];
    }
  }

  // ── 고급 섹션: TTS 엔진 드롭다운(tts_provider) ──
  // native select가 키보드를 소유한다 — change 이벤트로만 store에 쓴다.
  function handleTtsTypeChange(): void {
    const provider = ttsTypeEl.value;
    if (provider !== "irodori" && provider !== "openai") return;
    endpointsSettings.set({ tts_provider: provider });
    log.info("voice_engine_change", { provider });
    // store 구독(unsubscribeEndpoints)이 reflect.reflectVoiceEngine으로 값/서브뷰/화자 비활성을 갱신한다.
  }

  // ── 고급 섹션: Chat API 드롭다운(chat_api) — 서브뷰 없음(shared fields) ──
  function handleChatTypeChange(): void {
    const api = chatTypeEl.value;
    if (api !== "responses" && api !== "chat_completions") return;
    endpointsSettings.set({ chat_api: api });
    log.info("chat_api_change", { api });
    // store 구독(unsubscribeEndpoints)이 reflect.reflectChatType으로 값/summary hint를 갱신한다.
  }

  // ── 엔드포인트 섹션 ──

  function handleEndpointInput(e: Event): void {
    const input = e.target;
    if (!(input instanceof HTMLInputElement)) return;
    const row = input.closest<HTMLDivElement>(".yui-input-row");
    const key = row?.dataset.epField as keyof EndpointOverrides | undefined;
    if (!key) return;
    endpointsSettings.set({ [key]: input.value });
    validateEndpointInput(key, input);
  }

  // blur 시점에 입력 중 보류된 원격 변경을 반영한다(지침 textarea와 동일).
  function handleEndpointBlur(): void {
    reflectEndpoints();
  }

  // ── 서비스별 초기화(per-section reset) ──
  // 각 섹션이 비우는 엔드포인트 필드 + 키 store. URL/모델은 ""로, 키는 .clear()로 되돌린다.
  const SVC_RESET_FIELDS: Record<string, (keyof EndpointOverrides)[]> = {
    chat: ["chat_base_url", "chat_model"],
    stt: ["stt_base_url"],
    tts: ["irodori_base_url", "tts_base_url", "tts_voice"],
    broker: ["broker_base_url"],
  };
  const SVC_RESET_KEY: Record<string, ApiKeySettingsStore | undefined> = {
    chat: chatKeySettings,
    stt: sttKeySettings,
    tts: ttsKeySettings,
    broker: undefined,
  };

  function handleSvcReset(svc: string): void {
    const fields = SVC_RESET_FIELDS[svc];
    if (!fields) return;
    const patch: Partial<EndpointOverrides> = {};
    for (const key of fields) patch[key] = "";
    if (svc === "tts") patch.tts_provider = "";
    // chat_api is a dropdown enum (like tts_provider) — not in ENDPOINT_FIELDS/epInputs, so it's
    // patched directly rather than through the text-input reset loop below.
    if (svc === "chat") patch.chat_api = "";
    endpointsSettings.set(patch);
    for (const key of fields) {
      const input = epInputs.get(key)!;
      input.value = "";
      validateEndpointInput(key, input);
    }
    SVC_RESET_KEY[svc]?.clear();
    log.info("svc_reset", { svc });
  }

  // ── 배선 ──
  ttsTypeEl.addEventListener("change", handleTtsTypeChange);
  chatTypeEl.addEventListener("change", handleChatTypeChange);
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
