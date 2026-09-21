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
  if (!isObject(raw)) throw new ConfigError(file, ["not an object"]);
  const issues: string[] = [];
  const out: MotionRegistry = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!isObject(entry)) {
      issues.push(`${id}: entry is not an object`);
      continue;
    }
    if (typeof entry.vrma_path !== "string" || !entry.vrma_path.endsWith(".vrma")) {
      issues.push(`${id}.vrma_path must be a string ending in .vrma`);
    }
    if (!MOTION_KINDS.includes(entry.kind as MotionKind)) {
      issues.push(
        `${id}.kind must be one of ${MOTION_KINDS.join("|")} (got: ${JSON.stringify(entry.kind)})`,
      );
    }
    if (typeof entry.loop !== "boolean") {
      issues.push(`${id}.loop must be a boolean`);
    }
    // priority 0~100. typeof number lets NaN/Infinity through, so check the range too.
    if (
      typeof entry.priority !== "number" ||
      !Number.isFinite(entry.priority) ||
      entry.priority < 0 ||
      entry.priority > 100
    ) {
      issues.push(
        `${id}.priority must be a finite number in [0, 100] (got: ${JSON.stringify(entry.priority)})`,
      );
    }
    if (!INTERRUPT_POLICIES.includes(entry.interrupt_policy as InterruptPolicy)) {
      issues.push(`${id}.interrupt_policy must be one of ${INTERRUPT_POLICIES.join("|")}`);
    }
    // variants: if present, a pool of 2+ .vrma strings. A single one is meaningless.
    const rawVariants = entry.variants;
    let variants: string[] | undefined;
    if (rawVariants !== undefined) {
      if (!Array.isArray(rawVariants) || rawVariants.some((v) => typeof v !== "string")) {
        issues.push(`${id}.variants must be an array of strings`);
      } else if (rawVariants.length < 2) {
        issues.push(`${id}.variants must have at least 2 entries (got: ${rawVariants.length})`);
      } else if (rawVariants.some((v) => !(v as string).endsWith(".vrma"))) {
        issues.push(`${id}.variants entries must end in .vrma`);
      } else {
        variants = rawVariants as string[];
      }
    }
    const rawVariantPolicy = entry.variant_policy;
    let variant_policy: MotionRegistryEntry["variant_policy"];
    if (rawVariantPolicy !== undefined) {
      if (!VARIANT_POLICIES.includes(rawVariantPolicy as NonNullable<typeof variant_policy>)) {
        issues.push(`${id}.variant_policy must be one of ${VARIANT_POLICIES.join("|")}`);
      } else {
        variant_policy = rawVariantPolicy as MotionRegistryEntry["variant_policy"];
      }
    }
    // variant_policy without variants is a dead field ignored by resolve() — fail-loud.
    if (rawVariantPolicy !== undefined && rawVariants === undefined) {
      issues.push(`${id}.variant_policy has no meaning without variants`);
    }
    const rawBrokerPublish = entry.broker_publish;
    let broker_publish: boolean | undefined;
    if (rawBrokerPublish !== undefined) {
      if (typeof rawBrokerPublish !== "boolean") {
        issues.push(`${id}.broker_publish must be a boolean`);
      } else {
        broker_publish = rawBrokerPublish;
      }
    }
    // root_lock_y: strip the clip's baked vertical travel; the mover supplies it instead.
    const rawRootLockY = entry.root_lock_y;
    let root_lock_y: boolean | undefined;
    if (rawRootLockY !== undefined) {
      if (typeof rawRootLockY !== "boolean") {
        issues.push(`${id}.root_lock_y must be a boolean`);
      } else {
        root_lock_y = rawRootLockY;
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
        issues.push(`${id}.cycle_dwell_ms must be an integer in [0, 60000]`);
      } else {
        cycle_dwell_ms = rawCycleDwell;
      }
      // A dead field ignored by resolve() unless this is a cycle motion (variants>1 + loop) — fail-loud.
      if (!(Array.isArray(variants) && variants.length > 1 && entry.loop === true)) {
        issues.push(`${id}.cycle_dwell_ms is valid only for a cycle motion (variants>1 + loop)`);
      }
    }
    // pingpong: forward↔reverse loop. Requires loop, mutually exclusive with crossfade_loop.
    const rawPingpong = entry.pingpong;
    let pingpong: boolean | undefined;
    if (rawPingpong !== undefined) {
      if (typeof rawPingpong !== "boolean") {
        issues.push(`${id}.pingpong must be a boolean`);
      } else {
        pingpong = rawPingpong;
      }
      if (rawPingpong === true && entry.loop !== true) {
        issues.push(`${id}.pingpong:true requires loop:true`);
      }
      if (rawPingpong === true && entry.crossfade_loop === true) {
        issues.push(`${id}.pingpong and crossfade_loop are mutually exclusive`);
      }
    }
    // crossfade_loop: crossfade from loop end to start. Requires loop.
    const rawCrossfadeLoop = entry.crossfade_loop;
    let crossfade_loop: boolean | undefined;
    if (rawCrossfadeLoop !== undefined) {
      if (typeof rawCrossfadeLoop !== "boolean") {
        issues.push(`${id}.crossfade_loop must be a boolean`);
      } else {
        crossfade_loop = rawCrossfadeLoop;
      }
      if (rawCrossfadeLoop === true && entry.loop !== true) {
        issues.push(`${id}.crossfade_loop:true requires loop:true`);
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
        issues.push(`${id}.loop_cycles must be an array of 2 positive integers with lo<=hi`);
      } else {
        loop_cycles = [rawLoopCycles[0] as number, rawLoopCycles[1] as number];
      }
      // A dead field ignored by resolve() unless pingpong:true — fail-loud.
      if (rawPingpong !== true) {
        issues.push(`${id}.loop_cycles has no meaning without pingpong:true`);
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
        issues.push(`${id}.fade_ms must be an integer in [0, 5000]`);
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
      ...(root_lock_y !== undefined ? { root_lock_y } : {}),
      kind: entry.kind as MotionKind,
      loop: entry.loop as boolean,
      priority: entry.priority as number,
      interrupt_policy: entry.interrupt_policy as InterruptPolicy,
    } satisfies MotionRegistryEntry;
  }
  if (Object.keys(out).length === 0) issues.push("at least one motion must be registered");
  assertValid(file, issues);
  return out;
}
