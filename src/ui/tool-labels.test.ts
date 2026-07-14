/**
 * Tests for src/ui/tool-labels.ts — tool-id → display label lookup.
 *
 * Requirements:
 * - English labels by default (tool.* keys stay English in every locale).
 * - Known tool IDs map to specific English labels.
 * - Unmapped tool IDs are humanized from the id (snake_case → "Title case…").
 * - Empty tool IDs fall back to a generic "Working…" label.
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

  it("humanizes an unmapped snake_case tool id", () => {
    expect(getToolLabel("kb_get_ids")).toBe("Kb get ids…");
  });

  it("humanizes a single-word unmapped tool id", () => {
    expect(getToolLabel("summarize")).toBe("Summarize…");
  });

  it("returns generic fallback for empty string tool id", () => {
    expect(getToolLabel("")).toBe("Working…");
  });

  it("returns generic fallback when the id is only separators", () => {
    expect(getToolLabel("___")).toBe("Working…");
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

  it("humanizes unmapped tools regardless of locale", () => {
    expect(getToolLabel("no_such_tool", "ja")).toBe("No such tool…");
  });
});
