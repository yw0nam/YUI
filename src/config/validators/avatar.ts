import type { AvatarConfig, AvatarOption } from "../load";
import { assertValid, ConfigError, isObject } from "./shared";

const AVATAR_SOURCES: readonly NonNullable<AvatarOption["source"]>[] = ["bundled", "file", "user"];
/** AvatarOption.id 허용 문자 — 영속화 키이자 CSS 셀렉터 `[data-vrm-id="…"]` 값이므로 공백/특수문자 금지. */
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
      // id는 영속화 키 + CSS 셀렉터 값 — 공백/따옴표 등 특수문자 금지([A-Za-z0-9._-]).
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
    // id 유일성 — find(x => x.id === …) 해소가 첫 항목만 잡으므로 중복은 영구 unreachable.
    const seen = new Set<string>();
    available.forEach((opt, i) => {
      if (seen.has(opt.id)) {
        issues.push(`available[${i}].id 중복: ${JSON.stringify(opt.id)}`);
      }
      seen.add(opt.id);
    });
  }

  // framing — optional fit-to-bounds knob. 부분값 허용(기본값은 렌더러 소유).
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

  // hit_test — optional click-through knob. 부분값 허용(기본값은 컨트롤러 소유).
  let hit_test: AvatarConfig["hit_test"];
  const rawHitTest = raw.hit_test;
  if (rawHitTest !== undefined) {
    if (!isObject(rawHitTest)) {
      issues.push(`hit_test은 객체여야 함 (받음: ${JSON.stringify(rawHitTest)})`);
    } else {
      const out: NonNullable<AvatarConfig["hit_test"]> = {};
      // hysteresis_margin_px / poll_interval_ms: 유한 number. margin은 ≥0, interval은 >0.
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
      // debounce_samples: 1 이상 정수.
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
      // alpha_threshold: (0, 1] 범위 유한 number(phase-2 예약).
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

  // gaze — optional camera-tracking knob. 부분값 허용(기본값은 렌더러 소유, natural preset).
  let gaze: AvatarConfig["gaze"];
  const rawGaze = raw.gaze;
  if (rawGaze !== undefined) {
    if (!isObject(rawGaze)) {
      issues.push(`gaze는 객체여야 함 (받음: ${JSON.stringify(rawGaze)})`);
    } else {
      const out: NonNullable<AvatarConfig["gaze"]> = {};
      // 각도(deg) — 유한 number, 지정 범위. deadDeg만 0 허용, 나머지 각도는 >0.
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
    ...(available !== undefined ? { available } : {}),
    ...(framing !== undefined ? { framing } : {}),
    ...(hit_test !== undefined ? { hit_test } : {}),
    ...(gaze !== undefined ? { gaze } : {}),
  };
}
