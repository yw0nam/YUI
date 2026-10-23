import { describe, expect, it, vi } from "vitest";
import { EMPTY_CARD } from "../../../config/validators/persona/types";
import { type ChatHistoryItem, createChatHistoryStore } from "../conversation/chat-history-store";
import { type GreetingDeps, performGreeting } from "./perform-greeting";

const CARD = { card: { ...EMPTY_CARD, first_mes: "Hi, {{user}}. I'm {{char}}." }, charName: "Yui" };

function memStorage(items: ChatHistoryItem[]) {
  let data = items;
  return { load: () => data, save: (next: ChatHistoryItem[]) => (data = next) };
}

function setup(over: Partial<GreetingDeps> = {}) {
  const calls: string[] = [];
  const transcript = createChatHistoryStore({
    storage: memStorage([
      { role: "user", text: "old", ts: 1 },
      { kind: "boundary", ts: 2 },
    ]),
  });
  const append = transcript.append;
  transcript.append = (e) => {
    calls.push(`append:${e.text}:${e.greeting}`);
    append(e);
  };
  const deps: GreetingDeps = {
    transcript,
    getCard: () => CARD,
    userName: () => "Sam",
    speak: vi.fn((text: string) => void calls.push(`speak:${text}`)),
    now: () => 100,
    random: () => 0,
    ...over,
  };
  return { deps, calls };
}

describe("performGreeting", () => {
  it("appends the greeting as a flagged assistant entry, then speaks it", () => {
    const { deps, calls } = setup();
    performGreeting(deps);
    expect(calls).toEqual(["append:Hi, Sam. I'm Yui.:true", "speak:Hi, Sam. I'm Yui."]);
    expect(deps.speak).toHaveBeenCalledWith("Hi, Sam. I'm Yui.", {
      turn_id: "greeting:100",
      event_name: "greeting",
    });
  });

  it("greets once per session", () => {
    const { deps, calls } = setup();
    performGreeting(deps);
    performGreeting(deps);
    expect(calls).toHaveLength(2);
  });

  it("does nothing without a card", () => {
    const { deps, calls } = setup({ getCard: () => null });
    performGreeting(deps);
    expect(calls).toEqual([]);
  });

  it("sees a boundary another window's store wrote", () => {
    const storage = memStorage([{ role: "user", text: "old", ts: 1 }]);
    const storeA = createChatHistoryStore({ storage });
    const storeB = createChatHistoryStore({ storage });
    const speak = vi.fn();
    const { deps } = setup({ transcript: storeB, speak });
    storeA.startNewSession(5);
    performGreeting(deps);
    expect(speak).toHaveBeenCalledOnce();
    storeA.reloadFromStorage();
    expect(storeA.entriesAfterLastBoundary()).toEqual([
      { role: "assistant", text: "Hi, Sam. I'm Yui.", ts: 100, greeting: true },
    ]);
  });
});
