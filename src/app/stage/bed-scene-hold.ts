/** Whether the bed scene holds the body; the camera and the movers read it. */
export interface BedSceneHold {
  isHeld(): boolean;
  take(): void;
  release(): void;
}

export function createBedSceneHold(): BedSceneHold {
  let held = false;
  return {
    isHeld: () => held,
    take: () => {
      held = true;
    },
    release: () => {
      held = false;
    },
  };
}
