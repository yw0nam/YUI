/** catalog-state.test.ts — the catalog state's timers across dispose. */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CatalogEntry } from "../../../io/mcp-host/mcp-host";
import { createCatalogState } from "./catalog-state";

afterEach(() => {
  vi.useRealTimers();
});

/** Lets every microtask of the load's promise chain run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("createCatalogState", () => {
  it("leaves no timer when a check's load resolves after dispose", async () => {
    vi.useFakeTimers();
    let load: (entries: CatalogEntry[]) => void = () => {};
    const catalog = vi.fn(
      () =>
        new Promise<CatalogEntry[]>((resolve) => {
          load = resolve;
        }),
    );
    const state = createCatalogState({ manage: { catalog }, plugins: () => [], render: () => {} });

    state.check();
    state.dispose();
    load([]);
    await settle();

    expect(vi.getTimerCount()).toBe(0);
  });
});