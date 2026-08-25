/**
 * screen_source — frontmost-app transition firing source.
 *
 * Subscribes to the shared `os_event` channel, reads bare `os_idle_tick`, and runs a dwell
 * state machine over the frontmost app carried on each tick. Two transitions fire
 * `proactive.screen_<transition>` (tier2):
 *  - `app_switched`: the departed app held the foreground for `prev_dwell_ms` and the new app
 *    then held it for `settle_ms`.
 *  - `long_session`: one app has held the foreground for `long_session_ms`, re-marking each period.
 *
 * The clock is keyed on app identity alone — the frontmost tracker's `since` restamps on
 * title-only changes, so this source keeps its own and a title change is never a transition.
 * A tick with no frontmost app carries no identity and holds the clock where it is.
 *
 * Presence lapsing resets both clocks and clears the `recent` buffer described below: time away
 * never counts toward a dwell, a session, or a held path — an overnight-stale path must not
 * ship on the first morning fire.
 *
 * A candidate that survives to the gate is refused when the feature is off, the user is away,
 * the global proactive pacer still holds its window open, the min gap since the last screen
 * fire has not passed, or a turn from any producer landed within `quiet_after_turn_ms`. A
 * refused `long_session` mark is skipped, not queued — the next fire is the next mark. Every
 * fire re-anchors the idle-cue gap so proactive cues do not pile onto it.
 *
 * While the pacer holds, each `app_switched` refusal it causes is accumulated into a rolling
 * `recent` buffer (capped at `recent_cap`, oldest dropped on overflow, drained toward a lowered
 * cap on every tick) instead of being lost; `long_session` refusals are never a transition and
 * are never buffered. The next fire that actually ships carries the buffer and clears it. Every
 * tick while the feature is off or the user is away also clears it — not only a tick that
 * happens to evaluate a candidate — so a re-enable or a return never leaks a stale path.
 *
 * firing ≠ judgment: this only produces a candidate event; the backend decides
 * whether/what to speak.
 */

import type { ScreenConfig } from "../config";
import type { OsEventListen, OsEventPayload } from "../io/tauri-listen";
import { subscribeOsEvent } from "../io/tauri-listen";
import { buildSkipRecord, type ScreenSkipRecord, type SkipReason } from "../io/turn-record-log";
import { createLogger } from "../logger";
import type { BusEnvelope, EventBus } from "./event-bus";

const log = createLogger("screen-source");

type ScreenTransition = "app_switched" | "long_session";

/** The app left behind by an identity change, awaiting the new app's settle. */
interface PendingSwitch {
  app: string;
  dwell_ms: number;
}

/** An app_switched transition held back by the pacer instead of firing. */
interface RecentTransition {
  from_app: string;
  to_app: string;
  dwell_min: number;
}

