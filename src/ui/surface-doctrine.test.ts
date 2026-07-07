/**
 * surface-doctrine.test.ts
 *
 * Guards two doctrine rules across the small-label-chip surfaces
 * (tool-status, capture, voice indicators):
 *  - the bubble is the only surface allowed a frosted backdrop-filter;
 *    chips/pills use an opaque-enough scrim instead of blur.
 *  - status colors come from tokens (--yui-accent / --yui-danger), never
 *    raw oklch literals baked into a single component.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (name: string): string => readFileSync(resolve(__dirname, name), "utf-8");

/** Slices a top-level CSS rule's body out by selector text (anchored to line start, no nesting). */
function extractBlock(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${escaped}\\s*\\{`, "m");
  const match = re.exec(css);
  if (!match) throw new Error(`selector not found: ${selector}`);
  const start = match.index + match[0].length;
  const end = css.indexOf("\n}", start);
  return css.slice(start, end);
}

describe("chip/pill surfaces — no blur, scrim-strong background", () => {
  for (const file of ["capture-indicator.css", "voice-input-indicator.css"]) {
    it(`${file} has no backdrop-filter (webkit-prefixed included)`, () => {
      expect(read(file)).not.toMatch(/backdrop-filter/);
    });

    it(`${file} styles the pill with scrim-strong, never bare scrim`, () => {
      const css = read(file);
      expect(css).toMatch(/var\(--yui-scrim-strong\)/);
      const withoutStrong = css.replace(/var\(--yui-scrim-strong\)/g, "");
      expect(withoutStrong).not.toMatch(/var\(--yui-scrim\)/);
    });
  }
});

describe("voice-input-indicator.css — status colors from tokens", () => {
  it("has no raw green/red oklch literals for fired/error", () => {
    const css = read("voice-input-indicator.css");
    expect(css).not.toMatch(/oklch\(0\.76 0\.08 145/);
    expect(css).not.toMatch(/oklch\(0\.68 0\.13 28/);
  });

  it('[data-state="fired"] dot uses var(--yui-accent)', () => {
    const css = read("voice-input-indicator.css");
    const block = extractBlock(css, '.yui-voice[data-state="fired"] .yui-voice__dot');
    expect(block).toMatch(/var\(--yui-accent\)/);
  });

  it('[data-state="error"] dot uses var(--yui-danger)', () => {
    const css = read("voice-input-indicator.css");
    const block = extractBlock(css, '.yui-voice[data-state="error"] .yui-voice__dot');
    expect(block).toMatch(/var\(--yui-danger\)/);
  });
});

describe("surfaces.css — tool chip and input error use doctrine tokens", () => {
  it(".yui-tool chip background is var(--yui-scrim-strong)", () => {
    const css = read("surfaces.css");
    const block = extractBlock(css, ".yui-tool");
    expect(block).toMatch(/var\(--yui-scrim-strong\)/);
  });

  it(".yui-input__error color is var(--yui-danger)", () => {
    const css = read("surfaces.css");
    const block = extractBlock(css, ".yui-input__error");
    expect(block).toMatch(/var\(--yui-danger\)/);
  });
});
