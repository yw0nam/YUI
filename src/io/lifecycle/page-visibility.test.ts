/**
 * watchPageVisibility.test.ts — the page-hidden port the push socket suspends on.
 */

import { describe, expect, it } from "vitest";
import { watchPageVisibility } from "./page-visibility";

function fakeDocument(initial: DocumentVisibilityState) {
  const listeners = new Set<EventListener>();
  let visibilityState: DocumentVisibilityState = initial;
  return {
    get visibilityState() {
      return visibilityState;
    },
    addEventListener(type: string, cb: EventListener): void {
      if (type === "visibilitychange") listeners.add(cb);
    },
    removeEventListener(type: string, cb: EventListener): void {
      if (type === "visibilitychange") listeners.delete(cb);
    },
    /** Simulate the browser firing the event after the state changed. */
    hide() {
      visibilityState = "hidden";
      for (const cb of [...listeners]) cb(new Event("visibilitychange"));
    },
    show() {
      visibilityState = "visible";
      for (const cb of [...listeners]) cb(new Event("visibilitychange"));
    },
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

  it("detaches the document listener on dispose", () => {
    const doc = fakeDocument("visible");
    const visibility = watchPageVisibility(doc);
    const seen: boolean[] = [];
    const removed: boolean[] = [];
    visibility.subscribe(() => seen.push(visibility.get()));
    const off = visibility.subscribe(() => removed.push(visibility.get()));

    off();
    doc.hide();
    expect(removed).toEqual([]);
    expect(seen).toEqual([true]);

    visibility.dispose();
    doc.show();
    expect(seen).toEqual([true]);
    expect(visibility.get()).toBe(false);
  });
});
