import type { AvatarConfig, AvatarOption, TapConfig } from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

const AVATAR_SOURCES: readonly NonNullable<AvatarOption["source"]>[] = ["bundled", "file", "user"];
/** Allowed chars for AvatarOption.id — a persistence key and the CSS selector `[data-vrm-id="…"]` value, so no whitespace/special chars. */
const AVATAR_ID_RE = /^[A-Za-z0-9._-]+$/;
const TAP_DEFAULTS: TapConfig = {
  spam_count: 4,
  spam_window_ms: 3000,
  region_radius_frac: 0.18,
  region_motions: { chest: "embarrassed", hips: "embarrassed" },
  bored_cue: {
    label: "bored poking",
    context:
      "The user is repeatedly clicking the character with no particular spot in mind — they are likely bored and want attention. Fold in any accumulated signals and say something that fits the moment.",
  },
};

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
            if (key !== "chest" && key !== "hips") {
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
    ...(available !== undefined ? { available } : {}),
    ...(framing !== undefined ? { framing } : {}),
    ...(hit_test !== undefined ? { hit_test } : {}),
    ...(gaze !== undefined ? { gaze } : {}),
  };
}
