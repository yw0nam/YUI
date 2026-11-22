// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Checkbox } from "./checkbox";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Checkbox", () => {
  afterEach(() => {
    act(() => cleanup());
    document.body.innerHTML = "";
  });

  it("announces mixed, and Space and a click report to the caller", () => {
    const onCheckedChange = vi.fn();
    const { queryByRole } = render(
      <Checkbox checked={false} indeterminate label="Group" onCheckedChange={onCheckedChange} />,
    );
    const box = queryByRole("checkbox", { name: "Group" });
    expect(box?.getAttribute("aria-checked")).toBe("mixed");

    fireEvent.click(box!);
    act(() => box!.focus());
    fireEvent.keyDown(box!, { key: " " });
    fireEvent.keyUp(box!, { key: " " });

    expect(onCheckedChange.mock.calls).toEqual([[true], [true]]);
  });
});
