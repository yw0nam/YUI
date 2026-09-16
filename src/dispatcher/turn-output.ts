import type { ExpressArgs, ToolStatus } from "../contract";

/**
 * Speech lifecycle port between the backend caller and the voice pipeline.
 *
 * - `interrupt()` fires once on call entry, before any other member.
 * - `hasFiller()` is queried on entry; `thinkingStart` only follows when it is true and the turn
 *   is not a reflex turn.
 * - `thinkingStart`/`thinkingEnd` carry the same turn id, so an overtaken turn's late
 *   `thinkingEnd` is ignored by the implementation.
 * - `thinkingEnd` fires exactly once per turn that started thinking, on every exit path.
 * - `delta(text)` streams speech; the first one ends thinking.
 * - `end()` closes a streamed utterance; `speak(text)` is the whole-utterance fallback for a
 *   delta-less backend. Exactly one of the two per successful speaking turn — never both.
 * - `abort()` replaces `end()` when the stream died after at least one `delta`.
 * - `cue(args)` carries per-beat express cues while streaming; on the completed-only path it
 *   carries `emotion_text` alone, because `applyDirective` already rendered emotion/motion.
 * - `cueWithSpeech(args)` carries a cue whose sentence is submitted in the same stretch of work,
 *   so the cue is consumed by that sentence and never waits on a thinking turn's motion hold.
 * - `silentCue(args)` carries a cue with no speech of its own: it renders as soon as nothing
 *   holds the motion, and waits out a running thinking motion otherwise.
 * - `toolStatus(turnId, state, toolId?)` carries each streamed tool_status event, independent of
 *   the UI chip sink — like `thinkingStart`/`thinkingEnd`, `turnId` ties it to the turn it came
 *   from, so a superseded turn's late event is ignored rather than reaching whichever turn is
 *   thinking now.
 * - `activity(turnId)` carries non-tool progress (an express cue) — same turn-id-gated rule.
 * - `releaseMute()` ends a barge-in mute window; a reply accepted afterwards is spoken again.
 * - `hasOutstandingSpeech()` answers whether audio is still owed, speech the backend started on
 *   its own included.
 * - `onQueueDrained(callback)` registers a one-shot callback for the next point the pipeline has
 *   nothing left queued to play — the seam a caller uses to sequence its own work behind whatever
 *   speech is already playing.
 */
export interface TurnOutput {
  interrupt(): void;
  hasFiller(): boolean;
  thinkingStart(turnId: number): void;
  thinkingEnd(turnId: number): void;
  delta(text: string): void;
  speak(text: string): void;
  end(): void;
  abort(): void;
  cue(args: ExpressArgs): void;
  cueWithSpeech(args: ExpressArgs): void;
  silentCue(args: ExpressArgs): void;
  toolStatus(turnId: number, state: ToolStatus["state"], toolId?: string): void;
  activity(turnId: number): void;
  releaseMute(): void;
  hasOutstandingSpeech(): boolean;
  onQueueDrained(callback: () => void): void;
}
