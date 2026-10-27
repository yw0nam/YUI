// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageSurfaceOp } from "../../io/bridge/message/message-bridge";
import type { UserTurnRouted } from "../../io/bridge/settings-bridge";
import type { ChatHistoryEntry } from "../../io/chat/conversation/chat-history-store";
import type { PresetEntry } from "../../settings/preset/active-preset";
import { setLocale } from "../i18n";
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
const castRadios = () => [...document.querySelectorAll<HTMLElement>(".yui-uc__cast [role=radio]")];
const pick = (i: number) => castRadios()[i]!.click();
const recipients = () => castRadios().map((r) => [r.textContent, r.getAttribute("aria-checked")]);
const chipStates = () =>
  [...document.querySelectorAll<HTMLElement>(".yui-uc__chip[data-state]")].map(
    (c) => c.dataset.state,
  );
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
  setLocale("en");
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

  it("routes a spoken message like a typed one, marked as spoken", () => {
    mount();

    view.voiceSegment("hi");

    expect(routed).toEqual([{ sendId: "send-1", to: "natsume", text: "hi", via: "voice" }]);
  });

  it("routes a spoken message to the checked recipient: a typed @name in the field", () => {
    mount();

    type("@perlica ");
    view.voiceSegment("hello");

    expect(routed).toEqual([
      {
        sendId: "send-1",
        to: "perlica",
        text: "@Perlica hello",
        via: "voice",
        mention: "character",
      },
    ]);
  });

  it.each([
    { field: "@perlica ", rest: "" },
    { field: "@perlica tell me", rest: "tell me" },
  ])("a spoken send consumes the field's leading @name, leaving the rest (%j)", ({
    field: text,
    rest,
  }) => {
    mount();

    type(text);
    view.voiceSegment("hi");

    expect(routed).toEqual([
      { sendId: "send-1", to: "perlica", text: "@Perlica hi", via: "voice", mention: "character" },
    ]);
    expect(field().value).toBe(rest);
  });

  it("a spoken send with a picked chip leaves the field as it is", () => {
    mount();

    pick(0);
    type("draft");
    view.voiceSegment("hi");

    expect(routed).toEqual([
      { sendId: "send-1", to: "perlica", text: "@Perlica hi", via: "voice", mention: "character" },
    ]);
    expect(field().value).toBe("draft");
  });

  it("a spoken send with no pick and no typed @name equals the typed send of the same text but via", () => {
    mount();

    type("hi");
    press("Enter");
    const typed = routed[0]!;
    view.turnDone({ sendId: "send-1", preset: typed.to });

    view.voiceSegment("hi");

    expect(routed[1]).toEqual({ ...typed, sendId: "send-2", via: "voice" });
  });

  it("puts a spoken message that arrives during a send into the field, unsent and unfocused", () => {
    mount();
    type("hi");
    press("Enter");
    field().blur();

    view.voiceSegment("wait");
    view.voiceSegment("and this");

    expect(routed).toHaveLength(1);
    expect(field().value).toBe("wait and this");
    expect(document.activeElement).not.toBe(field());
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
    pick(2);
    expect(recipients()[2]).toEqual(["everyone", "true"]);
  });

  it("names the checked recipient in the field's placeholder, in the current language", () => {
    mount();
    expect(field().placeholder).toBe("Say something to Natsume…");

    type("@perlica ");
    expect(field().placeholder).toBe("Say something to Perlica…");

    type("");
    pick(2);
    expect(field().placeholder).toBe("Say something to everyone…");

    setLocale("ko");
    expect(field().placeholder).toBe("모두에게 말 걸기…");
  });

  it("routes to the recipient a click picked, with its mention in the text", () => {
    mount();
    pick(0);

    type("hello");
    press("Enter");

    expect(routed).toEqual([
      { sendId: "send-1", to: "perlica", text: "@Perlica hello", mention: "character" },
    ]);
    expect(recipients()[0]).toEqual(["Perlica", "true"]);

    view.turnDone({ sendId: "send-1", preset: "perlica" });
    expect(recipients()[1]).toEqual(["Natsume", "true"]);
  });

  it("checks everyone while an everyone send runs, then the last speaker without a refresh", () => {
    mount();
    pick(2);
    type("hi");
    press("Enter");
    const [first, second] =
      routed[0]!.to === "perlica" ? ["perlica", "natsume"] : ["natsume", "perlica"];

    view.turnDone({ sendId: "send-1", preset: first! });
    expect(recipients()[2]).toEqual(["everyone", "true"]);

    transcripts.perlica!.push({ role: "assistant", text: "Me.", ts: T - 1_000, turn_id: "9" });
    view.turnDone({ sendId: "send-1", preset: second! });
    expect(recipients()[0]).toEqual(["Perlica", "true"]);
  });

  it("routes everyone one character at a time", () => {
    mount();
    pick(2);
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

  it("repaints the cast chip and an open @ list with the new crop", () => {
    mount();
    type("@");
    cast = [CAST[0]!, framed];

    view.refresh();

    for (const root of [".yui-uc__chip:nth-child(2)", "[role=option]:nth-child(2)"]) {
      const img = document.querySelector(`${root} .yui-uc__avatar > img`);
      expect(img?.getAttribute("src"), root).toBe("asset://n.png");
      expect((img as HTMLElement).style.getPropertyValue("--yui-crop-size"), root).toBe("0.5");
    }
  });
});

describe("unified view — running replies", () => {
  it("turns send into stop while a reply runs, and stop ends every turn and the sequence", () => {
    mount();
    pick(2);
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

  it("a speech onset acts as the stop button while a send runs, and does nothing while idle", () => {
    mount();
    view.speechOnset();
    expect(stops).toBe(0);

    pick(2);
    type("hi");
    press("Enter");

    view.speechOnset();

    expect(stops).toBe(1);
    expect(routed).toHaveLength(1);
    expect(
      document.querySelector(".yui-uc__dock .yui-input")!.classList.contains("is-running"),
    ).toBe(false);
  });

  it("another window's stop ends the sequence without sending a stop of its own", () => {
    mount();
    pick(2);
    type("hi");
    press("Enter");
    const first = routed[0]!.to;

    view.stop();
    view.turnDone({ sendId: "send-1", preset: first });

    expect(stops).toBe(0);
    expect(routed).toHaveLength(1);
    expect(
      document.querySelector(".yui-uc__dock .yui-input")!.classList.contains("is-running"),
    ).toBe(false);
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

  it("drops the leading @name that a routed quote's lead repeats", () => {
    mount();

    stream("natsume", {
      op: "quote",
      quote: { text: "@Natsume are you up?", via: "text", images: 0, mention: "character" },
    });

    expect(
      [".yui-bubble__quote-who", ".yui-bubble__quote-text"].map(
        (sel) => document.querySelector(sel)?.textContent,
      ),
    ).toEqual(["You → Natsume", "are you up?"]);
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
        { role: "user", text: "@natsume still there?", ts: T - 60_000, send_id: "s3" },
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
      ["You → Natsume", "still there?"],
    ]);
  });
});
