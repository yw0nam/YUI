import { describe, expect, it, vi } from "vitest";
import { EMPTY_CARD } from "../../config/validators/persona/types";
import {
  type ChatHistoryItem,
  createChatHistoryStore,
} from "../../io/chat/conversation/chat-history-store";
import { wireGreeting } from "./wire-greeting";

const CARD = { card: { ...EMPTY_CARD, first_mes: "Hi, {{user}}. I'm {{char}}." }, charName: "Yui" };

function memStorage(items: ChatHistoryItem[] = []) {
  let data = items;
  return { load: () => data, save: (next: ChatHistoryItem[]) => (data = next) };
}

function setup(over: Partial<Parameters<typeof wireGreeting>[0]> = {}) {
  const calls: string[] = [];
  let resetCb: ((presetId: string) => void) | undefined;
  const transcript = createChatHistoryStore({
    storage: memStorage([
      { role: "user", text: "old", ts: 1 },
      { kind: "boundary", ts: 2 },
    ]),
  });
  const originalAppend = transcript.append;
  transcript.append = (e) => {
    calls.push(`append:${e.text}:${e.greeting}`);
    originalAppend(e);
  };
  const deps = {
    onSessionReset: (cb: (presetId: string) => void) => {
      resetCb = cb;
      return () => {
        resetCb = undefined;
      };
    },
    presetId: "p1",
    stopTurn: vi.fn(() => calls.push("stopTurn")),
    transcript,
    getCard: () => CARD,
    userName: () => "Sam",
    speak: vi.fn((text: string) => calls.push(`speak:${text}`)),
    now: () => 100,
    random: () => 0,
    ...over,
  };
  const greeting = wireGreeting(deps);
  return { greeting, deps, calls, transcript, fire: (id: string) => resetCb?.(id) };
}

describe("wireGreeting", () => {
  it("appends the greeting as a flagged assistant entry, then speaks it", () => {
    const { greeting, deps, calls } = setup();
    greeting.greetLocal();
    expect(calls).toEqual(["append:Hi, Sam. I'm Yui.:true", "speak:Hi, Sam. I'm Yui."]);
    expect(deps.speak).toHaveBeenCalledWith("Hi, Sam. I'm Yui.", {
      turn_id: "greeting:100",
      event_name: "greeting",
    });
  });

  it("greets once per session", () => {
    const { greeting, calls } = setup();
    greeting.greetLocal();
    greeting.greetLocal();
    expect(calls).toHaveLength(2);
  });

  it("does nothing at wire time, for another preset's reset, or without a card", () => {
    expect(setup().calls).toEqual([]);
    const other = setup();
    other.fire("p2");
    expect(other.calls).toEqual([]);
    const noCard = setup({ getCard: () => null });
    noCard.greeting.greetLocal();
    expect(noCard.calls).toEqual([]);
  });

  it("a reset from another window for this preset stops the running turn before it greets", () => {
    const { calls, fire } = setup();
    fire("p1");
    expect(calls).toEqual(["stopTurn", "append:Hi, Sam. I'm Yui.:true", "speak:Hi, Sam. I'm Yui."]);
  });

  it("sees a boundary another window's store wrote", () => {
    const storage = memStorage([{ role: "user", text: "old", ts: 1 }]);
    const storeA = createChatHistoryStore({ storage });
    const storeB = createChatHistoryStore({ storage });
    const speak = vi.fn();
    const { greeting } = setup({ transcript: storeB, speak });
    storeA.startNewSession(5);
    greeting.greetLocal();
    expect(speak).toHaveBeenCalledOnce();
    expect(storeA.entriesAfterLastBoundary()).toEqual([]);
    storeA.reloadFromStorage();
    expect(storeA.entriesAfterLastBoundary()).toEqual([
      { role: "assistant", text: "Hi, Sam. I'm Yui.", ts: 100, greeting: true },
    ]);
  });
});
