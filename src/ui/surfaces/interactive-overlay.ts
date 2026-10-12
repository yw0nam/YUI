/**
 * Overlay elements that must take OS pointer events while shown — everything else in the overlay
 * stays click-through. The bubble itself is display-only; the buttons on its edge and the speech
 * action button under the text are targets. The status pill takes them on its capture button, and
 * as a whole only while it offers the voice fix.
 */
export const INTERACTIVE_OVERLAY_SELECTORS = [
  ".yui-input.is-open",
  ".yui-bubble.is-visible .yui-bubble__tools button",
  ".yui-bubble.is-visible .yui-bubble__speech-action button",
  ".yui-status.is-visible .yui-status__capture:not([hidden])",
  '.yui-status.is-visible[data-fix="settings"]',
  ".yui-deleg.is-visible .yui-deleg__chip",
  ".yui-deleg.is-visible .yui-deleg__list.is-open",
] as const;
