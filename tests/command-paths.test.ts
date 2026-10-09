import { describe, expect, it, vi } from "vitest";
import { resolvePythonCommand } from "./python-command";

describe("Python command resolution", () => {
  it("keeps Bash-only imports independent of Python", async () => {
    vi.resetModules();
    const spawnSync = vi.fn(() => {
      throw new Error("Python is unavailable");
    });
    vi.doMock("node:child_process", () => ({ spawnSync }));
    const { BASH } = await import("./command-paths");
    expect(typeof BASH).toBe("string");
    expect(spawnSync).not.toHaveBeenCalled();
    vi.doUnmock("node:child_process");
  });

  it("uses an explicit override", () => {
    expect(resolvePythonCommand("win32", { YUI_PYTHON: "C:/Python/python.exe" }, () => true)).toBe(
      "C:/Python/python.exe",
    );
  });

  it("rejects an invalid explicit override", () => {
    expect(() =>
      resolvePythonCommand("win32", { YUI_PYTHON: "C:/Missing/python.exe" }, () => false),
    ).toThrow("YUI_PYTHON override is not usable");
  });

  it("uses python when Windows has no launcher", () => {
    expect(resolvePythonCommand("win32", {}, (command) => command === "python")).toBe("python");
  });

  it("falls back to the launcher when Windows has no python executable", () => {
    expect(resolvePythonCommand("win32", {}, (command) => command === "py")).toBe("py");
  });

  it("reports a missing interpreter", () => {
    expect(() => resolvePythonCommand("win32", {}, () => false)).toThrow(
      "Python interpreter not found",
    );
  });
});
