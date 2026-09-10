// @vitest-environment jsdom
/**
 * Tests for src/ui/summon-key.ts — the focused window's "/" opens its text input.
 * Both bootstraps bind this, so the guards live here rather than in either entry point.
 */

import { describe, expect, it, vi } from "vitest";
import { attachSummonKey } from "./summon-key";

function fakeSurfaces(opts: { inputOpen?: boolean } = {}) {
  return {
    isInputOpen: vi.fn(() => opts.inputOpen ?? false),
    summonInput: vi.fn(),
  };
}

/** Dispatches a keydown on window and hands back the event so the test can read preventDefault. */
function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const e = new KeyboardEvent("keydown", { key, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e;
}

describe("attachSummonKey", () => {
  it("summons the input on a bare / and swallows the keystroke", () => {
    const surfaces = fakeSurfaces();
    const detach = attachSummonKey(surfaces);
    const e = press("/");
    expect(surfaces.summonInput).toHaveBeenCalledOnce();
    expect(e.defaultPrevented).toBe(true);
    detach();
  });

  it("leaves a modified / alone (Cmd+/ belongs to whatever else claims it)", () => {
    const surfaces = fakeSurfaces();
    const detach = attachSummonKey(surfaces);
    const e = press("/", { metaKey: true });
    expect(surfaces.summonInput).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
    detach();
  });

  it("stops listening once the returned detach runs", () => {
    const surfaces = fakeSurfaces();
    const detach = attachSummonKey(surfaces);
    detach();
    press("/");
    expect(surfaces.summonInput).not.toHaveBeenCalled();
  });
});
