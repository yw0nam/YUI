// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageSurfaceOp } from "../../io/bridge/message/message-bridge";
import type { UserTurnRouted } from "../../io/bridge/settings-bridge";
import type { ChatHistoryEntry } from "../../io/chat/conversation/chat-history-store";
import type { PresetEntry } from "../../settings/preset/active-preset";
import { createUnifiedView } from "./unified-view";

vi.mock("../surfaces/surfaces.css", () => ({}));
vi.mock("./unified-window.css", () => ({}));

const T = 1_789_365_900_000;

let transcripts: Record<string, ChatHistoryEntry[]>;
let routed: UserTurnRouted[];
let stops: number;
let nextId: number;
let focusWindow: ReturnType<typeof vi.fn<() => Promise<void>>>;
let view: ReturnType<typeof createUnifiedView>;

let cast: PresetEntry[];

const CAST = [
  { id: "perlica", name: "Perlica", thumbnail: "asset://perlica.png" },
  { id: "natsume", name: "Natsume" },
];

function mount(): void {
  document.body.innerHTML = '<div id="app"></div>';
  focusWindow = vi.fn(async () => {});
  view = createUnifiedView({
    mount: document.querySelector("#app")!,
    cast: () => cast,
    transcripts: () => cast.map((c) => ({ ...c, entries: transcripts[c.id] ?? [] })),
    mainId: () => "perlica",
    now: () => T,
    randomId: () => `send-${++nextId}`,
    focusWindow,
    closeWindow: () => {},
    startDragging: () => {},
  });
  routed = [];
  stops = 0;
  view.onRoute((e) => routed.push(e));
  view.onStop(() => stops++);
  view.refresh();
}

const field = () => document.querySelector<HTMLTextAreaElement>(".yui-uc__dock .yui-input__field")!;
const stream = (preset: string, op: MessageSurfaceOp) => view.speechStream({ preset, op });
const recipients = () =>
  [...document.querySelectorAll<HTMLElement>("[role=radio]")].map((r) => [
    r.textContent,
    r.getAttribute("aria-checked"),
  ]);
const chipStates = () =>
  [...document.querySelectorAll<HTMLElement>(".yui-uc__chip")].map((c) => c.dataset.state);
const boxText = () => document.querySelector(".yui-bubble__text")?.textContent;

function type(text: string): void {
  field().value = text;
  field().dispatchEvent(new Event("input", { bubbles: true }));
}
function press(key: string): void {
  field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  transcripts = {
    perlica: [{ role: "assistant", text: "Hello.", ts: T - 110_000, turn_id: "1" }],
    natsume: [{ role: "assistant", text: "Yes.", ts: T - 50_000, turn_id: "3" }],
  };
  cast = CAST;
  nextId = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
  }));
});

