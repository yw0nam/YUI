import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_CARD } from "../../config/validators/persona/types";
import { createChatHistoryStore } from "../../io/chat/conversation/chat-history-store";
import { wireGreeting } from "./wire-greeting";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const calls: string[] = [];
  let resetCb: ((presetId: string) => void) | undefined;
  wireGreeting({
    onSessionReset: (cb) => {
      resetCb = cb;
      return () => {};
    },
    presetId: "p1",
    stopTurn: () => calls.push("stopTurn"),
    transcript: createChatHistoryStore(),
    getCard: () => ({ card: { ...EMPTY_CARD, first_mes: "Hi." }, charName: "Yui" }),
    userName: () => "Sam",
    speak: vi.fn((text: string) => void calls.push(`speak:${text}`)),
  });
  return { calls, fire: (id: string) => resetCb?.(id) };
}

describe("wireGreeting", () => {
  it("does nothing at wire time or for another preset's reset", () => {
    const { calls, fire } = setup();
    fire("p2");
    expect(calls).toEqual([]);
  });

  it("a reset from another window for this preset stops the running turn before it greets", () => {
    const { calls, fire } = setup();
    fire("p1");
    expect(calls).toEqual(["stopTurn", "speak:Hi."]);
  });

  it("greets once at wire time when the import's pending marker is set, and consumes it", () => {
    const map = new Map([["yui.p1.greeting-pending", "1"]]);
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => map.get(k) ?? null,
      removeItem: (k: string) => map.delete(k),
    });
    const { calls } = setup();
    expect(calls).toEqual(["speak:Hi."]);
    expect(map.has("yui.p1.greeting-pending")).toBe(false);
  });
});
