// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Slider } from "./slider";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Slider", () => {
  afterEach(() => {
    act(() => cleanup());
    document.body.innerHTML = "";
  });

  it("is a labelled slider whose keyboard step reports a change, then a commit", () => {
    const onValueChange = vi.fn();
    const onValueCommitted = vi.fn();
    const { queryByRole } = render(
      <Slider
        value={2}
        min={0.5}
        max={6}
        step={0.1}
        label="Mouth"
        valueText="two"
        onValueChange={onValueChange}
        onValueCommitted={onValueCommitted}
      />,
    );
    const thumb = queryByRole("slider", { name: "Mouth" });
    expect(thumb?.getAttribute("aria-valuetext")).toBe("two");

    act(() => thumb!.focus());
    fireEvent.keyDown(thumb!, { key: "ArrowRight" });

    expect(onValueChange.mock.calls).toEqual([[2.1]]);
    expect(onValueCommitted.mock.calls).toEqual([[2.1, "keyboard"]]);
    expect(document.activeElement).toBe(thumb);
  });
});
