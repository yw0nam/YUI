// @vitest-environment jsdom
/** rename-input.test.tsx — the inline rename field: a refused commit leaves it open for a corrected name. */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RenameInput } from "./rename-input";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(cleanup);

describe("RenameInput", () => {
  it("after a refused Enter, an edited name commits on the next Enter", () => {
    const onCommit = vi.fn((name: string) => name !== "taken");
    const { container } = render(
      <RenameInput label="taken" onCommit={onCommit} onCancel={vi.fn()} />,
    );
    const input = container.querySelector<HTMLInputElement>(".yui-ep-input")!;

    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "free" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommit.mock.calls.map(([name]) => name)).toEqual(["taken", "free"]);
  });
});
