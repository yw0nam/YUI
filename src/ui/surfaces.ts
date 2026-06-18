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
import { subscribe as subscribeLocale, t } from "./i18n";
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
  /** 제출 콜백 등록. text는 trim된 문자열(이미지만 보낼 땐 빈 문자열), images는 데이터 URL 배열. */
  onSubmit(cb: (text: string, images: string[]) => void): void;
  /** 중단 콜백 등록. busy 중 send 버튼을 명시적으로 누를 때만 발화한다. */
  onStop(cb: () => void): void;
  /**
   * 처리 중 토글. busy면 send 버튼이 stop으로 바뀌고(is-running + 앰버),
   * Enter/submit는 no-op이 된다. 중단은 버튼 클릭으로만 발화.
   */
  setBusy(busy: boolean): void;
  /** 인라인 에러 표시(예: 전송 실패). */
  showInputError(message: string): void;
  /** 입력 비활성화 토글(처리 중 등). 비활성 시 field disabled + pending 디밍. */
  setInputEnabled(enabled: boolean): void;
  /**
   * 입력의 하단 오프셋(px)을 캐릭터 발밑 추적용으로 설정한다. CSS의
   * `bottom: var(--yui-input-bottom, 4%)`를 픽셀로 덮어쓴다. null이면 var를
   * 지워 기본 4%로 복귀. width나 slide-up reveal은 건드리지 않는다.
   */
  setInputAnchor(bottomPx: number | null): void;

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
      <div class="yui-input__tray"></div>
      <div class="yui-input__row">
        <button type="button" class="yui-input__attach" aria-label="${t("aria.attach_image")}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
        <input
          class="yui-input__field"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          placeholder="${t("input.placeholder")}"
          aria-label="${t("aria.input_field")}"
        />
        <span class="yui-input__error" role="alert"></span>
        <button class="yui-input__send" type="submit" aria-label="${t("aria.send")}">
          <span class="icon-send" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <line x1="8" y1="13" x2="8" y2="3"/>
              <polyline points="4,7 8,3 12,7"/>
            </svg>
          </span>
          <span class="icon-stop" aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <rect x="4" y="4" width="8" height="8" rx="1.5"/>
            </svg>
          </span>
        </button>
        <input type="file" class="yui-input__picker" accept="image/*" multiple hidden />
      </div>
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
  const trayEl = el.querySelector<HTMLDivElement>(".yui-input__tray")!;
  const attachBtn = el.querySelector<HTMLButtonElement>(".yui-input__attach")!;
  const picker = el.querySelector<HTMLInputElement>(".yui-input__picker")!;
  const sendBtn = el.querySelector<HTMLButtonElement>(".yui-input__send")!;

  const dwell = dwellMs ?? readDwellToken(el) ?? DEFAULT_DWELL;
  const submitHandlers: Array<(text: string, images: string[]) => void> = [];
  const stopHandlers: Array<() => void> = [];
  // ponytail: no count/size cap — add when context-size bites.
  const attachments: string[] = [];
  // 백엔드 처리 중 — send 버튼이 stop으로 바뀌고 submit이 막힌다.
  let busy = false;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  // endSpeech({ defer:true })로 페이드를 보류 중인지 — finishSpeech()가 해제한다.
  let deferred = false;
  // Raw accumulated speech text — re-rendered as markdown on each push.
  let speechRaw = "";
  // 사용자가 말풍선 위에 커서를 올려 읽는 중인지.
  let hovering = false;
  // dwell 빚이 남아있는지(타이머 점화 보류 가능 상태).
  let dwellArmed = false;

  function clearDwell(): void {
    if (dwellTimer !== null) {
      clearTimeout(dwellTimer);
      dwellTimer = null;
    }
  }

  // dwell 점화 — 넘치는 말풍선을 읽는 중이면 보류(빚만 남기고 타이머는 안 켠다).
  function armDwell(): void {
    clearDwell();
    if (hovering && bubbleEl.classList.contains("is-scrollable")) return;
    dwellTimer = setTimeout(() => {
      dwellArmed = false;
      hideSpeech();
    }, dwell);
  }

  // 높이 상한된 말풍선의 최신 줄을 항상 보이게 끝으로 스크롤.
  // 넘칠 때만 is-scrollable을 켜 상단 fade가 적용되게 한다(짧은 발화는 첫 줄을 깎지 않음).
  function scrollBubbleToEnd(): void {
    bubbleEl.scrollTop = bubbleEl.scrollHeight;
    bubbleEl.classList.toggle("is-scrollable", bubbleEl.scrollHeight > bubbleEl.clientHeight);
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
    scrollBubbleToEnd();
  }

  function endSpeech(opts?: { defer?: boolean }): void {
    if (bubbleEl.hidden && speechRaw === "") return;
    bubbleEl.hidden = false;
    bubbleEl.classList.add("is-visible");
    bubbleEl.classList.remove("is-streaming");
    scrollBubbleToEnd();
    clearDwell();
    if (opts?.defer) {
      // 재생이 끝날 때까지 페이드 보류 — finishSpeech()가 dwell을 점화한다.
      deferred = true;
      return;
    }
    deferred = false;
    dwellArmed = true;
    armDwell();
  }

  function finishSpeech(): void {
    if (!deferred) return;
    deferred = false;
    if (bubbleEl.hidden) return;
    dwellArmed = true;
    armDwell();
  }

  function hideSpeech(): void {
    clearDwell();
    dwellArmed = false;
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
        clearAttachments();
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

  function onSubmit(cb: (text: string, images: string[]) => void): void {
    submitHandlers.push(cb);
  }

  function clearAttachments(): void {
    attachments.length = 0;
    trayEl.replaceChildren();
  }

  function addFiles(files: FileList | File[]): void {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        attachments.push(url);
        addChip(url);
      };
      reader.readAsDataURL(file);
    }
  }

  function addChip(dataUrl: string): void {
    const chip = document.createElement("div");
    chip.className = "yui-chip";
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = ""; // 장식용 썸네일 — 칩의 × 버튼이 첨부 존재를 전달한다.
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "yui-chip__remove";
    remove.textContent = "×";
    remove.setAttribute("aria-label", t("aria.remove_attachment"));
    remove.addEventListener("click", () => {
      const idx = Array.from(trayEl.children).indexOf(chip);
      if (idx !== -1) attachments.splice(idx, 1);
      chip.remove();
    });
    chip.append(img, remove);
    trayEl.append(chip);
  }

  function onStop(cb: () => void): void {
    stopHandlers.push(cb);
  }

  // busy면 send→stop 아이콘 스왑 + 앰버, field 디밍, submit 차단.
  function setBusy(value: boolean): void {
    busy = value;
    formEl.classList.toggle("is-running", value);
    sendBtn.setAttribute("aria-label", value ? t("aria.stop") : t("aria.send"));
  }

  // surfaces는 로케일 변경 시 재마운트되지 않으므로 정적 라벨을 직접 갱신한다.
  function applyLocaleLabels(): void {
    attachBtn.setAttribute("aria-label", t("aria.attach_image"));
    field.placeholder = t("input.placeholder");
    field.setAttribute("aria-label", t("aria.input_field"));
    sendBtn.setAttribute("aria-label", busy ? t("aria.stop") : t("aria.send"));
  }
  const unsubscribeLocale = subscribeLocale(applyLocaleLabels);

  function setInputEnabled(enabled: boolean): void {
    field.disabled = !enabled;
    formEl.classList.toggle("is-pending", !enabled);
  }

  function setInputAnchor(bottomPx: number | null): void {
    if (bottomPx === null) formEl.style.removeProperty("--yui-input-bottom");
    else formEl.style.setProperty("--yui-input-bottom", `${bottomPx}px`);
  }

  function handleSubmit(e: Event): void {
    e.preventDefault();
    if (busy) return; // 처리 중엔 Enter/submit no-op — 중단은 버튼 클릭으로만
    const text = field.value.trim();
    if (text === "" && attachments.length === 0) return;
    formEl.classList.remove("is-error");
    errorEl.textContent = "";
    const images = attachments.slice();
    for (const cb of submitHandlers) cb(text, images);
    clearAttachments();
  }

  // busy 중 버튼 클릭 = 중단(submit 가로채기). idle이면 type=submit로 통과.
  function handleSendClick(e: Event): void {
    if (!busy) return;
    e.preventDefault();
    for (const cb of stopHandlers) cb();
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

  // 넘치는 말풍선에 커서를 올리면 auto-hide를 멈춰 읽을 시간을 준다.
  function onBubbleEnter(): void {
    hovering = true;
    if (dwellArmed && bubbleEl.classList.contains("is-scrollable")) clearDwell();
  }
  function onBubbleLeave(): void {
    hovering = false;
    if (dwellArmed) armDwell();
  }

  function onAttachClick(): void {
    picker.click();
  }
  function onPickerChange(): void {
    if (picker.files) addFiles(picker.files);
    picker.value = "";
  }
  function onFieldPaste(e: ClipboardEvent): void {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = Array.from(items)
      .filter((i) => i.kind === "file")
      .map((i) => i.getAsFile())
      .filter((f): f is File => f !== null);
    if (files.length === 0) return;
    // 텍스트+이미지 혼합 붙여넣기면 텍스트를 살리기 위해 기본 동작을 막지 않는다.
    // 이미지 전용일 때만 막아 파일명이 필드에 새지 않게 한다.
    if (!e.clipboardData?.getData("text")) e.preventDefault();
    addFiles(files);
  }
  function onDragOver(e: DragEvent): void {
    e.preventDefault();
    formEl.classList.add("is-dragover");
  }
  function onDragLeave(e: DragEvent): void {
    // 자식 요소로 진입할 때도 dragleave가 발생하므로, 폼을 실제로 벗어날 때만 해제.
    if (!formEl.contains(e.relatedTarget as Node)) formEl.classList.remove("is-dragover");
  }
  function onDrop(e: DragEvent): void {
    e.preventDefault();
    formEl.classList.remove("is-dragover");
    if (e.dataTransfer) addFiles(e.dataTransfer.files);
  }

  formEl.addEventListener("submit", handleSubmit);
  sendBtn.addEventListener("click", handleSendClick);
  field.addEventListener("keydown", handleFieldKey);
  field.addEventListener("input", clearErrorOnInput);
  field.addEventListener("paste", onFieldPaste);
  attachBtn.addEventListener("click", onAttachClick);
  picker.addEventListener("change", onPickerChange);
  formEl.addEventListener("dragover", onDragOver);
  formEl.addEventListener("dragleave", onDragLeave);
  formEl.addEventListener("drop", onDrop);
  bubbleEl.addEventListener("pointerenter", onBubbleEnter);
  bubbleEl.addEventListener("pointerleave", onBubbleLeave);

  function dispose(): void {
    clearDwell();
    unsubscribeLocale();
    formEl.removeEventListener("submit", handleSubmit);
    sendBtn.removeEventListener("click", handleSendClick);
    field.removeEventListener("keydown", handleFieldKey);
    field.removeEventListener("input", clearErrorOnInput);
    field.removeEventListener("paste", onFieldPaste);
    attachBtn.removeEventListener("click", onAttachClick);
    picker.removeEventListener("change", onPickerChange);
    formEl.removeEventListener("dragover", onDragOver);
    formEl.removeEventListener("dragleave", onDragLeave);
    formEl.removeEventListener("drop", onDrop);
    bubbleEl.removeEventListener("pointerenter", onBubbleEnter);
    bubbleEl.removeEventListener("pointerleave", onBubbleLeave);
    submitHandlers.length = 0;
    stopHandlers.length = 0;
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
    onStop,
    setBusy,
    showInputError,
    setInputEnabled,
    setInputAnchor,
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
