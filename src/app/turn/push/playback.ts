import type { PreviousTurnSlot } from "../../../dispatcher/backend/previous-turn";
import type { PushSocket } from "../../../io/chat/push/push-socket";

export function wirePlayback(deps: {
  previousTurn: Pick<PreviousTurnSlot, "subscribe">;
  socket: Pick<PushSocket, "getState" | "sendPlayback">;
}): () => void {
  return deps.previousTurn.subscribe((record) => {
    if (!record.turn_id || deps.socket.getState().kind !== "ready") return;
    deps.socket.sendPlayback({
      type: "playback",
      turn_id: record.turn_id,
      ended: record.ended,
      ...(record.spoken ? { spoken: record.spoken } : {}),
      ...(record.unspoken ? { unspoken: record.unspoken } : {}),
    });
  });
}
