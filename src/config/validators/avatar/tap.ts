import { isObject } from "../shared";
import { cue, int, nonNegative, num, rejectUnknownKeys, type SectionContext, str } from "./helpers";
import type { TapConfig } from "./types";

/** Tap regions, in the order their issues are reported. */
const TAP_REGIONS = ["head", "chest", "hips"] as const;

// tap — region reactions and the touch speech candidates.
export function validateTap(raw: Record<string, unknown>, ctx: SectionContext): Partial<TapConfig> {
  const { issues } = ctx;
  const tap: Partial<TapConfig> = {};
  const rawTap = raw.tap;
  if (!isObject(rawTap)) {
    issues.push(`tap must be an object (got: ${JSON.stringify(rawTap)})`);
  } else {
    tap.spam_count = int(issues, rawTap, "tap", "spam_count", (v) => v >= 2, "an integer >= 2");
    tap.spam_window_ms = int(
      issues,
      rawTap,
      "tap",
      "spam_window_ms",
      (v) => v >= 1 && v <= 60_000,
      "an integer in [1, 60000]",
    );
    tap.region_radius_frac = num(
      issues,
      rawTap,
      "tap",
      "region_radius_frac",
      (v) => v > 0 && v <= 1,
      "a finite number in (0, 1]",
    );
    tap.touch_cue_cooldown_ms = int(
      issues,
      rawTap,
      "tap",
      "touch_cue_cooldown_ms",
      nonNegative,
      "an integer >= 0",
    );
    tap.touch_emotion_hold_ms = int(
      issues,
      rawTap,
      "tap",
      "touch_emotion_hold_ms",
      (v) => v >= 1,
      "an integer >= 1",
    );
    tap.pat_hold_ms = int(issues, rawTap, "tap", "pat_hold_ms", (v) => v >= 1, "an integer >= 1");

    const rawRegionMotions = rawTap.region_motions;
    if (!isObject(rawRegionMotions)) {
      issues.push(
        `tap.region_motions must be an object (got: ${JSON.stringify(rawRegionMotions)})`,
      );
    } else {
      rejectUnknownKeys(issues, rawRegionMotions, TAP_REGIONS, "tap.region_motions");
      const motions: Partial<TapConfig["region_motions"]> = {};
      for (const region of TAP_REGIONS) {
        motions[region] = str(issues, rawRegionMotions, "tap.region_motions", region);
      }
      tap.region_motions = motions as TapConfig["region_motions"];
    }

    const rawBoredCue = rawTap.bored_cue;
    if (!isObject(rawBoredCue)) {
      issues.push(`tap.bored_cue must be an object (got: ${JSON.stringify(rawBoredCue)})`);
    } else {
      tap.bored_cue = cue(issues, rawBoredCue, "tap.bored_cue");
    }

    // region_emotions — optional; a region left out keeps the motion alone.
    const rawRegionEmotions = rawTap.region_emotions;
    if (rawRegionEmotions !== undefined) {
      if (!isObject(rawRegionEmotions)) {
        issues.push(
          `tap.region_emotions must be an object (got: ${JSON.stringify(rawRegionEmotions)})`,
        );
      } else {
        rejectUnknownKeys(issues, rawRegionEmotions, TAP_REGIONS, "tap.region_emotions");
        const emotions: NonNullable<TapConfig["region_emotions"]> = {};
        for (const region of TAP_REGIONS) {
          if (rawRegionEmotions[region] === undefined) continue;
          emotions[region] = str(issues, rawRegionEmotions, "tap.region_emotions", region);
        }
        tap.region_emotions = emotions;
      }
    }

    // region_cues — optional; a region left out offers no touch speech candidate.
    const rawRegionCues = rawTap.region_cues;
    if (rawRegionCues !== undefined) {
      if (!isObject(rawRegionCues)) {
        issues.push(`tap.region_cues must be an object (got: ${JSON.stringify(rawRegionCues)})`);
      } else {
        rejectUnknownKeys(issues, rawRegionCues, TAP_REGIONS, "tap.region_cues");
        const cues: NonNullable<TapConfig["region_cues"]> = {};
        for (const region of TAP_REGIONS) {
          const entry = rawRegionCues[region];
          if (entry === undefined) continue;
          if (!isObject(entry)) {
            issues.push(
              `tap.region_cues.${region} must be an object (got: ${JSON.stringify(entry)})`,
            );
            continue;
          }
          cues[region] = cue(issues, entry, `tap.region_cues.${region}`);
        }
        tap.region_cues = cues;
      }
    }
  }
  return tap;
}
