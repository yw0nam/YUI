/**
 * Speaker list cluster — speaker radiogroup in Advanced tab irodori subview.
 * Mirrors VRM section but differs in one way: rows are div[role=radio], not <button>
 * (to hold nested ▶ preview <button> — button-in-button is invalid HTML, parser strips it).
 * So wires roving tabindex/Enter·Space/arrow keyboard directly.
 * Additionally owns reference-voice refresh + single audition preview.
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
  /** Panel root (el) — query .yui-spks / .yui-spk__import-error from here. */
  root: HTMLElement;
  speakerSelection: ReturnType<typeof createSpeakerSelection>;
  /** Perform actual speaker swap + commit store on success. Component does not call store.select directly. */
  swapSpeaker: (option: SpeakerOption) => Promise<void>;
  /** Refresh speaker reference voice (PUT /voices). Server-side update only — does not change speaker selection/store. */
  refreshSpeaker: (option: SpeakerOption) => Promise<void>;
  /** Full import flow: file select → register → addUserVoice + select. Inline error on reject. */
  importVoice: () => Promise<void>;
  /** Delete imported voice app-data file (idempotent). Called separately from store removal. */
  removeUserVoice: (id: string) => Promise<void>;
  /** Convert audition ref_url to fetchable URL (injectable). Default is resolveAssetUrl. */
  resolveAuditionUrl?: (refUrl: string) => Promise<string>;
  log: Logger;
  /** Speaker management is active only when effective voice engine is irodori. Gates when openai. */
  speakerControlsEnabled: () => boolean;
  /** After dispose, prevent in-flight refresh from re-rendering/timering on torn-down DOM. */
  isDisposed: () => boolean;
}

export interface SpeakerList {
  render(): void;
  handleKeydown(e: KeyboardEvent): void;
  handleAddClick(): void;
  /** Whether swap is in progress — used by entry's open-subscription guard. */
  isSwapping(): boolean;
  /** Stop audition (when panel closes). */
  stopAudition(): void;
  /** Permanent teardown — stop audition + clean refresh timers/state. */
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
  // User speaker id being renamed inline (null if none) · whether import is in progress.
  let spkRenamingId: string | null = null;
  let spkImporting = false;
  // Last row id where arrow roved — kept so re-render doesn't snap roving tabindex back to active.
  // Deliberately not reset in close() — re-open continues from roved row, guarded by ids.includes.
  let spkRovedId: string | null = null;

