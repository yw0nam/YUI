/** The per-row reference-voice refresh: its state, the done dwell timer, and the re-entry guard. */

import { useEffect, useRef, useState } from "react";
import type { SpeakerOption } from "../../../../io/voice/voices/speaker-selection";
import type { Logger } from "../../../../logger";

export type RefreshState = "refreshing" | "done" | "error";

const REFRESH_DONE_DWELL_MS = 2400;

export function useReferenceRefresh(deps: {
  /** Re-uploads the speaker's reference clip: a server-side update, the selection stays. */
  refreshSpeaker: (option: SpeakerOption) => Promise<void>;
  log: Logger;
}) {
  const { refreshSpeaker, log } = deps;
  const [states, setStates] = useState<Record<string, RefreshState>>({});
  // The guard reads the state before a render shows it.
  const current = useRef<Record<string, RefreshState>>({});
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const pending = timers.current;
    return () => {
      mounted.current = false;
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  function set(id: string, state: RefreshState | null): void {
    const next = { ...current.current };
    if (state === null) delete next[id];
    else next[id] = state;
    current.current = next;
    setStates(next);
  }

  async function refresh(option: SpeakerOption): Promise<void> {
    if (current.current[option.id] === "refreshing") return;
    const pendingTimer = timers.current.get(option.id);
    if (pendingTimer !== undefined) clearTimeout(pendingTimer);
    timers.current.delete(option.id);
    set(option.id, "refreshing");
    try {
      await refreshSpeaker(option);
      if (!mounted.current) return;
      set(option.id, "done");
      log.info("reference_voice_update", { id: option.id });
      // After a delay, the row returns to idle.
      timers.current.set(
        option.id,
        setTimeout(() => {
          timers.current.delete(option.id);
          set(option.id, null);
        }, REFRESH_DONE_DWELL_MS),
      );
    } catch (err) {
      if (!mounted.current) return;
      set(option.id, "error");
      log.error("reference_voice_update_failed", { id: option.id, error: String(err) });
    }
  }

  return { states, refresh };
}
