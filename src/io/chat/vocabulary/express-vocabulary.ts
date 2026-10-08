import type { AppConfig } from "../../../config/load";
import type { MotionRegistry } from "../../../contract";
import {
  type ExpressMotionSettings,
  enabledExpressMotions,
} from "../../../settings/avatar/express-motion-settings";

/** The emotion ids, motion ids, and voice-tone vocabulary the agent may cue with generate_express. */
export interface ExpressVocabulary {
  emotionIds: string[];
  motionIds: string[];
  emotionText: { mode: "free" | "enum"; table: Record<string, string> | null };
}

/**
 * Motion keys the agent may trigger via generate_express/motion cues — excludes reactive, ambient,
 * and `broker_publish:false` entries. Every consumer of the vocabulary reads it through here, so they stay in lockstep with the same registry.
 */
export function agentTriggerableMotionIds(motions: MotionRegistry): string[] {
  return Object.entries(motions)
    .filter(
      ([, entry]) =>
        entry.kind !== "reactive" && entry.kind !== "ambient" && entry.broker_publish !== false,
    )
    .map(([id]) => id);
}

/**
 * Pure derivation of the vocabulary from loaded config. emotion ids = registry keys; motion ids
 * = agent-triggerable motion keys (see agentTriggerableMotionIds) narrowed by the user's
 * expression-motion selection — the one seam every vocabulary consumer reads, so the broker publish,
 * the generate_express tool schema, and the push hello always carry the same list. The selection is required, so
 * no caller can publish the unfiltered catalog by leaving it out.
 * emotion_text is the emoji enum table (docs/reference/tts-emotion); no table (a provider without
 * one, or a failed load the loader already logged) publishes free mode.
 */
export function deriveExpressVocabulary(
  cfg: AppConfig,
  emotionTextTable: Record<string, string> | null,
  opts: { expressMotions: ExpressMotionSettings },
): ExpressVocabulary {
  const emotionIds = Object.keys(cfg.emotionRegistry);
  const motionIds = enabledExpressMotions(
    agentTriggerableMotionIds(cfg.motions),
    opts.expressMotions,
  );

  const emotionText: ExpressVocabulary["emotionText"] = emotionTextTable
    ? { mode: "enum", table: emotionTextTable }
    : { mode: "free", table: null };

  return { emotionIds, motionIds, emotionText };
}
