/**
 * Speaker list cluster — speaker radiogroup in the Advanced tab's TTS section.
 * Mirrors VRM section but differs in one way: rows are div[role=radio], not <button>
 * (to hold nested ▶ preview <button> — button-in-button is invalid HTML, parser strips it).
 * So wires roving tabindex/Enter·Space/arrow keyboard directly.
 * Additionally owns reference-voice refresh + single audition preview.
 */
import "./speaker-list.css";

import { resolveReferenceClipUrl } from "../../io/reference-clip";
import type { createSpeakerSelection, SpeakerOption } from "../../io/speaker-selection";
import type { Logger } from "../../logger";
import { t } from "../i18n";
import { createUserAssetList, resolveRovedId } from "./user-asset-list";

const SPK_PLAY_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const SPK_PAUSE_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="6" width="3.4" height="12" rx="0.8"/><rect x="13.6" y="6" width="3.4" height="12" rx="0.8"/></svg>`;
const SPK_REFRESH_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11a8 8 0 1 0-1.6 4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M20 5v5h-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SPK_CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SPK_NOTE_CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SPK_RENAME_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const SPK_REMOVE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>`;

const REFRESH_DONE_DWELL_MS = 2400;

interface SpeakerListDeps {
  /** Panel root (el) — query .yui-spks / .yui-spk__import-error from here. */
  root: HTMLElement;
  speakerSelection: ReturnType<typeof createSpeakerSelection>;
  /** Perform actual speaker swap + commit store on success. Component does not call store.select directly. */
  swapSpeaker: (option: SpeakerOption) => Promise<void>;
  /** Re-upload the speaker's reference clip. Server-side update only — does not change the selection. */
  refreshSpeaker: (option: SpeakerOption) => Promise<void>;
  /** Import pick step: opens the file picker, returns the source path + a naming-row seed (null on cancel). */
  pickVoiceImport: () => Promise<{ srcPath: string; seedName: string } | null>;
  /** Import commit step: copy + upload under the typed name → addUserOption + select. Inline error on reject. */
  commitVoiceImport: (srcPath: string, name: string) => Promise<void>;
  /** Delete imported voice app-data file (idempotent). Called separately from store removal. */
  removeUserVoice: (id: string) => Promise<void>;
  log: Logger;
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
    pickVoiceImport,
    commitVoiceImport,
    removeUserVoice,
    log,
    isDisposed,
  } = deps;
  const spksEl = deps.root.querySelector<HTMLDivElement>(".yui-spks")!;
  const spkImportErrorEl = deps.root.querySelector<HTMLParagraphElement>(".yui-spk__import-error")!;

  const list = createUserAssetList<SpeakerOption>({
    containerEl: spksEl,
    importErrorEl: spkImportErrorEl,
    classPrefix: "yui-spk",
    datasetKey: "spkId",
    i18nNamespace: "speaker",
    logPrefix: "voice",
    log,
    list: () => speakerSelection.list(),
    getActiveId: () => speakerSelection.getActiveId(),
    getActive: () => speakerSelection.getActive(),
    getLabel: (opt) => opt.label ?? opt.id,
    rename: (id, label) => speakerSelection.renameUserOption(id, label),
    removeFile: removeUserVoice,
    removeFromStore: (id) => speakerSelection.removeUserOption(id),
    swap: swapSpeaker,
    pickImport: pickVoiceImport,
    commitImport: commitVoiceImport,
    render: () => renderSpeakers(),
    onRowBusy: (row) => {
      // Hide preview button during swap, show "swapping…" hint in its place.
      row.querySelector(".yui-spk__preview")?.remove();
    },
  });

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
    void resolveReferenceClipUrl(refUrl)
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
    const activeId = speakerSelection.getActiveId();
    // Roving tabindex prioritizes last roved row — falls back to active if none.
    const ids = speakerSelection.list().map((o) => o.id);
    const rovedId = resolveRovedId(list.getRovedId(), ids, activeId);
    // Clean up edit state if row being edited no longer in list.
    list.reconcileRenaming(ids);
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
      row.tabIndex = opt.id === rovedId ? 0 : -1;

      if (isUser && opt.id === list.getRenamingId()) {
        list.renderRenamingRow(row, opt);
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
        renameBtn.addEventListener("click", (e) => {
          e.stopPropagation(); // Rename does not trigger row selection
          list.startRename(opt.id);
        });
        const removeBtn = row.querySelector<HTMLButtonElement>(".yui-spk__remove")!;
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation(); // Remove does not trigger row selection
          void list.remove(opt.id);
        });
      }
      const refreshBtn = row.querySelector<HTMLButtonElement>(".yui-spk__refresh")!;
      refreshBtn.disabled = !hasClip;
      refreshBtn.setAttribute("aria-label", t("aria.refresh_speaker", { name: label }));
      refreshBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // Refresh does not trigger row selection
        if (hasClip) void refreshTo(opt);
      });
      const previewBtn = row.querySelector<HTMLButtonElement>(".yui-spk__preview")!;
      previewBtn.disabled = !hasClip;
      previewBtn.setAttribute("aria-label", t("aria.preview_speaker", { name: label }));
      previewBtn.addEventListener("click", (e) => {
        e.stopPropagation(); // Preview does not trigger row selection
        if (hasClip) toggleAudition(previewBtn, opt.ref_url);
      });

      row.addEventListener("click", () => {
        void list.swapTo(opt);
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

      if (opt.id === list.getErrorId()) {
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

    // A picked-but-not-yet-copied import shows its naming row at the end (not a radio — it
    // isn't a selectable option yet). Hidden once commit starts, in favor of the spinner below.
    const pending = list.getPendingImport();
    if (pending !== null && !list.isImporting()) {
      const row = document.createElement("div");
      row.className = "yui-spk";
      list.renderPendingImportRow(row, pending);
      spksEl.appendChild(row);
    }

    // If import is in progress, append spinner placeholder row at end (not radio).
    if (list.isImporting()) {
      const loading = document.createElement("div");
      loading.className = "yui-spk__loading";
      loading.setAttribute("role", "status");
      loading.innerHTML = `<span class="yui-spk__spin" aria-hidden="true"></span><span class="yui-spk__loading-name">${t("speaker.loading")}</span>`;
      spksEl.appendChild(loading);
    }

    // If editing, focus input and exit (takes precedence over restoring roving focus).
    if (list.focusIfRenaming()) return;

    if (hadFocus) {
      const roved = list.rowById(rovedId);
      if (roved) {
        roved.focus();
        roved.scrollIntoView?.({ block: "nearest" });
      }
    }
  }

  // Reference clip re-upload — server-side update only, does not change the selection.
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

  function dispose(): void {
    stopAudition();
    for (const timer of spkRefreshTimers.values()) clearTimeout(timer);
    spkRefreshTimers.clear();
    spkRefreshState.clear();
  }

  return {
    render: renderSpeakers,
    handleKeydown: list.handleKeydown,
    handleAddClick: list.handleAddClick,
    isSwapping: list.isSwapping,
    stopAudition,
    dispose,
  };
}
