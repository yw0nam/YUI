import type { PushSocket } from "../../../io/chat/push/push-socket";
import { createAskCard } from "../../../ui/ask/ask-card";

/**
 * Routes a push socket's `ask` and `ask_end` frames into the Ask card at `mount`, clears the card
 * once the socket leaves `ready`, and sends the user's answer back as an `answer` frame. The
 * returned function unsubscribes and disposes the card.
 */
export function wireAskCard(deps: {
  socket: Pick<PushSocket, "onAsk" | "onAskEnd" | "onState" | "sendAnswer">;
  mount: HTMLElement;
}): () => void {
  const { socket } = deps;
  const card = createAskCard({
    mount: deps.mount,
    onAnswer: (answer) => socket.sendAnswer({ type: "answer", ...answer }),
  });
  const offs = [
    socket.onAsk(card.show),
    socket.onAskEnd(card.end),
    socket.onState((state) => {
      if (state.kind !== "ready") card.clear();
    }),
  ];
  return () => {
    for (const off of offs) off();
    card.dispose();
  };
}
