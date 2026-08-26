import type { TapConfig } from "../config/load";
import type { SignalGroup } from "../contract";
import type { EventBus } from "../dispatcher/event-bus";
import { createLogger } from "../logger";
import {
  type CssPoint,
  classifyTapRegion,
  type TapRegion,
  type TapRegionBones,
} from "../renderer/tap-region";

const log = createLogger("tap-source");

export type { TapConfig } from "../config/load";

export interface TapPoints extends TapRegionBones {
  charHpx: number;
}

export interface TapSource {
  handleClick(pos: CssPoint): void;
  /** True when a press at `pos` lands on the head region — arms the pat gesture. */
  isHeadPoint(pos: CssPoint): boolean;
  handlePatStart(): void;
  /** Pat released — ends the reaction and offers the release speech cue. */
  handlePatEnd(): void;
  /** Pat interrupted by teardown — ends the reaction without a speech cue. */
  handlePatAbort(): void;
}

interface TapSourceDeps {
  bus: Pick<EventBus, "push">;
  renderer: {
    getTapPoints(): TapPoints | null;
    getCurrentMotion(): { id: string; vrma_path: string } | null;
  };
  ambient: { trigger(cue: "tap_react"): void };
  config: TapConfig;
  drainSignals?: () => SignalGroup[];
  now?: () => number;
}

function isPoint(value: unknown): value is CssPoint {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<CssPoint>;
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isTapPoints(value: unknown): value is TapPoints {
  if (!value || typeof value !== "object") return false;
  const points = value as Partial<TapPoints>;
  return (
    typeof points.charHpx === "number" &&
    Number.isFinite(points.charHpx) &&
    points.charHpx > 0 &&
    (points.head === null || isPoint(points.head)) &&
    (points.chest === null || isPoint(points.chest)) &&
    (points.hips === null || isPoint(points.hips))
  );
}

export function createTapSource(deps: TapSourceDeps): TapSource {
  const now = deps.now ?? Date.now;
  const clicks: number[] = [];
  let lastTouchCueTs = Number.NEGATIVE_INFINITY;
  let patStartTs: number | null = null;

  function regionAt(pos: CssPoint): TapRegion | null {
    let points = deps.renderer.getTapPoints();
    if (points !== null && !isTapPoints(points)) {
      log.warn("invalid tap projection", points);
      points = null;
    }
    return points
      ? classifyTapRegion(pos, points, points.charHpx, deps.config.region_radius_frac)
      : null;
  }

  function pushPlainTap(ts: number): void {
    deps.ambient.trigger("tap_react");
    deps.bus.push({
      source: "os_event_watcher",
      event_name: "user.tap",
      ts,
      hint_tier: 1,
      dnd_override: true,
    });
  }

  function endPat(withCue: boolean): void {
    try {
      const ts = now();
      const heldMs = patStartTs === null ? 0 : ts - patStartTs;
      patStartTs = null;
      deps.bus.push({
        source: "os_event_watcher",
        event_name: "user.pat_end",
        ts,
        hint_tier: 1,
        dnd_override: true,
      });

      const cue = deps.config.region_cues?.head;
      if (!withCue || !cue || ts - lastTouchCueTs < deps.config.touch_cue_cooldown_ms) return;
      lastTouchCueTs = ts;
      // A pat is at least pat_hold_ms long — never report the hold as no time at all.
      const held = `held for ${Math.max(1, Math.round(heldMs / 1000))}s`;
      deps.bus.push({
        source: "os_event_watcher",
        event_name: "proactive.head_pat",
        ts,
        hint_tier: 2,
        payload: {
          cue_id: "head_pat",
          label: cue.label,
          context: cue.context !== undefined ? `${cue.context}; ${held}` : held,
        },
      });
    } catch (error) {
      log.warn("pat end failed", error);
    }
  }

  return {
    handleClick(pos) {
      try {
        const ts = now();
        while (clicks.length > 0 && ts - clicks[0] >= deps.config.spam_window_ms) {
          clicks.shift();
        }
        clicks.push(ts);

        // The head belongs to the pat gesture — a tap that lands there is a plain tap.
        const classified = regionAt(pos);
        const region = classified === "head" ? null : classified;

        if (clicks.length >= deps.config.spam_count) {
          clicks.length = 0;
          if (!region) {
            let signals: SignalGroup[] = [];
            try {
              signals = deps.drainSignals?.() ?? [];
            } catch (error) {
              log.warn("signal drain failed", error);
            }
            deps.bus.push({
              source: "os_event_watcher",
              event_name: "proactive.tap_bored",
              ts,
              hint_tier: 2,
              payload: {
                cue_id: "tap_bored",
                label: deps.config.bored_cue.label,
                ...(deps.config.bored_cue.context !== undefined
                  ? { context: deps.config.bored_cue.context }
                  : {}),
                ...(signals.length > 0 ? { signals } : {}),
              },
            });
            return;
          }
        }

        if (!region) {
          pushPlainTap(ts);
          return;
        }

        // ponytail: one cooldown shared across all regions — go per-region if it bites.
        const cue = deps.config.region_cues?.[region];
        if (cue && ts - lastTouchCueTs >= deps.config.touch_cue_cooldown_ms) {
          lastTouchCueTs = ts;
          deps.bus.push({
            source: "os_event_watcher",
            event_name: `proactive.touch_${region}`,
            ts,
            hint_tier: 2,
            payload: {
              cue_id: `touch_${region}`,
              label: cue.label,
              ...(cue.context !== undefined ? { context: cue.context } : {}),
            },
          });
        }

        const motionId = deps.config.region_motions[region];
        let currentMotion: { id: string; vrma_path: string } | null = null;
        try {
          currentMotion = deps.renderer.getCurrentMotion();
        } catch (error) {
          log.warn("current motion read failed", error);
        }
        if (currentMotion?.id === motionId) return;

        const emotionId = deps.config.region_emotions?.[region];
        deps.bus.push({
          source: "os_event_watcher",
          event_name: "user.tap_region",
          ts,
          hint_tier: 1,
          dnd_override: true,
          payload: { motion_id: motionId, ...(emotionId ? { emotion_id: emotionId } : {}) },
        });
      } catch (error) {
        log.warn("tap handling failed", error);
      }
    },

    isHeadPoint(pos) {
      try {
        return regionAt(pos) === "head";
      } catch (error) {
        log.warn("head classification failed", error);
        return false;
      }
    },

    handlePatStart() {
      try {
        patStartTs = now();
        const emotionId = deps.config.region_emotions?.head;
        deps.bus.push({
          source: "os_event_watcher",
          event_name: "user.pat_start",
          ts: patStartTs,
          hint_tier: 1,
          dnd_override: true,
          payload: {
            motion_id: deps.config.region_motions.head,
            ...(emotionId ? { emotion_id: emotionId } : {}),
          },
        });
      } catch (error) {
        log.warn("pat start failed", error);
      }
    },

    handlePatEnd() {
      endPat(true);
    },

    handlePatAbort() {
      endPat(false);
    },
  };
}
