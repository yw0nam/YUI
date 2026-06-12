// Central logger contract. In node (no window.__TAURI_INTERNALS__) the logger
// routes to console.* and initLogger() is a no-op.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, getLogLevel, initLogger, resolveLevel, setLogLevel } from "./logger";

// ─────────────────────────────────────────────────────────────────────────────
// §1  Console fallback in non-Tauri (node/test) env
// ─────────────────────────────────────────────────────────────────────────────

describe("console fallback in non-Tauri env", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let savedLevel: ReturnType<typeof getLogLevel>;

  beforeEach(() => {
    savedLevel = getLogLevel();
    setLogLevel("debug"); // ensure error always passes the filter
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    setLogLevel(savedLevel);
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
  let savedLevel: ReturnType<typeof getLogLevel>;

  beforeEach(() => {
    savedLevel = getLogLevel();
    setLogLevel("debug");
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
    setLogLevel(savedLevel);
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
// §3  Level filtering
// ─────────────────────────────────────────────────────────────────────────────

describe("level filtering", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  let savedLevel: ReturnType<typeof getLogLevel>;

  beforeEach(() => {
    savedLevel = getLogLevel();
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errSpy.mockRestore();
    setLogLevel(savedLevel);
  });

  it("setLogLevel('warn'): debug/info suppressed, warn/error pass", () => {
    setLogLevel("warn");
    const log = createLogger("x");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[YUI][x] w");
    expect(errSpy).toHaveBeenCalledWith("[YUI][x] e");
  });

  it("setLogLevel('debug'): all four levels pass through", () => {
    setLogLevel("debug");
    const log = createLogger("x");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(debugSpy).toHaveBeenCalledWith("[YUI][x] d");
    expect(infoSpy).toHaveBeenCalledWith("[YUI][x] i");
    expect(warnSpy).toHaveBeenCalledWith("[YUI][x] w");
    expect(errSpy).toHaveBeenCalledWith("[YUI][x] e");
  });

  it("setLogLevel('error'): only error passes", () => {
    setLogLevel("error");
    const log = createLogger("x");
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith("[YUI][x] e");
  });

  it("getLogLevel reflects the last setLogLevel", () => {
    setLogLevel("info");
    expect(getLogLevel()).toBe("info");
    setLogLevel("error");
    expect(getLogLevel()).toBe("error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4  resolveLevel — pure function (no mocking)
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
// §5  initLogger — no-op in non-Tauri env
// ─────────────────────────────────────────────────────────────────────────────

describe("initLogger — non-Tauri bootstrap", () => {
  it("resolves without throwing (no-op)", async () => {
    await expect(initLogger()).resolves.toBeUndefined();
  });
});
