/**
 * watchPageVisibility.test.ts — the page-hidden port the push socket suspends on.
 */

import { describe, expect, it } from "vitest";
import { watchPageVisibility } from "./page-visibility";

function fakeDocument(initial: string) {
  const listeners = new Set<() => void>();
  let visibilityState = initial;
  return {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type: string, cb: () => void) {
      if (type === "visibilitychange") listeners.add(cb);
    },
    removeEventListener(type: string, cb: () => void) {
      if (type === "visibilitychange") listeners.delete(cb);
    },
    /** Simulate the browser firing the event after the state changed. */
    hide() {
      visibilityState = "hidden";
      for (const cb of [...listeners]) cb();
    },
    show() {
      visibilityState = "visible";
      for (const cb of [...listeners]) cb();
    },
    listenerCount: () => listeners.size,
  };
}

describe("watchPageVisibility", () => {
  it("reads the initial state synchronously", () => {
    expect(watchPageVisibility(fakeDocument("hidden")).get()).toBe(true);
    expect(watchPageVisibility(fakeDocument("visible")).get()).toBe(false);
  });

  it("follows the page through hide and show", () => {
    const doc = fakeDocument("visible");
    const visibility = watchPageVisibility(doc);
    const seen: boolean[] = [];
    visibility.subscribe(() => seen.push(visibility.get()));

    doc.hide();
    doc.show();

    expect(seen).toEqual([true, false]);
    expect(visibility.get()).toBe(false);
  });

  it("stops listening on dispose", () => {
    const doc = fakeDocument("visible");
    const visibility = watchPageVisibility(doc);
    const off = visibility.subscribe(() => {});

    off();
    doc.hide();

    expect(doc.listenerCount()).toBe(0);
    expect(visibility.get()).toBe(true);
  });
});
