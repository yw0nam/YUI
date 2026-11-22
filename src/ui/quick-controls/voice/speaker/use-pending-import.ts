/** The two-phase import: the pick stages a copy, a naming row names it, Enter uploads it and Esc discards it. */

import { useCallback, useEffect, useRef, useState } from "react";
import { voiceIdFromName } from "../../../../io/assets/safe-id";
import type { PickedVoiceImport } from "../../../../io/voice/voices/voice-import-flow";
import type { Logger } from "../../../../logger";
import { t } from "../../../i18n";

export function usePendingImport(deps: {
  /** Stages the picked file's copy; null on cancel at the OS picker. */
  pickImport: () => Promise<PickedVoiceImport | null>;
  /** Uploads the staged copy under the typed name, then adds the option and selects it. */
  commitImport: (stagedId: string, name: string) => Promise<void>;
  /** An id the import may not take: the naming row warns and Enter keeps it open. */
  isImportBlocked: (id: string) => boolean;
  /** Whether a listed option already holds this id: the naming row warns of the overwrite. */
  hasId: (id: string) => boolean;
  log: Logger;
  /** Redraws the list around each step, as any list redraw does. */
  repaint: () => void;
}) {
  const { pickImport, commitImport, isImportBlocked, hasId, log } = deps;
  const [state, setState] = useState<{
    pending: PickedVoiceImport | null;
    committing: boolean;
    importError: boolean;
  }>({ pending: null, committing: false, importError: false });
  const pending = useRef<PickedVoiceImport | null>(null);
  const picking = useRef(false);
  const committing = useRef(false);
  const disposed = useRef(false);

  // Remove the staged copy; a failure surfaces as a warning, never into UI code.
  const discardStaged = useCallback(
    (staged: PickedVoiceImport): void => {
      void staged
        .discard()
        .catch((e) => log.warn(`voice_import_discard_failed`, { error: String(e) }));
    },
    [log],
  );

  // A pick that resolves after the list is gone is discarded, and so is a naming row left open.
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      if (pending.current === null) return;
      const staged = pending.current;
      pending.current = null;
      discardStaged(staged);
    };
  }, [discardStaged]);

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
      log.error(`voice_import_failed`, { error: String(err) });
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
    if (isImportBlocked(voiceIdFromName(name))) return false;
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
        log.error(`voice_import_failed`, { error: String(err) });
      } finally {
        committing.current = false;
        deps.repaint();
        setState((s) => ({ ...s, committing: false }));
      }
    })();
    return true;
  }

  // A name whose id matches a listed one replaces that clip, and the seed is the filename: warn live.
  function warnFor(name: string): string | null {
    const id = voiceIdFromName(name);
    if (isImportBlocked(id)) return t(`speaker.import_taken_warn`);
    return hasId(id) ? t(`speaker.import_overwrite_warn`) : null;
  }

  return { ...state, start, cancel, commit, warnFor };
}
