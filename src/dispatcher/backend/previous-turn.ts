import {
  BACKEND_EVENT_NAME,
  type PreviousTurn,
  type TurnEnded,
  type UtteranceIdentity,
} from "../../contract";
import type { SpokenSplit } from "../../io/voice/tts/tts-pipeline";
import {
  isPlainObject,
  localStorageStore,
  type PersistedStorage,
} from "../../settings/persisted-store";
import type { Turn } from "../turn/turn";
import type { TurnFailure } from "./backend-caller";

const STORAGE_KEY = "yui.previous-turn";
const ENDED_VALUES: readonly string[] = ["complete", "interrupted", "failed"];
const SPLIT_CHARS = 50;
// not_configured and superseded_by_user say nothing about a failed attempt to speak.
const RECORDED_FAILURES: ReadonlySet<TurnFailure> = new Set([
  "network_drop",
  "network_stall",
  "http_4xx_drop",
  "parse_error",
]);

interface PreviousTurnDeps {
  storage?: PersistedStorage<PreviousTurn>;
  now?: () => number;
}

export interface PreviousTurnSlot {
  utteranceStart(identity: UtteranceIdentity): void;
  utteranceEnd(
    ended: "complete" | "interrupted",
    split: SpokenSplit | undefined,
    identity: UtteranceIdentity,
  ): void;
  callFailed(turn: Turn, reason: TurnFailure): void;
  // Complete remains stored; the context builder decides which outcomes render.
  get(): PreviousTurn | undefined;
  subscribe(cb: (record: PreviousTurn) => void): () => void;
}

function parse(loaded: unknown): PreviousTurn | undefined {
  if (!isPlainObject(loaded)) return undefined;
  const { turn_id, event_name, ended, ts, spoken, unspoken } = loaded as Record<string, unknown>;
  if (typeof event_name !== "string" || event_name === "") return undefined;
  if (typeof ended !== "string" || !ENDED_VALUES.includes(ended)) return undefined;
  if (typeof ts !== "number" || !Number.isFinite(ts)) return undefined;
  return {
    event_name,
    ended: ended as TurnEnded,
    ts,
    ...(typeof turn_id === "string" && turn_id ? { turn_id } : {}),
    ...(typeof spoken === "string" ? { spoken } : {}),
    ...(typeof unspoken === "string" ? { unspoken } : {}),
  };
}

// Code-point slices keep characters outside the basic plane whole.
function cutParts(split: SpokenSplit | undefined): Pick<PreviousTurn, "spoken" | "unspoken"> {
  const spoken = Array.from(split?.spoken ?? "")
    .slice(-SPLIT_CHARS)
    .join("")
    .trim();
  const unspoken = Array.from(split?.unspoken ?? "")
    .slice(0, SPLIT_CHARS)
    .join("")
    .trim();
  return { ...(spoken ? { spoken } : {}), ...(unspoken ? { unspoken } : {}) };
}

export function createPreviousTurn(deps: PreviousTurnDeps = {}): PreviousTurnSlot {
  const storage = deps.storage ?? localStorageStore<PreviousTurn>(STORAGE_KEY);
  const now = deps.now ?? Date.now;
  const subscribers = new Set<(record: PreviousTurn) => void>();
  let slot = parse(storage.load());
  let lastClientStartedId: string | undefined;

  function save(identity: UtteranceIdentity, ended: TurnEnded, split?: SpokenSplit): void {
    slot = { ...identity, ended, ts: now(), ...(ended === "interrupted" ? cutParts(split) : {}) };
    storage.save(slot);
    for (const cb of subscribers) cb(slot);
  }

  return {
    utteranceStart(identity) {
      if (identity.event_name !== BACKEND_EVENT_NAME) lastClientStartedId = identity.turn_id;
    },
    utteranceEnd(ended, split, identity) {
      save(identity, ended, split);
    },
    callFailed(turn, reason) {
      if (!RECORDED_FAILURES.has(reason) || String(turn.id) === lastClientStartedId) return;
      save({ turn_id: String(turn.id), event_name: turn.trigger.event_name }, "failed");
    },
    get: () => slot,
    subscribe(cb) {
      subscribers.add(cb);
      return () => {
        subscribers.delete(cb);
      };
    },
  };
}
