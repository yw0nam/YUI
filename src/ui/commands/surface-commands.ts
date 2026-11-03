import { t } from "../i18n";
import type { createTextInput } from "../input/text-input";
import { createCommandInput } from "./command-input";

export function createSurfaceCommands(deps: {
  field: HTMLTextAreaElement;
  form: HTMLFormElement;
  input: Pick<ReturnType<typeof createTextInput>, "setBusy" | "showInputError">;
}) {
  const commands = createCommandInput(deps);
  let busy = false;
  return {
    ...commands,
    setBusy(next: boolean): void {
      busy = next;
      deps.input.setBusy(next);
    },
    onCommand(cb: (name: string, args: string) => boolean): void {
      commands.onCommand((name, args) => {
        if (busy) {
          deps.input.showInputError(t("command.busy_self"));
          return false;
        }
        return cb(name, args);
      });
    },
  };
}
