/** The shown bubble, which steps aside while an Ask card shows. */
export const BUBBLE =
  ".yui-ui:not(:has(.yui-ask-card:not([hidden]), .yui-cmd-reply:not([hidden]), .yui-cmd-list:not([hidden]))) .yui-bubble.is-visible";

/** The chip column, which takes no hits while the Character menu is open. */
const CHIP_COLUMN = ".yui-ui:not(:has(> .yui-cmenu:not([hidden]))) .yui-chip-column";

/**
 * Overlay elements that must take OS pointer events while shown — everything else in the overlay
 * stays click-through. Of the bubble, the box (a click completes the line), the buttons on its edge,
 * the speech action button under the text, and the backlog's toggle and open panel are targets; the
 * area around them passes through to the character. The status pill takes them on its capture
 * button and on its action button while it offers one. The chips take them while they show and
 * the Character menu is closed, the Ask card while it shows, and the Character menu on its pills alone.
 */
export const INTERACTIVE_OVERLAY_SELECTORS = [
  ".yui-input.is-open",
  ".yui-cmd-list:not([hidden])",
  ".yui-ui:not(:has(.yui-ask-card:not([hidden]))) .yui-cmd-reply:not([hidden])",
  `${BUBBLE} .yui-bubble__tools button`,
  `${BUBBLE} .yui-bubble__box`,
  `${BUBBLE} .yui-bubble__speech-action button`,
  `${BUBBLE} .yui-bubble__backlog-toggle:not([hidden])`,
  `${BUBBLE} .yui-bubble__backlog:not([hidden])`,
  ".yui-status.is-visible .yui-status__capture:not([hidden])",
  ".yui-status.is-visible .yui-status__action:not([hidden])",
  `${CHIP_COLUMN} .yui-deleg.is-visible .yui-deleg__chip`,
  `${CHIP_COLUMN} .yui-deleg.is-visible .yui-deleg__list.is-open`,
  `${CHIP_COLUMN} .yui-sigchips.is-visible .yui-sigchip`,
  `${CHIP_COLUMN} .yui-sigchips.is-visible .yui-sigchip__more`,
  `${CHIP_COLUMN} .yui-sigdetails`,
  `${CHIP_COLUMN} .yui-threadchip:not([hidden])`,
  ".yui-ask-card:not([hidden])",
  ".yui-cmenu:not([hidden]) .yui-cmenu__pill",
] as const;
