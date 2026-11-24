// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keyboardFocus, shownTip } from "../tooltip/tip-test-helpers";
import { TooltipHost } from "../tooltip/tooltip";
import { Segment, type SegmentProps } from "./segment";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LETTERS = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
];

/** Base UI moves focus in a microtask, so a key press settles inside the awaited act. */
async function press(element: Element, key: string) {
  await act(async () => {
    fireEvent.keyDown(element, { key });
  });
}

/** Holds the value like a store-backed caller does. */
function Host({
  onValueChange,
  ...props
}: Omit<SegmentProps<string>, "onValueChange"> & { onValueChange(value: string): void }) {
  const [value, setValue] = useState(props.value);
  return (
    <Segment
      {...props}
      value={value}
      onValueChange={(next) => {
        onValueChange(next);
        setValue(next);
      }}
    />
  );
}

describe("Segment", () => {
  afterEach(() => {
    act(() => cleanup());
    document.body.innerHTML = "";
  });

  it("selects the next option on arrows, wraps at the end, and moves focus to a click", async () => {
    const onValueChange = vi.fn();
    const { getAllByRole } = render(
      <Host label="Letter" options={LETTERS} value="a" onValueChange={onValueChange} />,
    );
    const radios = getAllByRole("radio");
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(radios[0].tabIndex).toBe(0);
    expect(radios[1].tabIndex).toBe(-1);

    radios[0].focus();
    await press(radios[0], "ArrowRight");
    expect(onValueChange).toHaveBeenLastCalledWith("b");
    expect(document.activeElement).toBe(radios[1]);

    await press(radios[1], "ArrowRight");
    expect(onValueChange).toHaveBeenLastCalledWith("c");
    await press(radios[2], "ArrowRight");
    expect(onValueChange).toHaveBeenLastCalledWith("a");
    expect(document.activeElement).toBe(radios[0]);

    fireEvent.click(radios[2]);
    expect(onValueChange).toHaveBeenLastCalledWith("c");
    expect(document.activeElement).toBe(radios[2]);
    expect(radios[2].tabIndex).toBe(0);
  });

  it("keeps the tab stop on the first option and its first arrow on the second when nothing is checked", async () => {
    const onValueChange = vi.fn();
    const { getAllByRole } = render(
      <Segment label="Letter" options={LETTERS} value="z" onValueChange={onValueChange} />,
    );
    const radios = getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
      "false",
      "false",
      "false",
    ]);
    expect(radios[0].tabIndex).toBe(0);

    radios[0].focus();
    await press(radios[0], "ArrowRight");
    expect(onValueChange).toHaveBeenLastCalledWith("b");
    expect(document.activeElement).toBe(radios[1]);
  });

  it("moves focus and the tab stop without selecting on arrows when activation selects", async () => {
    const onValueChange = vi.fn();
    const { getAllByRole } = render(
      <Segment
        label="Letter"
        options={LETTERS}
        value="a"
        selectOn="activate"
        onValueChange={onValueChange}
      />,
    );
    const radios = getAllByRole("radio");
    radios[0].focus();
    await press(radios[0], "ArrowRight");
    expect(onValueChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1].tabIndex).toBe(0);
    expect(radios[0].tabIndex).toBe(-1);
    expect(radios[1].getAttribute("aria-checked")).toBe("false");

    fireEvent.click(radios[1]);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenLastCalledWith("b");
  });

  it("disables every option and reports nothing", async () => {
    const onValueChange = vi.fn();
    const { getAllByRole } = render(
      <Segment label="Letter" options={LETTERS} value="a" onValueChange={onValueChange} disabled />,
    );
    const radios = getAllByRole("radio") as HTMLButtonElement[];
    expect(radios.map((radio) => radio.disabled)).toEqual([true, true, true]);

    fireEvent.click(radios[2]);
    radios[0].focus();
    await press(radios[0], "ArrowRight");
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("moves the tab stop to a value set from outside", async () => {
    const onValueChange = vi.fn();
    const { getAllByRole, rerender } = render(
      <Segment label="Letter" options={LETTERS} value="a" onValueChange={onValueChange} />,
    );
    const radios = getAllByRole("radio");
    radios[0].focus();
    await press(radios[0], "ArrowRight");
    expect(radios[1].tabIndex).toBe(0);

    rerender(<Segment label="Letter" options={LETTERS} value="c" onValueChange={onValueChange} />);
    expect(radios[2].getAttribute("aria-checked")).toBe("true");
    expect(radios[2].tabIndex).toBe(0);
    expect(radios[1].tabIndex).toBe(-1);
  });

  const GLYPHS = [
    { value: "w", label: <svg aria-hidden="true" />, ariaLabel: "2 waiting", tip: "Waiting" },
    { value: "a", label: <svg aria-hidden="true" />, ariaLabel: "5 in all", tip: "All" },
  ];

  it("names a glyph-labelled option by its ariaLabel", () => {
    const { queryAllByRole } = render(
      <Segment label="Filter" options={GLYPHS} value="w" onValueChange={() => {}} />,
    );

    expect(queryAllByRole("radio").map((radio) => radio.getAttribute("aria-label"))).toEqual([
      "2 waiting",
      "5 in all",
    ]);
  });

  it("opens an option's tip on keyboard focus of its radio", () => {
    const { getAllByRole } = render(
      <TooltipHost>
        <Segment label="Filter" options={GLYPHS} value="w" onValueChange={() => {}} />
      </TooltipHost>,
    );

    keyboardFocus(getAllByRole("radio")[1]);

    expect(shownTip()).toBe("All");
  });
});
