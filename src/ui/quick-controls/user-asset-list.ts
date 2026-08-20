/**
 * Shared "user-managed asset list" scaffolding for the VRM and speaker radiogroups:
 * inline rename FSM, delete-file-then-store removal with active-fallback swap, a
 * reentrancy-guarded import flow with inline error, row lookup, roving-tabindex keyboard
 * nav, and the swap orchestration (busy state + error row id). Domain-specific rendering
 * (row markup, refresh/audition, controls-enabled gating of markup) stays in the caller;
 * this module owns only the state + control flow that is identical across domains.
 */
import "./user-asset-list.css";

import type { Logger } from "../../logger";
import { t } from "../i18n";

interface UserAssetOption {
  id: string;
  label?: string;
}

/** A picked-but-not-yet-copied import, awaiting a typed name from the naming row. */
export interface PendingImport {
  srcPath: string;
  /** Seeds the naming row's input (typically the picked file's stem). */
  seedName: string;
}

export interface UserAssetListConfig<T extends UserAssetOption> {
  /** Row container element (e.g. .yui-vrms / .yui-spks). */
  containerEl: HTMLElement;
  /** Import inline-error paragraph element (.hidden toggled). */
  importErrorEl: HTMLElement;
  /** CSS class prefix, e.g. "yui-vrm" / "yui-spk" — derives row/body/hint/renaming selectors. */
  classPrefix: string;
  /** Row dataset property holding the id, e.g. "vrmId" / "spkId". */
  datasetKey: string;
  /** i18n key namespace — resolves `${ns}.swapping`, `${ns}.name_aria`, `${ns}.rename_hint_save`, `${ns}.rename_hint_cancel`. */
  i18nNamespace: string;
  /** Log event key prefix — resolves `${prefix}_rename`, `${prefix}_delete`, `${prefix}_delete_failed`, `${prefix}_fallback_swap_failed`, `${prefix}_import_failed`, `${prefix}_swap`, `${prefix}_swap_failed`. */
  logPrefix: string;
  log: Logger;

  list: () => T[];
  getActiveId: () => string;
  getActive: () => T;
  /** Renaming-input seed value: opt.label (VRM) vs opt.label ?? opt.id (speaker). */
  getLabel: (opt: T) => string;
  rename: (id: string, label: string) => void;
  removeFile: (id: string) => Promise<void>;
  removeFromStore: (id: string) => void;
  /** Perform the actual swap + commit store on success. */
  swap: (option: T) => Promise<void>;
  /** Predicts the native id a typed name imports under (sanitizeStem for VRM, voiceIdFromName for speaker) — drives the naming row's overwrite warning. */
  deriveId: (name: string) => string;
  /** One-shot import flow (VRM): file select → copy/load → addOption + select. Mutually exclusive with pickImport/commitImport. */
  importFn?: () => Promise<void>;
  /** Two-phase import pick step (speaker): opens the file picker, returns the source path + a naming-row seed (null on cancel). */
  pickImport?: () => Promise<PendingImport | null>;
  /** Two-phase import commit step (speaker): copy + register under the typed name, then addOption + select. */
  commitImport?: (srcPath: string, name: string) => Promise<void>;
  /** Domain's full list render — called after any state change that isn't reflected via store subscription. */
  render: () => void;
  /** Per-domain DOM tweak right after a row is marked aria-busy for swap, before the "swapping…" hint (speaker removes its preview button). */
  onRowBusy?: (row: HTMLElement) => void;
}

/** Roving tabindex resolution: prioritizes the last roved row, falls back to active if it's gone from the list. */
export function resolveRovedId(roved: string | null, ids: string[], activeId: string): string {
  return roved !== null && ids.includes(roved) ? roved : activeId;
}

function camelToKebab(key: string): string {
  return key.replace(/([A-Z])/g, "-$1").toLowerCase();
}

