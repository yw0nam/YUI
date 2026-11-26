/** A Settings request as the Ask slot carries it, and the user's decision on it, beside the push Ask and its Answer. */

import type { SettingsChange } from "../../../../settings/agent-access/document";
import type { AskAnswer, AskFrame } from "../../push/push-frames";

/** A Settings request as the Ask slot draws it: the client raises it, so it never crosses the push transport. */
export interface SettingsRequestFrame {
  type: "settings_request";
  request_id: string;
  /** The character's name, as the card's title shows it. */
  name: string;
  changes: SettingsChange[];
  why?: string;
  /** Epoch ms; set when the frame heads the queue. */
  expires_at?: number;
}

/** The user's pick on one Settings request: the paths they allowed (empty on Deny), and their trimmed note. */
export interface SettingsRequestDecision {
  request_id: string;
  allow: string[];
  note?: string;
}

/** What the Ask slot shows: a push Ask or a Settings request. */
export type AskSlotFrame = AskFrame | SettingsRequestFrame;
/** What the Ask slot answers: an Ask's Answer, matched by ask_id, or a Settings request's decision, matched by request_id. */
export type AskSlotAnswer = AskAnswer | SettingsRequestDecision;
