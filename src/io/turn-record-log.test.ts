/**
 * turn-record-log.test.ts — record builders + fire-and-forget append to the turns JSONL file.
 */

import { describe, expect, it, vi } from "vitest";
import type { ClientContext } from "../contract";
import {
  appendRecord,
  buildSkipRecord,
  buildTurnRecord,
  type ScreenSkipReason,
  type TurnRecordLogDeps,
} from "./turn-record-log";

const CLIENT_CONTEXT: ClientContext = {
  env: { timestamp: "2026-08-18T10:00:00+09:00", timezone: "Asia/Seoul" },
  trigger: { kind: "user" },
};

describe("turn-record-log — buildTurnRecord", () => {
  it("shapes a spoken turn record", () => {
    const record = buildTurnRecord({
      ts: 1_000,
      event_name: "user.text_submitted",
      trigger_kind: "user",
      client_context: CLIENT_CONTEXT,
      spoke_text: true,
    });
    expect(record).toEqual({
      type: "turn",
      ts: 1_000,
      event_name: "user.text_submitted",
      trigger_kind: "user",
      client_context: CLIENT_CONTEXT,
      spoke_text: true,
    });
  });

  it("shapes a silent turn record (spoke_text: false)", () => {
    const record = buildTurnRecord({
      ts: 2_000,
      event_name: "proactive.cowork",
      trigger_kind: "proactive",
      client_context: CLIENT_CONTEXT,
      spoke_text: false,
    });
    expect(record.spoke_text).toBe(false);
    expect(record.type).toBe("turn");
  });
});

describe("turn-record-log — buildSkipRecord", () => {
  const REASONS: ScreenSkipReason[] = ["disabled", "not_present", "min_gap", "quiet_after_turn"];

  it.each(REASONS)("shapes a screen skip record for reason=%s", (reason) => {
    const record = buildSkipRecord({ ts: 3_000, reason, transition: "app_switched" });
    expect(record).toEqual({
      type: "skip",
      source: "screen",
      ts: 3_000,
      reason,
      transition: "app_switched",
    });
  });
});

describe("turn-record-log — appendRecord", () => {
  it("invokes append_turn_record with the JSON-stringified line", () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const deps: TurnRecordLogDeps = { invoke };
    const record = buildTurnRecord({
      ts: 1_000,
      event_name: "user.text_submitted",
      trigger_kind: "user",
      client_context: CLIENT_CONTEXT,
      spoke_text: true,
    });

    appendRecord(record, deps);

    expect(invoke).toHaveBeenCalledOnce();
    const [cmd, args] = invoke.mock.calls[0];
    expect(cmd).toBe("append_turn_record");
    expect(JSON.parse((args as { line: string }).line)).toEqual(record);
  });

  it("never throws when invoke rejects — failure is swallowed", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("ipc down"));
    const deps: TurnRecordLogDeps = { invoke };
    const record = buildSkipRecord({ ts: 3_000, reason: "min_gap", transition: "long_session" });

    expect(() => appendRecord(record, deps)).not.toThrow();
    // let the internal rejection settle without surfacing as unhandled.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
