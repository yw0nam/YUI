// @vitest-environment jsdom

/**
 * reflect-unless-editing.test.ts — reflectUnlessEditing idle-edit focus guard.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reflectUnlessEditing } from "./reflect-unless-editing";

describe("reflectUnlessEditing", () => {
  let input: HTMLInputElement;

  beforeEach(() => {
    input = document.createElement("input");
    document.body.appendChild(input);
  });

  afterEach(() => {
    input.remove();
    vi.restoreAllMocks();
  });

  it("skips the write when the input is focused and active", () => {
    input.value = "old";
    input.focus();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);

    reflectUnlessEditing(input, "new");

    expect(input.value).toBe("old");
  });

  it("writes the value when the input is not focused", () => {
    input.value = "old";
    vi.spyOn(document, "hasFocus").mockReturnValue(true);

    reflectUnlessEditing(input, "new");

    expect(input.value).toBe("new");
  });

  it("skips the write when the value already matches", () => {
    input.value = "same";
    const setter = vi.spyOn(input, "value", "set");

    reflectUnlessEditing(input, "same");

    expect(setter).not.toHaveBeenCalled();
  });
});
