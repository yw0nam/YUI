/**
 * Tests for src/ui/tool-labels.ts — tool-id → display label lookup.
 *
 * Requirements:
 * - English labels by default (tool.* keys stay English in every locale).
 * - Known tool IDs map to specific English labels.
 * - Unknown tool IDs fall back to a generic "Working…" label.
 * - getToolLabel delegates to the i18n dictionary.
 */

import { describe, expect, it } from "vitest";
import { getToolLabel } from "./tool-labels";

describe("getToolLabel (default English)", () => {
  it("returns English label for web_search", () => {
    expect(getToolLabel("web_search")).toBe("Searching…");
  });

  it("returns English label for browser", () => {
    expect(getToolLabel("browser")).toBe("Browsing…");
  });

  it("returns English label for terminal", () => {
    expect(getToolLabel("terminal")).toBe("Running…");
  });

  it("returns generic fallback for an unknown tool id", () => {
    expect(getToolLabel("unknown_tool_xyz")).toBe("Working…");
  });

  it("returns generic fallback for empty string tool id", () => {
    expect(getToolLabel("")).toBe("Working…");
  });
});

describe("getToolLabel (explicit locale)", () => {
  it("returns English label when locale='en'", () => {
    expect(getToolLabel("web_search", "en")).toBe("Searching…");
  });

  it("stays English for other locales (tool labels are not translated)", () => {
    expect(getToolLabel("web_search", "ja")).toBe("Searching…");
    expect(getToolLabel("web_search", "ko")).toBe("Searching…");
  });

  it("falls back to generic fallback for unknown tools regardless of locale", () => {
    expect(getToolLabel("no_such_tool", "ja")).toBe("Working…");
  });
});
