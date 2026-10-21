/** One voice at a time across windows: an exclusive Web Lock held from an utterance's first sound to its end. */
export const VOICE_LOCK_NAME = "yui.speaking";

export interface VoiceGate {
  /** Resolves once this window may play: at once when the gate is off, when no lock manager exists, or when the signal is already aborted; an abort while waiting resolves without holding. */
  acquire(signal: AbortSignal): Promise<void>;
  /** Ends the hold; a no-op when nothing is held. */
  release(): void;
}

export function createVoiceGate(deps: {
  enabled: () => boolean;
  locks?: Pick<LockManager, "request">;
}): VoiceGate {
  const locks = deps.locks ?? globalThis.navigator?.locks;
  let release: (() => void) | undefined;
  return {
    acquire(signal) {
      if (!deps.enabled() || !locks || signal.aborted) return Promise.resolve();
      return new Promise<void>((granted) => {
        // The lock stays held while the callback's promise is pending, so release() is what frees it.
        locks
          .request(VOICE_LOCK_NAME, { signal }, () => {
            granted();
            return new Promise<void>((r) => {
              release = r;
            });
          })
          .catch(() => granted());
      });
    },
    release() {
      release?.();
      release = undefined;
    },
  };
}
