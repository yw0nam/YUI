import type { ProactivePacer } from "./proactive-pacer";

/** The busy predicate a buffered-inbox source takes: the pipeline's own, plus the global gap. */
export interface PacedPipelineBusy {
  isBusy: () => boolean;
  subscribe: (cb: (busy: boolean) => void) => () => void;
}

/**
 * Compose pipeline-busy with the global proactive gap. The buffered-inbox sources hold their
 * items instead of skipping them, so a held window reads as busy and its opening is the
 * busy→idle edge that flushes one catchup.
 */
export function composePacedPipelineBusy(deps: {
  pipelineBusy: PacedPipelineBusy;
  pacer: Pick<ProactivePacer, "isHolding" | "subscribe">;
}): PacedPipelineBusy {
  const { pipelineBusy, pacer } = deps;
  const paced: PacedPipelineBusy = {
    isBusy: () => pipelineBusy.isBusy() || pacer.isHolding(),
    subscribe: (cb) => {
      const unsubscribeBusy = pipelineBusy.subscribe(() => cb(paced.isBusy()));
      const unsubscribePacer = pacer.subscribe(() => cb(paced.isBusy()));
      return () => {
        unsubscribeBusy();
        unsubscribePacer();
      };
    },
  };
  return paced;
}
