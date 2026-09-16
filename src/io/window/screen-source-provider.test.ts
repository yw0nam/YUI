/**
 * screen-source-provider.test.ts — createBrowserScreenSourceProvider seam.
 *
 * Verify:
 *  - returns single primary monitor using injected screen dims
 *  - omits width/height if screen absent
 *  - index=0, label="This screen", primary=true
 */

import { describe, expect, it } from "vitest";
import { createBrowserScreenSourceProvider } from "./screen-source-provider";

describe("createBrowserScreenSourceProvider — with injected screen", () => {
  it("returns a single monitor with injected width/height", async () => {
    const provider = createBrowserScreenSourceProvider({ width: 2560, height: 1440 });
    const monitors = await provider.listMonitors();
    expect(monitors).toHaveLength(1);
    expect(monitors[0]).toEqual({
      index: 0,
      label: "이 화면",
      width: 2560,
      height: 1440,
      primary: true,
    });
  });
});

describe("createBrowserScreenSourceProvider — without injected screen", () => {
  it("returns a monitor without width/height when screen not provided", async () => {
    const provider = createBrowserScreenSourceProvider(undefined);
    const monitors = await provider.listMonitors();
    expect(monitors).toHaveLength(1);
    const m = monitors[0];
    expect(m.index).toBe(0);
    expect(m.label).toBe("이 화면");
    expect(m.primary).toBe(true);
    expect(m.width).toBeUndefined();
    expect(m.height).toBeUndefined();
  });
});

describe("createBrowserScreenSourceProvider — structure", () => {
  it("index is always 0, label is '이 화면', primary is true", async () => {
    const provider = createBrowserScreenSourceProvider({ width: 800, height: 600 });
    const [m] = await provider.listMonitors();
    expect(m.index).toBe(0);
    expect(m.label).toBe("이 화면");
    expect(m.primary).toBe(true);
  });
});
