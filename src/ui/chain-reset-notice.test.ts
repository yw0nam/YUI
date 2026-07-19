/**
 * chain-reset-notice.test.ts — showChainResetNotice bubble display routine.
 */

import { describe, expect, it, vi } from "vitest";
import { showChainResetNotice } from "./chain-reset-notice";

describe("showChainResetNotice", () => {
  it("shows the chain.reset_notice text through the bubble in begin→push→end order", () => {
    const calls: string[] = [];
    const beginSpeech = vi.fn(() => calls.push("begin"));
    const pushSpeech = vi.fn(() => calls.push("push"));
    const endSpeech = vi.fn(() => calls.push("end"));
    const t = vi.fn((key: string) => `translated:${key}`);

    showChainResetNotice({ surfaces: { beginSpeech, pushSpeech, endSpeech }, t });

    expect(calls).toEqual(["begin", "push", "end"]);
    expect(t).toHaveBeenCalledWith("chain.reset_notice");
    expect(pushSpeech).toHaveBeenCalledWith("translated:chain.reset_notice");
  });
});
