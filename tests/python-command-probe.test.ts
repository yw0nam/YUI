import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSync } = vi.hoisted(() => ({ spawnSync: vi.fn() }));
vi.mock("node:child_process", () => ({ spawnSync }));

import { resolvePythonCommand } from "./python-command";

const VERSION_CHECK = "import sys; raise SystemExit(0 if sys.version_info[0] == 3 else 1)";
const PROBE_OPTIONS = { stdio: "ignore", timeout: 2_000, windowsHide: true };

describe("Python executable probing", () => {
  beforeEach(() => spawnSync.mockReset());

  it("executes the Python 3 version check with a bounded probe", () => {
    spawnSync.mockReturnValue({ error: undefined, status: 0 });

    expect(resolvePythonCommand("win32", {})).toBe("python");
    expect(spawnSync).toHaveBeenCalledWith("python", ["-c", VERSION_CHECK], PROBE_OPTIONS);
  });

  it("falls back after a timed-out candidate", () => {
    spawnSync
      .mockReturnValueOnce({
        error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
        status: null,
      })
      .mockReturnValueOnce({ error: undefined, status: 0 });

    expect(resolvePythonCommand("win32", {})).toBe("py");
    expect(spawnSync).toHaveBeenNthCalledWith(1, "python", ["-c", VERSION_CHECK], PROBE_OPTIONS);
    expect(spawnSync).toHaveBeenNthCalledWith(2, "py", ["-c", VERSION_CHECK], PROBE_OPTIONS);
  });

  it("rejects a nonzero Python version check", () => {
    spawnSync
      .mockReturnValueOnce({ error: undefined, status: 1 })
      .mockReturnValueOnce({ error: undefined, status: 1 });

    expect(() => resolvePythonCommand("win32", {})).toThrow("Python interpreter not found");
  });

  it("validates an explicit override with the same Python 3 probe", () => {
    spawnSync.mockReturnValue({ error: undefined, status: 0 });

    expect(resolvePythonCommand("win32", { YUI_PYTHON: "C:/Python/python.exe" })).toBe(
      "C:/Python/python.exe",
    );
    expect(spawnSync).toHaveBeenCalledWith(
      "C:/Python/python.exe",
      ["-c", VERSION_CHECK],
      PROBE_OPTIONS,
    );
  });

  it("rejects an invalid explicit override after probing it", () => {
    spawnSync.mockReturnValue({ error: undefined, status: 1 });

    expect(() => resolvePythonCommand("win32", { YUI_PYTHON: "C:/Missing/python.exe" })).toThrow(
      "YUI_PYTHON override is not usable",
    );
  });
});
