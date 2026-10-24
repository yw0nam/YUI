/**
 * Two-phase import flow for a user asset list: the pick stages a copy of the picked file on
 * the Rust side, so the pick owns a lifecycle. A naming row names the staged copy — Enter
 * commits it (uploads the staged copy under the typed name), Esc discards it. One picker at
 * a time; a pick that resolves after `dispose()` is discarded.
 */
import type { Logger } from "../../../logger";
import { t } from "../../i18n";

/** A staged-but-not-yet-named import: the naming row names it, Esc discards it. */
export interface PendingImport {
  stagedId: string;
  /** Seeds the naming row's input (the picked file's stem). */
  seedName: string;
  /** Removes the staged copy when the naming row is cancelled or the list torn down. */
  discard: () => Promise<void>;
}

export interface PendingImportConfig {
  pickImport: () => Promise<PendingImport | null>;
  commitImport: (stagedId: string, name: string) => Promise<void>;
  deriveId: (name: string) => string;
  isImportBlocked?: (id: string) => boolean;
  /** Whether a listed asset already holds this id — drives the overwrite warning. */
  hasId: (id: string) => boolean;
  importErrorEl: HTMLElement;
  log: Logger;
  logPrefix: string;
  i18nNamespace: string;
  /** Row renderer hooks: the list's class names the naming row reuses. */
  rowClasses: { renaming: string; tick: string; renameHint: string; overwriteWarn: string };
  render: () => void;
}

export interface PendingImportFlow {
  /** The pick step: one picker at a time; a resolved pick opens the naming row. */
  start(): Promise<void>;
  /** Esc on the naming row: discards the staged copy and closes the row. */
  cancel(): void;
  /** Enter on the naming row: uploads the staged copy under `name`. */
  commit(name: string): Promise<void>;
  renderRow(row: HTMLElement, pending: PendingImport): void;
  get(): PendingImport | null;
  isCommitting(): boolean;
  dispose(): void;
}

export function createPendingImport(cfg: PendingImportConfig): PendingImportFlow {
  let pendingImport: PendingImport | null = null;
  let picking = false;
  let disposed = false;
  let committing = false;

  function renderRow(row: HTMLElement, pending: PendingImport): void {
    row.classList.add(cfg.rowClasses.renaming);
    row.innerHTML = `
      <span class="${cfg.rowClasses.tick}" aria-hidden="true"></span>
      <span class="yui-input-wrap"><input class="yui-ep-input" type="text" aria-label="${t(`${cfg.i18nNamespace}.name_aria`)}" /></span>
      <span class="${cfg.rowClasses.renameHint}"><kbd>Enter</kbd> ${t(`${cfg.i18nNamespace}.rename_hint_save`)} · <kbd>Esc</kbd> ${t(`${cfg.i18nNamespace}.rename_hint_cancel`)}</span>
    `;
    const input = row.querySelector<HTMLInputElement>(".yui-ep-input")!;
    input.value = pending.seedName;
    // Committing a name whose derived id matches an existing one replaces that asset's file
    // outright. The seed comes from the picked filename, so the collision can be entirely
    // unintended — flag it live next to the hint rather than letting Enter silently overwrite.
    const hintEl = row.querySelector<HTMLElement>(`.${cfg.rowClasses.renameHint}`)!;
    const baseHint = hintEl.innerHTML;
    const syncOverwriteWarning = (): void => {
      const id = cfg.deriveId(input.value);
      const warnKey = cfg.isImportBlocked?.(id)
        ? "import_taken_warn"
        : cfg.hasId(id)
          ? "import_overwrite_warn"
          : null;
      hintEl.innerHTML = warnKey
        ? `${baseHint} · <span class="${cfg.rowClasses.overwriteWarn}">${t(`${cfg.i18nNamespace}.${warnKey}`)}</span>`
        : baseHint;
    };
    syncOverwriteWarning();
    input.addEventListener("input", syncOverwriteWarning);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void commit(input.value);
      } else if (e.key === "Escape") {
        // Escape cancels the import only — does not propagate to panel close (document Escape).
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
    });
    input.addEventListener("blur", () => {
      if (pendingImport === null) return; // Already cleaned up by commit/cancel
      void commit(input.value);
    });
  }

  // Remove the staged copy; a failure surfaces as a warning, never into UI code.
  function discardStaged(pending: PendingImport): void {
    void pending
      .discard()
      .catch((e) => cfg.log.warn(`${cfg.logPrefix}_import_discard_failed`, { error: String(e) }));
  }

  async function start(): Promise<void> {
    if (committing || picking || pendingImport !== null) return; // one picker at a time
    picking = true;
    cfg.importErrorEl.hidden = true;
    try {
      const picked = await cfg.pickImport();
      if (picked === null) return; // cancelled at the OS picker
      if (disposed) {
        discardStaged(picked);
        return;
      }
      pendingImport = picked;
      cfg.render();
    } catch (err) {
      cfg.importErrorEl.hidden = false;
      cfg.log.error(`${cfg.logPrefix}_import_failed`, { error: String(err) });
    } finally {
      picking = false;
    }
  }

  function cancel(): void {
    if (pendingImport === null) return;
    const pending = pendingImport;
    pendingImport = null;
    cfg.render();
    discardStaged(pending);
  }

  async function commit(name: string): Promise<void> {
    if (committing || pendingImport === null) return; // Reentrancy guard (see below for why it holds)
    if (cfg.isImportBlocked?.(cfg.deriveId(name))) return; // the warning stays; the row stays open
    const picked = pendingImport;
    // Clear BEFORE the first render — mirrors commitRename clearing renamingId before its render.
    // cfg.render() (next line) replaces the naming row's innerHTML, detaching the still-focused
    // input; a real browser fires `blur` on that SYNCHRONOUSLY, re-entering this function through
    // the input's blur listener. Clearing pendingImport (and setting committing=true) first means
    // that reentrant call's guard above sees the already-cleared state and no-ops instead of
    // double-committing the same import.
    pendingImport = null;
    committing = true;
    cfg.importErrorEl.hidden = true;
    cfg.render();
    try {
      await cfg.commitImport(picked.stagedId, name);
    } catch (err) {
      cfg.importErrorEl.hidden = false;
      cfg.log.error(`${cfg.logPrefix}_import_failed`, { error: String(err) });
    } finally {
      committing = false;
      cfg.render();
    }
  }

  function dispose(): void {
    disposed = true;
    if (pendingImport !== null) {
      const pending = pendingImport;
      pendingImport = null;
      discardStaged(pending);
    }
  }

  return {
    start,
    cancel,
    commit,
    renderRow,
    get: () => pendingImport,
    isCommitting: () => committing,
    dispose,
  };
}
