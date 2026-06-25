/**
 * 화자 목록 클러스터 — 고급 탭 irodori 서브뷰의 화자 라디오그룹.
 * VRM 섹션을 미러링하되 한 가지만 다르다: 행이 <button>이 아닌 div[role=radio]다
 * (중첩 ▶ 미리듣기 <button>을 품으려면 — button 안의 button은 무효 HTML이라 파서가 빼낸다).
 * 그래서 roving tabindex/Enter·Space/화살표 키보드를 직접 배선한다.
 * 추가로 참조-음성 재등록(refresh) + 단일 audition 미리듣기를 소유한다.
 */
import { resolveAssetUrl } from "../../io/asset-url";
import type { createSpeakerSelection, SpeakerOption } from "../../io/speaker-selection";
import type { Logger } from "../../logger";
import { t } from "../i18n";

const SPK_PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const SPK_PAUSE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="6" width="3.4" height="12" rx="0.8"/><rect x="13.6" y="6" width="3.4" height="12" rx="0.8"/></svg>`;
const SPK_REFRESH_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11a8 8 0 1 0-1.6 4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M20 5v5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SPK_CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SPK_NOTE_CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SPK_RENAME_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const SPK_REMOVE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;

const REFRESH_DONE_DWELL_MS = 2400;

export interface SpeakerListDeps {
  /** 패널 루트(el) — .yui-spks / .yui-spk__import-error를 여기서 쿼리한다. */
  root: HTMLElement;
  speakerSelection: ReturnType<typeof createSpeakerSelection>;
  /** 실제 화자 스왑 수행 + 성공 시 store 커밋. 컴포넌트는 store.select를 직접 호출하지 않는다. */
  swapSpeaker: (option: SpeakerOption) => Promise<void>;
  /** 화자의 참조 음성 재등록(PUT /voices). 서버 측 갱신만 — 화자 선택/store는 바꾸지 않는다. */
  refreshSpeaker: (option: SpeakerOption) => Promise<void>;
  /** 파일 선택 → 등록 → addUserVoice + 선택까지의 전체 임포트 흐름. reject 시 인라인 에러. */
  importVoice: () => Promise<void>;
  /** 임포트된 음성의 app-data 파일을 삭제(idempotent). store 제거와 별개로 호출한다. */
  removeUserVoice: (id: string) => Promise<void>;
  /** 미리듣기 ref_url을 fetchable URL로 변환(주입 가능). 기본은 resolveAssetUrl. */
  resolveAuditionUrl?: (refUrl: string) => Promise<string>;
  log: Logger;
  /** 효과적 음성 엔진이 irodori일 때만 화자 관리가 활성. openai면 게이팅한다. */
  speakerControlsEnabled: () => boolean;
  /** dispose 후 in-flight refresh가 무너진 DOM에 재그림/타이머를 쓰지 않게 막는다. */
  isDisposed: () => boolean;
}

export interface SpeakerList {
  render(): void;
  handleKeydown(e: KeyboardEvent): void;
  handleAddClick(): void;
  /** 스왑 진행 중 여부 — 엔트리의 open-subscription 가드가 쓴다. */
  isSwapping(): boolean;
  /** 미리듣기 중지(패널 close 시). */
  stopAudition(): void;
  /** 영구 teardown — audition 정지 + refresh 타이머/상태 정리. */
  dispose(): void;
}

export function createSpeakerList(deps: SpeakerListDeps): SpeakerList {
  const {
    speakerSelection,
    swapSpeaker,
    refreshSpeaker,
    importVoice,
    removeUserVoice,
    resolveAuditionUrl,
    log,
    speakerControlsEnabled,
    isDisposed,
  } = deps;
  const spksEl = deps.root.querySelector<HTMLDivElement>(".yui-spks")!;
  const spkImportErrorEl = deps.root.querySelector<HTMLParagraphElement>(".yui-spk__import-error")!;

  let spkSwapping: string | null = null;
  let spkErrorId: string | null = null;
  // 인라인 이름 편집 중인 user 화자 id(없으면 null) · 임포트 진행 여부.
  let spkRenamingId: string | null = null;
  let spkImporting = false;
  // 마지막으로 화살표가 머문 행 id — 재그림이 roving tabindex를 active로 되돌리지 않게 유지.
  // close()에서 일부러 리셋하지 않는다 — 재오픈 시에도 머문 행을 잇고, ids.includes로 가드한다.
  let spkRovedId: string | null = null;

  // 행별 참조-음성 갱신 상태 — renderSpeakers 재그림을 살아남도록 id별로 보관.
  type RefreshState = "refreshing" | "done" | "error";
  const spkRefreshState = new Map<string, RefreshState>();
  // "done" 상태를 일정 시간 후 idle로 되돌리는 타이머(중복 갱신·dispose 시 정리).
  const spkRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function clearRefreshTimer(id: string): void {
    const t = spkRefreshTimers.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      spkRefreshTimers.delete(id);
    }
  }

  // 미리듣기는 단일 audition — 하나를 재생하면 다른 것은 멈춘다.
  let auditionAudio: HTMLAudioElement | null = null;
  let auditionBtn: HTMLButtonElement | null = null;

  function stopAudition(): void {
    if (auditionAudio) {
      auditionAudio.pause();
      auditionAudio = null;
    }
    if (auditionBtn) {
      auditionBtn.classList.remove("is-playing");
      auditionBtn.innerHTML = SPK_PLAY_SVG;
      auditionBtn = null;
    }
  }

  // 미리듣기 ref_url을 fetchable URL로 변환한다(패키징 시 /references/* 404 회피).
  // Tauri는 번들 리소스 절대 URL, dev/브라우저는 원본 통과 — irodori-voices와 같은 resolver.
  const resolveAudition = resolveAuditionUrl ?? resolveAssetUrl;

  function toggleAudition(btn: HTMLButtonElement, refUrl: string): void {
    if (auditionBtn === btn) {
      stopAudition(); // 같은 버튼 재클릭 → 정지 토글
      return;
    }
    stopAudition(); // 다른 클립 재생 중이면 먼저 멈춘다
    btn.classList.add("is-playing");
    btn.innerHTML = SPK_PAUSE_SVG;
    auditionBtn = btn; // resolver 대기 동안 같은 버튼 재클릭이 정지 토글로 동작하도록 선점
    const fail = (): void => {
      if (auditionBtn === btn) stopAudition();
    };
    // ref_url을 먼저 자산 프로토콜로 해석한 뒤 Audio를 만든다 — bundled·user 행 모두.
    void resolveAudition(refUrl)
      .then((url) => {
        if (auditionBtn !== btn) return; // 대기 중 다른 클립이 시작/정지됨
        const audio = new Audio(url);
        audio.addEventListener("ended", () => {
          if (auditionBtn === btn) stopAudition();
        });
        auditionAudio = audio;
        // play()는 Promise 또는(구형/일부 환경) undefined를 반환할 수 있다 — 둘 다 안전 처리.
        try {
          const p = audio.play();
          if (p && typeof p.then === "function") p.catch(fail);
        } catch {
          fail();
        }
      })
      .catch(fail);
  }

  function renderSpeakers(): void {
    const activeId = speakerSelection.getActiveId();
    // roving tabindex는 마지막으로 화살표가 머문 행이 우선 — 없으면 active로 폴백.
    const ids = speakerSelection.list().map((o) => o.id);
    const rovedId = spkRovedId !== null && ids.includes(spkRovedId) ? spkRovedId : activeId;
    // 더 이상 목록에 없는 행을 편집 중이었다면 편집 상태를 정리한다.
    if (spkRenamingId !== null && !ids.includes(spkRenamingId)) spkRenamingId = null;
    const hadFocus = spksEl.contains(document.activeElement);
    stopAudition(); // 재그림이 미리듣기 버튼 노드를 파괴하므로 audition 정리
    spksEl.innerHTML = "";
    for (const opt of speakerSelection.list()) {
      const isUser = opt.source === "user";
      const row = document.createElement("div");
      row.setAttribute("role", "radio");
      row.className = "yui-spk";
      row.dataset.spkId = opt.id;
      const selected = opt.id === activeId;
      row.setAttribute("aria-checked", String(selected));
      row.tabIndex = opt.id === rovedId ? 0 : -1;

      if (isUser && opt.id === spkRenamingId) {
        renderSpkRenamingRow(row, opt);
        spksEl.appendChild(row);
        continue;
      }

      const label = opt.label ?? opt.id;
      const hasClip = opt.ref_url.length > 0;
      const refreshState = spkRefreshState.get(opt.id);
      const badgeHtml = selected
        ? `<span class="yui-spk__badge">${t("speaker.in_use")}</span>`
        : "";
      // user 행은 ✎ 이름 바꾸기 · 🗑 삭제를 ↻/▶ 앞에 더한다.
      const userActionsHtml = isUser
        ? `<button class="yui-spk__rename" type="button" title="${t("speaker.rename")}" aria-label="${t("speaker.rename")}">${SPK_RENAME_SVG}</button>` +
          `<button class="yui-spk__remove" type="button" title="${t("speaker.remove")}" aria-label="${t("speaker.remove")}">${SPK_REMOVE_SVG}</button>`
        : "";
      row.innerHTML = `
        <span class="yui-spk__tick" aria-hidden="true"></span>
        <span class="yui-spk__body"><span class="yui-spk__name"></span></span>
        ${userActionsHtml}
        <button class="yui-spk__refresh" type="button" title="${t("speaker.refresh")}" ${hasClip ? "" : "disabled"}>${SPK_REFRESH_SVG}</button>
        <button class="yui-spk__preview" type="button" title="${t("speaker.preview")}" ${hasClip ? "" : "disabled"}>${SPK_PLAY_SVG}</button>
        ${badgeHtml}
      `;
      // 라벨은 신뢰 불가 입력일 수 있다 — textContent로만 넣는다.
      const nameEl = row.querySelector<HTMLSpanElement>(".yui-spk__name")!;
      nameEl.textContent = label;
      if (isUser) {
        row.querySelector<HTMLButtonElement>(".yui-spk__rename")!.addEventListener("click", (e) => {
          e.stopPropagation(); // 이름 편집은 행 선택을 트리거하지 않는다
          if (speakerControlsEnabled()) startSpkRename(opt.id);
        });
        row.querySelector<HTMLButtonElement>(".yui-spk__remove")!.addEventListener("click", (e) => {
          e.stopPropagation(); // 삭제는 행 선택을 트리거하지 않는다
          if (speakerControlsEnabled()) void removeUserSpeaker(opt.id);
        });
      }
      const refreshBtn = row.querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
      refreshBtn.setAttribute("aria-label", t("aria.refresh_speaker", { name: label }));
      refreshBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // 갱신은 행 선택을 트리거하지 않는다
        if (hasClip) void refreshTo(opt);
      });
      const previewBtn = row.querySelector<HTMLButtonElement>(".yui-spk__preview")!;
      previewBtn.setAttribute("aria-label", t("aria.preview_speaker", { name: label }));
      previewBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // 미리듣기는 행 선택을 트리거하지 않는다
        if (hasClip) toggleAudition(previewBtn, opt.ref_url);
      });

      row.addEventListener("click", () => {
        void swapToSpeaker(opt);
      });

      // 저장된 refresh 상태를 재그림 후에도 시각/aria에 반영한다.
      if (refreshState === "refreshing") {
        refreshBtn.classList.add("is-refreshing");
        refreshBtn.disabled = true;
        refreshBtn.setAttribute(
          "aria-label",
          t("aria.refresh_speaker_refreshing", { name: label }),
        );
        const body = row.querySelector(".yui-spk__body");
        if (body && !row.querySelector(".yui-spk__hint")) {
          const hint = document.createElement("span");
          hint.className = "yui-spk__hint";
          hint.textContent = t("speaker.refreshing");
          body.insertAdjacentElement("afterend", hint);
        }
      } else if (refreshState === "done") {
        refreshBtn.classList.add("is-done");
        refreshBtn.innerHTML = SPK_CHECK_SVG;
        refreshBtn.setAttribute("aria-label", t("aria.refresh_speaker_done", { name: label }));
      }

      spksEl.appendChild(row);

      if (opt.id === spkErrorId) {
        row.classList.add("is-error");
        row.setAttribute("aria-invalid", "true");
        const err = document.createElement("p");
        err.className = "yui-spk__error";
        err.setAttribute("role", "status");
        err.textContent = t("speaker.swap_error");
        spksEl.appendChild(err);
      } else if (refreshState === "error") {
        row.classList.add("is-error");
        row.setAttribute("aria-invalid", "true");
        const err = document.createElement("p");
        err.className = "yui-spk__error";
        err.setAttribute("role", "status");
        err.textContent = t("speaker.refresh_error");
        spksEl.appendChild(err);
      } else if (refreshState === "done") {
        const note = document.createElement("p");
        note.className = "yui-spk__note";
        note.setAttribute("role", "status");
        note.innerHTML = `${SPK_NOTE_CHECK_SVG}${t("speaker.refresh_done")}`;
        spksEl.appendChild(note);
      }
    }

    // 임포트 진행 중이면 목록 끝에 스피너 placeholder 행을 붙인다(라디오 아님).
    if (spkImporting) {
      const loading = document.createElement("div");
      loading.className = "yui-spk__loading";
      loading.setAttribute("role", "status");
      loading.innerHTML = `<span class="yui-spk__spin" aria-hidden="true"></span><span class="yui-spk__loading-name">${t("speaker.loading")}</span>`;
      spksEl.appendChild(loading);
    }

    // 편집 중이면 입력에 포커스를 두고 종료한다(roving 포커스 복원보다 우선).
    if (spkRenamingId !== null) {
      const input = spksEl.querySelector<HTMLInputElement>(".yui-spk--renaming .yui-ep-input");
      if (input) {
        input.focus();
        input.select();
      }
      return;
    }

    if (hadFocus) {
      const roved = spkRowById(rovedId);
      if (roved) {
        roved.focus();
        roved.scrollIntoView?.({ block: "nearest" });
      }
    }
  }

  // user 화자 행을 인라인 이름 편집 모드로 그린다 — 라벨이 입력으로 바뀌고 hint가 뒤따른다.
  function renderSpkRenamingRow(row: HTMLElement, opt: SpeakerOption): void {
    row.classList.add("yui-spk--renaming");
    row.innerHTML = `
      <span class="yui-spk__tick" aria-hidden="true"></span>
      <span class="yui-input-wrap"><input class="yui-ep-input" type="text" aria-label="${t("speaker.name_aria")}" /></span>
      <span class="yui-spk__rename-hint"><kbd>Enter</kbd> ${t("speaker.rename_hint_save")} · <kbd>Esc</kbd> ${t("speaker.rename_hint_cancel")}</span>
    `;
    const input = row.querySelector<HTMLInputElement>(".yui-ep-input")!;
    input.value = opt.label ?? opt.id;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitSpkRename(opt.id, input.value);
      } else if (e.key === "Escape") {
        // Esc는 이름 편집만 취소한다 — 패널 닫기(document Escape)로 새지 않게 막는다.
        e.preventDefault();
        e.stopPropagation();
        cancelSpkRename();
      }
    });
    // blur로 빠져나가면 비어있지 않은 값을 커밋한다.
    input.addEventListener("blur", () => {
      if (spkRenamingId !== opt.id) return; // 이미 commit/cancel로 정리됨
      commitSpkRename(opt.id, input.value);
    });
  }

  function startSpkRename(id: string): void {
    spkRenamingId = id;
    renderSpeakers();
  }

  function cancelSpkRename(): void {
    if (spkRenamingId === null) return;
    spkRenamingId = null;
    renderSpeakers();
  }

  function commitSpkRename(id: string, label: string): void {
    if (spkRenamingId !== id) return;
    spkRenamingId = null;
    // 빈/공백 label은 store가 거부한다(기존 라벨 유지). 변경 시 store 구독이 재그림.
    speakerSelection.renameUserVoice(id, label);
    log.info("voice_rename", { id });
    renderSpeakers();
  }

  // user 화자 제거 — 파일을 먼저 지우고(성공해야 store/disk 불일치 없음 → 다음 발화의 서버
  // 422 방지), 그 다음에만 store에서 빼고 active였으면 fallback으로 스왑한다.
  async function removeUserSpeaker(id: string): Promise<void> {
    const wasActive = speakerSelection.getActiveId() === id;
    log.info("voice_delete", { id });
    try {
      await removeUserVoice(id);
    } catch (err) {
      // 파일 삭제 실패 — store 제거를 커밋하지 않고 행을 그대로 둔다(disk와 일치 유지).
      log.error("voice_delete_failed", { id, error: String(err) });
      return;
    }
    speakerSelection.removeUserVoice(id); // active였으면 default로 폴백 + 통지
    // 비-active 제거는 store가 통지하지 않으므로 목록을 직접 다시 그린다.
    if (!wasActive) {
      renderSpeakers();
      return;
    }
    // active를 지웠으면 폴백 화자를 서버에 등록·커밋한다(store는 이미 default를 가리킴).
    try {
      await swapSpeaker(speakerSelection.getActive());
    } catch (err) {
      log.error("voice_fallback_swap_failed", { error: String(err) });
      renderSpeakers(); // 스왑 실패 시 목록을 실제 상태에 맞춰 다시 그린다.
    }
  }

  function setSpkImportError(show: boolean): void {
    spkImportErrorEl.hidden = !show;
  }

  // "파일에서 추가…" — importing 행을 띄우고 전체 임포트 흐름을 위임한다.
  // 성공 시 store가 행을 추가하고(구독→재그림), 실패 시 인라인 에러를 띄운다.
  async function importVoiceFlow(): Promise<void> {
    if (spkImporting) return; // 진행 중엔 두 번째 임포트 금지
    spkImporting = true;
    setSpkImportError(false);
    renderSpeakers();
    try {
      await importVoice();
    } catch (err) {
      setSpkImportError(true);
      log.error("voice_import_failed", { error: String(err) });
    } finally {
      spkImporting = false;
      renderSpeakers();
    }
  }

  function spkRowById(id: string): HTMLDivElement | null {
    return spksEl.querySelector<HTMLDivElement>(`.yui-spk[data-spk-id="${CSS.escape(id)}"]`);
  }

  async function swapToSpeaker(option: SpeakerOption): Promise<void> {
    if (spkSwapping !== null) return; // 진행 중엔 두 번째 스왑 금지
    if (option.id === speakerSelection.getActiveId()) return; // 이미 active면 no-op

    if (spkErrorId !== null) {
      spkErrorId = null;
      renderSpeakers();
    }
    spkSwapping = option.id;

    spksEl.setAttribute("aria-busy", "true");
    spksEl.classList.add("is-swapping");
    const row = spkRowById(option.id);
    if (row) {
      row.setAttribute("aria-busy", "true");
      // 미리듣기 버튼은 스왑 중 숨기고 "바꾸는 중…" 힌트를 그 자리에 둔다.
      row.querySelector(".yui-spk__preview")?.remove();
      const body = row.querySelector(".yui-spk__body");
      if (body && !row.querySelector(".yui-spk__hint")) {
        const hint = document.createElement("span");
        hint.className = "yui-spk__hint";
        hint.textContent = t("speaker.swapping");
        body.insertAdjacentElement("afterend", hint);
      }
    }

    try {
      await swapSpeaker(option);
      spkRovedId = option.id; // 커밋된 행으로 roving tabindex를 잇는다
      log.info("voice_swap", { id: option.id });
    } catch (err) {
      spkErrorId = option.id;
      log.error("voice_swap_failed", { id: option.id, error: String(err) });
    } finally {
      spkSwapping = null;
      spksEl.removeAttribute("aria-busy");
      spksEl.classList.remove("is-swapping");
      renderSpeakers();
    }
  }

  // 참조 음성 재등록 — 서버 측 갱신만, 화자 선택/store는 바꾸지 않는다.
  // 재진입 가드: 같은 id가 이미 갱신 중이면 무시한다.
  async function refreshTo(option: SpeakerOption): Promise<void> {
    if (spkRefreshState.get(option.id) === "refreshing") return;
    clearRefreshTimer(option.id);
    spkRefreshState.set(option.id, "refreshing");
    renderSpeakers();
    try {
      await refreshSpeaker(option);
      if (isDisposed()) return;
      spkRefreshState.set(option.id, "done");
      log.info("reference_voice_update", { id: option.id });
      renderSpeakers();
      // 일정 시간 후 idle로 되돌린다(상태 삭제 + 재그림).
      spkRefreshTimers.set(
        option.id,
        setTimeout(() => {
          spkRefreshTimers.delete(option.id);
          spkRefreshState.delete(option.id);
          renderSpeakers();
        }, REFRESH_DONE_DWELL_MS),
      );
    } catch (err) {
      if (isDisposed()) return;
      spkRefreshState.set(option.id, "error");
      log.error("reference_voice_update_failed", { id: option.id, error: String(err) });
      renderSpeakers();
    }
  }

  // 화자 radiogroup 키보드 — div[role=radio]라 직접 배선한다.
  // manual-activation: 화살표는 roving focus 이동만, Enter/Space가 커밋 — 매 화살표마다 ▶ 미리듣기/스왑 비용을 피한다.
  function handleSpkKeydown(e: KeyboardEvent): void {
    if (spkSwapping !== null) return;
    // 인라인 이름 편집 입력의 키는 입력 자체가 처리한다 — 라디오 키보드로 새지 않게 막는다.
    if ((e.target as HTMLElement).closest(".yui-spk--renaming")) return;
    const target = (e.target as HTMLElement).closest<HTMLDivElement>(".yui-spk[role=radio]");
    if (!target) return;
    const rows = Array.from(spksEl.querySelectorAll<HTMLDivElement>(".yui-spk[role=radio]"));
    if (rows.length === 0) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const opt = speakerSelection.list().find((o) => o.id === target.dataset.spkId);
      if (opt) void swapToSpeaker(opt);
      return;
    }

    const current = Math.max(0, rows.indexOf(target));
    let next = -1;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = current + 1;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = current - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = rows.length - 1;
    else return;
    e.preventDefault();
    const wrapped = (next + rows.length) % rows.length;
    const focusTarget = rows[wrapped];
    spkRovedId = focusTarget.dataset.spkId ?? null;
    // roving tabindex 이동: 새 행만 0, 나머지 -1.
    for (const r of rows) r.tabIndex = -1;
    focusTarget.tabIndex = 0;
    focusTarget.focus();
    focusTarget.scrollIntoView?.({ block: "nearest" });
  }

  function handleAddClick(): void {
    if (!speakerControlsEnabled()) return;
    void importVoiceFlow();
  }

  function dispose(): void {
    stopAudition();
    for (const timer of spkRefreshTimers.values()) clearTimeout(timer);
    spkRefreshTimers.clear();
    spkRefreshState.clear();
  }

  return {
    render: renderSpeakers,
    handleKeydown: handleSpkKeydown,
    handleAddClick,
    isSwapping: () => spkSwapping !== null,
    stopAudition,
    dispose,
  };
}
