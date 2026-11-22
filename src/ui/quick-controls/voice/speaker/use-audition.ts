/** The speaker preview: one clip plays at a time, and playing another or the same row again stops it. */

import { useCallback, useEffect, useRef, useState } from "react";
import { resolveReferenceClipUrl } from "../../../../io/voice/voices/reference-clip";

export function useAudition() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  // The row whose clip plays or is still resolving; the audio element once it plays.
  const playing = useRef<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback((): void => {
    audio.current?.pause();
    audio.current = null;
    playing.current = null;
    setPlayingId(null);
  }, []);

  function toggle(id: string, refUrl: string): void {
    // The same row again stops it.
    if (playing.current === id) {
      stop();
      return;
    }
    stop();
    // Claimed before the clip resolves, so a second click while it waits stops it.
    playing.current = id;
    setPlayingId(id);
    const fail = (): void => {
      if (playing.current === id) stop();
    };
    // The ref_url resolves to the asset protocol first, for bundled and user rows alike.
    void resolveReferenceClipUrl(refUrl)
      .then((url) => {
        // A different clip started or stopped while it waited.
        if (playing.current !== id) return;
        const clip = new Audio(url);
        clip.addEventListener("ended", () => {
          if (playing.current === id) stop();
        });
        audio.current = clip;
        // play() returns a Promise or, in some environments, undefined.
        try {
          const p = clip.play();
          if (p && typeof p.then === "function") p.catch(fail);
        } catch {
          fail();
        }
      })
      .catch(fail);
  }

  // A torn-down list leaves nothing playing.
  useEffect(
    () => () => {
      audio.current?.pause();
      audio.current = null;
      playing.current = null;
    },
    [],
  );

  return { playingId, toggle, stop };
}
