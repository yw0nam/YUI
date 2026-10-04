/**
 * Binds the push socket's state onto the plate's connection tell — the initial state read first,
 * then every transition.
 */

import type { PushSocket, PushSocketState } from "../../io/chat/push/push-socket";
import type { MessagePlate } from "./message-plate";

function toConnection(state: PushSocketState): "up" | "reconnecting" | "failed" {
  if (state.kind === "connecting" || state.kind === "reconnecting") return "reconnecting";
  if (state.kind === "failed") return "failed";
  // A socket that is meant to be down is no loss.
  return "up";
}

export function bindPlateConnection(
  plate: Pick<MessagePlate, "setConnection">,
  socket: Pick<PushSocket, "getState" | "onState">,
): () => void {
  plate.setConnection(toConnection(socket.getState()));
  return socket.onState((state) => plate.setConnection(toConnection(state)));
}
