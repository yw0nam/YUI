/**
 * YUI interaction surfaces — speech bubble · tool-status · text input.
 *
 * 세 표면을 하나의 시스템으로 관리한다 (DESIGN.md "The Hearthlight").
 * API는 **상태 렌더러**다 — firing ≠ judgment: 이 컨트롤러는 백엔드가 정한 상태를
 * *그리기만* 한다. judgment(말할지/내용)는 backend, 발화 트리거는 dispatcher/chat-client.
 * 여기에 brain·페르소나·모드 분기를 두지 않는다.
 *
 * 현재 = 목업 단계: createSurfaces가 DOM/전이/상태를 담당하고, 실제 데이터는
 * mock.ts(스크립트) 또는 (후속) chat-client SSE가 이 API를 호출한다.
 */

import "./surfaces.css";
import { renderMarkdownInline } from "./markdown";
import { getToolLabel } from "./tool-labels";

export interface Surfaces {
  /** overlay 루트 (.yui-ui) */
  readonly el: HTMLElement;

  // ── speech bubble (출력) ──
  /** 말풍선 등장(빈 상태) + 캐럿 ON. 스트리밍 시작 전 호출. */
  beginSpeech(): void;
  /** 스트리밍 델타 추가. */
  pushSpeech(delta: string): void;
  /**
   * 캐럿 OFF. 기본은 dwell 후 자동 페이드(전체 텍스트를 한 번에 줄 때도 사용).
   * defer=true면 페이드를 보류 — TTS 재생이 끝나 finishSpeech()가 호출될 때까지 말풍선 유지.
   */
  endSpeech(opts?: { defer?: boolean }): void;
  /** 보류된 말풍선(endSpeech defer)을 dwell→페이드로 해제. 비-보류/숨김 상태면 no-op. */
  finishSpeech(): void;
  /** 즉시 말풍선 숨김(dwell 무시). */
  hideSpeech(): void;

  // ── tool-status (백엔드 tool 관찰) ──
  /** tool_id를 넘기면 label 맵에서 표시 문자열을 조회한다. 미등록 id는 generic fallback. */
  showTool(toolId: string): void;
  hideTool(): void;

  // ── text input (입력) ──
  /** 핫키 소환 — 슬라이드 업 + 포커스. */
  summonInput(): void;
  /** 입력 닫기. */
  dismissInput(): void;
  /** 입력 열림 여부. */
  isInputOpen(): boolean;
  /** 제출 콜백 등록. text는 trim된 비어있지 않은 문자열. */
  onSubmit(cb: (text: string) => void): void;
  /** 인라인 에러 표시(예: 전송 실패). */
  showInputError(message: string): void;

  dispose(): void;
}

interface SurfacesOptions {
  mount: HTMLElement;
  /** dwell(설정값) override. 기본 = --yui-dwell 토큰. */
  dwellMs?: number;
}

const DEFAULT_DWELL = 5000;

