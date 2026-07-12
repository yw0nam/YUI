/**
 * format-accel.test.ts — formatAccel accelerator display formatting.
 */

import { describe, expect, it } from "vitest";
import { formatAccel } from "./format-accel";

describe("formatAccel", () => {
  it("renders CmdOrCtrl+Shift+Y on mac with symbols and no separator", () => {
    expect(formatAccel("CmdOrCtrl+Shift+Y", true)).toBe("⌘⇧Y");
  });

  it("renders CmdOrCtrl+Shift+Y on non-mac as Ctrl+Shift+Y", () => {
    expect(formatAccel("CmdOrCtrl+Shift+Y", false)).toBe("Ctrl+Shift+Y");
  });

  it("matches modifiers case-insensitively and normalizes casing", () => {
    expect(formatAccel("cmdorctrl+shift+y", false)).toBe("Ctrl+Shift+Y");
    expect(formatAccel("cmdorctrl+shift+y", true)).toBe("⌘⇧Y");
  });

  it("returns empty string for empty or whitespace-only input", () => {
    expect(formatAccel("", false)).toBe("");
    expect(formatAccel("   ", true)).toBe("");
  });

  it("skips empty tokens from doubled separators", () => {
    expect(formatAccel("Ctrl++Y", false)).toBe("Ctrl+Y");
  });

  it("passes unknown/symbol tokens through unchanged", () => {
    expect(formatAccel("Ctrl+*", false)).toBe("Ctrl+*");
  });
});