interface ScreenSourceDeps {
  bus: Pick<EventBus, "push">;
  present_max_idle_ms: number;
  /** Read inside the tick handler — thresholds stay editable without restarting the source. */
  getConfig: () => ScreenConfig;
  /** Read inside the tick handler — gates firing without stopping the subscription. */
  isEnabled: () => boolean;
  /** Re-anchors the idle-cue gap on a fire. */
  noteInteraction?: () => void;
  /** Backend-turn busy edges — each one re-anchors the quiet-after-turn window. */
  subscribeBusy?: (cb: (busy: boolean) => void) => () => void;
  /** Global proactive gap — a candidate inside the window is skipped, not queued. */
  isPacerHolding?: () => boolean;
  /** Skip-record JSONL sink — best-effort disk log of suppressed fires for analysis. */
  appendSkipRecord?: (record: ScreenSkipRecord) => void;
  /** Injectable channel listen; defaults to the resolved Tauri `listen`. */
  listen?: OsEventListen;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

export interface ScreenSource {
  start(): Promise<void>;
  stop(): void;
}

const toMin = (ms: number): number => Math.round(ms / 60_000);

export function createScreenSource(deps: ScreenSourceDeps): ScreenSource {
  const { bus, present_max_idle_ms, getConfig, isEnabled } = deps;
  const now = deps.now ?? Date.now;

  let unlisten: (() => void) | undefined;
  let unsubscribeBusy: (() => void) | undefined;

  let currentApp: string | undefined;
  let appSince: number | undefined;
  let pending: PendingSwitch | undefined;
  /** Start of the current long-session period; re-stamped on each mark and each app change. */
  let markedAt: number | undefined;
  let lastFireTs: number | undefined;
  let lastTurnTs: number | undefined;
  let away = false;
  /** app_switched transitions held back by the pacer, oldest first. Shipped on the next fire. */
  let recent: RecentTransition[] = [];

  function suppressionReason(t: number, present: boolean): SkipReason | undefined {
    if (!isEnabled()) return "disabled";
    if (!present) return "not_present";
    if (deps.isPacerHolding?.()) return "global_gap";
    const cfg = getConfig();
    if (lastTurnTs !== undefined && t - lastTurnTs < cfg.quiet_after_turn_ms) {
      return "quiet_after_turn";
    }
    if (lastFireTs !== undefined && t - lastFireTs < cfg.min_gap_ms) return "min_gap";
    return undefined;
  }

  /** Buffers a held app_switched transition, then drains back down to `cap` (0 = accumulate
      nothing). The tick-top drain above already bounds `recent` to the live cap on entry, so this
      only ever has the one just-pushed entry to shed. */
  function pushRecent(from_app: string, to_app: string, dwell_min: number, cap: number): void {
    recent.push({ from_app, to_app, dwell_min });
    while (recent.length > Math.max(0, cap)) recent.shift();
  }

  function fire(
    transition: ScreenTransition,
    t: number,
    dwellMs: number,
    from: PendingSwitch | undefined,
  ): void {
    const dwell_min = toMin(dwellMs);
    const fromFields = from ? { from_app: from.app, from_dwell_min: toMin(from.dwell_ms) } : {};
    const recentFields = recent.length > 0 ? { recent } : {};
    const env: BusEnvelope = {
      source: "screen_watcher",
      event_name: `proactive.screen_${transition}`,
      ts: t,
      hint_tier: 2,
      dnd_override: false,
      payload: { transition, dwell_min, ...fromFields, ...recentFields },
    };
    bus.push(env);
    lastFireTs = t;
    recent = [];
    deps.noteInteraction?.();
    log.info("fire", { transition, app: currentApp, dwell_min, ...fromFields });
  }

  function resetClocks(): void {
    currentApp = undefined;
    appSince = undefined;
    pending = undefined;
    markedAt = undefined;
  }

  function onTick(payload: OsEventPayload): void {
    if (payload.event_name !== "os_idle_tick") return;
    const idle = payload.data.os_idle_ms;
    // Null idle (e.g. Windows) carries no presence signal — ignore entirely.
    if (idle == null) return;

    const present = idle <= present_max_idle_ms;
    const t = now();
    const app = payload.data.frontmost_app ?? undefined;
    const cfg = getConfig();

    // Drains toward the live cap on every tick, not only when a new suppression pushes — a cap
    // lowered mid-hold takes effect even if no further switch happens before the next fire.
    while (recent.length > Math.max(0, cfg.recent_cap)) recent.shift();

    if (present && away) away = false;

    // App identity only; the window title never enters the comparison.
    if (present && app !== undefined && app !== currentApp) {
      pending =
        currentApp !== undefined && appSince !== undefined
          ? { app: currentApp, dwell_ms: t - appSince }
          : undefined;
      log.debug("transition", { from: currentApp, to: app, from_dwell_ms: pending?.dwell_ms });
      currentApp = app;
      appSince = t;
      markedAt = t;
    }

    const held = appSince === undefined ? 0 : t - appSince;
    let transition: ScreenTransition | undefined;
    let from: PendingSwitch | undefined;
    if (pending !== undefined && held >= cfg.settle_ms) {
      if (pending.dwell_ms >= cfg.prev_dwell_ms) {
        transition = "app_switched";
        from = pending;
      }
      // Consumed either way: a settled switch is decided once, never re-examined.
      pending = undefined;
    } else if (markedAt !== undefined && t - markedAt >= cfg.long_session_ms) {
      transition = "long_session";
      markedAt = t;
    }

    if (transition !== undefined) {
      const reason = suppressionReason(t, present);
      if (reason) {
        log.info("fire.suppressed", { transition, reason, app: currentApp });
        if (
          reason === "global_gap" &&
          transition === "app_switched" &&
          from &&
          currentApp !== undefined
        ) {
          pushRecent(from.app, currentApp, toMin(from.dwell_ms), cfg.recent_cap);
        }
        try {
          deps.appendSkipRecord?.(buildSkipRecord({ ts: t, reason, transition }));
        } catch (err) {
          log.debug("skip_record_append_failed", { error: String(err) });
        }
      } else {
        fire(transition, t, held, from);
      }
    }

    if (!present) {
      away = true;
      resetClocks();
    }
    // Both invalidating conditions in one place: disabled or away, checked every tick, not only
    // when a candidate happened to be evaluated this tick.
    if (!isEnabled() || !present) recent = [];
  }

  async function start(): Promise<void> {
    if (unlisten) return;
    unsubscribeBusy ??= deps.subscribeBusy?.(() => {
      lastTurnTs = now();
    });
    unlisten = await subscribeOsEvent({ listen: deps.listen, onTick, log });
  }

  function stop(): void {
    unlisten?.();
    unlisten = undefined;
    unsubscribeBusy?.();
    unsubscribeBusy = undefined;
  }

  return { start, stop };
}
