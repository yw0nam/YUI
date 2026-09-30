/**
 * surface-doctrine.test.ts
 *
 * Guards two doctrine rules across the small-label-chip surfaces
 * (the status pill) and the boot-error notice:
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
  for (const file of ["../chips/status-pill.css", "../notices/boot-error.css"]) {
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

describe("status-pill.css — the pill's shape and colors come from tokens", () => {
  const css = (): string => read("../chips/status-pill.css");

  it("sets the pill on the shared pill tokens, 1.75rem tall at the top edge", () => {
    const block = extractBlock(css(), ".yui-status");
    expect(block).toMatch(/top:\s*4\.5%/);
    expect(block).toMatch(/height:\s*1\.75rem/);
    expect(block).toMatch(/border:\s*1px solid var\(--yui-edge\)/);
    expect(block).toMatch(/box-shadow:\s*var\(--yui-float\)/);
    expect(block).toMatch(/border-radius:\s*var\(--yui-radius-pill\)/);
    expect(block).toMatch(/font-size:\s*var\(--yui-fs-sub\)/);
    expect(block).toMatch(/font-weight:\s*500/);
  });

  it("carries no text-shadow and no raw oklch literal", () => {
    expect(css()).not.toMatch(/text-shadow/);
    expect(css()).not.toMatch(/oklch\(/);
  });

  it("colors each voice state and the tool states from tokens", () => {
    const c = css();
    expect(extractBlock(c, '.yui-status__dot[data-voice="fired"]')).toMatch(
      /box-shadow:\s*0 0 0 2px var\(--yui-accent-soft\)/,
    );
    expect(extractBlock(c, '.yui-status__dot[data-voice="error"]')).toMatch(/var\(--yui-danger\)/);
    expect(extractBlock(c, '.yui-status__voice[data-voice="error"]')).toMatch(
      /color:\s*var\(--yui-danger\)/,
    );
    expect(extractBlock(c, '.yui-status__dot[data-tool="running"]')).toMatch(
      /var\(--yui-text-dim\)/,
    );
    expect(extractBlock(c, '.yui-status__dot[data-tool="done"]')).toMatch(/var\(--yui-ok\)/);
    expect(extractBlock(c, ".yui-status__capture-dot")).toMatch(/var\(--yui-accent\)/);
  });

  it("stops every animation under reduced motion", () => {
    const reduced = css().slice(css().indexOf("@media (prefers-reduced-motion"));
    expect(reduced).toContain(".yui-status__dot");
    expect(reduced).toMatch(/animation:\s*none/);
  });
});

// The not_configured voice error reuses the inline-link idiom .yui-input__error-action
// already ships, so "this is clickable" reads identically on both error surfaces.
describe("status-pill.css — not_configured fix affordance", () => {
  const fix = '.yui-status[data-fix="settings"]';

  it("underlines the label in accent-soft at rest", () => {
    const block = extractBlock(read("../chips/status-pill.css"), `${fix} .yui-status__label`);
    expect(block).toMatch(/text-decoration-color:\s*var\(--yui-accent-soft\)/);
  });

  it("ignites the label on hover and on keyboard focus alike", () => {
    const css = read("../chips/status-pill.css");
    expect(css).toContain(`${fix}:hover .yui-status__label`);
    expect(css).toContain(`${fix}:has(:focus-visible) .yui-status__label`);
  });

  it("keeps the gear glyph out of every other state", () => {
    const css = read("../chips/status-pill.css");
    expect(extractBlock(css, ".yui-status__fix-glyph")).toMatch(/display:\s*none/);
    expect(extractBlock(css, `${fix} .yui-status__fix-glyph`)).toMatch(/display:\s*block/);
  });
});

// The One-Pulse Rule: the pill's dot is the only thing that animates in the character window.
describe("character-window chips — one pulse at a time", () => {
  it("only the status pill's dot declares an animation in status-pill.css", () => {
    const rules = read("../chips/status-pill.css").match(
      /^[^{}@]+\{[^}]*animation:\s*yui-[^}]*\}/gm,
    );
    expect(rules?.length).toBeGreaterThan(0);
    for (const rule of rules ?? []) expect(rule).toMatch(/\.yui-status__dot/);
  });

  it("the delegation chip's dot holds still", () => {
    const css = read("../chips/delegation-chip.css");
    expect(css).not.toMatch(/@keyframes/);
    expect(extractBlock(css, ".yui-deleg__dot")).not.toMatch(/animation/);
  });
});

describe("surfaces.css — input error uses doctrine tokens", () => {
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
    const css = read("../quick-controls/sections/history-section.css");
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
    const css = read("../quick-controls/sections/endpoints-section.css");
    expect(extractBlock(css, ".yui-chat-status,\n.yui-session__deleg-lost")).toMatch(/display:/);
    expect(
      extractBlock(css, ".yui-chat-status[hidden],\n.yui-session__deleg-lost[hidden]"),
    ).toMatch(/display:\s*none/);
  });
});

// Same rule on the overlay surfaces: the status pill and its buttons carry `display: inline-flex`,
// so without their own [hidden] rule a hidden segment keeps painting.
describe("surfaces.css — components with a display rule honour [hidden]", () => {
  it(".yui-status and its children set display:none under [hidden]", () => {
    const css = read("../chips/status-pill.css");
    expect(extractBlock(css, ".yui-status")).toMatch(/display:/);
    expect(extractBlock(css, ".yui-status[hidden],\n.yui-status [hidden]")).toMatch(
      /display:\s*none/,
    );
  });

  it(".yui-input__pop sets display:none under [hidden]", () => {
    const css = read("surfaces.css");
    expect(extractBlock(css, ".yui-input__btn")).toMatch(/display:/);
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

// The bubble is a positioning wrapper around a box: the box wears the frost and scrolls, so the
// edge tools can sit outside it without being clipped or faded by the scroll mask.
describe("surfaces.css — the bubble's box carries the material", () => {
  const css = (): string => read("surfaces.css");

  it("leaves the wrapper bare: no background, no frost, no overflow", () => {
    const block = extractBlock(css(), ".yui-bubble");
    expect(block).not.toMatch(/background|backdrop-filter|overflow/);
  });

  it("gives the box the scrim, the frost, the scroll cap and the speech size", () => {
    const block = extractBlock(css(), ".yui-bubble__box");
    expect(block).toMatch(/background:\s*var\(--yui-scrim\)/);
    expect(block).toMatch(/backdrop-filter:\s*blur\(10px\) saturate\(1\.1\)/);
    expect(block).toMatch(/overflow-y:\s*auto/);
    expect(block).toMatch(/font-size:\s*var\(--yui-fs-speech\)/);
  });

  it("fades the top of the box, not the wrapper, once it overflows", () => {
    expect(extractBlock(css(), ".yui-bubble.is-scrollable .yui-bubble__box")).toMatch(/mask-image/);
  });

  it("drops the frost for a solid strong scrim under reduced transparency", () => {
    const c = css();
    const reduced = c.slice(c.indexOf("@media (prefers-reduced-transparency: reduce)"));
    expect(reduced).toMatch(
      /\.yui-bubble__box\s*\{\s*background:\s*var\(--yui-scrim-strong\);\s*backdrop-filter:\s*none;/,
    );
  });

  // markdown.ts wraps the speech in a <span>; a block last paragraph would push the caret to its own line.
  it("runs the last speech paragraph inline so the streaming caret follows the text", () => {
    expect(extractBlock(css(), ".yui-bubble__text > span > p:last-child")).toMatch(
      /display:\s*inline/,
    );
  });

  it("clips the reasoning at six lines and scrolls it", () => {
    const block = extractBlock(css(), ".yui-bubble__think-text");
    expect(block).toMatch(/max-height:\s*calc\(6 \* 1\.45em\)/);
    expect(block).toMatch(/overflow-y:\s*auto/);
    expect(block).toMatch(/white-space:\s*pre-wrap/);
  });

  it("stops the live reasoning cursor under reduced motion", () => {
    const c = css();
    expect(extractBlock(c, ".yui-bubble__think-text.is-live::after")).toMatch(/animation:/);
    const reduced = c.slice(c.indexOf("@media (prefers-reduced-motion"));
    expect(reduced).toContain(".yui-bubble__think-text.is-live::after");
  });
});

// The scrim alpha carries contrast on the bubble, composer and plate; none adds a text shadow.
describe("bubble, composer and plate — no text shadow", () => {
  for (const file of ["surfaces.css", "../message/message-window.css"]) {
    it(`${file} carries no text shadow`, () => {
      expect(read(file)).not.toMatch(/text-shadow/);
    });
  }
});
