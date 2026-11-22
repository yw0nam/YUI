// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Segment } from "./segment";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LETTERS = [
  { value: "a", label: "A" },
  { value: "b", label: "B" },
  { value: "c", label: "C" },
];

describe("Segment", () => {
  afterEach(() => {
    act(() => cleanup());
    document.body.innerHTML = "";
  });

  it("selects on arrow keys and on a click when focus selects", () => {
    const onValueChange = vi.fn();
    const { getAllByRole, rerender } = render(
      <Segment label="Letter" options={LETTERS} value="a" onValueChange={onValueChange} />,
    );
    const radios = getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("data-value"))).toEqual(["a", "b", "c"]);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(radios[0].tabIndex).toBe(0);
    expect(radios[1].tabIndex).toBe(-1);

    radios[0].focus();
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(onValueChange).toHaveBeenLastCalledWith("b");
    expect(document.activeElement).toBe(radios[1]);

    rerender(<Segment label="Letter" options={LETTERS} value="b" onValueChange={onValueChange} />);
    expect(radios[1].getAttribute("aria-checked")).toBe("true");
    expect(radios[1].tabIndex).toBe(0);
    expect(radios[0].tabIndex).toBe(-1);

    fireEvent.click(radios[2]);
    expect(onValueChange).toHaveBeenLastCalledWith("c");
  });

  it("moves focus without selecting on arrow keys when activation selects", () => {
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
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    expect(onValueChange).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(radios[1]);
    expect(radios[1].tabIndex).toBe(0);
    expect(radios[0].tabIndex).toBe(-1);
    expect(radios[1].getAttribute("aria-checked")).toBe("false");

    fireEvent.keyDown(radios[1], { key: "Enter" });
    expect(onValueChange).toHaveBeenLastCalledWith("b");
  });
});
