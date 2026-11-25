/** A Settings request: the user's Allow or Deny on settings an agent may change only with it, asked in the Ask card. */

import type { SettingsChange } from "../../settings/agent-access/document";
import { settingsRequestPrompt } from "../../ui/ask/settings-request-prompt";
import { t } from "../../ui/i18n";
import type { AskOwner, AskQueue } from "./ask-queue";

export type SettingsAnswer = "allow" | "deny" | "no answer";

export type RequestSettings = (
  request: { changes: SettingsChange[]; why?: string },
  signal: AbortSignal,
) => Promise<SettingsAnswer>;

/** How long the card waits for the user once it shows. */
const SHOWN_MS = 60_000;

export function createSettingsRequest(deps: {
  asks: Pick<AskQueue, "put" | "remove">;
  /** The character's name, as the card's title shows it. */
  name: () => string;
}): RequestSettings {
  let count = 0;
  return ({ changes, why }, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve("no answer");
        return;
      }
      const finish = (answer: SettingsAnswer): void => {
        signal.removeEventListener("abort", withdraw);
        resolve(answer);
      };
      const owner: AskOwner = {
        shownMs: SHOWN_MS,
        answer: (answer) => {
          finish(answer.choice === "allow" ? "allow" : "deny");
          return true;
        },
        expired: () => finish("no answer"),
      };
      const withdraw = (): void => {
        deps.asks.remove(owner);
        finish("no answer");
      };
      signal.addEventListener("abort", withdraw);
      deps.asks.put(owner, {
        type: "ask",
        ask: {
          ask_id: `settings-request-${++count}`,
          prompt: settingsRequestPrompt(deps.name(), changes, why),
          choices: [
            { id: "deny", label: t("settings_request.deny"), tone: "danger" },
            { id: "allow", label: t("settings_request.allow"), tone: "primary" },
          ],
          text: false,
        },
      });
    });
}
