/** A Settings request: the user's decision on settings an agent may change only with their Allow, shown in the Ask slot. */

import type { RequestSettings, SettingsDecision } from "../../io/chat/tools/run/settings-api";
import {
  NOTE_MAX,
  type SettingsRequestDecision,
} from "../../io/chat/tools/run/settings-request-frame";
import type { AskOwner, AskQueue } from "./ask-queue";

export type { RequestSettings, SettingsDecision };

/** How long the card waits for the user once it shows. */
const SHOWN_MS = 60_000;

/** The bridge checks only a control op's name, so a decision from the popped window may hold anything. */
const wellFormed = ({ allow, note }: SettingsRequestDecision): boolean =>
  Array.isArray(allow) &&
  allow.every((path) => typeof path === "string") &&
  (note === undefined || typeof note === "string");

export function createSettingsRequest(deps: {
  asks: Pick<AskQueue, "put" | "remove">;
  /** The character's name, as the card's title shows it. */
  name: () => string;
}): RequestSettings {
  let open = false;
  return ({ changes, why }, signal) =>
    new Promise((resolve) => {
      if (signal.aborted) {
        resolve("no answer");
        return;
      }
      if (open) {
        resolve("busy");
        return;
      }
      open = true;
      const finish = (decision: SettingsDecision): void => {
        open = false;
        signal.removeEventListener("abort", withdraw);
        resolve(decision);
      };
      const owner: AskOwner<SettingsRequestDecision> = {
        shownMs: SHOWN_MS,
        answer: (decision) => {
          if (!wellFormed(decision)) return false;
          const note = [...(decision.note?.trim() ?? "")].slice(0, NOTE_MAX).join("");
          finish({
            allow: changes.map((c) => c.path).filter((path) => decision.allow.includes(path)),
            ...(note ? { note } : {}),
          });
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
        type: "settings_request",
        request_id: crypto.randomUUID(),
        name: deps.name(),
        changes,
        why,
      });
    });
}
