import type { CommandReply } from "../../io/bridge/message/message-bridge";
import { createCommandReply } from "./command-reply";

export function createCommandReplySurface(mount: HTMLElement) {
  const reply = createCommandReply({ mount });
  return {
    show(value: CommandReply): void {
      if (value.kind === "clear") reply.clear();
      else {
        reply.pending(value.name);
        if (value.kind === "settled") reply.settle(value.text);
      }
    },
    dispose: reply.dispose,
  };
}
