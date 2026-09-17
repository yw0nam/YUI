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
  for (const file of [
    "../chips/capture-indicator.css",
    "../chips/voice-input-indicator.css",
    "../notices/boot-error.css",
  ]) {
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
    const css = read("../chips/voice-input-indicator.css");
    expect(css).not.toMatch(/oklch\(0\.76 0\.08 145/);
    expect(css).not.toMatch(/oklch\(0\.68 0\.13 28/);
  });

  it('[data-state="fired"] dot uses var(--yui-accent)', () => {
    const css = read("../chips/voice-input-indicator.css");
    const block = extractBlock(css, '.yui-voice[data-state="fired"] .yui-voice__dot');
    expect(block).toMatch(/var\(--yui-accent\)/);
  });

  it('[data-state="error"] dot uses var(--yui-danger)', () => {
    const css = read("../chips/voice-input-indicator.css");
    const block = extractBlock(css, '.yui-voice[data-state="error"] .yui-voice__dot');
    expect(block).toMatch(/var\(--yui-danger\)/);
  });
});

// The chip's fix state reuses the inline-link idiom .yui-input__error-action already
// ships, so "this is clickable" reads identically on both error surfaces.
describe("voice-input-indicator.css — not_configured fix affordance", () => {
  const fix = '.yui-voice[data-state="error"][data-fix="settings"]';

  it("underlines the label in accent-soft at rest", () => {
    const block = extractBlock(
      read("../chips/voice-input-indicator.css"),
      `${fix} .yui-voice__label`,
    );
    expect(block).toMatch(/text-decoration-color:\s*var\(--yui-accent-soft\)/);
  });

  it("ignites the label on hover and on focus-visible alike", () => {
    const css = read("../chips/voice-input-indicator.css");
    expect(css).toContain(`${fix}:hover .yui-voice__label`);
    expect(css).toContain(`${fix}:focus-visible .yui-voice__label`);
  });

  it("carries a 2px accent-soft focus ring", () => {
    const block = extractBlock(read("../chips/voice-input-indicator.css"), `${fix}:focus-visible`);
    expect(block).toMatch(/outline:\s*2px solid var\(--yui-accent-soft\)/);
  });

  it("keeps the gear glyph out of every other state", () => {
    const css = read("../chips/voice-input-indicator.css");
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
    const css = read("../quick-controls/history-section.css");
    expect(extractBlock(css, ".yui-hist__foot")).not.toMatch(/border-top/);
  });
});

// A class-level `display` outranks the UA [hidden] rule, so every such component
// has to restate [hidden] itself or the attribute silently stops hiding it.
describe("quick-controls.css — components with a display rule honour [hidden]", () => {
  for (const selector of [".yui-link-btn", ".yui-confirm"]) {
    it(`${selector} sets display:none under [hidden]`, () => {
      const css = read("../quick-controls/quick-controls.css");
      expect(extractBlock(css, selector)).toMatch(/display:/);
      expect(extractBlock(css, `${selector}[hidden]`)).toMatch(/display:\s*none/);
    });
  }
});

// Same rule on the quick-controls endpoints section: the chat-status line and the
// session lost line both carry `display: flex`, so without their own [hidden] rule
// reflect.ts setting `hidden` on either leaves it painted in the layout.
describe("endpoints-section.css — components with a display rule honour [hidden]", () => {
  it(".yui-chat-status and .yui-session__deleg-lost set display:none under [hidden]", () => {
    const css = read("../quick-controls/endpoints-section.css");
    expect(extractBlock(css, ".yui-chat-status,\n.yui-session__deleg-lost")).toMatch(/display:/);
    expect(
      extractBlock(css, ".yui-chat-status[hidden],\n.yui-session__deleg-lost[hidden]"),
    ).toMatch(/display:\s*none/);
  });
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
    expect(read("../message/message-window.css")).toMatch(/^\.yui-ui\.yui-ui--message\s*\{/m);
  });

  it("adds no backdrop-filter of its own", () => {
    expect(read("../message/message-window.css")).not.toMatch(/backdrop-filter/);
  });

  it("styles the plate with scrim-strong", () => {
    expect(extractBlock(read("../message/message-window.css"), ".yui-plate")).toMatch(
      /var\(--yui-scrim-strong\)/,
    );
  });

  it("takes its live-state color from the accent token, never a literal", () => {
    const css = read("../message/message-window.css");
    expect(extractBlock(css, '.yui-plate[data-state="responding"] .yui-plate__dot')).toMatch(
      /var\(--yui-accent\)/,
    );
    expect(css).not.toMatch(/oklch\(/);
  });

  // In flow, a closed input whose display rule outranks [hidden] would hold the column
  // open at composer height, so the idle window would never shrink back to its handle.
  it("keeps a closed input out of the flow column", () => {
    expect(
      extractBlock(read("../message/message-window.css"), ".yui-ui--message .yui-input[hidden]"),
    ).toMatch(/display:\s*none/);
  });

  it("hides the pop button in the window that is already popped out", () => {
    expect(
      extractBlock(read("../message/message-window.css"), ".yui-ui--message .yui-bubble__pop"),
    ).toMatch(/display:\s*none/);
    expect(
      extractBlock(read("../message/message-window.css"), ".yui-ui--message .yui-input__pop"),
    ).toMatch(/display:\s*none/);
  });
});

