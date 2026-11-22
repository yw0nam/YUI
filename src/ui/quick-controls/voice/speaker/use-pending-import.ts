/** The two-phase import: the pick stages a copy, a naming row names it, Enter uploads it and Esc discards it. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Logger } from "../../../../logger";
import { t } from "../../../i18n";

/** A staged-but-not-yet-named import: the naming row names it, Esc discards it. */
export interface PendingImport {
  stagedId: string;
  /** Seeds the naming row's input (the picked file's stem). */
  seedName: string;
  /** Removes the staged copy when the naming row is cancelled or the list torn down. */
  discard: () => Promise<void>;
}

export function usePendingImport(deps: {
  /** Stages the picked file's copy; null on cancel at the OS picker. */
  pickImport: () => Promise<PendingImport | null>;
  /** Uploads the staged copy under the typed name, then adds the option and selects it. */
  commitImport: (stagedId: string, name: string) => Promise<void>;
  /** The id a typed name imports under. */
  deriveId: (name: string) => string;
  /** An id the import may not take: the naming row warns and Enter keeps it open. */
  isImportBlocked: (id: string) => boolean;
  /** Whether a listed option already holds this id: the naming row warns of the overwrite. */
  hasId: (id: string) => boolean;
  log: Logger;
  logPrefix: string;
  /** The i18n namespace of the warnings. */
  namespace: string;
  /** Redraws the list around each step, as any list redraw does. */
  repaint: () => void;
}) {
  const { pickImport, commitImport, deriveId, isImportBlocked, hasId, log, logPrefix } = deps;
  const [state, setState] = useState<{
    pending: PendingImport | null;
    committing: boolean;
    importError: boolean;
  }>({ pending: null, committing: false, importError: false });
  const pending = useRef<PendingImport | null>(null);
  const picking = useRef(false);
  const committing = useRef(false);
  const disposed = useRef(false);

  // Remove the staged copy; a failure surfaces as a warning, never into UI code.
  const discardStaged = useCallback(
    (staged: PendingImport): void => {
      void staged
        .discard()
        .catch((e) => log.warn(`${logPrefix}_import_discard_failed`, { error: String(e) }));
    },
    [log, logPrefix],
  );

  // A pick that resolves after the list is gone is discarded, and so is a naming row left open.
  useEffect(
    () => () => {
      disposed.current = true;
      if (pending.current === null) return;
      const staged = pending.current;
      pending.current = null;
      discardStaged(staged);
    },
    [discardStaged],
  );

  async function start(): Promise<void> {
    // One picker at a time.
    if (committing.current || picking.current || pending.current !== null) return;
    picking.current = true;
    setState((s) => ({ ...s, importError: false }));
    try {
      const picked = await pickImport();
      if (picked === null) return;
      if (disposed.current) {
        discardStaged(picked);
        return;
      }
      pending.current = picked;
      deps.repaint();
      setState((s) => ({ ...s, pending: picked }));
    } catch (err) {
      setState((s) => ({ ...s, importError: true }));
      log.error(`${logPrefix}_import_failed`, { error: String(err) });
    } finally {
      picking.current = false;
    }
  }

  function cancel(): void {
    if (pending.current === null) return;
    const staged = pending.current;
    pending.current = null;
    deps.repaint();
    setState((s) => ({ ...s, pending: null }));
    discardStaged(staged);
  }

  /** Whether the name was taken; a blocked id keeps the naming row open. */
  function commit(name: string): boolean {
    if (committing.current || pending.current === null) return true;
    if (isImportBlocked(deriveId(name))) return false;
    const staged = pending.current;
    // Cleared before the render: a blur fired by the row's removal finds nothing to commit again.
    pending.current = null;
    committing.current = true;
    deps.repaint();
    setState({ pending: null, committing: true, importError: false });
    void (async () => {
      try {
        await commitImport(staged.stagedId, name);
      } catch (err) {
        setState((s) => ({ ...s, importError: true }));
        log.error(`${logPrefix}_import_failed`, { error: String(err) });
      } finally {
        committing.current = false;
        deps.repaint();
        setState((s) => ({ ...s, committing: false }));
      }
    })();
    return true;
  }

  // Committing a name whose id matches a listed one replaces that clip outright, and the seed comes
  // from the picked filename, so the collision can be unintended: flag it live next to the hint.
  function warnFor(name: string): string | null {
    const id = deriveId(name);
    if (isImportBlocked(id)) return t(`${deps.namespace}.import_taken_warn`);
    return hasId(id) ? t(`${deps.namespace}.import_overwrite_warn`) : null;
  }

  return { ...state, start, cancel, commit, warnFor };
}
