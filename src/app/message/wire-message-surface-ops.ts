import type { MessageBridge } from "../../io/bridge/message/message-bridge";
import { receiveSurfaceOp, type SurfacePort } from "../../io/bridge/message/surface-ops";
import { focusWindow } from "../../io/window/geometry/companion-column";
import { createLogger } from "../../logger";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import type { MirroredName } from "./mirrored-name";

const log = createLogger("message-bootstrap");

/** Draws each surface op the pet window sends onto this window's surfaces, and takes the character's name it sends. */
export function wireMessageSurfaceOps({
  bridge,
  surfaces,
  name,
}: {
  bridge: MessageBridge;
  surfaces: Surfaces;
  name: Pick<MirroredName, "set">;
}): void {
  surfaces.onAskAnswer((answer) => {
    bridge.emitControl({ op: "ask-answer", answer });
    return true;
  });
  surfaces.onCommandReplyClose(() => bridge.emitControl({ op: "command-reply-close" }));
  const port: SurfacePort = {
    ...surfaces,
    setName: (n) => name.set(n),
    summonInput: () => {
      // A document focus in an unfocused webview leaves the keystrokes with the pet window.
      void focusWindow("message").then(() => surfaces.summonInput());
    },
    setBusy: (busy) => {
      log.info("busy_recv", { busy });
      surfaces.setBusy(busy);
    },
  };
  bridge.onSurface((op) => {
    if (!receiveSurfaceOp(op, port, (c) => bridge.emitControl(c))) {
      log.warn("unhandled_surface_op", { op: JSON.stringify(op) });
    }
  });
}