  // Per-row reference-voice refresh state — kept per-id so survives renderSpeakers re-render.
  type RefreshState = "refreshing" | "done" | "error";
  const spkRefreshState = new Map<string, RefreshState>();
  // Timer to revert "done" state to idle after delay (cleaned up on duplicate refresh/dispose).
  const spkRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function clearRefreshTimer(id: string): void {
    const t = spkRefreshTimers.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      spkRefreshTimers.delete(id);
    }
  }

  // Audition is single — playing one stops others.
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

  // Convert audition ref_url to fetchable URL (avoid /references/* 404 on packaging).
  // Tauri: absolute URL to bundled resource; dev/browser: pass through original — same resolver as irodori-voices.
  const resolveAudition = resolveAuditionUrl ?? resolveAssetUrl;

  function toggleAudition(btn: HTMLButtonElement, refUrl: string): void {
    if (auditionBtn === btn) {
      stopAudition(); // Same button re-click → toggle stop
      return;
    }
    stopAudition(); // If different clip is playing, stop it first
    btn.classList.add("is-playing");
    btn.innerHTML = SPK_PAUSE_SVG;
    auditionBtn = btn; // Preempt same button re-click while resolver waits so it toggles stop
    const fail = (): void => {
      if (auditionBtn === btn) stopAudition();
    };
    // Resolve ref_url to asset protocol first, then create Audio — for both bundled and user rows.
    void resolveAudition(refUrl)
      .then((url) => {
        if (auditionBtn !== btn) return; // Different clip started/stopped while waiting
        const audio = new Audio(url);
        audio.addEventListener("ended", () => {
          if (auditionBtn === btn) stopAudition();
        });
        auditionAudio = audio;
        // play() returns Promise or (old/some envs) undefined — handle both safely.
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
    // With openai engine, speaker management is inactive — actually disabled with real disabled attr (CSS dims).
    const controlsEnabled = speakerControlsEnabled();
    const activeId = speakerSelection.getActiveId();
    // Roving tabindex prioritizes last roved row — falls back to active if none.
    const ids = speakerSelection.list().map((o) => o.id);
    const rovedId = spkRovedId !== null && ids.includes(spkRovedId) ? spkRovedId : activeId;
    // Clean up edit state if row being edited no longer in list.
    if (spkRenamingId !== null && !ids.includes(spkRenamingId)) spkRenamingId = null;
    const hadFocus = spksEl.contains(document.activeElement);
    stopAudition(); // Re-render destroys audition button nodes, so clean audition
    spksEl.innerHTML = "";
    for (const opt of speakerSelection.list()) {
      const isUser = opt.source === "user";
      const row = document.createElement("div");
      row.setAttribute("role", "radio");
      row.className = "yui-spk";
      row.dataset.spkId = opt.id;
      const selected = opt.id === activeId;
      row.setAttribute("aria-checked", String(selected));
      // When inactive (openai), all rows get -1 to skip Tab navigation.
      row.tabIndex = controlsEnabled ? (opt.id === rovedId ? 0 : -1) : -1;

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
      // User rows add ✎ rename · 🗑 remove buttons before ↻/▶.
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
      // Label may be untrusted input — set via textContent only.
      const nameEl = row.querySelector<HTMLSpanElement>(".yui-spk__name")!;
      nameEl.textContent = label;
      if (isUser) {
        const renameBtn = row.querySelector<HTMLButtonElement>(".yui-spk__rename")!;
        renameBtn.disabled = !controlsEnabled;
        renameBtn.addEventListener("click", (e) => {
          e.stopPropagation(); // Rename does not trigger row selection
          if (speakerControlsEnabled()) startSpkRename(opt.id);
        });
        const removeBtn = row.querySelector<HTMLButtonElement>(".yui-spk__remove")!;
        removeBtn.disabled = !controlsEnabled;
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation(); // Remove does not trigger row selection
          if (speakerControlsEnabled()) void removeUserSpeaker(opt.id);
        });
      }
      const refreshBtn = row.querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
      refreshBtn.disabled = !controlsEnabled || !hasClip;
      refreshBtn.setAttribute("aria-label", t("aria.refresh_speaker", { name: label }));
      refreshBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // Refresh does not trigger row selection
        if (hasClip) void refreshTo(opt);
      });
      const previewBtn = row.querySelector<HTMLButtonElement>(".yui-spk__preview")!;
      previewBtn.disabled = !controlsEnabled || !hasClip;
      previewBtn.setAttribute("aria-label", t("aria.preview_speaker", { name: label }));
      previewBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // Preview does not trigger row selection
        if (hasClip) toggleAudition(previewBtn, opt.ref_url);
      });

      row.addEventListener("click", () => {
        if (!speakerControlsEnabled()) return; // Row selection inactive with openai
        void swapToSpeaker(opt);
      });

      // Reflect saved refresh state in visuals/aria even after re-render.
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

    // If import is in progress, append spinner placeholder row at end (not radio).
    if (spkImporting) {
      const loading = document.createElement("div");
      loading.className = "yui-spk__loading";
      loading.setAttribute("role", "status");
      loading.innerHTML = `<span class="yui-spk__spin" aria-hidden="true"></span><span class="yui-spk__loading-name">${t("speaker.loading")}</span>`;
      spksEl.appendChild(loading);
    }

    // If editing, focus input and exit (takes precedence over restoring roving focus).
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

  // Render user speaker row in inline rename mode — label becomes input, hint follows.
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
        // Escape cancels rename only — does not propagate to panel close (document Escape).
        e.preventDefault();
        e.stopPropagation();
        cancelSpkRename();
      }
    });
    // On blur, commit nonempty value.
    input.addEventListener("blur", () => {
      if (spkRenamingId !== opt.id) return; // Already cleaned up by commit/cancel
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
    // Empty/whitespace label is rejected by store (keeps existing label). Change triggers store subscription re-render.
    speakerSelection.renameUserVoice(id, label);
    log.info("voice_rename", { id });
    renderSpeakers();
  }

  // Remove user speaker — delete file first (success required, no store/disk mismatch to prevent 422), then
  // remove from store and swap to fallback if it was active.
  async function removeUserSpeaker(id: string): Promise<void> {
    const wasActive = speakerSelection.getActiveId() === id;
    log.info("voice_delete", { id });
    try {
      await removeUserVoice(id);
    } catch (err) {
      // File delete failed — do not commit store removal, keep row (maintain disk match).
      log.error("voice_delete_failed", { id, error: String(err) });
      return;
    }
    speakerSelection.removeUserVoice(id); // Falls back to default if was active + notify
    // Non-active removal does not notify store, so re-render list directly.
    if (!wasActive) {
      renderSpeakers();
      return;
    }
    // Active delete — load fallback speaker into server (store already points to default).
    try {
      await swapSpeaker(speakerSelection.getActive());
    } catch (err) {
      log.error("voice_fallback_swap_failed", { error: String(err) });
      renderSpeakers(); // Swap failed, re-render list to match actual state.
    }
  }

  function setSpkImportError(show: boolean): void {
    spkImportErrorEl.hidden = !show;
  }

  // "Add from file…" — show importing row and delegate full import flow.
  // Success: store adds row (subscription → re-render); failure: show inline error.
  async function importVoiceFlow(): Promise<void> {
    if (spkImporting) return; // Prevent second import while in progress
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
    if (spkSwapping !== null) return; // Prevent second swap while in progress
    if (option.id === speakerSelection.getActiveId()) return; // Already active, no-op

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
      // Hide preview button during swap, show "swapping…" hint in its place.
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
      spkRovedId = option.id; // carry the roving tabindex over to the committed row
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

  // Reference voice refresh — server-side update only, do not change speaker selection/store.
  // Re-entry guard: ignore if the same id is already refreshing.
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
      // After a delay, reset to idle state (delete state + re-render).
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

  // Speaker radiogroup keyboard — wire directly as div[role=radio].
  // Manual-activation: arrows only move roving focus, Enter/Space commits — avoids preview/swap cost on every arrow.
  function handleSpkKeydown(e: KeyboardEvent): void {
    if (spkSwapping !== null) return;
    // Inline name editing input handles its own keys — prevent leaking to radio keyboard.
    if ((e.target as HTMLElement).closest(".yui-spk--renaming")) return;
    const target = (e.target as HTMLElement).closest<HTMLDivElement>(".yui-spk[role=radio]");
    if (!target) return;
    const rows = Array.from(spksEl.querySelectorAll<HTMLDivElement>(".yui-spk[role=radio]"));
    if (rows.length === 0) return;

    if (e.key === "Enter" || e.key === " ") {
      if (!speakerControlsEnabled()) return; // Disable row selection for OpenAI
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
    // Roving tabindex move: new row only 0, rest -1.
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
