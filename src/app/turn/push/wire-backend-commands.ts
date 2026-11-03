import type { PushSocket } from "../../../io/chat/push/push-socket";
import { createLogger } from "../../../logger";
import type { Surfaces } from "../../../ui/surfaces/surfaces";

const log = createLogger("wire-backend-commands");

export function wireBackendCommands({
  socket,
  surfaces,
}: {
  socket: Pick<
    PushSocket,
    "onCommands" | "getCommands" | "sendCommand" | "onCommandReply" | "onState"
  >;
  surfaces: Pick<Surfaces, "setCommands" | "onCommand" | "showCommandReply">;
}): () => void {
  let pending: { id: string; name: string } | null = null;
  let disposed = false;
  surfaces.setCommands(socket.getCommands());
  surfaces.onCommand((name, args) => {
    if (disposed || pending) return;
    const id = crypto.randomUUID();
    if (!socket.sendCommand({ type: "command", id, name, args })) return;
    pending = { id, name };
    surfaces.showCommandReply({ kind: "pending", name });
    log.info("command_sent", { name });
  });
  const offs = [
    socket.onCommands(surfaces.setCommands),
    socket.onCommandReply((frame) => {
      if (!pending || pending.id !== frame.id) return;
      const { name } = pending;
      pending = null;
      surfaces.showCommandReply({ kind: "settled", name, text: frame.text });
      log.info("command_reply", { name, chars: [...frame.text].length });
      log.debug("command_reply_text", { name, text: frame.text });
    }),
    socket.onState((state) => {
      if (state.kind === "ready") return;
      pending = null;
      surfaces.showCommandReply({ kind: "clear" });
    }),
  ];
  return () => {
    disposed = true;
    pending = null;
    for (const off of offs) off();
  };
}
