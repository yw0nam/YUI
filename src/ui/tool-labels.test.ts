/**
 * Tests for src/ui/tool-labels.ts — tool-id → display label map.
 *
 * Requirements:
 * - English labels by default.
 * - Structured for i18n extension (locale lookup with English fallback).
 * - Known tool IDs map to specific English labels.
 * - Unknown tool IDs fall back to a generic "Working…" label.
 */

import { describe, expect, it } from "vitest";
import { getToolLabel, TOOL_LABELS } from "./tool-labels";

describe("TOOL_LABELS (English locale)", () => {
  it("exports an 'en' locale entry", () => {
    expect(TOOL_LABELS).toHaveProperty("en");
    expect(typeof TOOL_LABELS.en).toBe("object");
  });

  it("maps web_search to a non-empty English label", () => {
    expect(typeof TOOL_LABELS.en.web_search).toBe("string");
    expect(TOOL_LABELS.en.web_search.length).toBeGreaterThan(0);
  });

  it("maps browser to a non-empty English label", () => {
    expect(typeof TOOL_LABELS.en.browser).toBe("string");
    expect(TOOL_LABELS.en.browser.length).toBeGreaterThan(0);
  });

  it("maps terminal to a non-empty English label", () => {
    expect(typeof TOOL_LABELS.en.terminal).toBe("string");
    expect(TOOL_LABELS.en.terminal.length).toBeGreaterThan(0);
  });
});

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

  it("falls back to English when requested locale is not registered", () => {
    // 'ja' locale not registered → falls back to 'en'
    expect(getToolLabel("web_search", "ja")).toBe("Searching…");
  });

  it("falls back to generic fallback when locale not registered and tool unknown", () => {
    expect(getToolLabel("no_such_tool", "fr")).toBe("Working…");
  });
});

describe("getToolLabel (i18n extension)", () => {
  it("TOOL_LABELS structure allows adding a new locale without touching core logic", () => {
    // Simulate a consumer adding a 'ja' locale entry at runtime.
    // The map is mutable so i18n can extend it without forking the module.
    const originalEn = { ...TOOL_LABELS.en };

    // Add a minimal Japanese locale
    (TOOL_LABELS as Record<string, Record<string, string>>).ja = {
      web_search: "検索中…",
    };

    expect(getToolLabel("web_search", "ja")).toBe("検索中…");
    // Unknown tool in 'ja' falls back to English
    expect(getToolLabel("browser", "ja")).toBe("Browsing…");

    // Cleanup
    delete (TOOL_LABELS as Record<string, Record<string, string>>).ja;
    expect(TOOL_LABELS.en).toEqual(originalEn);
  });
});
