/**
 * drag-hold-source — proactive.drag_held reflex candidate.
 *
 * Client-firing, backend-judged (firing ≠ judgment): a drag held past holdMs pushes
 * ONE tier2 candidate; the backend decides whether/what to say. Fires once per drag —
 * no repeat while sustained, no cooldown. noteDragEnd disarms; the next noteDragStart re-arms.
 */

import type { GestureCueConfig } from "../config/load";
import type { EventBus } from "../dispatcher/event-bus";

export interface DragHoldSourceDeps {
  bus: Pick<EventBus, "push">;
  /** Hold duration (ms) before the reflex fires — read at arm time so config hot-reload applies. */
  getHoldMs: () => number;
  /** Cue read at fire time (label/context from config, live). */
  getCue: () => GestureCueConfig;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
  /** Injectable timer fns (fake timers in tests). */
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

export interface DragHoldSource {
  /** Arm the hold timer. Cancels any timer already pending. */
  noteDragStart(): void;
  /** Cancel a pending timer and disarm. */
  noteDragEnd(): void;
}

export function createDragHoldSource(deps: DragHoldSourceDeps): DragHoldSource {
  const { bus, getHoldMs, getCue } = deps;
  const now = deps.now ?? Date.now;
  const setTimeoutImpl = deps.setTimeout ?? setTimeout;
  const clearTimeoutImpl = deps.clearTimeout ?? clearTimeout;

  let timer: ReturnType<typeof setTimeout> | null = null;

  function disarm(): void {
    if (timer !== null) {
      clearTimeoutImpl(timer);
      timer = null;
    }
  }

  return {
    noteDragStart() {
      disarm();
      timer = setTimeoutImpl(() => {
        timer = null;
        const cue = getCue();
        bus.push({
          source: "os_event_watcher",
          event_name: "proactive.drag_held",
          ts: now(),
          hint_tier: 2,
          payload: { cue_id: "drag_held", label: cue.label, context: cue.context },
        });
      }, getHoldMs());
    },
    noteDragEnd() {
      disarm();
    },
  };
}
