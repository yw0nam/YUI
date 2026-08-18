/**
 * Turn-record JSONL — long-horizon speak-rate/suppression analysis source.
 *
 * One JSON line per completed backend turn ("turn") and per screen-source fire skipped
 * before becoming a turn ("skip"), appended to the day's turns JSONL file via the Rust
 * `append_turn_record` command. Best-effort: outside the Tauri runtime, or on any invoke
 * failure, the line is dropped and logged at debug — this must never break the turn or
 * the fire path that produced the record.
 */

import type { ClientContext } from "../contract";
import { createLogger } from "../logger";
import { isTauri } from "./tauri-env";

const log = createLogger("turn-record-log");

export interface TurnRecord {
  type: "turn";
  ts: number;
  event_name: string;
  trigger_kind: ClientContext["trigger"]["kind"];
  client_context: ClientContext;
  spoke_text: boolean;
}

export type ScreenSkipReason = "disabled" | "not_present" | "min_gap" | "quiet_after_turn";

export interface SkipRecord {
  type: "skip";
  ts: number;
  source: "screen";
  reason: ScreenSkipReason;
  transition: string;
}

export function buildTurnRecord(fields: Omit<TurnRecord, "type">): TurnRecord {
  return { type: "turn", ...fields };
}

export function buildSkipRecord(fields: Omit<SkipRecord, "type" | "source">): SkipRecord {
  return { type: "skip", source: "screen", ...fields };
}

export interface TurnRecordLogDeps {
  /** `@tauri-apps/api/core` invoke. */
  invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

async function defaultDeps(): Promise<TurnRecordLogDeps | undefined> {
  if (!isTauri()) return undefined;
  const { invoke } = await import("@tauri-apps/api/core");
  return { invoke };
}

/**
 * Fire-and-forget append to the day's turns JSONL file. Never throws; a failed
 * write (no Tauri runtime, IPC error, etc.) is caught and logged at debug.
 */
export function appendRecord(record: TurnRecord | SkipRecord, deps?: TurnRecordLogDeps): void {
  const line = JSON.stringify(record);
  const run = async () => {
    const d = deps ?? (await defaultDeps());
    if (!d) return;
    await d.invoke("append_turn_record", { line });
  };
  run().catch((err) => log.debug("append_failed", { error: String(err) }));
}
