/**
 * maybeShowFirstRunHint — one-time onboarding hint through the existing speech
 * bubble. Fires right after the character becomes visible; commits the seen
 * flag on show, not on fade (so a preempting backend speech never resurfaces it).
 */

import { formatAccel } from "./format-accel";

export type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

export interface FirstRunHintDeps {
  seen(): boolean;
  markSeen(): void;
  surfaces: {
    beginSpeech(): void;
    pushSpeech(t: string): void;
    endSpeech(): void;
  };
  hotkey: string;
  isMac: boolean;
  t: TranslateFn;
}

const MARKDOWN_SPECIAL = /([\\`*_{}[\]()#+\-.!|~>])/g;

/** pushSpeech renders markdown; summon_global is arbitrary config text, not markdown. */
function escapeMarkdown(s: string): string {
  return s.replace(MARKDOWN_SPECIAL, "\\$1");
}

export function maybeShowFirstRunHint(deps: FirstRunHintDeps): boolean {
  if (deps.seen()) return false;

  const formatted = formatAccel(deps.hotkey, deps.isMac);
  const text = formatted
    ? deps.t("hint.first_run", { hotkey: escapeMarkdown(formatted) })
    : deps.t("hint.first_run_no_hotkey");

  deps.surfaces.beginSpeech();
  deps.surfaces.pushSpeech(text);
  deps.surfaces.endSpeech();
  deps.markSeen();
  return true;
}
