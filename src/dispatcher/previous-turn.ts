/**
 * Previous-turn slot — one persisted record of how the last turn that tried to speak ended.
 *
 * A ledger, not an authority: speech playback reports the utterance it opened and closed, the
 * dispatcher reports a call that failed before any speech, and the context builder reads the
 * record onto the next turn's client_context. What to do about a cut-off reply is the backend's.
 */

import type { PreviousTurn, TurnEnded } from "../contract";
import { isPlainObject, localStorageStore, type PersistedStorage } from "../io/persisted-store";
import type { TurnFailure } from "./backend-caller";
import type { Turn } from "./turn";

const STORAGE_KEY = "yui.previous-turn";

const ENDED_VALUES: readonly string[] = ["complete", "interrupted", "failed"];

/** Failures that say a turn never got to speak. not_configured and superseded_by_user say nothing. */
const RECORDED_FAILURES: ReadonlySet<TurnFailure> = new Set([
  "network_drop",
  "network_stall",
  "http_4xx_drop",
  "parse_error",
]);

interface PreviousTurnDeps {
  /** turnLog.current — the turn whose backend call is streaming. */
  currentTurn: () => Turn | null;
  /** Injectable persistence; defaults to the `yui.previous-turn` store. */
  storage?: PersistedStorage<PreviousTurn>;
  /** Injectable clock; defaults to Date.now. */
  now?: () => number;
}

export interface PreviousTurnSlot {
  /** speech-playback opened a backend utterance. */
  utteranceStart(): void;
  /** speech-playback closed the utterance opened by the last utteranceStart. */
  utteranceEnd(ended: "complete" | "interrupted"): void;
  /** The backend call for `turn` settled in a failure. */
  callFailed(turn: Turn, reason: TurnFailure): void;
  /** The record as stored, `complete` included — the context builder decides what renders. */
  get(): PreviousTurn | undefined;
}

function parse(loaded: unknown): PreviousTurn | undefined {
  if (!isPlainObject(loaded)) return undefined;
  const { event_name, ended, ts } = loaded as Record<string, unknown>;
  if (typeof event_name !== "string" || event_name === "") return undefined;
  if (typeof ended !== "string" || !ENDED_VALUES.includes(ended)) return undefined;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return undefined;
  return { event_name, ended: ended as TurnEnded, ts };
}

export function createPreviousTurn(deps: PreviousTurnDeps): PreviousTurnSlot {
  const storage = deps.storage ?? localStorageStore<PreviousTurn>(STORAGE_KEY);
  const now = deps.now ?? Date.now;

  let slot = parse(storage.load());
  // The event name of the turn holding the open utterance, held from its first backend delta.
  let speakingEventName: string | null = null;
  // The last turn that opened an utterance — its call failure is already told as the utterance's ending.
  let lastStartedId: number | null = null;

  function save(event_name: string, ended: TurnEnded): void {
    slot = { event_name, ended, ts: now() };
    storage.save(slot);
  }

  return {
    utteranceStart() {
      const turn = deps.currentTurn();
      if (!turn) return;
      speakingEventName = turn.trigger.event_name;
      lastStartedId = turn.id;
    },
    utteranceEnd(ended) {
      if (speakingEventName === null) return;
      save(speakingEventName, ended);
      speakingEventName = null;
    },
    callFailed(turn, reason) {
      if (!RECORDED_FAILURES.has(reason)) return;
      if (turn.id === lastStartedId) return;
      save(turn.trigger.event_name, "failed");
    },
    get() {
      return slot;
    },
  };
}
