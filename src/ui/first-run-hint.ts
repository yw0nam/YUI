/**
 * maybeShowFirstRunHint — one-time onboarding hint through the existing speech
 * bubble. Fires right after the character becomes visible; commits the seen
 * flag on show, not on fade (so a preempting backend speech never resurfaces it).
 *
 * With no chat backend configured the hint becomes setup guidance and stays
 * uncommitted, so it keeps pointing at Settings → Advanced until chat works.
 */

import { formatAccel } from "./format-accel";

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

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
  /** Whether a chat backend address is set. False switches the hint to setup guidance. */
  chatConfigured: boolean;
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
  const text = !deps.chatConfigured
    ? deps.t("hint.setup_backend")
    : formatted
      ? deps.t("hint.first_run", { hotkey: escapeMarkdown(formatted) })
      : deps.t("hint.first_run_no_hotkey");

  deps.surfaces.beginSpeech();
  deps.surfaces.pushSpeech(text);
  deps.surfaces.endSpeech();
  if (deps.chatConfigured) deps.markSeen();
  return true;
}
