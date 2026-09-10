// Central logger contract. In node (no window.__TAURI_INTERNALS__) the logger
// routes to console.* and initLogger() is a no-op.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, initLogger, resolveLevel } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// §1  Console fallback in non-Tauri (node/test) env
// ─────────────────────────────────────────────────────────────────────────────

describe("console fallback in non-Tauri env", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it("routes .error to console.error with prefixed first arg + extra args passed through", () => {
    const err = new Error("kaboom");
    createLogger("io/tts").error("boom", err);
    expect(errSpy).toHaveBeenCalledWith("[YUI][io/tts] boom", err);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2  Namespace + prefix formatting
// ─────────────────────────────────────────────────────────────────────────────

describe("namespace + prefix formatting", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it("first console arg is exactly '[YUI][renderer] <msg>'", () => {
    createLogger("renderer").error("frame dropped");
    expect(errSpy).toHaveBeenCalledWith("[YUI][renderer] frame dropped");
  });

  it("first console arg is exactly '[YUI][io/tts-pipeline] <msg>'", () => {
    createLogger("io/tts-pipeline").error("queue stalled");
    expect(errSpy).toHaveBeenCalledWith("[YUI][io/tts-pipeline] queue stalled");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3  resolveLevel — pure function (no mocking)
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveLevel — pure function", () => {
  it("DEV:true → 'debug'", () => {
    expect(resolveLevel({ DEV: true })).toBe("debug");
  });

  it("DEV:false → 'warn'", () => {
    expect(resolveLevel({ DEV: false })).toBe("warn");
  });

  it("DEV undefined ({}) → 'warn'", () => {
    expect(resolveLevel({})).toBe("warn");
  });

  it("explicit override wins over DEV:true → 'error'", () => {
    expect(resolveLevel({ DEV: true, VITE_YUI_LOG_LEVEL: "error" })).toBe("error");
  });

  it("explicit override wins over DEV:false → 'debug'", () => {
    expect(resolveLevel({ DEV: false, VITE_YUI_LOG_LEVEL: "debug" })).toBe("debug");
  });

  it("invalid override ignored → falls back to DEV-based default ('debug')", () => {
    expect(resolveLevel({ DEV: true, VITE_YUI_LOG_LEVEL: "bogus" })).toBe("debug");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4  initLogger — no-op in non-Tauri env
// ─────────────────────────────────────────────────────────────────────────────

describe("initLogger — non-Tauri bootstrap", () => {
  it("resolves without throwing (no-op)", async () => {
    await expect(initLogger()).resolves.toBeUndefined();
  });
});
