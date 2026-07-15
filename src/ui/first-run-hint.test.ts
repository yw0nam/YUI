/**
 * first-run-hint.test.ts — maybeShowFirstRunHint decision/display routine.
 */

import { describe, expect, it, vi } from "vitest";
import { type FirstRunHintDeps, maybeShowFirstRunHint } from "./first-run-hint";

function fakeDeps(overrides: Partial<FirstRunHintDeps> = {}): {
  deps: FirstRunHintDeps;
  calls: string[];
  markSeen: ReturnType<typeof vi.fn>;
  t: ReturnType<typeof vi.fn>;
  beginSpeech: ReturnType<typeof vi.fn>;
  pushSpeech: ReturnType<typeof vi.fn>;
  endSpeech: ReturnType<typeof vi.fn>;
} {
  const calls: string[] = [];
  const beginSpeech = vi.fn(() => calls.push("begin"));
  const pushSpeech = vi.fn(() => calls.push("push"));
  const endSpeech = vi.fn(() => calls.push("end"));
  const markSeen = vi.fn(() => calls.push("markSeen"));
  const t = vi.fn((key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
  );

  const deps: FirstRunHintDeps = {
    seen: () => false,
    markSeen,
    surfaces: { beginSpeech, pushSpeech, endSpeech },
    hotkey: "CmdOrCtrl+Shift+Y",
    isMac: false,
    t,
    ...overrides,
  };

  return { deps, calls, markSeen, t, beginSpeech, pushSpeech, endSpeech };
}

describe("maybeShowFirstRunHint", () => {
  it("shows once and marks seen in begin→push→end→markSeen order", () => {
    const { deps, calls } = fakeDeps();

    expect(maybeShowFirstRunHint(deps)).toBe(true);
    expect(calls).toEqual(["begin", "push", "end", "markSeen"]);
  });

  it("does nothing and returns false when already seen", () => {
    const { deps, beginSpeech, pushSpeech, endSpeech, markSeen } = fakeDeps({
      seen: () => true,
    });

    expect(maybeShowFirstRunHint(deps)).toBe(false);
    expect(beginSpeech).not.toHaveBeenCalled();
    expect(pushSpeech).not.toHaveBeenCalled();
    expect(endSpeech).not.toHaveBeenCalled();
    expect(markSeen).not.toHaveBeenCalled();
  });

  it("uses hint.first_run with the formatted+escaped hotkey when a hotkey is set", () => {
    const { deps, pushSpeech, t } = fakeDeps({ hotkey: "CmdOrCtrl+Shift+Y", isMac: false });

    maybeShowFirstRunHint(deps);

    // Markdown escape uniformly applies to all CommonMark punctuation — marked converts \+ back to +.
    expect(t).toHaveBeenCalledWith("hint.first_run", { hotkey: "Ctrl\\+Shift\\+Y" });
    // The fake t stringifies vars with JSON, so backslashes get extra-escaped.
    expect(pushSpeech).toHaveBeenCalledWith('hint.first_run:{"hotkey":"Ctrl\\\\+Shift\\\\+Y"}');
  });

  it("falls back to hint.first_run_no_hotkey when the hotkey is empty/whitespace", () => {
    const { deps, pushSpeech, t } = fakeDeps({ hotkey: "   " });

    maybeShowFirstRunHint(deps);

    expect(t).toHaveBeenCalledWith("hint.first_run_no_hotkey");
    expect(pushSpeech).toHaveBeenCalledWith("hint.first_run_no_hotkey");
  });

  it("escapes markdown-special characters in the formatted hotkey before interpolation", () => {
    const { deps, t } = fakeDeps({ hotkey: "Ctrl+*", isMac: false });

    maybeShowFirstRunHint(deps);

    expect(t).toHaveBeenCalledWith("hint.first_run", { hotkey: "Ctrl\\+\\*" });
  });
});