afterEach(() => {
  view?.dispose();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("unified view — sending", () => {
  it("routes a typed message to the last speaker", () => {
    mount();

    type("hi");
    press("Enter");

    expect(routed).toEqual([{ sendId: "send-1", to: "natsume", text: "hi" }]);
  });

  it("checks the fallback recipient, then the one a click or a typed @name picks", () => {
    mount();
    expect(recipients()).toEqual([
      ["Perlica", "false"],
      ["Natsume", "true"],
      ["everyone", "false"],
    ]);

    type("@perlica hi");
    expect(recipients()[0]).toEqual(["Perlica", "true"]);

    type("");
    document.querySelectorAll<HTMLElement>("[role=radio]")[2]!.click();
    expect(recipients()[2]).toEqual(["everyone", "true"]);
  });

  it("routes to the recipient a click picked, with its mention in the text", () => {
    mount();
    document.querySelectorAll<HTMLElement>("[role=radio]")[0]!.click();

    type("hello");
    press("Enter");

    expect(routed).toEqual([
      { sendId: "send-1", to: "perlica", text: "@Perlica hello", mention: "character" },
    ]);
    expect(recipients()[1]).toEqual(["Natsume", "true"]);
  });

  it("routes everyone one character at a time", () => {
    mount();
    document.querySelectorAll<HTMLElement>("[role=radio]")[2]!.click();
    type("hi");
    press("Enter");
    expect(routed).toHaveLength(1);
    const first = routed[0]!.to;

    view.turnDone({ sendId: "send-1", preset: first });

    expect(routed[1]).toMatchObject({
      sendId: "send-1",
      to: first === "perlica" ? "natsume" : "perlica",
      text: "@everyone hi",
      mention: "everyone",
    });
  });

  it("Tab picks the highlighted @ option", () => {
    mount();

    type("@per");
    press("Tab");
    type("hi");
    press("Enter");

    expect(routed).toEqual([
      { sendId: "send-1", to: "perlica", text: "@Perlica hi", mention: "character" },
    ]);
  });
});

describe("unified view — a face that changes", () => {
  const framed = {
    id: "natsume",
    name: "Natsume",
    thumbnail: "asset://n.png",
    crop: { x: 0.2, y: 0.05, size: 0.5 },
  };

  it("repaints the cast chip, the recipient chip and an open @ list with the new crop", () => {
    mount();
    type("@");
    cast = [CAST[0]!, framed];

    view.refresh();

    for (const root of [
      ".yui-uc__chip:nth-child(2)",
      "[role=radio][data-id=natsume]",
      "[role=option]:nth-child(2)",
    ]) {
      const img = document.querySelector(`${root} .yui-uc__avatar > img`);
      expect(img?.getAttribute("src"), root).toBe("asset://n.png");
      expect((img as HTMLElement).style.getPropertyValue("--yui-crop-size"), root).toBe("0.5");
    }
  });
});

describe("unified view — running replies", () => {
  it("turns send into stop while a reply runs, and stop ends every turn and the sequence", () => {
    mount();
    document.querySelectorAll<HTMLElement>("[role=radio]")[2]!.click();
    type("hi");
    press("Enter");
    const first = routed[0]!.to;
    stream(first, { op: "busy", busy: true });
    const form = document.querySelector(".yui-uc__dock .yui-input")!;
    expect(form.classList.contains("is-running")).toBe(true);

    document.querySelector<HTMLButtonElement>(".yui-uc__dock .yui-input__send")!.click();
    view.turnDone({ sendId: "send-1", preset: first });

    expect(stops).toBe(1);
    expect(routed).toHaveLength(1);
  });

  it("shows a routed turn's error under the composer", () => {
    mount();

    stream("natsume", { op: "input-error", message: "Could not reach the backend" });

    expect(document.querySelector(".yui-uc__dock .yui-input__error")?.textContent).toBe(
      "Could not reach the backend",
    );
  });

  it("keeps a failed routed turn's error while the send still waits for its turn to close", () => {
    mount();
    type("hi");
    press("Enter");

    stream("natsume", { op: "input-error", message: "Backend not configured" });
    stream("natsume", { op: "busy", busy: false });

    expect(document.querySelector(".yui-uc__dock .yui-input__error")?.textContent).toBe(
      "Backend not configured",
    );
  });

  it("offers an error's fix and sends its click back to the preset that failed", () => {
    mount();
    const clicked: string[] = [];
    view.onInputErrorAction((preset) => clicked.push(preset));

    stream("natsume", {
      op: "input-error",
      message: "Connect a backend first.",
      action: { label: "Open Connection" },
    });
    const fix = document.querySelector<HTMLButtonElement>(
      ".yui-uc__dock .yui-input__error-action",
    )!;
    expect(fix.textContent).toBe("Open Connection");
    fix.click();

    expect(clicked).toEqual(["natsume"]);
  });

  it("focuses the window and the field on a summon", async () => {
    mount();

    stream("perlica", { op: "summon-input" });

    await vi.waitFor(() => expect(document.activeElement).toBe(field()));
    expect(focusWindow).toHaveBeenCalledOnce();
  });

  it("shows one character's line at a time, the other waiting", () => {
    mount();

    stream("perlica", { op: "begin" });
    stream("perlica", { op: "push", delta: "First." });
    stream("natsume", { op: "begin" });
    stream("natsume", { op: "push", delta: "Second." });

    expect(boxText()).toBe("First.");
    expect(document.querySelector(".yui-plate__name")?.textContent).toBe("Perlica");
    expect(chipStates()).toEqual(["talk", "think"]);

    stream("perlica", { op: "end" });

    expect(boxText()).toBe("Second.");
    expect(document.querySelector(".yui-plate__name")?.textContent).toBe("Natsume");
    expect(chipStates()).toEqual(["idle", "talk"]);
  });

  it("leads a quote routed to everyone with You → everyone", () => {
    mount();

    stream("natsume", {
      op: "quote",
      quote: { text: "hi all", via: "text", images: 0, mention: "everyone" },
    });

    expect(document.querySelector(".yui-bubble__quote-who")?.textContent).toBe("You → everyone");
  });
});

describe("unified view — the backlog", () => {
  it("labels the user's lines with who they went to", () => {
    transcripts = {
      perlica: [
        { role: "user", text: "hi all", ts: T - 90_000, send_id: "s1", mention: "everyone" },
        { role: "assistant", text: "Hello.", ts: T - 80_000 },
      ],
      natsume: [
        { role: "user", text: "hi all", ts: T - 89_000, send_id: "s1", mention: "everyone" },
        { role: "user", text: "just you", ts: T - 70_000, send_id: "s2" },
      ],
    };
    mount();
    stream("perlica", { op: "begin" });
    stream("perlica", { op: "push", delta: "Now." });

    document.querySelector<HTMLButtonElement>(".yui-bubble__backlog-toggle")!.click();

    expect(
      [...document.querySelectorAll(".yui-bubble__backlog-list li")].map((li) => [
        li.querySelector(".yui-bubble__backlog-who")?.textContent,
        li.querySelector(".yui-bubble__backlog-text")?.textContent,
      ]),
    ).toEqual([
      ["You → everyone", "hi all"],
      ["Perlica", "Hello."],
      ["You → Natsume", "just you"],
    ]);
  });
});
