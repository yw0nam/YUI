// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Switch } from "./switch";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Switch", () => {
  afterEach(() => {
    act(() => cleanup());
    document.body.innerHTML = "";
  });

  it("is a labelled switch whose click reports the flipped value", () => {
    const onCheckedChange = vi.fn();
    const { getByRole, rerender } = render(
      <Switch checked={false} label="Attach" onCheckedChange={onCheckedChange} />,
    );
    const sw = getByRole("switch", { name: "Attach" });
    expect(sw.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);

    rerender(<Switch checked label="Attach" onCheckedChange={onCheckedChange} />);
    expect(sw.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(sw);
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });
});
