import type { AskAnswer } from "../../../io/chat/push/push-frames";
import type { PushSocket } from "../../../io/chat/push/push-socket";
import type { AskOwner, AskQueue } from "../ask-queue";

/** Feeds the push socket's Asks into the window's ask queue and sends their Answers back. */
export function wireAskSession({
  socket,
  asks,
}: {
  socket: Pick<PushSocket, "onAsk" | "onAskEnd" | "onState" | "sendAnswer">;
  asks: Pick<AskQueue, "put" | "remove">;
}): () => void {
  const owner: AskOwner<AskAnswer> = {
    answer: (value) => socket.sendAnswer({ type: "answer", ...value }),
  };
  const offs = [
    socket.onAsk((frame) => asks.put(owner, frame)),
    socket.onAskEnd((id) => asks.remove(owner, id)),
    socket.onState((state) => {
      if (state.kind !== "ready") asks.remove(owner);
    }),
  ];
  return () => {
    for (const off of offs) off();
    asks.remove(owner);
  };
}