export function createSurfaces({ mount, dwellMs }: SurfacesOptions): Surfaces {
  const el = document.createElement("div");
  el.className = "yui-ui";
  el.innerHTML = `
    <div class="yui-tool" role="status" aria-live="polite" hidden>
      <span class="yui-tool__dot" aria-hidden="true"></span>
      <span class="yui-tool__label"></span>
    </div>
    <div class="yui-bubble" role="status" aria-live="polite" hidden>
      <span class="yui-bubble__text"></span><span class="yui-bubble__caret" aria-hidden="true">|</span>
    </div>
    <form class="yui-input" novalidate hidden>
      <input
        class="yui-input__field"
        type="text"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        placeholder="말 걸기…"
        aria-label="YUI에게 말 걸기"
      />
      <span class="yui-input__error" role="alert"></span>
    </form>
  `;
  mount.appendChild(el);

  const toolEl = el.querySelector<HTMLDivElement>(".yui-tool")!;
  const toolLabel = el.querySelector<HTMLSpanElement>(".yui-tool__label")!;
  const bubbleEl = el.querySelector<HTMLDivElement>(".yui-bubble")!;
  const bubbleText = el.querySelector<HTMLSpanElement>(".yui-bubble__text")!;
  const formEl = el.querySelector<HTMLFormElement>(".yui-input")!;
  const field = el.querySelector<HTMLInputElement>(".yui-input__field")!;
  const errorEl = el.querySelector<HTMLSpanElement>(".yui-input__error")!;

  const dwell = dwellMs ?? readDwellToken(el) ?? DEFAULT_DWELL;
  const submitHandlers: Array<(text: string) => void> = [];
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  // endSpeech({ defer:true })로 페이드를 보류 중인지 — finishSpeech()가 해제한다.
  let deferred = false;
  // Raw accumulated speech text — re-rendered as markdown on each push.
  let speechRaw = "";

  function clearDwell(): void {
    if (dwellTimer !== null) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
  }

  // ── speech bubble ──
  function beginSpeech(): void {
    clearDwell();
    deferred = false;
    speechRaw = "";
    bubbleText.replaceChildren();
    bubbleEl.hidden = false;
    bubbleEl.classList.add("is-streaming");
    // 다음 프레임에 transition 점화 (hidden 해제 직후 같은 프레임이면 안 움직임)
    requestAnimationFrame(() => bubbleEl.classList.add("is-visible"));
  }

  function pushSpeech(delta: string): void {
    if (bubbleEl.hidden) beginSpeech();
    speechRaw += delta;
    // Re-render the full accumulated text as inline markdown on each delta.
    bubbleText.replaceChildren(renderMarkdownInline(speechRaw));
  }

  function endSpeech(opts?: { defer?: boolean }): void {
    if (bubbleEl.hidden && speechRaw === "") return;
    bubbleEl.hidden = false;
    bubbleEl.classList.add("is-visible");
    bubbleEl.classList.remove("is-streaming");
    clearDwell();
    if (opts?.defer) {
      // 재생이 끝날 때까지 페이드 보류 — finishSpeech()가 dwell을 점화한다.
      deferred = true;
      return;
    }
    deferred = false;
    dwellTimer = setTimeout(hideSpeech, dwell);
  }

  function finishSpeech(): void {
    if (!deferred) return;
    deferred = false;
    if (bubbleEl.hidden) return;
    clearDwell();
    dwellTimer = setTimeout(hideSpeech, dwell);
  }

  function hideSpeech(): void {
    clearDwell();
    deferred = false;
    bubbleEl.classList.remove("is-visible", "is-streaming");
    const onEnd = (e: TransitionEvent): void => {
      if (e.propertyName !== "opacity") return;
      bubbleEl.removeEventListener("transitionend", onEnd);
      if (!bubbleEl.classList.contains("is-visible")) {
        bubbleEl.hidden = true;
        speechRaw = "";
        bubbleText.replaceChildren();
      }
    };
    bubbleEl.addEventListener("transitionend", onEnd);
  }

  // ── tool-status ──
  function showTool(toolId: string): void {
    toolLabel.textContent = getToolLabel(toolId);
    toolEl.hidden = false;
    requestAnimationFrame(() => toolEl.classList.add("is-visible"));
  }

  function hideTool(): void {
    toolEl.classList.remove("is-visible");
    const onEnd = (e: TransitionEvent): void => {
      if (e.propertyName !== "opacity") return;
      toolEl.removeEventListener("transitionend", onEnd);
      if (!toolEl.classList.contains("is-visible")) toolEl.hidden = true;
    };
    toolEl.addEventListener("transitionend", onEnd);
  }

  // ── text input ──
  function summonInput(): void {
    formEl.hidden = false;
    formEl.classList.remove("is-error", "is-pending");
    errorEl.textContent = "";
    requestAnimationFrame(() => {
      formEl.classList.add("is-open");
      field.focus();
    });
  }

  function dismissInput(): void {
    formEl.classList.remove("is-open");
    field.blur();
    const onEnd = (e: TransitionEvent): void => {
      if (e.propertyName !== "opacity") return;
      formEl.removeEventListener("transitionend", onEnd);
      if (!formEl.classList.contains("is-open")) {
        formEl.hidden = true;
        field.value = "";
        formEl.classList.remove("is-error", "is-pending");
        errorEl.textContent = "";
      }
    };
    formEl.addEventListener("transitionend", onEnd);
  }

  function isInputOpen(): boolean {
    return formEl.classList.contains("is-open");
  }

  function showInputError(message: string): void {
    errorEl.textContent = message;
    formEl.classList.add("is-error");
    formEl.classList.remove("is-pending");
  }

  function onSubmit(cb: (text: string) => void): void {
    submitHandlers.push(cb);
  }

  function handleSubmit(e: Event): void {
    e.preventDefault();
    const text = field.value.trim();
    if (text === "") return;
    formEl.classList.remove("is-error");
    errorEl.textContent = "";
    for (const cb of submitHandlers) cb(text);
  }

  function handleFieldKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      dismissInput();
    }
  }
  // 사용자가 다시 타이핑하면 에러 해제
  function clearErrorOnInput(): void {
    if (formEl.classList.contains("is-error")) {
      formEl.classList.remove("is-error");
      errorEl.textContent = "";
    }
  }

  formEl.addEventListener("submit", handleSubmit);
  field.addEventListener("keydown", handleFieldKey);
  field.addEventListener("input", clearErrorOnInput);

  function dispose(): void {
    clearDwell();
    formEl.removeEventListener("submit", handleSubmit);
    field.removeEventListener("keydown", handleFieldKey);
    field.removeEventListener("input", clearErrorOnInput);
    submitHandlers.length = 0;
    el.remove();
  }

  return {
    el,
    beginSpeech,
    pushSpeech,
    endSpeech,
    finishSpeech,
    hideSpeech,
    showTool,
    hideTool,
    summonInput,
    dismissInput,
    isInputOpen,
    onSubmit,
    showInputError,
    dispose,
  };
}

/** --yui-dwell 토큰(ms)을 읽는다. 없으면 null. */
function readDwellToken(el: HTMLElement): number | null {
  const raw = getComputedStyle(el).getPropertyValue("--yui-dwell").trim();
  if (raw === "") return null;
  const ms = raw.endsWith("ms")
    ? parseFloat(raw)
    : raw.endsWith("s")
      ? parseFloat(raw) * 1000
      : parseFloat(raw);
  return Number.isFinite(ms) ? ms : null;
}
