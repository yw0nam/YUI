import type { TapConfig } from "../config/load";
import type { SignalItem } from "../contract";
import type { EventBus } from "../dispatcher/event-bus";
import { createLogger } from "../logger";
import { type CssPoint, classifyTapRegion, type TapRegionBones } from "../renderer/tap-region";

const log = createLogger("tap-source");

export type { TapConfig } from "../config/load";

export interface TapPoints extends TapRegionBones {
  charHpx: number;
}

export interface TapSource {
  handleClick(pos: CssPoint): void;
}

interface TapSourceDeps {
  bus: Pick<EventBus, "push">;
  renderer: {
    getTapPoints(): TapPoints | null;
    getCurrentMotion(): { id: string; vrma_path: string } | null;
  };
  ambient: { trigger(cue: "tap_react"): void };
  config: TapConfig;
  drainSignals?: () => SignalItem[];
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
    (points.chest === null || isPoint(points.chest)) &&
    (points.hips === null || isPoint(points.hips))
  );
}

export function createTapSource(deps: TapSourceDeps): TapSource {
  const now = deps.now ?? Date.now;
  const clicks: number[] = [];
  let lastTouchCueTs = Number.NEGATIVE_INFINITY;

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

  return {
    handleClick(pos) {
      try {
        const ts = now();
        while (clicks.length > 0 && ts - clicks[0] >= deps.config.spam_window_ms) {
          clicks.shift();
        }
        clicks.push(ts);

        let points = deps.renderer.getTapPoints();
        if (points !== null && !isTapPoints(points)) {
          log.warn("invalid tap projection", points);
          points = null;
        }
        const region = points
          ? classifyTapRegion(pos, points, points.charHpx, deps.config.region_radius_frac)
          : null;

        if (clicks.length >= deps.config.spam_count) {
          clicks.length = 0;
          if (!region) {
            let signals: SignalItem[] = [];
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

        // ponytail: one cooldown shared across both regions — go per-region if it bites.
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
  };
}
