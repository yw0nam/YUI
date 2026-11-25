/** A Settings request: the user's Allow or Deny on settings an agent may change only with it, asked in the Ask card. */

import type { SettingsChange } from "../../settings/agent-access/document";
import type { AskQueue } from "./ask-queue";

export type SettingsAnswer = "allow" | "deny" | "no answer";

export type RequestSettings = (
  request: { changes: SettingsChange[]; why?: string },
  signal: AbortSignal,
) => Promise<SettingsAnswer>;

export function createSettingsRequest(_deps: {
  asks: Pick<AskQueue, "put" | "remove">;
  /** The character's name, as the card's title shows it. */
  name: () => string;
}): RequestSettings {
  return () => new Promise(() => {});
}
