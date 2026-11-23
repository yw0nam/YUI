// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Disclosure } from "./disclosure";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("Disclosure", () => {
  afterEach(() => {
    act(() => cleanup());
    document.body.innerHTML = "";
  });

  it("renders a closed more fold with its label in the summary and its rows", () => {
    const { container } = render(
      <Disclosure label="Advanced">
        <p>row</p>
      </Disclosure>,
    );
    const details = container.querySelector("details");
    expect(details).not.toBeNull();
    if (!details) return;

    expect(details.className).toBe("yui-more");
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.querySelector("summary")?.textContent?.trim()).toBe("Advanced");
    expect(details.querySelector("p")?.textContent).toBe("row");
  });
});
