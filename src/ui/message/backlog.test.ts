// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  type ChatHistoryEntry,
  createChatHistoryStore,
} from "../../io/chat/conversation/chat-history-store";
import { createBacklog } from "./backlog";

function setup(read: () => ChatHistoryEntry[]) {
  const bubble = document.createElement("div");
  const frame = document.createElement("div");
  bubble.append(frame);
  const backlog = createBacklog({
    mount: frame,
    read,
    characterName: () => "Perlica",
    bubble: { keepOpen: vi.fn() },
  });
  backlog.refresh();
  const toggle = bubble.querySelector<HTMLButtonElement>(".yui-bubble__backlog-toggle")!;
  const panel = bubble.querySelector<HTMLElement>(".yui-bubble__backlog")!;
  const rows = () =>
    [...panel.querySelectorAll("li")].map((li) => [
      li.querySelector(".yui-bubble__backlog-who")?.textContent,
      li.querySelector(".yui-bubble__backlog-text")?.textContent,
    ]);
  return { toggle, panel, rows, frame };
}

describe("createBacklog", () => {
  it("lists the current session's user and character lines above the box, oldest first", () => {
    const transcript = createChatHistoryStore();
    transcript.append({ role: "user", text: "Old question", ts: 1 });
    transcript.startNewSession(2);
    transcript.append({ role: "user", text: "Hi", ts: 3 });
    transcript.append({ role: "assistant", text: "Hello!", ts: 4 });
    const { toggle, panel, rows, frame } = setup(transcript.entriesAfterLastBoundary);

    expect(panel.hidden).toBe(true);
    toggle.click();

    expect(panel.hidden).toBe(false);
    expect(panel.nextElementSibling).toBe(frame);
    expect(toggle.parentElement).toBe(frame);
    expect(rows()).toEqual([
      ["You", "Hi"],
      ["Perlica", "Hello!"],
    ]);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.textContent).toBe("Hide backlog");
  });

  it("reads the transcript again on each open", () => {
    const entries: ChatHistoryEntry[] = [{ role: "user", text: "Hi", ts: 1 }];
    const { toggle, rows } = setup(() => entries);
    toggle.click();
    toggle.click();
    entries.push({ role: "assistant", text: "Hello!", ts: 2 });
    toggle.click();
    expect(rows()).toEqual([
      ["You", "Hi"],
      ["Perlica", "Hello!"],
    ]);
  });

  it("hides the toggle while the session has no lines", () => {
    const { toggle } = setup(() => []);
    expect(toggle.hidden).toBe(true);
  });
});
