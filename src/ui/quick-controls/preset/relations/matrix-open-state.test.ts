// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readOpen, writeOpen } from "./matrix-open-state";

describe("matrix open state", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("keeps one open state per preset window", () => {
    vi.stubGlobal("location", { search: "?preset=aaaa0001" });
    writeOpen(true);
    expect(readOpen()).toBe(true);

    vi.stubGlobal("location", { search: "?preset=bbbb0002" });
    expect(readOpen()).toBe(false);

    writeOpen(true);
    vi.stubGlobal("location", { search: "?preset=aaaa0001" });
    writeOpen(false);
    expect(readOpen()).toBe(false);
    vi.stubGlobal("location", { search: "?preset=bbbb0002" });
    expect(readOpen()).toBe(true);
  });
});
