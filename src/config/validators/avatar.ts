import {
  type AvatarConfig,
  type AvatarOption,
  CLIMB_DEFAULTS,
  type ClimbConfig,
  DRAG_HOLD_MS_DEFAULT,
  FALL_DEFAULTS,
  type FallConfig,
  GESTURE_CUES_DEFAULTS,
  type GestureCuesConfig,
  JUMP_DEFAULTS,
  type JumpConfig,
  PEEK_DEFAULTS,
  PERCH_WALK_DEFAULTS,
  type PeekConfig,
  type PerchWalkConfig,
  TAP_DEFAULTS,
  type TapConfig,
  WALK_DEFAULTS,
  type WalkConfig,
} from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

const AVATAR_SOURCES: readonly NonNullable<AvatarOption["source"]>[] = ["bundled", "file", "user"];
/** Allowed chars for AvatarOption.id — a persistence key and the CSS selector `[data-vrm-id="…"]` value, so no whitespace/special chars. */
const AVATAR_ID_RE = /^[A-Za-z0-9._-]+$/;

export function validateAvatar(file: string, raw: unknown): AvatarConfig {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const vrm_url = raw.vrm_url;
  if (typeof vrm_url !== "string" || vrm_url.length === 0) {
    throw new ConfigError(file, [
      `vrm_url은 비어 있지 않은 문자열이어야 함 (받음: ${JSON.stringify(vrm_url)})`,
    ]);
  }
  const issues: string[] = [];

  // available[] — optional VRM swap manifest.
  let available: AvatarOption[] | undefined;
  const rawAvailable = raw.available;
  if (rawAvailable !== undefined) {
    if (!Array.isArray(rawAvailable)) {
      throw new ConfigError(file, [
        `available은 배열이어야 함 (받음: ${JSON.stringify(rawAvailable)})`,
      ]);
    }
    available = [];
    rawAvailable.forEach((entry, i) => {
      if (!isObject(entry)) {
        issues.push(`available[${i}]: 항목이 객체가 아님`);
        return;
      }
      for (const k of ["id", "label", "url"] as const) {
        if (typeof entry[k] !== "string" || (entry[k] as string).length === 0) {
          issues.push(
            `available[${i}].${k}는 비어 있지 않은 문자열이어야 함 (받음: ${JSON.stringify(entry[k])})`,
          );
        }
      }
      // id is a persistence key + CSS selector value — no whitespace/quotes or other special chars ([A-Za-z0-9._-]).
      if (typeof entry.id === "string" && !AVATAR_ID_RE.test(entry.id)) {
        issues.push(
          `available[${i}].id는 [A-Za-z0-9._-]만 허용 (받음: ${JSON.stringify(entry.id)})`,
        );
      }
      const source = entry.source;
      if (
        source !== undefined &&
        !AVATAR_SOURCES.includes(source as AvatarOption["source"] & string)
      ) {
        issues.push(
          `available[${i}].source는 ${AVATAR_SOURCES.join("|")} 중 하나여야 함 (받음: ${JSON.stringify(source)})`,
        );
      }
      available!.push({
        id: entry.id as string,
        label: entry.label as string,
        url: entry.url as string,
        ...(source !== undefined ? { source: source as AvatarOption["source"] } : {}),
      });
    });
    // id uniqueness — find(x => x.id === …) resolves to the first entry only, so a duplicate is permanently unreachable.
    const seen = new Set<string>();
    available.forEach((opt, i) => {
      if (seen.has(opt.id)) {
        issues.push(`available[${i}].id 중복: ${JSON.stringify(opt.id)}`);
      }
      seen.add(opt.id);
    });
  }

  // framing — optional fit-to-bounds knob. Partial values allowed (defaults owned by the renderer).
  let framing: AvatarConfig["framing"];
  const rawFraming = raw.framing;
  if (rawFraming !== undefined) {
    if (!isObject(rawFraming)) {
      issues.push(`framing은 객체여야 함 (받음: ${JSON.stringify(rawFraming)})`);
    } else {
      const { margin, fov } = rawFraming;
      if (
        margin !== undefined &&
        (typeof margin !== "number" || !Number.isFinite(margin) || margin < 0)
      ) {
        issues.push(`framing.margin은 0 이상 유한 number여야 함 (받음: ${JSON.stringify(margin)})`);
      }
      if (
        fov !== undefined &&
        (typeof fov !== "number" || !Number.isFinite(fov) || fov <= 0 || fov >= 180)
      ) {
        issues.push(`framing.fov는 (0, 180) 열린구간 number여야 함 (받음: ${JSON.stringify(fov)})`);
      }
      framing = {
        ...(typeof margin === "number" ? { margin } : {}),
        ...(typeof fov === "number" ? { fov } : {}),
      };
    }
  }

  // hit_test — optional click-through knob. Partial values allowed (defaults owned by the controller).
  let hit_test: AvatarConfig["hit_test"];
  const rawHitTest = raw.hit_test;
  if (rawHitTest !== undefined) {
    if (!isObject(rawHitTest)) {
      issues.push(`hit_test은 객체여야 함 (받음: ${JSON.stringify(rawHitTest)})`);
    } else {
      const out: NonNullable<AvatarConfig["hit_test"]> = {};
      // hysteresis_margin_px / poll_interval_ms: finite number. margin is ≥0, interval is >0.
      const posNum = (
        k: "hysteresis_margin_px" | "poll_interval_ms",
        minExclusive: boolean,
      ): void => {
        const v = rawHitTest[k];
        if (v === undefined) return;
        if (typeof v !== "number" || !Number.isFinite(v) || (minExclusive ? v <= 0 : v < 0)) {
          issues.push(
            `hit_test.${k}는 ${minExclusive ? "0보다 큰" : "0 이상"} 유한 number여야 함 (받음: ${JSON.stringify(v)})`,
          );
        } else {
          out[k] = v;
        }
      };
      posNum("hysteresis_margin_px", false);
      posNum("poll_interval_ms", true);
      // debounce_samples: integer ≥ 1.
      const ds = rawHitTest.debounce_samples;
      if (ds !== undefined) {
        if (typeof ds !== "number" || !Number.isInteger(ds) || ds < 1) {
          issues.push(
            `hit_test.debounce_samples는 1 이상 정수여야 함 (받음: ${JSON.stringify(ds)})`,
          );
        } else {
          out.debounce_samples = ds;
        }
      }
      // alpha_threshold: finite number in (0, 1] (reserved for phase-2).
      const at = rawHitTest.alpha_threshold;
      if (at !== undefined) {
        if (typeof at !== "number" || !Number.isFinite(at) || at <= 0 || at > 1) {
          issues.push(
            `hit_test.alpha_threshold는 (0, 1] 범위 유한 number여야 함 (받음: ${JSON.stringify(at)})`,
          );
        } else {
          out.alpha_threshold = at;
        }
      }
      hit_test = out;
    }
  }

  const tap: TapConfig = {
    ...TAP_DEFAULTS,
    region_motions: { ...TAP_DEFAULTS.region_motions },
    bored_cue: { ...TAP_DEFAULTS.bored_cue },
  };
  const rawTap = raw.tap;
  if (rawTap !== undefined) {
    if (!isObject(rawTap)) {
      issues.push(`tap은 객체여야 함 (받음: ${JSON.stringify(rawTap)})`);
    } else {
      const spamCount = rawTap.spam_count;
      if (spamCount !== undefined) {
        if (typeof spamCount !== "number" || !Number.isInteger(spamCount) || spamCount < 2) {
          issues.push(`tap.spam_count는 2 이상 정수여야 함 (받음: ${JSON.stringify(spamCount)})`);
        } else {
          tap.spam_count = spamCount;
        }
      }

      const spamWindowMs = rawTap.spam_window_ms;
      if (spamWindowMs !== undefined) {
        if (
          typeof spamWindowMs !== "number" ||
          !Number.isInteger(spamWindowMs) ||
          spamWindowMs < 1 ||
          spamWindowMs > 60_000
        ) {
          issues.push(
            `tap.spam_window_ms는 1..60000 범위 정수여야 함 (받음: ${JSON.stringify(spamWindowMs)})`,
          );
        } else {
          tap.spam_window_ms = spamWindowMs;
        }
      }

      const radiusFrac = rawTap.region_radius_frac;
      if (radiusFrac !== undefined) {
        if (
          typeof radiusFrac !== "number" ||
          !Number.isFinite(radiusFrac) ||
          radiusFrac <= 0 ||
          radiusFrac > 1
        ) {
          issues.push(
            `tap.region_radius_frac는 (0, 1] 범위 유한 number여야 함 (받음: ${JSON.stringify(radiusFrac)})`,
          );
        } else {
          tap.region_radius_frac = radiusFrac;
        }
      }

      const regionMotions = rawTap.region_motions;
      if (regionMotions !== undefined) {
        if (!isObject(regionMotions)) {
          issues.push(`tap.region_motions은 객체여야 함 (받음: ${JSON.stringify(regionMotions)})`);
        } else {
          for (const key of Object.keys(regionMotions)) {
            if (key !== "head" && key !== "chest" && key !== "hips") {
              issues.push(`tap.region_motions.${key}는 허용되지 않는 키`);
              continue;
            }
            const motion = regionMotions[key];
            if (typeof motion !== "string" || motion.length === 0) {
              issues.push(
                `tap.region_motions.${key}는 비어 있지 않은 문자열이어야 함 (받음: ${JSON.stringify(motion)})`,
              );
            } else {
              tap.region_motions[key] = motion;
            }
          }
        }
      }

      const boredCue = rawTap.bored_cue;
      if (boredCue !== undefined) {
        if (!isObject(boredCue)) {
          issues.push(`tap.bored_cue은 객체여야 함 (받음: ${JSON.stringify(boredCue)})`);
        } else {
          for (const field of ["label", "context"] as const) {
            const value = boredCue[field];
            if (value === undefined) continue;
            if (typeof value !== "string" || value.length === 0) {
              issues.push(
                `tap.bored_cue.${field}는 비어 있지 않은 문자열이어야 함 (받음: ${JSON.stringify(value)})`,
              );
            } else {
              tap.bored_cue[field] = value;
            }
          }
        }
      }

      const regionEmotions = rawTap.region_emotions;
      if (regionEmotions !== undefined) {
        if (!isObject(regionEmotions)) {
          issues.push(
            `tap.region_emotions은 객체여야 함 (받음: ${JSON.stringify(regionEmotions)})`,
          );
        } else {
          const out: NonNullable<TapConfig["region_emotions"]> = {};
          for (const key of Object.keys(regionEmotions)) {
            if (key !== "head" && key !== "chest" && key !== "hips") {
              issues.push(`tap.region_emotions.${key}는 허용되지 않는 키`);
              continue;
            }
            const emotion = regionEmotions[key];
            if (typeof emotion !== "string" || emotion.length === 0) {
              issues.push(
                `tap.region_emotions.${key}는 비어 있지 않은 문자열이어야 함 (받음: ${JSON.stringify(emotion)})`,
              );
            } else {
              out[key] = emotion;
            }
          }
          tap.region_emotions = out;
        }
      }

      const regionCues = rawTap.region_cues;
      if (regionCues !== undefined) {
        if (!isObject(regionCues)) {
          issues.push(`tap.region_cues은 객체여야 함 (받음: ${JSON.stringify(regionCues)})`);
        } else {
          const out: NonNullable<TapConfig["region_cues"]> = {};
          for (const key of Object.keys(regionCues)) {
            if (key !== "head" && key !== "chest" && key !== "hips") {
              issues.push(`tap.region_cues.${key}는 허용되지 않는 키`);
              continue;
            }
            const cue = regionCues[key];
            if (!isObject(cue)) {
              issues.push(`tap.region_cues.${key}는 객체여야 함 (받음: ${JSON.stringify(cue)})`);
              continue;
            }
            const { label, context } = cue;
            if (
              typeof label !== "string" ||
              label.length === 0 ||
              (context !== undefined && (typeof context !== "string" || context.length === 0))
            ) {
              issues.push(
                `tap.region_cues.${key}의 label은 비어 있지 않은 문자열이어야 하고 context는 생략하거나 비어 있지 않은 문자열이어야 함 (받음: ${JSON.stringify(cue)})`,
              );
            } else {
              out[key] = { label, ...(context !== undefined ? { context } : {}) };
            }
          }
          tap.region_cues = out;
        }
      }

      const touchCueCooldownMs = rawTap.touch_cue_cooldown_ms;
      if (touchCueCooldownMs !== undefined) {
        if (
          typeof touchCueCooldownMs !== "number" ||
          !Number.isInteger(touchCueCooldownMs) ||
          touchCueCooldownMs < 0
        ) {
          issues.push(
            `tap.touch_cue_cooldown_ms는 0 이상 정수여야 함 (받음: ${JSON.stringify(touchCueCooldownMs)})`,
          );
        } else {
          tap.touch_cue_cooldown_ms = touchCueCooldownMs;
        }
      }

      const touchEmotionHoldMs = rawTap.touch_emotion_hold_ms;
      if (touchEmotionHoldMs !== undefined) {
        if (
          typeof touchEmotionHoldMs !== "number" ||
          !Number.isInteger(touchEmotionHoldMs) ||
          touchEmotionHoldMs < 1
        ) {
          issues.push(
            `tap.touch_emotion_hold_ms는 1 이상 정수여야 함 (받음: ${JSON.stringify(touchEmotionHoldMs)})`,
          );
        } else {
          tap.touch_emotion_hold_ms = touchEmotionHoldMs;
        }
      }

      const patHoldMs = rawTap.pat_hold_ms;
      if (patHoldMs !== undefined) {
        if (typeof patHoldMs !== "number" || !Number.isInteger(patHoldMs) || patHoldMs < 1) {
          issues.push(`tap.pat_hold_ms는 1 이상 정수여야 함 (받음: ${JSON.stringify(patHoldMs)})`);
        } else {
          tap.pat_hold_ms = patHoldMs;
        }
      }
    }
  }

  const peek: PeekConfig = { ...PEEK_DEFAULTS };
  const rawPeek = raw.peek;
  if (rawPeek !== undefined) {
    if (!isObject(rawPeek)) {
      issues.push(`peek은 객체여야 함 (받음: ${JSON.stringify(rawPeek)})`);
    } else {
      for (const field of ["side_out_frac", "side_in_frac"] as const) {
        const value = rawPeek[field];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 2) {
          issues.push(
            `peek.${field}는 (0, 2] 범위 유한 number여야 함 (받음: ${JSON.stringify(value)})`,
          );
        } else {
          peek[field] = value;
        }
      }
      const insetFrac = rawPeek.inset_frac;
      if (insetFrac !== undefined) {
        if (
          typeof insetFrac !== "number" ||
          !Number.isFinite(insetFrac) ||
          insetFrac < 0 ||
          insetFrac > 1
        ) {
          issues.push(
            `peek.inset_frac는 [0, 1] 범위 유한 number여야 함 (받음: ${JSON.stringify(insetFrac)})`,
          );
        } else {
          peek.inset_frac = insetFrac;
        }
      }
      const mirrorSide = rawPeek.mirror_side;
      if (mirrorSide !== undefined) {
        if (mirrorSide !== "left" && mirrorSide !== "right" && mirrorSide !== "none") {
          issues.push(
            `peek.mirror_side는 left|right|none 중 하나여야 함 (받음: ${JSON.stringify(mirrorSide)})`,
          );
        } else {
          peek.mirror_side = mirrorSide;
        }
      }
    }
  }

  const walk: WalkConfig = { ...WALK_DEFAULTS };
  const rawWalk = raw.walk;
  if (rawWalk !== undefined) {
    if (!isObject(rawWalk)) {
      issues.push(`walk은 객체여야 함 (받음: ${JSON.stringify(rawWalk)})`);
    } else {
      for (const field of [
        "interval_min_ms",
        "interval_max_ms",
        "distance_min_px",
        "distance_max_px",
      ] as const) {
        const value = rawWalk[field];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          issues.push(
            `walk.${field}는 0보다 큰 유한 number여야 함 (받음: ${JSON.stringify(value)})`,
          );
        } else {
          walk[field] = value;
        }
      }
      const tolerance = rawWalk.floor_tolerance_px;
      if (tolerance !== undefined) {
        if (typeof tolerance !== "number" || !Number.isFinite(tolerance) || tolerance < 0) {
          issues.push(
            `walk.floor_tolerance_px는 0 이상 유한 number여야 함 (받음: ${JSON.stringify(tolerance)})`,
          );
        } else {
          walk.floor_tolerance_px = tolerance;
        }
      }
      if (walk.interval_min_ms > walk.interval_max_ms) {
        issues.push(
          `walk.interval_min_ms는 walk.interval_max_ms 이하여야 함 (받음: ${walk.interval_min_ms} > ${walk.interval_max_ms})`,
        );
      }
      if (walk.distance_min_px > walk.distance_max_px) {
        issues.push(
          `walk.distance_min_px는 walk.distance_max_px 이하여야 함 (받음: ${walk.distance_min_px} > ${walk.distance_max_px})`,
        );
      }
    }
  }

  const perch_walk: PerchWalkConfig = { ...PERCH_WALK_DEFAULTS };
  const rawPerchWalk = raw.perch_walk;
  if (rawPerchWalk !== undefined) {
    if (!isObject(rawPerchWalk)) {
      issues.push(`perch_walk은 객체여야 함 (받음: ${JSON.stringify(rawPerchWalk)})`);
    } else {
      for (const field of ["dwell_min_ms", "dwell_max_ms"] as const) {
        const value = rawPerchWalk[field];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
          issues.push(`perch_walk.${field}는 0 이상 정수여야 함 (받음: ${JSON.stringify(value)})`);
        } else {
          perch_walk[field] = value;
        }
      }
      for (const field of ["distance_min_px", "distance_max_px"] as const) {
        const value = rawPerchWalk[field];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          issues.push(
            `perch_walk.${field}는 0보다 큰 유한 number여야 함 (받음: ${JSON.stringify(value)})`,
          );
        } else {
          perch_walk[field] = value;
        }
      }
      const edgeMarginFrac = rawPerchWalk.edge_margin_frac;
      if (edgeMarginFrac !== undefined) {
        if (
          typeof edgeMarginFrac !== "number" ||
          !Number.isFinite(edgeMarginFrac) ||
          edgeMarginFrac < 0 ||
          edgeMarginFrac > 1
        ) {
          issues.push(
            `perch_walk.edge_margin_frac는 0 이상 1 이하 number여야 함 (받음: ${JSON.stringify(edgeMarginFrac)})`,
          );
        } else {
          perch_walk.edge_margin_frac = edgeMarginFrac;
        }
      }
      if (perch_walk.dwell_min_ms > perch_walk.dwell_max_ms) {
        issues.push(
          `perch_walk.dwell_min_ms는 perch_walk.dwell_max_ms 이하여야 함 (받음: ${perch_walk.dwell_min_ms} > ${perch_walk.dwell_max_ms})`,
        );
      }
      if (perch_walk.distance_min_px > perch_walk.distance_max_px) {
        issues.push(
          `perch_walk.distance_min_px는 perch_walk.distance_max_px 이하여야 함 (받음: ${perch_walk.distance_min_px} > ${perch_walk.distance_max_px})`,
        );
      }
    }
  }

  const fall: FallConfig = { ...FALL_DEFAULTS };
  const rawFall = raw.fall;
  if (rawFall !== undefined) {
    if (!isObject(rawFall)) {
      issues.push(`fall은 객체여야 함 (받음: ${JSON.stringify(rawFall)})`);
    } else {
      for (const field of ["gravity_px_s2", "max_speed_px_s"] as const) {
        const value = rawFall[field];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          issues.push(
            `fall.${field}는 0보다 큰 유한 number여야 함 (받음: ${JSON.stringify(value)})`,
          );
        } else {
          fall[field] = value;
        }
      }
      const minDropFrac = rawFall.min_drop_frac;
      if (minDropFrac !== undefined) {
        if (
          typeof minDropFrac !== "number" ||
          !Number.isFinite(minDropFrac) ||
          minDropFrac < 0 ||
          minDropFrac > 1
        ) {
          issues.push(
            `fall.min_drop_frac는 [0, 1] 범위 유한 number여야 함 (받음: ${JSON.stringify(minDropFrac)})`,
          );
        } else {
          fall.min_drop_frac = minDropFrac;
        }
      }
      const cueCooldownMs = rawFall.cue_cooldown_ms;
      if (cueCooldownMs !== undefined) {
        if (
          typeof cueCooldownMs !== "number" ||
          !Number.isInteger(cueCooldownMs) ||
          cueCooldownMs < 0
        ) {
          issues.push(
            `fall.cue_cooldown_ms는 0 이상 정수여야 함 (받음: ${JSON.stringify(cueCooldownMs)})`,
          );
        } else {
          fall.cue_cooldown_ms = cueCooldownMs;
        }
      }
    }
  }

  const climb: ClimbConfig = { ...CLIMB_DEFAULTS };
  const rawClimb = raw.climb;
  if (rawClimb !== undefined) {
    if (!isObject(rawClimb)) {
      issues.push(`climb은 객체여야 함 (받음: ${JSON.stringify(rawClimb)})`);
    } else {
      for (const field of [
        "interval_min_ms",
        "interval_max_ms",
        "perch_dwell_min_ms",
        "perch_dwell_max_ms",
      ] as const) {
        const value = rawClimb[field];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
          issues.push(`climb.${field}는 0 이상 정수여야 함 (받음: ${JSON.stringify(value)})`);
        } else {
          climb[field] = value;
        }
      }
      for (const field of [
        "max_height_frac",
        "hang_frac",
        "wall_offset_frac",
        "ledge_walk_min_frac",
        "ledge_walk_max_frac",
      ] as const) {
        const value = rawClimb[field];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          issues.push(
            `climb.${field}는 0보다 큰 유한 number여야 함 (받음: ${JSON.stringify(value)})`,
          );
        } else {
          climb[field] = value;
        }
      }
      if (climb.interval_min_ms > climb.interval_max_ms) {
        issues.push(
          `climb.interval_min_ms는 climb.interval_max_ms 이하여야 함 (받음: ${climb.interval_min_ms} > ${climb.interval_max_ms})`,
        );
      }
      if (climb.perch_dwell_min_ms > climb.perch_dwell_max_ms) {
        issues.push(
          `climb.perch_dwell_min_ms는 climb.perch_dwell_max_ms 이하여야 함 (받음: ${climb.perch_dwell_min_ms} > ${climb.perch_dwell_max_ms})`,
        );
      }
      if (climb.ledge_walk_min_frac > climb.ledge_walk_max_frac) {
        issues.push(
          `climb.ledge_walk_min_frac는 climb.ledge_walk_max_frac 이하여야 함 (받음: ${climb.ledge_walk_min_frac} > ${climb.ledge_walk_max_frac})`,
        );
      }
    }
  }

  const jump: JumpConfig = { ...JUMP_DEFAULTS };
  const rawJump = raw.jump;
  if (rawJump !== undefined) {
    if (!isObject(rawJump)) {
      issues.push(`jump은 객체여야 함 (받음: ${JSON.stringify(rawJump)})`);
    } else {
      for (const field of ["probability", "takeoff_frac", "land_frac"] as const) {
        const value = rawJump[field];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
          issues.push(
            `jump.${field}는 [0, 1] 범위 유한 number여야 함 (받음: ${JSON.stringify(value)})`,
          );
        } else {
          jump[field] = value;
        }
      }
      for (const field of [
        "height_up_max_frac",
        "height_down_max_frac",
        "gap_max_width_frac",
        "apex_lift_frac",
      ] as const) {
        const value = rawJump[field];
        if (value === undefined) continue;
        if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
          issues.push(
            `jump.${field}는 0보다 큰 유한 number여야 함 (받음: ${JSON.stringify(value)})`,
          );
        } else {
          jump[field] = value;
        }
      }
      const flightTimeoutMs = rawJump.flight_timeout_ms;
      if (flightTimeoutMs !== undefined) {
        if (
          typeof flightTimeoutMs !== "number" ||
          !Number.isInteger(flightTimeoutMs) ||
          flightTimeoutMs <= 0
        ) {
          issues.push(
            `jump.flight_timeout_ms는 0보다 큰 정수여야 함 (받음: ${JSON.stringify(flightTimeoutMs)})`,
          );
        } else {
          jump.flight_timeout_ms = flightTimeoutMs;
        }
      }
      if (jump.takeoff_frac >= jump.land_frac) {
        issues.push(
          `jump.takeoff_frac는 jump.land_frac 미만이어야 함 (받음: ${jump.takeoff_frac} >= ${jump.land_frac})`,
        );
      }
    }
  }

  let drag_hold_ms = DRAG_HOLD_MS_DEFAULT;
  const rawDragHoldMs = raw.drag_hold_ms;
  if (rawDragHoldMs !== undefined) {
    if (
      typeof rawDragHoldMs !== "number" ||
      !Number.isInteger(rawDragHoldMs) ||
      rawDragHoldMs < 1
    ) {
      issues.push(`drag_hold_ms는 1 이상 정수여야 함 (받음: ${JSON.stringify(rawDragHoldMs)})`);
    } else {
      drag_hold_ms = rawDragHoldMs;
    }
  }

  const gesture_cues: GestureCuesConfig = {
    drag_held: { ...GESTURE_CUES_DEFAULTS.drag_held },
    window_sit: { ...GESTURE_CUES_DEFAULTS.window_sit },
    peek: { ...GESTURE_CUES_DEFAULTS.peek },
    dropped: { ...GESTURE_CUES_DEFAULTS.dropped },
  };
  const rawGestureCues = raw.gesture_cues;
  if (rawGestureCues !== undefined) {
    if (!isObject(rawGestureCues)) {
      issues.push(`gesture_cues은 객체여야 함 (받음: ${JSON.stringify(rawGestureCues)})`);
    } else {
      for (const key of Object.keys(rawGestureCues)) {
        if (key !== "drag_held" && key !== "window_sit" && key !== "peek" && key !== "dropped") {
          issues.push(`gesture_cues.${key}는 허용되지 않는 키`);
          continue;
        }
        const cue = rawGestureCues[key];
        if (!isObject(cue)) {
          issues.push(`gesture_cues.${key}는 객체여야 함 (받음: ${JSON.stringify(cue)})`);
          continue;
        }
        for (const field of ["label", "context"] as const) {
          const value = cue[field];
          if (value === undefined) continue;
          if (typeof value !== "string" || value.length === 0) {
            issues.push(
              `gesture_cues.${key}.${field}는 비어 있지 않은 문자열이어야 함 (받음: ${JSON.stringify(value)})`,
            );
          } else {
            gesture_cues[key as keyof GestureCuesConfig][field] = value;
          }
        }
      }
    }
  }

  // gaze — optional camera-tracking knob. Partial values allowed (defaults owned by the renderer, natural preset).
  let gaze: AvatarConfig["gaze"];
  const rawGaze = raw.gaze;
  if (rawGaze !== undefined) {
    if (!isObject(rawGaze)) {
      issues.push(`gaze는 객체여야 함 (받음: ${JSON.stringify(rawGaze)})`);
    } else {
      const out: NonNullable<AvatarConfig["gaze"]> = {};
      // angle (deg) — finite number, specified range. Only deadDeg allows 0, other angles are >0.
      const ranged = (
        k:
          | "deadDeg"
          | "headEngageDeg"
          | "disengageDeg"
          | "maxHeadYaw"
          | "maxHeadPitch"
          | "eyeMaxDeg"
          | "headNeckSplit"
          | "smooth",
        min: number,
        max: number,
        minInclusive: boolean,
      ): void => {
        const v = rawGaze[k];
        if (v === undefined) return;
        const lowOk = typeof v === "number" && (minInclusive ? v >= min : v > min);
        if (typeof v !== "number" || !Number.isFinite(v) || !lowOk || v > max) {
          issues.push(
            `gaze.${k}는 ${minInclusive ? min : `${min} 초과`}..${max} 범위 유한 number여야 함 (받음: ${JSON.stringify(v)})`,
          );
        } else {
          out[k] = v;
        }
      };
      ranged("deadDeg", 0, 180, true);
      ranged("headEngageDeg", 0, 180, false);
      ranged("disengageDeg", 0, 180, false);
      ranged("maxHeadYaw", 0, 90, false);
      ranged("maxHeadPitch", 0, 90, false);
      ranged("eyeMaxDeg", 0, 90, false);
      ranged("headNeckSplit", 0, 1, true);
      ranged("smooth", 0, 1000, false);
      gaze = out;
    }
  }

  assertValid(file, issues);
  return {
    vrm_url,
    tap,
    peek,
    walk,
    perch_walk,
    fall,
    climb,
    jump,
    drag_hold_ms,
    gesture_cues,
    ...(available !== undefined ? { available } : {}),
    ...(framing !== undefined ? { framing } : {}),
    ...(hit_test !== undefined ? { hit_test } : {}),
    ...(gaze !== undefined ? { gaze } : {}),
  };
}
