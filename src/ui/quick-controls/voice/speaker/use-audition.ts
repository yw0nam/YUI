/** The audition's playing row for a list, and the two rules that stop it: a swap starts, the row leaves the list. */

import { useEffect, useSyncExternalStore } from "react";
import type { Audition } from "./audition";

export function useAudition(
  audition: Audition,
  list: { swapping: boolean; ids: readonly string[] },
): string | null {
  const playingId = useSyncExternalStore(audition.subscribe, audition.playingId);
  const gone = playingId !== null && !list.ids.includes(playingId);
  useEffect(() => {
    // A swap hides the busy row's preview button.
    if (list.swapping || gone) audition.stop();
  }, [audition, list.swapping, gone]);
  return playingId;
}
