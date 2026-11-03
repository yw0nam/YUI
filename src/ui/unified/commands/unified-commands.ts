import type { SpeechStream, SpeechStreamControl } from "../../../io/bridge/settings-bridge";
import type { BackendCommand } from "../../../io/chat/push/push-frames";
import type { PresetEntry } from "../../../settings/preset/active-preset";
import { t } from "../../i18n";
import type { Surfaces } from "../../surfaces/surfaces";
import type { Composer } from "../composer";
import { EVERYONE } from "../targets";

export function createUnifiedCommands(deps: {
  composer: Composer;
  box: Pick<Surfaces, "showCommandReply" | "onCommandReplyClose">;
  cast(): PresetEntry[];
  nameOf(preset: string): string;
  isBusy(preset: string): boolean;
}) {
  const commands = new Map<string, BackendCommand[]>();
  const pending = new Map<string, string>();
  const handlers: Array<(event: SpeechStreamControl) => void> = [];
  let replyPreset: string | null = null;
  const emit = (event: SpeechStreamControl): void => {
    for (const cb of handlers) cb(event);
  };
  function refresh(): void {
    const preset = deps.composer.getMention();
    deps.composer.setCommands(
      preset && preset !== EVERYONE ? (commands.get(preset) ?? []) : [],
      preset && preset !== EVERYONE ? deps.nameOf(preset) : undefined,
    );
    const ids = new Set(deps.cast().map((entry) => entry.id));
    for (const id of commands.keys()) if (!ids.has(id)) commands.delete(id);
    for (const id of pending.keys()) if (!ids.has(id)) pending.delete(id);
  }
  deps.composer.onChange(refresh);
  deps.composer.onCommand((name, args) => {
    const preset = deps.composer.getMention();
    if (!preset || preset === EVERYONE) return false;
    if (deps.isBusy(preset)) {
      deps.composer.showError(t("command.busy", { name: deps.nameOf(preset) }));
      return false;
    }
    const command = pending.get(preset);
    if (command !== undefined) {
      deps.composer.showError(t("command.pending", { name: deps.nameOf(preset), command }));
      return false;
    }
    emit({ preset, op: { op: "command", name, args } });
    return true;
  });
  deps.box.onCommandReplyClose(() => {
    if (replyPreset) emit({ preset: replyPreset, op: { op: "command-reply-close" } });
  });
  return {
    refresh,
    accept({ preset, op }: SpeechStream): void {
      switch (op.op) {
        case "commands":
          commands.set(preset, op.commands);
          refresh();
          break;
        case "command-reply":
          if (op.reply.kind === "pending") pending.set(preset, op.reply.name);
          else pending.delete(preset);
          if (op.reply.kind === "clear") {
            if (replyPreset === preset) {
              replyPreset = null;
              deps.box.showCommandReply(op.reply);
            }
          } else {
            replyPreset = preset;
            deps.box.showCommandReply({ ...op.reply, speaker: deps.nameOf(preset) });
          }
          break;
      }
    },
    onControl(cb: (event: SpeechStreamControl) => void): void {
      handlers.push(cb);
    },
  };
}
