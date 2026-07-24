/**
 * fade-out.ts — settle callback for elements that fade out before leaving the a11y tree.
 *
 * Surfaces drop `is-visible` to start the fade, then set `hidden` once it ends, so `hidden=true`
 * never cuts the transition off. The settle callback re-checks its own state, because a re-show
 * can land before the fade finishes.
 */

// Fallback for environments where the transition never fires. A rAF (next frame ~16ms) is
// shorter than the fade (--yui-dur 200ms / -fast 140ms) and would cut it off, so the timer must exceed that ceiling.
const FADE_FALLBACK_MS = 400; // ponytail: safety net exceeding the --yui-dur/-fast ceiling

/** Runs `settle` once — on the element's opacity transitionend, or on the fallback timer. */
export function afterFadeOut(el: HTMLElement, settle: () => void): void {
  const fallback = setTimeout(run, FADE_FALLBACK_MS);

  function run(): void {
    clearTimeout(fallback);
    el.removeEventListener("transitionend", onEnd);
    settle();
  }

  function onEnd(e: TransitionEvent): void {
    if (e.propertyName === "opacity") run();
  }

  el.addEventListener("transitionend", onEnd);
}
