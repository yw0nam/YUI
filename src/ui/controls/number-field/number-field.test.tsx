// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NumberField } from "./number-field";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A caller that keeps a committed value only inside its range, as a store rejects an out-of-range one. */
function Caller({
  initial,
  min = 1,
  max = 99,
  onCommit,
}: {
  initial: number | null;
  min?: number;
  max?: number;
  onCommit(value: number | null): void;
}) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <NumberField
      id="f"
      value={value}
      min={min}
      max={max}
      onCommit={(next) => {
        onCommit(next);
        if (next === null || (next >= min && next <= max)) setValue(next);
      }}
    >
      <span className="yui-cue__suffix">min</span>
    </NumberField>
  );
}

function renderCaller(props: { initial: number | null; min?: number; max?: number }) {
  const onCommit = vi.fn<(value: number | null) => void>();
  const { container } = render(<Caller {...props} onCommit={onCommit} />);
  const input = container.querySelector<HTMLInputElement>("#f");
  return { input, onCommit };
}

const type = (el: HTMLInputElement, text: string) =>
  fireEvent.change(el, { target: { value: text } });
const focus = (el: HTMLInputElement) => act(() => el.focus());
const blur = (el: HTMLInputElement) => act(() => el.blur());

describe("NumberField", () => {
  afterEach(() => {
    act(() => cleanup());
    document.body.innerHTML = "";
  });

  it("commits on blur only, not on each keystroke", () => {
    const { input, onCommit } = renderCaller({ initial: 30 });
    expect(input).not.toBeNull();
    if (!input) return;

    focus(input);
    type(input, "2");
    type(input, "25");
    expect(onCommit.mock.calls).toEqual([]);

    blur(input);
    expect(onCommit.mock.calls).toEqual([[25]]);
  });

  it("commits once on Enter, keeps focus, and a later blur commits nothing", () => {
    const { input, onCommit } = renderCaller({ initial: 30 });
    expect(input).not.toBeNull();
    if (!input) return;

    focus(input);
    type(input, "25");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommit.mock.calls).toEqual([[25]]);
    expect(document.activeElement).toBe(input);

    blur(input);
    expect(onCommit.mock.calls).toEqual([[25]]);
  });

  it("snaps a value the caller rejects back after the commit", () => {
    const { input, onCommit } = renderCaller({ initial: 30 });
    expect(input).not.toBeNull();
    if (!input) return;

    focus(input);
    type(input, "500");
    blur(input);

    expect(onCommit.mock.calls).toEqual([[500]]);
    expect(input.value).toBe("30");
  });

  it("commits null when the field is emptied", () => {
    const { input, onCommit } = renderCaller({ initial: 30 });
    expect(input).not.toBeNull();
    if (!input) return;

    focus(input);
    type(input, "");
    blur(input);

    expect(onCommit.mock.calls).toEqual([[null]]);
    expect(input.value).toBe("");
  });

  it("renders 8770 without a thousands separator", () => {
    const { input } = renderCaller({ initial: 8770, min: 1024, max: 65535 });
    expect(input).not.toBeNull();
    if (!input) return;

    expect(input.value).toBe("8770");
  });
});