import type {
  InterruptPolicy,
  MotionKind,
  MotionRegistry,
  MotionRegistryEntry,
} from "../../contract";
import { assertValid, ConfigError, isObject } from "./shared";

const MOTION_KINDS: readonly MotionKind[] = ["ambient", "reactive", "state", "oneshot"];
const INTERRUPT_POLICIES: readonly InterruptPolicy[] = ["replace", "queue", "ignore"];
const VARIANT_POLICIES: readonly NonNullable<MotionRegistryEntry["variant_policy"]>[] = [
  "random",
  "sequential",
];

export function validateMotions(file: string, raw: unknown): MotionRegistry {
  if (!isObject(raw)) throw new ConfigError(file, ["객체가 아님"]);
  const issues: string[] = [];
  const out: MotionRegistry = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!isObject(entry)) {
      issues.push(`${id}: 항목이 객체가 아님`);
      continue;
    }
    if (typeof entry.vrma_path !== "string" || !entry.vrma_path.endsWith(".vrma")) {
      issues.push(`${id}.vrma_path는 .vrma로 끝나는 문자열이어야 함`);
    }
    if (!MOTION_KINDS.includes(entry.kind as MotionKind)) {
      issues.push(
        `${id}.kind는 ${MOTION_KINDS.join("|")} 중 하나여야 함 (받음: ${JSON.stringify(entry.kind)})`,
      );
    }
    if (typeof entry.loop !== "boolean") {
      issues.push(`${id}.loop은 boolean이어야 함`);
    }
    // priority 0~100. typeof number lets NaN/Infinity through, so check the range too.
    if (
      typeof entry.priority !== "number" ||
      !Number.isFinite(entry.priority) ||
      entry.priority < 0 ||
      entry.priority > 100
    ) {
      issues.push(
        `${id}.priority는 0~100 사이 유한 number여야 함 (받음: ${JSON.stringify(entry.priority)})`,
      );
    }
    if (!INTERRUPT_POLICIES.includes(entry.interrupt_policy as InterruptPolicy)) {
      issues.push(`${id}.interrupt_policy는 ${INTERRUPT_POLICIES.join("|")} 중 하나여야 함`);
    }
    // variants: if present, a pool of 2+ .vrma strings. A single one is meaningless.
    const rawVariants = entry.variants;
    let variants: string[] | undefined;
    if (rawVariants !== undefined) {
      if (!Array.isArray(rawVariants) || rawVariants.some((v) => typeof v !== "string")) {
        issues.push(`${id}.variants는 문자열 배열이어야 함`);
      } else if (rawVariants.length < 2) {
        issues.push(`${id}.variants는 2개 이상이어야 함 (받음: ${rawVariants.length}개)`);
      } else if (rawVariants.some((v) => !(v as string).endsWith(".vrma"))) {
        issues.push(`${id}.variants의 각 항목은 .vrma로 끝나야 함`);
      } else {
        variants = rawVariants as string[];
      }
    }
    const rawVariantPolicy = entry.variant_policy;
    let variant_policy: MotionRegistryEntry["variant_policy"];
    if (rawVariantPolicy !== undefined) {
      if (!VARIANT_POLICIES.includes(rawVariantPolicy as NonNullable<typeof variant_policy>)) {
        issues.push(`${id}.variant_policy는 ${VARIANT_POLICIES.join("|")} 중 하나여야 함`);
      } else {
        variant_policy = rawVariantPolicy as MotionRegistryEntry["variant_policy"];
      }
    }
    // variant_policy without variants is a dead field ignored by resolve() — fail-loud.
    if (rawVariantPolicy !== undefined && rawVariants === undefined) {
      issues.push(`${id}.variant_policy는 variants 없이 의미 없음 (variants 필요)`);
    }
    const rawBrokerPublish = entry.broker_publish;
    let broker_publish: boolean | undefined;
    if (rawBrokerPublish !== undefined) {
      if (typeof rawBrokerPublish !== "boolean") {
        issues.push(`${id}.broker_publish는 boolean이어야 함`);
      } else {
        broker_publish = rawBrokerPublish;
      }
    }
    const rawTags = entry.tags;
    let tags: string[] | undefined;
    if (rawTags !== undefined) {
      if (!Array.isArray(rawTags) || rawTags.some((tag) => typeof tag !== "string")) {
        issues.push(`${id}.tags는 문자열 배열이어야 함`);
      } else {
        tags = rawTags as string[];
      }
    }
    // cycle_dwell_ms: ms to hold the settled frame before a cycle motion swaps to the next variant.
    const rawCycleDwell = entry.cycle_dwell_ms;
    let cycle_dwell_ms: number | undefined;
    if (rawCycleDwell !== undefined) {
      if (
        typeof rawCycleDwell !== "number" ||
        !Number.isInteger(rawCycleDwell) ||
        rawCycleDwell < 0 ||
        rawCycleDwell > 60000
      ) {
        issues.push(`${id}.cycle_dwell_ms는 0~60000 사이 정수여야 함`);
      } else {
        cycle_dwell_ms = rawCycleDwell;
      }
      // A dead field ignored by resolve() unless this is a cycle motion (variants>1 + loop) — fail-loud.
      if (!(Array.isArray(variants) && variants.length > 1 && entry.loop === true)) {
        issues.push(`${id}.cycle_dwell_ms는 cycle 모션(variants>1 + loop)에만 유효함`);
      }
    }
    // pingpong: forward↔reverse loop. Requires loop, mutually exclusive with crossfade_loop.
    const rawPingpong = entry.pingpong;
    let pingpong: boolean | undefined;
    if (rawPingpong !== undefined) {
      if (typeof rawPingpong !== "boolean") {
        issues.push(`${id}.pingpong은 boolean이어야 함`);
      } else {
        pingpong = rawPingpong;
      }
      if (rawPingpong === true && entry.loop !== true) {
        issues.push(`${id}.pingpong:true는 loop:true를 요구함`);
      }
      if (rawPingpong === true && entry.crossfade_loop === true) {
        issues.push(`${id}.pingpong과 crossfade_loop는 상호 배타임`);
      }
    }
    // crossfade_loop: crossfade from loop end to start. Requires loop.
    const rawCrossfadeLoop = entry.crossfade_loop;
    let crossfade_loop: boolean | undefined;
    if (rawCrossfadeLoop !== undefined) {
      if (typeof rawCrossfadeLoop !== "boolean") {
        issues.push(`${id}.crossfade_loop은 boolean이어야 함`);
      } else {
        crossfade_loop = rawCrossfadeLoop;
      }
      if (rawCrossfadeLoop === true && entry.loop !== true) {
        issues.push(`${id}.crossfade_loop:true는 loop:true를 요구함`);
      }
    }
    // loop_cycles: [min,max] round-trip count. Two positive integers + lo<=hi. Valid only with pingpong:true.
    const rawLoopCycles = entry.loop_cycles;
    let loop_cycles: [number, number] | undefined;
    if (rawLoopCycles !== undefined) {
      if (
        !Array.isArray(rawLoopCycles) ||
        rawLoopCycles.length !== 2 ||
        rawLoopCycles.some((v) => typeof v !== "number" || !Number.isInteger(v) || v < 1) ||
        (rawLoopCycles[0] as number) > (rawLoopCycles[1] as number)
      ) {
        issues.push(`${id}.loop_cycles는 lo<=hi인 양의 정수 2개 배열이어야 함`);
      } else {
        loop_cycles = [rawLoopCycles[0] as number, rawLoopCycles[1] as number];
      }
      // A dead field ignored by resolve() unless pingpong:true — fail-loud.
      if (rawPingpong !== true) {
        issues.push(`${id}.loop_cycles는 pingpong:true 없이 의미 없음`);
      }
    }
    // fade_ms: entry-level default crossfade ms. Valid for all entries.
    const rawFade = entry.fade_ms;
    let fade_ms: number | undefined;
    if (rawFade !== undefined) {
      if (
        typeof rawFade !== "number" ||
        !Number.isInteger(rawFade) ||
        rawFade < 0 ||
        rawFade > 5000
      ) {
        issues.push(`${id}.fade_ms는 0~5000 사이 정수여야 함`);
      } else {
        fade_ms = rawFade;
      }
    }
    out[id] = {
      vrma_path: entry.vrma_path as string,
      ...(variants !== undefined ? { variants } : {}),
      ...(variant_policy !== undefined ? { variant_policy } : {}),
      ...(cycle_dwell_ms !== undefined ? { cycle_dwell_ms } : {}),
      ...(pingpong !== undefined ? { pingpong } : {}),
      ...(crossfade_loop !== undefined ? { crossfade_loop } : {}),
      ...(loop_cycles !== undefined ? { loop_cycles } : {}),
      ...(fade_ms !== undefined ? { fade_ms } : {}),
      ...(broker_publish !== undefined ? { broker_publish } : {}),
      ...(tags !== undefined ? { tags } : {}),
      kind: entry.kind as MotionKind,
      loop: entry.loop as boolean,
      priority: entry.priority as number,
      interrupt_policy: entry.interrupt_policy as InterruptPolicy,
    } satisfies MotionRegistryEntry;
  }
  if (Object.keys(out).length === 0) issues.push("최소 1개 모션이 등록되어야 함");
  assertValid(file, issues);
  return out;
}
