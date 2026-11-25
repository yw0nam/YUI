/** One pet window's open Asks, push Asks and Settings requests alike: shown oldest first, each Answer sent to the owner of the shown one. */

import type { AskAnswer, AskFrame } from "../../io/chat/push/push-frames";
import type { Surfaces } from "../../ui/surfaces/surfaces";

/** Who raised a frame: it takes the Answer and may give the frame a deadline from when it shows. */
export interface AskOwner {
  /** Takes the user's Answer to its shown frame; true closes the frame, false keeps it open. */
  answer(answer: AskAnswer): boolean;
  /** Milliseconds the frame stays once it is the shown head; without it the frame's own `expires_at` holds. */
  shownMs?: number;
  /** One of its frames closed at its deadline. */
  expired?(id: string): void;
}

export interface AskQueue {
  /** Appends a frame, or replaces this owner's frame of the same `ask_id` in place. */
  put(owner: AskOwner, frame: AskFrame): void;
  /** Closes this owner's frame of `id`, or every frame it owns when `id` is omitted. */
  remove(owner: AskOwner, id?: string): void;
  dispose(): void;
}

export function createAskQueue(_deps: {
  surfaces: Pick<Surfaces, "setAsks" | "onAskAnswer">;
  now?: () => number;
}): AskQueue {
  return { put() {}, remove() {}, dispose() {} };
}
