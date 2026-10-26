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
  let shown: (shown: boolean) => void = () => {};
  createBacklog({
    mount: frame,
    read,
    characterName: () => "Perlica",
    bubble: {
      keepOpen: vi.fn(),
      onShown: (listener) => {
        shown = listener;
        return () => {};
      },
    },
  });
  shown(true);
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

  it("renders each line's markdown, links keeping their address", () => {
    const { toggle, rows, panel } = setup(() => [
      {
        role: "assistant",
        text: "See **this part** and [the guide](https://example.com/x) with `code`.",
        ts: 1,
      },
    ]);
    toggle.click();
    expect(rows()).toEqual([["Perlica", "See this part and the guide with code."]]);
    expect(panel.querySelector("strong")?.textContent).toBe("this part");
    expect(panel.querySelector("a")?.getAttribute("href")).toBe("https://example.com/x");
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
