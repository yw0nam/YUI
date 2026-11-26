/** What one pet window holds open in its Ask slot, the push socket's Asks and the client's Settings requests: shown oldest first, the user's pick sent to the owner of the one shown. */

import type { AskAnswer, AskFrame } from "../../io/chat/push/push-frames";
import type {
  AskSlotAnswer,
  AskSlotFrame,
  SettingsRequestDecision,
  SettingsRequestFrame,
} from "../../io/chat/tools/run/settings-request-frame";
import type { Surfaces } from "../../ui/surfaces/surfaces";

/** Who raised a frame: it takes the user's pick and may give the frame a deadline from when it shows. */
export interface AskOwner<A extends AskSlotAnswer = AskSlotAnswer> {
  /** Takes the user's pick on its shown frame; true closes the frame, false keeps it open. */
  answer(answer: A): boolean;
  /** Milliseconds the frame stays once it is the shown head; without it the frame's own `expires_at` holds. */
  shownMs?: number;
  /** One of its frames closed unanswered: its deadline passed or the queue was disposed. */
  expired?(id: string): void;
}

export interface AskQueue {
  /** Appends a frame, or replaces this owner's frame of the same id in place; once disposed, closes it unanswered. */
  put(owner: AskOwner<AskAnswer>, frame: AskFrame): void;
  put(owner: AskOwner<SettingsRequestDecision>, frame: SettingsRequestFrame): void;
  /** Closes this owner's frame of `id`, or every frame it owns when `id` is omitted. */
  remove(owner: AskOwner, id?: string): void;
  dispose(): void;
}

const idOf = (frame: AskSlotFrame): string =>
  frame.type === "ask" ? frame.ask.ask_id : frame.request_id;

export function createAskQueue({
  surfaces,
  now = Date.now,
}: {
  surfaces: Pick<Surfaces, "setAsks" | "onAskAnswer">;
  now?: () => number;
}): AskQueue {
  let open: { owner: AskOwner; frame: AskSlotFrame }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  function publish(): void {
    clearTimeout(timer);
    const time = now();
    const expired = open.filter(
      ({ frame }) => frame.expires_at !== undefined && frame.expires_at <= time,
    );
    open = open.filter((entry) => !expired.includes(entry));
    // A frame with a shown deadline starts counting once it heads the queue.
    const head = open[0];
    if (head?.owner.shownMs !== undefined && head.frame.expires_at === undefined) {
      head.frame = { ...head.frame, expires_at: time + head.owner.shownMs };
    }
    surfaces.setAsks(open.map((entry) => entry.frame));
    const deadlines = open.flatMap(({ frame }) =>
      frame.expires_at === undefined ? [] : [frame.expires_at],
    );
    if (deadlines.length) timer = setTimeout(publish, Math.min(...deadlines) - time);
    for (const { owner, frame } of expired) owner.expired?.(idOf(frame));
  }

  // An Answer reaches only a shown Ask and a decision only a shown Settings request, so each owner gets its own kind.
  surfaces.onAskAnswer((answer) => {
    const head = open[0];
    const [kind, id] =
      "ask_id" in answer ? ["ask", answer.ask_id] : ["settings_request", answer.request_id];
    if (!head || head.frame.type !== kind || idOf(head.frame) !== id) return false;
    const taken = head.owner.answer(answer);
    if (taken) open = open.filter((entry) => entry !== head);
    publish();
    return taken;
  });

  return {
    put(owner: AskOwner, frame: AskSlotFrame) {
      if (disposed) {
        owner.expired?.(idOf(frame));
        return;
      }
      const index = open.findIndex(
        (entry) => entry.owner === owner && idOf(entry.frame) === idOf(frame),
      );
      if (index < 0) open.push({ owner, frame });
      else open[index] = { owner, frame };
      publish();
    },
    remove(owner, id) {
      open = open.filter(
        (entry) => entry.owner !== owner || (id !== undefined && idOf(entry.frame) !== id),
      );
      publish();
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      const left = open;
      open = [];
      surfaces.setAsks([]);
      for (const { owner, frame } of left) owner.expired?.(idOf(frame));
    },
  };
}
