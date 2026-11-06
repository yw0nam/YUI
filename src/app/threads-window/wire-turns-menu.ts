/** Wires the Character turns menu: a pick writes Thread turns and tells the other windows; both stores redraw it. */

import type { createAgentNotifySettings } from "../../settings/backend/agent-notify-settings";
import type {
  ThreadTurnsLevel,
  ThreadTurnsSettingsStore,
} from "../../settings/threads/thread-turns-settings";
import type { TurnsState } from "../../ui/threads/window/turns-menu";

export function wireTurnsMenu(deps: {
  turns: Pick<ThreadTurnsSettingsStore, "get" | "setLevel" | "subscribe">;
  agentNotify: Pick<ReturnType<typeof createAgentNotifySettings>, "get" | "subscribe">;
  show(state: TurnsState): void;
  emitSettingsChanged(): void;
}): { pick(level: ThreadTurnsLevel): void; dispose(): void } {
  const draw = (): void =>
    deps.show({ level: deps.turns.get().level, disabled: !deps.agentNotify.get().enabled });
  // The bridge never hands a window its own settings-changed, so a local pick redraws from here.
  const offTurns = deps.turns.subscribe(draw);
  const offNotify = deps.agentNotify.subscribe(draw);
  draw();
  return {
    pick(level) {
      deps.turns.setLevel(level);
      deps.emitSettingsChanged();
    },
    dispose() {
      offTurns();
      offNotify();
    },
  };
}
