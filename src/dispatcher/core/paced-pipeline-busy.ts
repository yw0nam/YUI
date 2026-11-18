/** The busy predicate a buffered-inbox source takes: the pipeline's own, plus any hold composed on it. */
export interface PacedPipelineBusy {
  isBusy: () => boolean;
  subscribe: (cb: (busy: boolean) => void) => () => void;
}

/** A hold the busy predicate takes on: the proactive gap or do-not-disturb. */
export interface BusyHold {
  isHolding(): boolean;
  subscribe(cb: (holding: boolean) => void): () => void;
}

/**
 * Compose pipeline-busy with a hold: the proactive gap or do-not-disturb. The buffered-inbox
 * sources hold their items instead of skipping them, so a hold reads as busy and its end is the
 * busy→idle edge that flushes one catchup.
 */
export function composePacedPipelineBusy(deps: {
  pipelineBusy: PacedPipelineBusy;
  hold: BusyHold;
}): PacedPipelineBusy {
  const { pipelineBusy, hold } = deps;
  const paced: PacedPipelineBusy = {
    isBusy: () => pipelineBusy.isBusy() || hold.isHolding(),
    subscribe: (cb) => {
      const unsubscribeBusy = pipelineBusy.subscribe(() => cb(paced.isBusy()));
      const unsubscribeHold = hold.subscribe(() => cb(paced.isBusy()));
      return () => {
        unsubscribeBusy();
        unsubscribeHold();
      };
    },
  };
  return paced;
}
