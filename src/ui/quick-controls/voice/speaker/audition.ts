/** The speaker preview: one clip plays at a time, and the same row again stops it. */

import { resolveReferenceClipUrl } from "../../../../io/voice/voices/reference-clip";

export interface Audition {
  /** The row whose clip plays or is still resolving. */
  playingId(): string | null;
  subscribe(onChange: () => void): () => void;
  toggle(id: string, refUrl: string): void;
  stop(): void;
}

export function createAudition(): Audition {
  let playing: string | null = null;
  let audio: HTMLAudioElement | null = null;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const cb of listeners) cb();
  };

  function stop(): void {
    if (playing === null && audio === null) return;
    audio?.pause();
    audio = null;
    playing = null;
    notify();
  }

  function toggle(id: string, refUrl: string): void {
    if (playing === id) {
      stop();
      return;
    }
    stop();
    // Claimed before the clip resolves, so a second click while it waits stops it.
    playing = id;
    notify();
    const fail = (): void => {
      if (playing === id) stop();
    };
    // The ref_url resolves to the asset protocol first, for bundled and user rows alike.
    void resolveReferenceClipUrl(refUrl)
      .then((url) => {
        // A different clip started or stopped while it waited.
        if (playing !== id) return;
        const clip = new Audio(url);
        clip.addEventListener("ended", () => {
          if (playing === id) stop();
        });
        audio = clip;
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

  return {
    playingId: () => playing,
    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    toggle,
    stop,
  };
}
