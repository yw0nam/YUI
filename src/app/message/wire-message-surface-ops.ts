import type { MessageBridge } from "../../io/bridge/message/message-bridge";
import { createLogger } from "../../logger";
import { applySpeechOp } from "../../ui/surfaces/apply-speech-op";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import type { MirroredName } from "./mirrored-name";
import { focusWindow } from "./wire-message-tauri-window";

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
  bridge.onSurface((op) => {
    switch (op.op) {
      case "begin":
      case "push":
      case "pace":
      case "end":
      case "finish":
      case "hide":
      case "quote":
      case "quote-signals":
      case "settle-quote":
      case "clear-quote":
        applySpeechOp(op, surfaces);
        break;
      case "name":
        name.set(op.name);
        break;
      case "summon-input":
        // A document focus in an unfocused webview leaves the keystrokes with the pet window.
        void focusWindow().then(() => surfaces.summonInput());
        break;
      case "dismiss-input":
        surfaces.dismissInput();
        break;
      case "busy":
        log.info("busy_recv", { busy: op.busy });
        surfaces.setBusy(op.busy);
        break;
      case "input-error":
        surfaces.showInputError(
          op.message,
          op.action
            ? {
                label: op.action.label,
                onClick: () => bridge.emitControl({ op: "input-error-action" }),
              }
            : undefined,
        );
        break;
      case "speech-action":
        surfaces.showSpeechAction(
          op.action
            ? {
                label: op.action.label,
                onClick: () => bridge.emitControl({ op: "speech-action" }),
              }
            : undefined,
        );
        break;
      case "attachment-limits":
        surfaces.setAttachmentLimits(op.limits);
        break;
      case "restore-input":
        surfaces.restoreInput(op.text, op.images);
        break;
      default: {
        const unhandled: never = op;
        log.warn("unhandled_surface_op", { op: JSON.stringify(unhandled) });
      }
    }
  });
}
