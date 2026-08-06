import type { ExpressArgs } from "../contract";

/**
 * Speech lifecycle port between the backend caller and the voice pipeline.
 *
 * - `interrupt()` fires once on call entry, before any other member.
 * - `hasFiller()` is queried on entry; `thinkingStart` only follows when it is true and the turn
 *   is not a reflex turn.
 * - `thinkingStart`/`thinkingEnd` carry the same token for one turn, so an overtaken turn's late
 *   `thinkingEnd` is ignored by the implementation.
 * - `thinkingEnd` fires exactly once per turn that started thinking, on every exit path.
 * - `delta(text)` streams speech; the first one ends thinking.
 * - `end()` closes a streamed utterance; `speak(text)` is the whole-utterance fallback for a
 *   delta-less backend. Exactly one of the two per successful speaking turn — never both.
 * - `abort()` replaces `end()` when the stream died after at least one `delta`.
 * - `cue(args)` carries per-beat express cues while streaming; on the completed-only path it
 *   carries `emotion_text` alone, because `applyDirective` already rendered emotion/motion.
 */
export interface TurnOutput {
  interrupt(): void;
  hasFiller(): boolean;
  thinkingStart(token: object): void;
  thinkingEnd(token: object): void;
  delta(text: string): void;
  speak(text: string): void;
  end(): void;
  abort(): void;
  cue(args: ExpressArgs): void;
}
