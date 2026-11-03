/** The shown bubble, which steps aside while an Ask card shows. */
export const BUBBLE =
  ".yui-ui:not(:has(.yui-ask-card:not([hidden]), .yui-cmd-reply:not([hidden]), .yui-cmd-list:not([hidden]))) .yui-bubble.is-visible";

/**
 * Overlay elements that must take OS pointer events while shown — everything else in the overlay
 * stays click-through. Of the bubble, the box (a click completes the line), the buttons on its edge,
 * the speech action button under the text, and the backlog's toggle and open panel are targets; the
 * area around them passes through to the character. The status pill takes them on its capture
 * button, and as a whole only while it offers the voice fix. The Threads chip and the Ask card take
 * them while they show.
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
  '.yui-status.is-visible[data-fix="settings"]',
  ".yui-deleg.is-visible .yui-deleg__chip",
  ".yui-deleg.is-visible .yui-deleg__list.is-open",
  ".yui-sigchips.is-visible .yui-sigchip",
  ".yui-sigchips.is-visible .yui-sigchip__more",
  ".yui-sigdetails",
  ".yui-threadchip:not([hidden])",
  ".yui-ask-card:not([hidden])",
] as const;
