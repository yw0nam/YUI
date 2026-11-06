/** Wires the Thread turns menu: a pick writes Thread turns and tells the other windows; both stores redraw it. */

import type { AgentNotifySettingsStore } from "../../settings/backend/agent-notify-settings";
import type {
  ThreadTurnsLevel,
  ThreadTurnsSettingsStore,
} from "../../settings/threads/thread-turns-settings";
import type { TurnsState } from "../../ui/threads/window/turns-menu";

export function wireTurnsMenu(deps: {
  turns: Pick<ThreadTurnsSettingsStore, "get" | "setLevel" | "subscribe">;
  agentNotify: Pick<AgentNotifySettingsStore, "get" | "subscribe">;
  emitSettingsChanged(): void;
}): {
  pick(level: ThreadTurnsLevel): void;
  /** Draws the state now and on every change of either store; returns the unsubscribe. */
  draw(show: (state: TurnsState) => void): () => void;
} {
  return {
    pick(level) {
      deps.turns.setLevel(level);
      deps.emitSettingsChanged();
    },
    draw(show) {
      const draw = (): void =>
        show({ level: deps.turns.get().level, disabled: !deps.agentNotify.get().enabled });
      // The bridge never hands a window its own settings-changed, so a local pick redraws from here.
      const offTurns = deps.turns.subscribe(draw);
      const offNotify = deps.agentNotify.subscribe(draw);
      draw();
      return () => {
        offTurns();
        offNotify();
      };
    },
  };
}
