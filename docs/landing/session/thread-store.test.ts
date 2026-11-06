import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AskAnswer, Thread } from "../../../src/contract";
import type { Recording } from "./thread-store";

let store: typeof import("./thread-store").store;
beforeEach(async () => {
  vi.resetModules();
  ({ store } = await import("./thread-store"));
});

const allowBash = {
  ask_id: "perm:1",
  prompt: "Allow Bash?",
  text: true,
  choices: [
    { id: "allow", label: "Allow" },
    { id: "deny", label: "Deny" },
  ],
};
const whatNext = { ask_id: "stop:1", prompt: "What next?", text: true };

function replay(ask: object) {
  let thread: Thread | undefined;
  const heard: [string, AskAnswer][] = [];
  store.subscribe((s) => {
    thread = s.threads[0];
  });
  store.onAnswer((prompt, answer) => heard.push([prompt, answer]));
  const snapshot = {
    t: 0,
    threads: [
      {
        id: "cc",
        source: "claude-code",
        title: "acme-web",
        state: "input-required",
        entries: [{ role: "user", text: "run the tests", at: 0 }],
        created_at: 0,
        updated_at: 0,
        ask,
      },
    ],
  } as unknown as Recording["snapshots"][number];
  store.fromRecording(snapshot, 0);
  return { thread: () => thread!, heard };
}

describe("landing thread store", () => {
  it("publishes an ask the recording sent without choices with an empty choice list", () => {
    const { thread } = replay(whatNext);
    expect(thread().ask).toEqual({
      ask_id: "stop:1",
      prompt: "What next?",
      text: true,
      choices: [],
    });
  });

  it.each([
    ["allow", "Allow"],
    ["deny", "Deny"],
  ])("closes the permission ask on %s and tells the story", async (choice, label) => {
    const { thread, heard } = replay(allowBash);
    await store.answer("cc", "perm:1", { choice });
    expect(thread().ask).toBe(undefined);
    expect(thread().state).toBe("working");
    expect(thread().entries.at(-1)).toMatchObject({ role: "user", text: label });
    expect(heard).toEqual([["Allow Bash?", { choice }]]);
  });

  it("rejects a text-only answer to the permission ask and keeps it open", async () => {
    const { thread, heard } = replay(allowBash);
    await expect(store.answer("cc", "perm:1", { text: "skip e2e" })).rejects.toThrow(
      "pick Allow or Deny in this demo",
    );
    expect(thread().ask?.ask_id).toBe("perm:1");
    expect(heard).toEqual([]);
  });
});
