import type { BackendCommand } from "../../io/chat/push/push-frames";
import { createCommandList } from "./command-list";

export function createCommandInput({
  field,
  form,
}: {
  field: HTMLTextAreaElement;
  form: HTMLFormElement;
}) {
  let commands: BackendCommand[] = [];
  const handlers: Array<(name: string, args: string) => void> = [];
  const list = createCommandList({ field, mount: form, commands: () => commands });
  return {
    setCommands(next: BackendCommand[]): void {
      commands = next;
      list.refresh();
    },
    onCommand(cb: (name: string, args: string) => void): void {
      handlers.push(cb);
    },
    interceptSubmit(text: string, images: string[]): boolean {
      list.close();
      const command = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text);
      if (images.length > 0 || !command || !commands.some((cmd) => cmd.name === command[1]))
        return false;
      for (const cb of handlers) cb(command[1]!, command[2]?.trim() ?? "");
      return true;
    },
    dispose(): void {
      list.dispose();
      handlers.length = 0;
    },
  };
}
