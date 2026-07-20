export interface MotionStartGeneration {
  begin(): number;
  invalidate(): void;
  isCurrent(token: number): boolean;
}

/** Track which asynchronous motion start still owns mixer playback. */
export function createMotionStartGeneration(): MotionStartGeneration {
  let generation = 0;
  return {
    begin: () => ++generation,
    invalidate: () => {
      generation += 1;
    },
    isCurrent: (token) => token === generation,
  };
}
