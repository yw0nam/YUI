/**
 * surface-doctrine.test.ts
 *
 * Guards two doctrine rules across the small-label-chip surfaces
 * (tool-status, capture, voice indicators) and the boot-error notice:
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
  for (const file of ["capture-indicator.css", "voice-input-indicator.css", "boot-error.css"]) {
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

// The chip's fix state reuses the inline-link idiom .yui-input__error-action already
// ships, so "this is clickable" reads identically on both error surfaces.
describe("voice-input-indicator.css — not_configured fix affordance", () => {
  const fix = '.yui-voice[data-state="error"][data-fix="settings"]';

  it("underlines the label in accent-soft at rest", () => {
    const block = extractBlock(read("voice-input-indicator.css"), `${fix} .yui-voice__label`);
    expect(block).toMatch(/text-decoration-color:\s*var\(--yui-accent-soft\)/);
  });

  it("ignites the label on hover and on focus-visible alike", () => {
    const css = read("voice-input-indicator.css");
    expect(css).toContain(`${fix}:hover .yui-voice__label`);
    expect(css).toContain(`${fix}:focus-visible .yui-voice__label`);
  });

  it("carries a 2px accent-soft focus ring", () => {
    const block = extractBlock(read("voice-input-indicator.css"), `${fix}:focus-visible`);
    expect(block).toMatch(/outline:\s*2px solid var\(--yui-accent-soft\)/);
  });

  it("keeps the gear glyph out of every other state", () => {
    const css = read("voice-input-indicator.css");
    expect(extractBlock(css, ".yui-voice__fix-glyph")).toMatch(/display:\s*none/);
    expect(extractBlock(css, `${fix} .yui-voice__fix-glyph`)).toMatch(/display:\s*block/);
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

// The divider above the start-fresh footer is the History tab's one separator;
// a border on the retention note would stack a second rule right beside it.
describe("history-section.css — a single separator above the start-fresh footer", () => {
  it(".yui-hist__foot carries no border of its own", () => {
    const css = read("quick-controls/history-section.css");
    expect(extractBlock(css, ".yui-hist__foot")).not.toMatch(/border-top/);
  });
});

// A class-level `display` outranks the UA [hidden] rule, so every such component
// has to restate [hidden] itself or the attribute silently stops hiding it.
describe("quick-controls.css — components with a display rule honour [hidden]", () => {
  for (const selector of [".yui-link-btn", ".yui-confirm"]) {
    it(`${selector} sets display:none under [hidden]`, () => {
      const css = read("quick-controls.css");
      expect(extractBlock(css, selector)).toMatch(/display:/);
      expect(extractBlock(css, `${selector}[hidden]`)).toMatch(/display:\s*none/);
    });
  }
});

// Same rule on the overlay surfaces: .yui-tool carries `display: inline-flex`, so without
// its own [hidden] rule a hidden chip keeps painting whenever `is-visible` is on it.
describe("surfaces.css — components with a display rule honour [hidden]", () => {
  it(".yui-tool sets display:none under [hidden]", () => {
    const css = read("surfaces.css");
    expect(extractBlock(css, ".yui-tool")).toMatch(/display:/);
    expect(extractBlock(css, ".yui-tool[hidden]")).toMatch(/display:\s*none/);
  });

  it(".yui-input__pop sets display:none under [hidden]", () => {
    const css = read("surfaces.css");
    expect(extractBlock(css, ".yui-input__pop")).toMatch(/display:/);
    expect(extractBlock(css, ".yui-input__pop[hidden]")).toMatch(/display:\s*none/);
  });
});

// The message window reuses the bubble and the input verbatim, so the frost stays
// where doctrine puts it — on the bubble — and the plate takes a strong scrim instead.
describe("message-window.css — the plate is a chip, not a frosted panel", () => {
  // surfaces.css is injected after this file, so a single-class root rule would lose the
  // specificity tie to `.yui-ui` and leave the column absolutely positioned.
  it("qualifies the column rule with both classes", () => {
    expect(read("message-window.css")).toMatch(/^\.yui-ui\.yui-ui--message\s*\{/m);
  });

  it("adds no backdrop-filter of its own", () => {
    expect(read("message-window.css")).not.toMatch(/backdrop-filter/);
  });

  it("styles the plate with scrim-strong", () => {
    expect(extractBlock(read("message-window.css"), ".yui-plate")).toMatch(
      /var\(--yui-scrim-strong\)/,
    );
  });

  it("takes its live-state color from the accent token, never a literal", () => {
    const css = read("message-window.css");
    expect(extractBlock(css, ".yui-plate.is-live .yui-plate__dot")).toMatch(/var\(--yui-accent\)/);
    expect(css).not.toMatch(/oklch\(/);
  });

  // In flow, a closed input whose display rule outranks [hidden] would hold the column
  // open at composer height, so the idle window would never shrink back to its handle.
  it("keeps a closed input out of the flow column", () => {
    expect(extractBlock(read("message-window.css"), ".yui-ui--message .yui-input[hidden]")).toMatch(
      /display:\s*none/,
    );
  });

  it("hides the pop button in the window that is already popped out", () => {
    expect(extractBlock(read("message-window.css"), ".yui-ui--message .yui-bubble__pop")).toMatch(
      /display:\s*none/,
    );
    expect(extractBlock(read("message-window.css"), ".yui-ui--message .yui-input__pop")).toMatch(
      /display:\s*none/,
    );
  });
});
