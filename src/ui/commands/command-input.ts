import type { BackendCommand } from "../../io/chat/push/push-frames";
import type { SubmitInterception } from "../input/text-input";
import { createCommandList } from "./command-list";

export function createCommandInput({
  field,
  form,
  mount = form,
  label,
}: {
  field: HTMLTextAreaElement;
  form: HTMLFormElement;
  mount?: HTMLElement;
  label?: () => string;
}) {
  let commands: BackendCommand[] = [];
  const handlers: Array<(name: string, args: string) => boolean> = [];
  const list = createCommandList({ field, mount, commands: () => commands, label });
  return {
    setCommands(next: BackendCommand[]): void {
      commands = next;
      list.refresh();
    },
    onCommand(cb: (name: string, args: string) => boolean): void {
      handlers.push(cb);
    },
    interceptSubmit(text: string, images: string[]): SubmitInterception {
      list.close();
      const command = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
      if (images.length > 0 || !command || !commands.some((cmd) => cmd.name === command[1]))
        return false;
      for (const cb of handlers) if (!cb(command[1]!, command[2]?.trim() ?? "")) return "refused";
      return "accepted";
    },
    dispose(): void {
      list.dispose();
      handlers.length = 0;
    },
  };
}
