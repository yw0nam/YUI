import type { MessageBridge } from "../../io/bridge/message/message-bridge";
import { createLogger } from "../../logger";
import type { MessagePlate } from "../../ui/message/message-plate";
import type { Surfaces } from "../../ui/surfaces/surfaces";
import { focusWindow } from "./wire-message-tauri-window";

const log = createLogger("message-bootstrap");

/** Draws each surface op the pet window sends onto this window's surfaces and plate. */
export function wireMessageSurfaceOps({
  bridge,
  surfaces,
  plate,
}: {
  bridge: MessageBridge;
  surfaces: Surfaces;
  plate: MessagePlate;
}): void {
  bridge.onSurface((op) => {
    switch (op.op) {
      case "begin":
        plate.setLive(true);
        surfaces.beginSpeech();
        break;
      case "push":
        surfaces.pushSpeech(op.delta);
        break;
      case "end":
        plate.setLive(false);
        surfaces.endSpeech(op.defer ? { defer: true } : undefined);
        break;
      case "finish":
        surfaces.finishSpeech();
        break;
      case "hide":
        plate.setLive(false);
        surfaces.hideSpeech();
        break;
      case "quote":
        surfaces.quoteUser(op.quote);
        break;
      case "settle-quote":
        surfaces.settleQuote();
        break;
      case "clear-quote":
        surfaces.clearQuote();
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
        plate.setBusy(op.busy);
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
