import { describe, expect, it, vi } from "vitest";

import {
  buildDevUrl,
  isValidPort,
  resolvePort,
  resolveVitePort,
  tauriConfigArg,
} from "../scripts/dev-port.mjs";

describe("isValidPort", () => {
  it("accepts the integer boundaries 1 and 65535", () => {
    expect(isValidPort(1)).toBe(true);
    expect(isValidPort(65535)).toBe(true);
  });

  it("rejects out-of-range, NaN, and non-integer values", () => {
    expect(isValidPort(0)).toBe(false);
    expect(isValidPort(65536)).toBe(false);
    expect(isValidPort(Number.NaN)).toBe(false);
    expect(isValidPort(1420.5)).toBe(false);
  });
});

describe("resolvePort env precedence", () => {
  it("honors a valid YUI_DEV_PORT without ever scanning", async () => {
    const isPortFree = vi.fn(() => true);
    const port = await resolvePort({ env: { YUI_DEV_PORT: "1500" }, isPortFree });
    expect(port).toBe(1500);
    expect(isPortFree).not.toHaveBeenCalled();
  });

  it("throws on a present but invalid YUI_DEV_PORT", async () => {
    const isPortFree = vi.fn(() => true);
    for (const bad of ["abc", "0", "70000"]) {
      await expect(
        resolvePort({ env: { YUI_DEV_PORT: bad }, isPortFree }),
      ).rejects.toThrow(/Invalid YUI_DEV_PORT/);
    }
    expect(isPortFree).not.toHaveBeenCalled();
  });

  it("treats an empty YUI_DEV_PORT as unset and falls through to scanning", async () => {
    const isPortFree = vi.fn((p: number) => p === 1420);
    const port = await resolvePort({ env: { YUI_DEV_PORT: "" }, isPortFree, base: 1420 });
    expect(port).toBe(1420);
    expect(isPortFree).toHaveBeenCalled();
  });
});

describe("resolvePort scanning", () => {
  it("skips busy ports and returns the first free one", async () => {
    const busy = new Set([1420, 1421]);
    const isPortFree = vi.fn((p: number) => !busy.has(p));
    const port = await resolvePort({ env: {}, isPortFree, base: 1420 });
    expect(port).toBe(1422);
  });

  it("awaits an async isPortFree", async () => {
    const busy = new Set([1420]);
    const isPortFree = vi.fn(async (p: number) => !busy.has(p));
    const port = await resolvePort({ env: {}, isPortFree, base: 1420 });
    expect(port).toBe(1421);
  });

  it("throws naming the scanned range when every port is busy", async () => {
    const isPortFree = vi.fn(() => false);
    await expect(
      resolvePort({ env: {}, isPortFree, base: 1420, maxScan: 5 }),
    ).rejects.toThrow(/1420/);
  });
});

describe("resolveVitePort", () => {
  it("defaults to 1420 when YUI_DEV_PORT is unset", () => {
    expect(resolveVitePort({})).toBe(1420);
  });

  it("treats an empty YUI_DEV_PORT as unset and defaults to 1420", () => {
    expect(resolveVitePort({ YUI_DEV_PORT: "" })).toBe(1420);
  });

  it("returns a valid YUI_DEV_PORT", () => {
    expect(resolveVitePort({ YUI_DEV_PORT: "1737" })).toBe(1737);
  });

  it("throws on a present but invalid YUI_DEV_PORT", () => {
    for (const bad of ["0", "70000", "-5", "8080.9", "abc"]) {
      expect(() => resolveVitePort({ YUI_DEV_PORT: bad })).toThrow(
        /Invalid YUI_DEV_PORT/,
      );
    }
  });
});

describe("url + tauri config helpers", () => {
  it("builds a 127.0.0.1-pinned dev url", () => {
    expect(buildDevUrl(1737)).toBe("http://127.0.0.1:1737");
  });

  it("emits a tauri --config override for build.devUrl", () => {
    expect(JSON.parse(tauriConfigArg(1737))).toEqual({
      build: { devUrl: "http://127.0.0.1:1737" },
    });
  });
});
