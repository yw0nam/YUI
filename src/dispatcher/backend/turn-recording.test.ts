import { describe, expect, it, vi } from "vitest";
import type { SignalEnvelope, SignalGroup } from "../../contract";
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
    signalHistory: { append: vi.fn() },
  };
  return { entries, log, deps };
}

function turnOf(over: Partial<SentTurn> = {}, guide?: "controls"): SentTurn {
  return {
    eventName: "user.text",
    userText: "hi",
    turnId: "t1",
    // Narrow cast: the real client context is large and only the trigger is read.
    clientContext: {
      trigger: { kind: "user", ...(guide ? { guide } : {}) },
    } as SentTurn["clientContext"],
    startSessionToken: "s1",
    spokeText: true,
    ...over,
  };
}

function groupOf(over: Partial<SignalEnvelope> = {}): SignalGroup {
  return {
    envelope: {
      source: "unset",
      event_type: "issue.opened",
      delivery: "batched",
      event_id: "e1",
      occurred_at: 1,
      ...over,
    },
    items: [],
  };
}

function signalsTurn(over: Partial<SentTurn> = {}): SentTurn {
  return turnOf({
    eventName: "signals.urgent",
    userText: undefined,
    spokeText: false,
    clientContext: {
      trigger: {
        kind: "signals",
        signals: [
          groupOf({ source: "a", delivery: "urgent", event_id: "ea" }),
          groupOf({ source: "b", label: "CI failed", delivery: "immediate", event_id: "eb" }),
        ],
      },
    } as SentTurn["clientContext"],
    ...over,
  });
}

describe("recordSentTurn — routed turns", () => {
  it("the user entry carries the send id and the assistant entry the recipient", () => {
    const a = setup();
    recordSentTurn(
      { ...a.deps, addressedTo: (id) => (id === "t1" ? "perlica" : undefined) },
      a.log,
      turnOf({ sendId: "s1", assistantText: "Hello." }),
    );
    expect(a.entries).toEqual([
      { role: "user", text: "hi", ts: expect.any(Number), send_id: "s1" },
      { role: "assistant", text: "Hello.", ts: expect.any(Number), turn_id: "t1", to: "perlica" },
    ]);
  });

  it.each([
    ["everyone", { mention: "everyone" }],
    ["one character", {}],
  ] as const)("a turn routed to %s records its user entry with that recipient", (_to, extra) => {
    const a = setup();
    const mention = "mention" in extra ? "everyone" : "character";
    recordSentTurn(
      a.deps,
      a.log,
      turnOf({
        sendId: "s1",
        clientContext: { trigger: { kind: "user", mention } } as SentTurn["clientContext"],
      }),
    );
    expect(a.entries).toEqual([
      { role: "user", text: "hi", ts: expect.any(Number), send_id: "s1", ...extra },
    ]);
  });

  it("adds neither field to an unrouted turn", () => {
    const a = setup();
    recordSentTurn(a.deps, a.log, turnOf({ assistantText: "Hello." }));
    expect(a.entries).toEqual([
      { role: "user", text: "hi", ts: expect.any(Number) },
      { role: "assistant", text: "Hello.", ts: expect.any(Number), turn_id: "t1" },
    ]);
  });
});

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

  it("appends one record per signal group, delivery kept or folded to batched, said = what was spoken", () => {
    const a = setup();
    recordSentTurn(a.deps, a.log, signalsTurn({ assistantText: "Two came.", spokeText: true }));

    expect(a.deps.signalHistory.append).toHaveBeenCalledWith([
      {
        turn_id: "t1",
        event_id: "ea",
        source: "a",
        event_type: "issue.opened",
        label: null,
        delivery: "urgent",
        ts: expect.any(Number),
        said: "Two came.",
      },
      {
        turn_id: "t1",
        event_id: "eb",
        source: "b",
        event_type: "issue.opened",
        label: "CI failed",
        delivery: "batched",
        ts: expect.any(Number),
        said: "Two came.",
      },
    ]);
  });

  it("a silent turn records its groups with said null", () => {
    const a = setup();
    recordSentTurn(a.deps, a.log, signalsTurn({ assistantText: "[SILENT]", spokeText: false }));

    expect(a.deps.signalHistory.append).toHaveBeenCalledWith([
      expect.objectContaining({ turn_id: "t1", said: null }),
      expect.objectContaining({ turn_id: "t1", said: null }),
    ]);
  });

  it("a push send records its groups though its half is the user's only", () => {
    const a = setup();
    recordSentTurn(a.deps, a.log, signalsTurn({ userHalfOnly: true }));

    expect(a.deps.signalHistory.append).toHaveBeenCalledTimes(1);
    expect(a.entries).toEqual([]);
  });

  it("a turn whose trigger carries no groups records none", () => {
    const a = setup();
    recordSentTurn(a.deps, a.log, turnOf({ assistantText: "hello" }));

    expect(a.deps.signalHistory.append).not.toHaveBeenCalled();
  });

  it("the assistant entry names the turn that spoke it", () => {
    const a = setup();
    recordSentTurn(a.deps, a.log, turnOf({ assistantText: "hello", turnId: "t42" }));

    expect(a.entries).toEqual([
      { role: "user", text: "hi", ts: expect.any(Number) },
      { role: "assistant", text: "hello", ts: expect.any(Number), turn_id: "t42" },
    ]);
  });

  it("a silent reply appends no assistant entry", () => {
    const a = setup();
    recordSentTurn(a.deps, a.log, turnOf({ assistantText: "[SILENT]", spokeText: false }));

    expect(a.entries.map((e) => e.role)).toEqual(["user"]);
  });
});
