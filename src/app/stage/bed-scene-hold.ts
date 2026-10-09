/** Whether the bed scene holds the body; the camera and the movers read it. */
export interface BedSceneHold {
  isHeld(): boolean;
  take(): void;
  release(): void;
  /** Called each time the scene takes the body; returns the unsubscribe. */
  onTake(listener: () => void): () => void;
}

export function createBedSceneHold(): BedSceneHold {
  let held = false;
  const listeners = new Set<() => void>();
  return {
    isHeld: () => held,
    take: () => {
      if (held) return;
      held = true;
      for (const listener of listeners) listener();
    },
    release: () => {
      held = false;
    },
    onTake: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
