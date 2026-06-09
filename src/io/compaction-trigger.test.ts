/**
 * compaction-trigger.test.ts — TDD red for the pure hysteresis controller.
 *
 * Pins the contract for src/io/compaction-trigger.ts:
 *   createCompactionTrigger({ contextWindow?, thresholdRatio, resumeRatio, onTrigger })
 *     → { noteUsage(totalTokens), noteResult(CompactResult), reset() }
 *
 * Hysteresis: armed starts true; noteUsage fires onTrigger + disarms when
 * total ≥ window*threshold while armed; re-arms only when a later noteUsage
 * shows total < window*resume. skipped/error results keep it disarmed.
 */

import { describe, it, expect, vi } from "vitest";
import { createCompactionTrigger } from "./compaction-trigger";
import type { CompactResult } from "./session-compactor";

const WINDOW = 200_000;
const THRESHOLD = 0.7; // fire at ≥ 140_000
const RESUME = 0.5; // re-arm at < 100_000

function make(onTrigger = vi.fn(), contextWindow: number | undefined = WINDOW) {
  const trigger = createCompactionTrigger({
    contextWindow,
    thresholdRatio: THRESHOLD,
    resumeRatio: RESUME,
    onTrigger,
  });
  return { trigger, onTrigger };
}

describe("createCompactionTrigger — threshold firing", () => {
  it("fires onTrigger exactly once when usage first crosses the threshold", () => {
    const { trigger, onTrigger } = make();
    trigger.noteUsage(120_000); // below threshold
    expect(onTrigger).not.toHaveBeenCalled();
    trigger.noteUsage(140_000); // at threshold
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it("fires at exactly window*thresholdRatio (inclusive boundary)", () => {
    const { trigger, onTrigger } = make();
    trigger.noteUsage(WINDOW * THRESHOLD);
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it("does NOT re-fire on subsequent high turns while still high", () => {
    const { trigger, onTrigger } = make();
    trigger.noteUsage(150_000);
    trigger.noteUsage(160_000);
    trigger.noteUsage(199_000);
    expect(onTrigger).toHaveBeenCalledOnce();
  });
});

describe("createCompactionTrigger — re-arm via usage drop (hysteresis band)", () => {
  it("re-arms after usage drops below resumeRatio, then fires a second time", () => {
    const { trigger, onTrigger } = make();
    trigger.noteUsage(150_000); // fire #1, disarm
    expect(onTrigger).toHaveBeenCalledOnce();
    trigger.noteUsage(90_000); // < resume (100_000) → re-arm
    trigger.noteUsage(150_000); // fire #2
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it("usage in the hysteresis band (between resume and threshold) does NOT re-arm", () => {
    const { trigger, onTrigger } = make();
    trigger.noteUsage(150_000); // fire #1, disarm
    trigger.noteUsage(120_000); // band: ≥ resume, < threshold → no re-arm
    trigger.noteUsage(150_000); // still disarmed → no fire
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it("re-arm requires strictly below resumeRatio (boundary does not re-arm)", () => {
    const { trigger, onTrigger } = make();
    trigger.noteUsage(150_000); // fire #1
    trigger.noteUsage(WINDOW * RESUME); // == resume boundary → no re-arm
    trigger.noteUsage(150_000);
    expect(onTrigger).toHaveBeenCalledOnce();
  });
});

describe("createCompactionTrigger — result settling", () => {
  it("skipped result keeps it disarmed even if next turn is still high", () => {
    const { trigger, onTrigger } = make();
    trigger.noteUsage(150_000); // fire #1, disarm
    trigger.noteResult({ status: "skipped" } as CompactResult);
    trigger.noteUsage(160_000); // still high, disarmed → no fire
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it("error result keeps it disarmed (no tight retry loop)", () => {
    const { trigger, onTrigger } = make();
    trigger.noteUsage(150_000); // fire #1, disarm
    trigger.noteResult({ status: "error" } as CompactResult);
    trigger.noteUsage(160_000);
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it("compressed result needs no special handling — usage drop re-arms naturally", () => {
    const { trigger, onTrigger } = make();
    trigger.noteUsage(150_000); // fire #1
    trigger.noteResult({
      status: "compressed",
      session_id: "s2",
      before_tokens: 150_000,
      after_tokens: 60_000,
      removed: 90_000,
    });
    trigger.noteUsage(60_000); // drop below resume → re-arm
    trigger.noteUsage(150_000); // fire #2
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });
});

describe("createCompactionTrigger — no known context window", () => {
  it("never fires when contextWindow is undefined", () => {
    const { trigger, onTrigger } = make(vi.fn(), undefined);
    trigger.noteUsage(1_000_000);
    trigger.noteUsage(5_000_000);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("noteResult is a safe no-op with undefined contextWindow", () => {
    const { trigger, onTrigger } = make(vi.fn(), undefined);
    expect(() => trigger.noteResult({ status: "skipped" } as CompactResult)).not.toThrow();
    trigger.noteUsage(1_000_000);
    expect(onTrigger).not.toHaveBeenCalled();
  });
});

describe("createCompactionTrigger — reset", () => {
  it("re-arms after reset so the threshold fires again", () => {
    const { trigger, onTrigger } = make();
    trigger.noteUsage(150_000); // fire #1, disarm
    trigger.reset();
    trigger.noteUsage(150_000); // fire #2
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it("clears skipped-suppression so the next high turn fires", () => {
    const { trigger, onTrigger } = make();
    trigger.noteUsage(150_000); // fire #1
    trigger.noteResult({ status: "skipped" } as CompactResult);
    trigger.reset();
    trigger.noteUsage(150_000); // fire #2
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });
});