// The chip's list opens at min-width: 15rem anchored to the chip's left edge in
// delegation-chip.css, which overruns the window's fixed 340px column; the message
// window instead wraps the list onto its own full-width line under the plate row.
describe("message-window.css — the delegation list wraps under the plate row", () => {
  it("lets the plate row wrap onto a second line", () => {
    expect(extractBlock(read("../message/message-window.css"), ".yui-plate-row")).toMatch(
      /flex-wrap:\s*wrap/,
    );
  });

  it("spans the list the full row width instead of anchoring beside the chip", () => {
    const block = extractBlock(
      read("../message/message-window.css"),
      ".yui-ui--message .yui-deleg__list",
    );
    expect(block).toMatch(/flex:\s*1 0 100%/);
    expect(block).toMatch(/min-width:\s*0/);
    expect(block).toMatch(/box-sizing:\s*border-box/);
  });

  it("keeps a hidden chip out of the flow row", () => {
    expect(
      extractBlock(read("../message/message-window.css"), ".yui-ui--message .yui-deleg[hidden]"),
    ).toMatch(/display:\s*none/);
  });
});

// The reasoning chip mirrors the delegation chip's layout: both chips' buttons sit in the
// row and both panels take a full-width line after them, kept there by flex order.
describe("reasoning-chip.css — the reasoning panel wraps under the plate row", () => {
  it("keeps a hidden root and a hidden panel out of the flow row", () => {
    const css = read("../chips/reasoning-chip.css");
    expect(extractBlock(css, ".yui-think")).toMatch(/display:/);
    expect(extractBlock(css, ".yui-think[hidden]")).toMatch(/display:\s*none/);
    expect(extractBlock(css, ".yui-think__panel[hidden]")).toMatch(/display:\s*none/);
  });

  it("takes the row's next full-width line after both buttons", () => {
    const block = extractBlock(read("../chips/reasoning-chip.css"), ".yui-think__panel");
    expect(block).toMatch(/flex:\s*1 0 100%/);
    expect(block).toMatch(/order:\s*1/);
  });

  it("keeps the delegation list on the same line order, after the row's buttons", () => {
    const block = extractBlock(
      read("../message/message-window.css"),
      ".yui-ui--message .yui-deleg__list",
    );
    expect(block).toMatch(/order:\s*1/);
  });

  it("clips the text at six lines and scrolls it", () => {
    const block = extractBlock(read("../chips/reasoning-chip.css"), ".yui-think__text");
    expect(block).toMatch(/max-height:\s*calc\(6 \* 1\.45em\)/);
    expect(block).toMatch(/overflow-y:\s*auto/);
    expect(block).toMatch(/white-space:\s*pre-wrap/);
  });

  it("styles the panel with the scrim and edge tokens, never literals", () => {
    const css = read("../chips/reasoning-chip.css");
    const block = extractBlock(css, ".yui-think__panel");
    expect(block).toMatch(/var\(--yui-scrim\)/);
    expect(block).toMatch(/var\(--yui-edge\)/);
    expect(css).not.toMatch(/oklch\(/);
  });

  it("breathes the glyph and blinks the cursor while live, and stops both under reduced motion", () => {
    const css = read("../chips/reasoning-chip.css");
    expect(extractBlock(css, ".yui-think__chip.is-live .yui-think__glyph")).toMatch(
      /animation:.*yui-plate-breathe/,
    );
    expect(extractBlock(css, ".yui-think__text.is-live::after")).toMatch(/animation:/);
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion"));
    expect(reduced).toContain(".yui-think__chip.is-live .yui-think__glyph");
    expect(reduced).toContain(".yui-think__text.is-live::after");
    expect(reduced).toMatch(/animation:\s*none/);
  });
});
