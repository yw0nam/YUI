/**
 * filler-tool-lines.test.ts — textarea round-trip for the `tool` tier.
 *
 * Pins the contract for src/ui/quick-controls/filler-tool-lines.ts:
 *   parseToolLines(text) -> Record<string, string[]>
 *   serializeToolLines(tool) -> text
 */

import { describe, expect, it } from "vitest";
import { parseToolLines, serializeToolLines } from "./filler-tool-lines";

describe("parseToolLines", () => {
  it("a plain line (no ' = ') goes to _default", () => {
    expect(parseToolLines("checking on that...")).toEqual({
      _default: ["checking on that..."],
    });
  });

  it("a 'key = phrase' line populates that key", () => {
    expect(parseToolLines("terminal = Running that in a terminal.")).toEqual({
      terminal: ["Running that in a terminal."],
    });
  });

  it("multiple lines for the same key accumulate in order", () => {
    expect(parseToolLines("terminal = one\nterminal = two")).toEqual({
      terminal: ["one", "two"],
    });
  });

  it("mixes _default and keyed lines", () => {
    expect(parseToolLines("checking...\nterminal = running it\nweb_search = searching")).toEqual({
      _default: ["checking..."],
      terminal: ["running it"],
      web_search: ["searching"],
    });
  });

  it("trims whitespace around the key and the phrase", () => {
    expect(parseToolLines("  terminal   =   running it  ")).toEqual({
      terminal: ["running it"],
    });
  });

  it("a key with invalid characters falls back to the whole line as _default", () => {
    expect(parseToolLines("한글 키 = phrase")).toEqual({
      _default: ["한글 키 = phrase"],
    });
  });

  it("accepts dots, colons, underscores, and hyphens in a key", () => {
    expect(parseToolLines("mcp.tool:sub-name_1 = phrase")).toEqual({
      "mcp.tool:sub-name_1": ["phrase"],
    });
  });

  it("splits only on the first '=' — a phrase may itself contain one", () => {
    expect(parseToolLines("terminal = 1 + 1 = 2")).toEqual({
      terminal: ["1 + 1 = 2"],
    });
  });

  it("skips blank lines", () => {
    expect(parseToolLines("checking...\n\n\nterminal = running it\n")).toEqual({
      _default: ["checking..."],
      terminal: ["running it"],
    });
  });

  it("empty text yields an empty object", () => {
    expect(parseToolLines("")).toEqual({});
  });
});

describe("serializeToolLines", () => {
  it("emits _default lines plain, first", () => {
    expect(serializeToolLines({ _default: ["a", "b"] })).toBe("a\nb");
  });

  it("emits keyed lines as 'key = phrase'", () => {
    expect(serializeToolLines({ terminal: ["running it"] })).toBe("terminal = running it");
  });

  it("emits _default lines before keyed lines, keyed lines sorted by key", () => {
    expect(
      serializeToolLines({
        web_search: ["searching"],
        _default: ["checking..."],
        terminal: ["running it"],
      }),
    ).toBe("checking...\nterminal = running it\nweb_search = searching");
  });

  it("emits every phrase for a key on its own line", () => {
    expect(serializeToolLines({ terminal: ["one", "two"] })).toBe("terminal = one\nterminal = two");
  });

  it("empty tool object yields empty text", () => {
    expect(serializeToolLines({})).toBe("");
  });
});

describe("parseToolLines / serializeToolLines — round trip", () => {
  it("serialize then parse recovers the same tool object", () => {
    const tool = {
      _default: ["checking on that...", "let me look"],
      terminal: ["running it"],
      web_search: ["searching", "still searching"],
    };
    expect(parseToolLines(serializeToolLines(tool))).toEqual(tool);
  });

  it("parse then serialize recovers the same text (already-canonical input)", () => {
    const text = "checking...\nterminal = running it\nweb_search = searching";
    expect(serializeToolLines(parseToolLines(text))).toBe(text);
  });
});