export function createUserAssetList<T extends UserAssetOption>(cfg: UserAssetListConfig<T>) {
  const renamingClass = `${cfg.classPrefix}--renaming`;
  const renamingSelector = `.${renamingClass}`;
  const radioSelector = `.${cfg.classPrefix}[role=radio]`;
  const bodySelector = `.${cfg.classPrefix}__body`;
  const tickClass = `${cfg.classPrefix}__tick`;
  const hintClass = `${cfg.classPrefix}__hint`;
  const renameHintClass = `${cfg.classPrefix}__rename-hint`;
  const overwriteWarnClass = `${cfg.classPrefix}__overwrite-warn`;
  const datasetAttr = camelToKebab(cfg.datasetKey);

  // Swapping id (guards duplicate swap) · last error row id (keeps inline guidance on re-render).
  let swappingId: string | null = null;
  let errorId: string | null = null;
  // Last row id where arrow roved — kept so re-render doesn't snap roving tabindex back to active.
  let rovedId: string | null = null;
  // User option id being renamed inline (null if none) · whether import is in progress.
  let renamingId: string | null = null;
  let importing = false;
  // Two-phase import: picked-but-not-yet-copied file awaiting a typed name (null if none pending).
  let pendingImport: PendingImport | null = null;

  function rowById(id: string): HTMLElement | null {
    return cfg.containerEl.querySelector<HTMLElement>(
      `.${cfg.classPrefix}[data-${datasetAttr}="${CSS.escape(id)}"]`,
    );
  }

  function startRename(id: string): void {
    renamingId = id;
    cfg.render();
  }

  function cancelRename(): void {
    if (renamingId === null) return;
    renamingId = null;
    cfg.render();
  }

  function commitRename(id: string, label: string): void {
    if (renamingId !== id) return;
    renamingId = null;
    // Empty/whitespace label is rejected by store (keeps existing label). Change triggers store subscription re-render.
    cfg.rename(id, label);
    cfg.log.info(`${cfg.logPrefix}_rename`, { id });
    cfg.render();
  }

  // Render user row in inline rename mode — label becomes input, hint follows.
  function renderRenamingRow(row: HTMLElement, opt: T): void {
    row.classList.add(renamingClass);
    row.innerHTML = `
      <span class="${tickClass}" aria-hidden="true"></span>
      <span class="yui-input-wrap"><input class="yui-ep-input" type="text" aria-label="${t(`${cfg.i18nNamespace}.name_aria`)}" /></span>
      <span class="${renameHintClass}"><kbd>Enter</kbd> ${t(`${cfg.i18nNamespace}.rename_hint_save`)} · <kbd>Esc</kbd> ${t(`${cfg.i18nNamespace}.rename_hint_cancel`)}</span>
    `;
    const input = row.querySelector<HTMLInputElement>(".yui-ep-input")!;
    input.value = cfg.getLabel(opt);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitRename(opt.id, input.value);
      } else if (e.key === "Escape") {
        // Escape cancels rename only — does not propagate to panel close (document Escape).
        e.preventDefault();
        e.stopPropagation();
        cancelRename();
      }
    });
    // On blur, commit nonempty value.
    input.addEventListener("blur", () => {
      if (renamingId !== opt.id) return; // Already cleaned up by commit/cancel
      commitRename(opt.id, input.value);
    });
  }

  // Render the not-yet-imported pending row in the same inline naming presentation as
  // renderRenamingRow — seeded with the file stem, text selected (see focusIfRenaming). Enter
  // commits the import (copy + register under the typed name); Esc cancels the whole import —
  // nothing was copied yet, so nothing to clean up.
  function renderPendingImportRow(row: HTMLElement, pending: PendingImport): void {
    row.classList.add(renamingClass);
    row.innerHTML = `
      <span class="${tickClass}" aria-hidden="true"></span>
      <span class="yui-input-wrap"><input class="yui-ep-input" type="text" aria-label="${t(`${cfg.i18nNamespace}.name_aria`)}" /></span>
      <span class="${renameHintClass}"><kbd>Enter</kbd> ${t(`${cfg.i18nNamespace}.rename_hint_save`)} · <kbd>Esc</kbd> ${t(`${cfg.i18nNamespace}.rename_hint_cancel`)}</span>
    `;
    const input = row.querySelector<HTMLInputElement>(".yui-ep-input")!;
    input.value = pending.seedName;
    // Committing a name whose derived id matches an existing one replaces that asset's file
    // outright. The seed comes from the picked filename, so the collision can be entirely
    // unintended — flag it live next to the hint rather than letting Enter silently overwrite.
    const hintEl = row.querySelector<HTMLElement>(`.${renameHintClass}`)!;
    const baseHint = hintEl.innerHTML;
    const syncOverwriteWarning = (): void => {
      const id = cfg.deriveId(input.value);
      const collides = cfg.list().some((o) => o.id === id);
      hintEl.innerHTML = collides
        ? `${baseHint} · <span class="${overwriteWarnClass}">${t(`${cfg.i18nNamespace}.import_overwrite_warn`)}</span>`
        : baseHint;
    };
    syncOverwriteWarning();
    input.addEventListener("input", syncOverwriteWarning);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commitPendingImport(input.value);
      } else if (e.key === "Escape") {
        // Escape cancels the import only — does not propagate to panel close (document Escape).
        e.preventDefault();
        e.stopPropagation();
        cancelPendingImport();
      }
    });
    input.addEventListener("blur", () => {
      if (pendingImport === null) return; // Already cleaned up by commit/cancel
      void commitPendingImport(input.value);
    });
  }

  // Remove user option — delete file first (success required, no store/disk mismatch), then
  // remove from store and swap to fallback if it was active.
  async function remove(id: string): Promise<void> {
    const wasActive = cfg.getActiveId() === id;
    cfg.log.info(`${cfg.logPrefix}_delete`, { id });
    try {
      await cfg.removeFile(id);
    } catch (err) {
      // File delete failed — do not commit store removal, keep row (maintain disk match).
      cfg.log.error(`${cfg.logPrefix}_delete_failed`, { id, error: String(err) });
      return;
    }
    cfg.removeFromStore(id); // Falls back to default if was active + notify
    // Non-active removal does not notify store, so re-render list directly.
    if (!wasActive) {
      cfg.render();
      return;
    }
    // Active delete — load fallback option (store already points to default).
    try {
      await cfg.swap(cfg.getActive());
    } catch (err) {
      cfg.log.error(`${cfg.logPrefix}_fallback_swap_failed`, { error: String(err) });
      cfg.render(); // Swap failed, re-render list to match actual state.
    }
  }

  // "Add from file…" — show importing row and delegate the one-shot import flow (VRM).
  // Success: store adds row (subscription → re-render); failure: show inline error.
  async function runImport(): Promise<void> {
    if (importing) return; // Prevent second import while in progress
    importing = true;
    cfg.importErrorEl.hidden = true;
    cfg.render();
    try {
      await cfg.importFn!();
    } catch (err) {
      cfg.importErrorEl.hidden = false;
      cfg.log.error(`${cfg.logPrefix}_import_failed`, { error: String(err) });
    } finally {
      importing = false;
      cfg.render();
    }
  }

  // "Add from file…" pick step (speaker) — opens the file picker only. A naming row then
  // appears (see renderPendingImportRow), seeded with the picked file's stem.
  async function startPendingImport(): Promise<void> {
    if (importing || pendingImport !== null) return; // Prevent a second pick while one is in flight
    const picked = await cfg.pickImport!();
    if (picked === null) return; // cancelled at the OS picker
    pendingImport = picked;
    cfg.render();
  }

  // Esc on the naming row — cancels the whole import. Nothing was copied yet, so nothing to clean up.
  function cancelPendingImport(): void {
    if (pendingImport === null) return;
    pendingImport = null;
    cfg.render();
  }

  // Enter on the naming row — copy + register under the typed name, then addOption + select
  // (performed by cfg.commitImport). Failure shows the inline error, same as the one-shot flow.
  async function commitPendingImport(name: string): Promise<void> {
    if (importing || pendingImport === null) return; // Reentrancy guard (see below for why it holds)
    const picked = pendingImport;
    // Clear BEFORE the first render — mirrors commitRename clearing renamingId before its render.
    // cfg.render() (next line) replaces the naming row's innerHTML, detaching the still-focused
    // input; a real browser fires `blur` on that SYNCHRONOUSLY, re-entering this function through
    // the input's blur listener. Clearing pendingImport (and setting importing=true) first means
    // that reentrant call's guard above sees the already-cleared state and no-ops instead of
    // double-committing the same import.
    pendingImport = null;
    importing = true;
    cfg.importErrorEl.hidden = true;
    cfg.render();
    try {
      await cfg.commitImport!(picked.srcPath, name);
    } catch (err) {
      cfg.importErrorEl.hidden = false;
      cfg.log.error(`${cfg.logPrefix}_import_failed`, { error: String(err) });
    } finally {
      importing = false;
      cfg.render();
    }
  }

  async function swapTo(option: T): Promise<void> {
    if (swappingId !== null) return; // Prevent second swap while in progress
    if (option.id === cfg.getActiveId()) return; // Already active, no-op

    // If previous error shown, clear it first (re-render removes inline guidance).
    if (errorId !== null) {
      errorId = null;
      cfg.render();
    }
    swappingId = option.id;

    // Reflect loading: "swapping…" + spinner on clicked row, group locked with busy.
    // Mutate row in-place so caller's node reference persists (no re-render).
    cfg.containerEl.setAttribute("aria-busy", "true");
    cfg.containerEl.classList.add("is-swapping");
    const row = rowById(option.id);
    if (row) {
      row.setAttribute("aria-busy", "true");
      cfg.onRowBusy?.(row);
      const body = row.querySelector(bodySelector);
      if (body && !row.querySelector(`.${hintClass}`)) {
        const hint = document.createElement("span");
        hint.className = hintClass;
        hint.textContent = t(`${cfg.i18nNamespace}.swapping`);
        body.insertAdjacentElement("afterend", hint);
      }
    }

    try {
      await cfg.swap(option);
      rovedId = option.id; // Continue roving tabindex from committed row
      cfg.log.info(`${cfg.logPrefix}_swap`, { id: option.id });
      // Success: swap committed store, subscription moves active row. Unlock, then re-render.
    } catch (err) {
      errorId = option.id;
      cfg.log.error(`${cfg.logPrefix}_swap_failed`, { id: option.id, error: String(err) });
      // Failure: selection stays (no revert, store unchanged). Error row + inline guidance.
    } finally {
      swappingId = null;
      cfg.containerEl.removeAttribute("aria-busy");
      cfg.containerEl.classList.remove("is-swapping");
      cfg.render();
    }
  }

  // Radiogroup keyboard — Enter/Space selects (swaps), arrows move roving focus only (wraps), Home/End jump ends.
  function handleKeydown(e: KeyboardEvent): void {
    if (swappingId !== null) return;
    // Inline rename input handles its own keys — guard so it doesn't leak to radio keyboard.
    if ((e.target as HTMLElement).closest(renamingSelector)) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>(radioSelector);
    if (!target) return;
    const rows = Array.from(cfg.containerEl.querySelectorAll<HTMLElement>(radioSelector));
    if (rows.length === 0) return;

    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const id = target.dataset[cfg.datasetKey];
      const opt = cfg.list().find((o) => o.id === id);
      if (opt) void swapTo(opt);
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
    rovedId = focusTarget.dataset[cfg.datasetKey] ?? null;
    for (const r of rows) r.tabIndex = -1;
    focusTarget.tabIndex = 0;
    focusTarget.focus();
    focusTarget.scrollIntoView?.({ block: "nearest" });
  }

  function handleAddClick(): void {
    if (cfg.pickImport) void startPendingImport();
    else void runImport();
  }

  // Prune stale renaming id if the row it points to left the list.
  function reconcileRenaming(ids: string[]): void {
    if (renamingId !== null && !ids.includes(renamingId)) renamingId = null;
  }

  // If editing (rename OR the pending-import naming row — both carry renamingClass), focus the
  // input and report "handled" (domain render should return early — takes precedence over
  // restoring roving focus, even when the input node itself wasn't found).
  function focusIfRenaming(): boolean {
    if (renamingId === null && pendingImport === null) return false;
    const input = cfg.containerEl.querySelector<HTMLInputElement>(
      `${renamingSelector} .yui-ep-input`,
    );
    if (input) {
      input.focus();
      input.select();
    }
    return true;
  }

  return {
    getRenamingId: (): string | null => renamingId,
    getRovedId: (): string | null => rovedId,
    getErrorId: (): string | null => errorId,
    getPendingImport: (): PendingImport | null => pendingImport,
    isImporting: (): boolean => importing,
    isSwapping: (): boolean => swappingId !== null,
    reconcileRenaming,
    focusIfRenaming,
    renderRenamingRow,
    renderPendingImportRow,
    rowById,
    startRename,
    remove,
    runImport,
    swapTo,
    handleKeydown,
    handleAddClick,
  };
}
