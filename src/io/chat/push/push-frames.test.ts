/**
 * push-frames.test.ts — the fault checks name the field that makes a frame unreadable, in order.
 */

import { describe, expect, it } from "vitest";
import { renderFrameFault, speechFrameFault } from "./push-frames";

describe("push frame fault checks", () => {
  it("renderFrameFault names source when segments are readable but source is not a string", () => {
    const frame = { segments: [], source: 7, turn_id: "t" } satisfies Record<string, unknown>;
    expect(renderFrameFault(frame)).toBe("source");
  });

  it("renderFrameFault checks segments before source and turn_id, and readable frames pass", () => {
    const allBad = { segments: null, source: 7, turn_id: 7 } satisfies Record<string, unknown>;
    expect(renderFrameFault(allBad)).toBe("segments");
    const clean = { segments: [], source: "test", turn_id: "t" } satisfies Record<string, unknown>;
    expect(renderFrameFault(clean)).toBeNull();
    expect(
      speechFrameFault({ segments: [], turn_id: "t" } satisfies Record<string, unknown>),
    ).toBeNull();
  });
});
