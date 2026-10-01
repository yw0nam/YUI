// @vitest-environment jsdom
/** Tests for attachVisualViewport — the visual viewport and keyboard overlap as custom properties. */

import { describe, expect, it } from "vitest";
import { attachVisualViewport } from "./phone-viewport";

function fakeViewport(height: number, offsetTop = 0) {
  return Object.assign(new EventTarget(), { height, offsetTop });
}

function props(root: HTMLElement): [string, string, string] {
  return [
    root.style.getPropertyValue("--yui-visual-viewport-top"),
    root.style.getPropertyValue("--yui-visual-viewport-height"),
    root.style.getPropertyValue("--yui-keyboard-overlap"),
  ];
}

describe("attachVisualViewport", () => {
  it("writes the full viewport at attach", () => {
    const root = document.createElement("div");
    attachVisualViewport({ root, viewport: fakeViewport(923), layoutHeight: () => 923 });

    expect(props(root)).toEqual(["0px", "923px", "0px"]);
  });

  it("follows resize and scroll with the keyboard overlap below the viewport", () => {
    const root = document.createElement("div");
    const viewport = fakeViewport(923);
    attachVisualViewport({ root, viewport, layoutHeight: () => 923 });

    viewport.height = 587;
    viewport.dispatchEvent(new Event("resize"));
    expect(props(root)).toEqual(["0px", "587px", "336px"]);

    viewport.offsetTop = 100;
    viewport.dispatchEvent(new Event("scroll"));
    expect(props(root)).toEqual(["100px", "587px", "236px"]);
  });

  it("removes the properties on detach and stops listening", () => {
    const root = document.createElement("div");
    const viewport = fakeViewport(923);
    const detach = attachVisualViewport({ root, viewport, layoutHeight: () => 923 });

    detach();
    expect(props(root)).toEqual(["", "", ""]);

    viewport.height = 587;
    viewport.dispatchEvent(new Event("resize"));
    expect(props(root)).toEqual(["", "", ""]);
  });

  it("writes nothing without a visual viewport", () => {
    const root = document.createElement("div");
    const detach = attachVisualViewport({ root, viewport: null, layoutHeight: () => 923 });

    expect(props(root)).toEqual(["", "", ""]);
    expect(() => detach()).not.toThrow();
  });
});
