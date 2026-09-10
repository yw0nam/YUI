/**
 * Local summon key — the focused window's "/" opens its text input. Both bootstraps (pet
 * window, message window) bind the same key and the same typing guard; the OS-wide
 * accelerator that summons from any app is a separate path (src/io/summon-hotkey.ts).
 */

import type { Surfaces } from "./surfaces";

/** Input summon hotkey (window-focus only). */
const SUMMON_KEY = "/";

/** Don't intercept the hotkey if focus already sits on an input element. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Summon `surfaces`'s input on the summon key while the window has focus (Esc/Enter are
 * handled inside the input). Returns the detach.
 */
export function attachSummonKey(
  surfaces: Pick<Surfaces, "isInputOpen" | "summonInput">,
): () => void {
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== SUMMON_KEY || e.metaKey || e.ctrlKey || e.altKey) return;
    if (surfaces.isInputOpen()) return;
    if (isTypingTarget(e.target)) return;
    e.preventDefault();
    surfaces.summonInput();
  }
  window.addEventListener("keydown", onKeydown);
  return () => window.removeEventListener("keydown", onKeydown);
}
