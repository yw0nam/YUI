// @vitest-environment jsdom
/**
 * Tests for surfaces.ts — the compose shim wiring speech-bubble.ts,
 * tool-status.ts, and text-input.ts behind createSurfaces(). Per-surface
 * behavior is tested alongside its module (speech-bubble.test.ts,
 * tool-status.test.ts, text-input.test.ts); this file covers the
 * cross-surface coordination the shim owns.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// CSS imports are not handled in jsdom — mock them
vi.mock("./surfaces.css", () => ({}));
vi.mock("./tokens.css", () => ({}));

import { createSurfaces } from "./surfaces";

function makeSurfaces() {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const s = createSurfaces({ mount });
  return { s, mount };
}

describe("bubble ↔ input coordination — input must not obscure the bubble", () => {
  let mount: HTMLElement;
  let s: ReturnType<typeof createSurfaces>;

  beforeEach(() => {
    ({ s, mount } = makeSurfaces());
  });

  afterEach(() => {
    s.dispose();
    mount.remove();
  });

  function bubble(): HTMLElement {
    return mount.querySelector(".yui-bubble") as HTMLElement;
  }
  function form(): HTMLElement {
    return mount.querySelector(".yui-input") as HTMLElement;
  }

  it("lifts the bubble above the input while the input is open", () => {
    s.beginSpeech();
    s.pushSpeech("I am speaking while you open the input.");
    // anchor the input near the feet, then summon it
    s.setInputAnchor(40);
    s.summonInput();

    // form is revealed synchronously (is-open is rAF-gated, so check hidden)
    expect(form().hidden).toBe(false);
    // bubble enters an input-aware mode and gets a lifted bottom anchor
    expect(bubble().classList.contains("is-above-input")).toBe(true);
    expect(bubble().style.getPropertyValue("--yui-bubble-bottom")).not.toBe("");
  });

  it("restores the bubble's normal position when the input closes", () => {
    s.beginSpeech();
    s.pushSpeech("Speaking.");
    s.setInputAnchor(40);
    s.summonInput();
    expect(bubble().classList.contains("is-above-input")).toBe(true);

    s.dismissInput();
    // dismiss animates out; drive the transitionend that finalises close
    const te = new Event("transitionend") as TransitionEvent & { propertyName: string };
    Object.defineProperty(te, "propertyName", { value: "opacity", configurable: true });
    form().dispatchEvent(te);

    expect(bubble().classList.contains("is-above-input")).toBe(false);
    expect(bubble().style.getPropertyValue("--yui-bubble-bottom")).toBe("");
  });

  it("tracks the feet anchor changing while the input stays open", () => {
    s.setInputAnchor(40);
    s.summonInput();
    const first = bubble().style.getPropertyValue("--yui-bubble-bottom");

    // feet move up → input bottom grows → bubble must lift further
    s.setInputAnchor(160);
    const second = bubble().style.getPropertyValue("--yui-bubble-bottom");

    expect(parseFloat(second)).toBeGreaterThan(parseFloat(first));
  });
});
