import { describe, expect, it, vi } from "vitest";
import type { ChatHistoryEntry } from "../../io/chat/conversation/chat-history-store";
import type { Logger } from "../../logger";
import type { SentTurn } from "./turn-recording";
import { recordSentTurn } from "./turn-recording";

function setup(token = "s1") {
  const entries: ChatHistoryEntry[] = [];
  const log: Logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = {
    transcript: { append: (e: ChatHistoryEntry) => entries.push(e), sessionToken: () => token },
    contextHistory: { append: vi.fn() },
    appendTurnRecord: vi.fn(),
  };
  return { entries, log, deps };
}

function turnOf(over: Partial<SentTurn> = {}, guide?: "controls"): SentTurn {
  return {
    eventName: "user.text",
    userText: "hi",
    // Narrow cast: the real client context is large and only the trigger is read.
    clientContext: {
      trigger: { kind: "user", ...(guide ? { guide } : {}) },
    } as SentTurn["clientContext"],
    startSessionToken: "s1",
    spokeText: true,
    ...over,
  };
}

describe("recordSentTurn", () => {
  it("appends the user entry on a matching token, with the guide when present", () => {
    const a = setup();
    recordSentTurn(a.deps, a.log, turnOf());
    expect(a.entries).toMatchObject([{ role: "user", text: "hi" }]);
    expect(a.entries[0]).not.toHaveProperty("guide");
    const b = setup();
    recordSentTurn(b.deps, b.log, turnOf({}, "controls"));
    expect(b.entries[0]).toMatchObject({ role: "user", guide: "controls" });
  });

  it("appends the assistant entry only when given", () => {
    const a = setup();
    recordSentTurn(a.deps, a.log, turnOf({ assistantText: "hello" }));
    expect(a.entries.map((e) => e.role)).toEqual(["user", "assistant"]);
    const b = setup();
    recordSentTurn(b.deps, b.log, turnOf());
    expect(b.entries.map((e) => e.role)).toEqual(["user"]);
  });

  it("skips the transcript with a log on a reset token but still appends contextHistory", () => {
    const a = setup("s2");
    recordSentTurn(a.deps, a.log, turnOf({ assistantText: "hello" }));
    expect(a.entries).toEqual([]);
    expect(a.log.info).toHaveBeenCalledWith("transcript_skipped", {
      reason: "session_reset",
      event_name: "user.text",
    });
    expect(a.deps.contextHistory.append).toHaveBeenCalledTimes(1);
    expect(a.deps.appendTurnRecord).toHaveBeenCalledTimes(1);
  });

  it("logs a reset only when there is user text if userHalfOnly", () => {
    const a = setup("s2");
    recordSentTurn(a.deps, a.log, turnOf({ userText: undefined }));
    expect(a.log.info).toHaveBeenCalledTimes(1);
    const b = setup("s2");
    recordSentTurn(b.deps, b.log, turnOf({ userText: undefined, userHalfOnly: true }));
    expect(b.log.info).not.toHaveBeenCalled();
  });

  it("records only the user half and logs nothing for a push-style turn on a matching token", () => {
    const a = setup();
    recordSentTurn(a.deps, a.log, turnOf({ userHalfOnly: true, spokeText: false }));
    expect(a.entries.map((e) => e.role)).toEqual(["user"]);
    expect(a.log.info).not.toHaveBeenCalled();
  });

  it("swallows a throwing appendTurnRecord and logs it", () => {
    const a = setup();
    a.deps.appendTurnRecord.mockImplementation(() => {
      throw new Error("disk");
    });
    expect(() => recordSentTurn(a.deps, a.log, turnOf())).not.toThrow();
    expect(a.log.debug).toHaveBeenCalledWith("turn_record_append_failed", {
      error: "Error: disk",
    });
  });
});
