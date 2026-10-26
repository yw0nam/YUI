import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatHistoryEntry } from "../../../io/chat/conversation/chat-history-store";
import { createAddressedProducer } from "./addressed-producer";

const NO_TEXT_LINE = "[YUI][addressed-producer] no_text";

function setup(entries: ChatHistoryEntry[] = []) {
  const emit = vi.fn();
  const producer = createAddressedProducer({
    transcript: { entriesAfterLastBoundary: () => entries },
    selfPresetId: "natsume",
    selfName: () => "Natsume",
    emit,
    now: () => 5_000,
  });
  return { producer, emit };
}

function assistantEntry(text: string, turnId: string, ts: number): ChatHistoryEntry {
  return { role: "assistant", text, ts, turn_id: turnId };
}

describe("createAddressedProducer", () => {
  let consoleInfo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  it("keeps the first target of a turn and answers it from a second record call", () => {
    const { producer, emit } = setup([assistantEntry("hi", "7", 1)]);

    expect(producer.record("7", "perlica")).toBeUndefined();
    expect(producer.record("7", "shino")).toBe("perlica");

    producer.onTurnClosed({ id: 7, outcome: "ok", spokeText: true });
    expect(emit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: "perlica" }));
  });

  it("answers the recipient of an open turn and forgets it once the turn closes", () => {
    const { producer } = setup([assistantEntry("hi", "7", 1)]);
    producer.record("7", "perlica");

    expect(producer.targetOf("7")).toBe("perlica");
    expect(producer.targetOf("8")).toBeUndefined();

    producer.onTurnClosed({ id: 7, outcome: "ok", spokeText: true });
    expect(producer.targetOf("7")).toBeUndefined();
  });

  it("emits once for a closed turn with speech, joining its assistant entries", () => {
    const { producer, emit } = setup([
      assistantEntry("You", "7", 1),
      { role: "user", text: "did not", ts: 2, turn_id: "8" },
      assistantEntry("are right.", "7", 3),
    ]);
    producer.record("7", "perlica");

    producer.onTurnClosed({ id: 7, outcome: "ok", spokeText: true });

    expect(emit).toHaveBeenCalledExactlyOnceWith({
      from: "natsume",
      name: "Natsume",
      to: "perlica",
      text: "You are right.",
      ts: 5_000,
    });
  });

  it.each([
    [true, "  Ask me\nverbatim.  ", { user_message: "  Ask me\nverbatim.  " }],
    [true, undefined, {}],
    [false, "Ask me", {}],
    [true, "", { user_message: "" }],
  ])("emits handoff=%s with userText=%j", (handoff, userText, extra) => {
    const { producer, emit } = setup([assistantEntry("Ask Perlica.", "7", 1)]);
    producer.record("7", "perlica", handoff);
    producer.record("7", "shino", !handoff);
    producer.onTurnClosed({ id: 7, outcome: "ok", spokeText: true, userText });

    expect(emit).toHaveBeenCalledExactlyOnceWith({
      from: "natsume",
      name: "Natsume",
      to: "perlica",
      text: "Ask Perlica.",
      ts: 5_000,
      ...extra,
    });
  });

  it("emits nothing when the same turn closes again", () => {
    const { producer, emit } = setup([assistantEntry("hi", "7", 1)]);
    producer.record("7", "perlica");

    producer.onTurnClosed({ id: 7, outcome: "ok", spokeText: true });
    producer.onTurnClosed({ id: 7, outcome: "ok", spokeText: true });

    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("emits nothing when the outcome is not ok", () => {
    const { producer, emit } = setup([assistantEntry("hi", "7", 1)]);
    producer.record("7", "perlica");

    producer.onTurnClosed({ id: 7, outcome: "network_drop", spokeText: true });

    expect(emit).not.toHaveBeenCalled();
  });

  it("emits nothing when the turn spoke no text", () => {
    const { producer, emit } = setup([assistantEntry("hi", "7", 1)]);
    producer.record("7", "perlica");

    producer.onTurnClosed({ id: 7, outcome: "ok", spokeText: false });

    expect(emit).not.toHaveBeenCalled();
  });

  it("emits nothing and logs no_text when the transcript holds no entry of the turn", () => {
    const { producer, emit } = setup([assistantEntry("another turn", "8", 1)]);
    producer.record("7", "perlica");

    producer.onTurnClosed({ id: 7, outcome: "ok", spokeText: true });

    expect(emit).not.toHaveBeenCalled();
    expect(consoleInfo).toHaveBeenCalledWith(NO_TEXT_LINE, { to: "perlica" });
  });

  it("emits nothing for a turn with no recorded target", () => {
    const { producer, emit } = setup([assistantEntry("hi", "7", 1)]);

    producer.onTurnClosed({ id: 7, outcome: "ok", spokeText: true });

    expect(emit).not.toHaveBeenCalled();
  });
});
