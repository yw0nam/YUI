import { describe, expect, it, vi } from "vitest";
import { composePacedPipelineBusy } from "./paced-pipeline-busy";

describe("composePacedPipelineBusy", () => {
  it("unsubscribes both upstreams and stops notifying afterwards", () => {
    const listeners = {
      pipeline: new Set<(busy: boolean) => void>(),
      pacer: new Set<(holding: boolean) => void>(),
    };
    const paced = composePacedPipelineBusy({
      pipelineBusy: {
        isBusy: () => false,
        subscribe: (cb) => {
          listeners.pipeline.add(cb);
          return () => listeners.pipeline.delete(cb);
        },
      },
      pacer: {
        isHolding: () => false,
        subscribe: (cb) => {
          listeners.pacer.add(cb);
          return () => listeners.pacer.delete(cb);
        },
      },
    });
    const cb = vi.fn();

    const unsubscribe = paced.subscribe(cb);
    for (const l of listeners.pipeline) l(true);
    for (const l of listeners.pacer) l(true);
    expect(cb).toHaveBeenCalledTimes(2);

    unsubscribe();
    expect(listeners.pipeline.size).toBe(0);
    expect(listeners.pacer.size).toBe(0);
  });
});
