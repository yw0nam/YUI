// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserTurnRouted } from "../../io/bridge/settings-bridge";
import type { ChatHistoryEntry } from "../../io/chat/conversation/chat-history-store";
import { createUnifiedView } from "./unified-view";

vi.mock("../surfaces/surfaces.css", () => ({}));
vi.mock("./unified-window.css", () => ({}));

const T = 1_789_365_900_000;

let transcripts: Record<string, ChatHistoryEntry[]>;
let routed: UserTurnRouted[];
let nextId: number;
let view: ReturnType<typeof createUnifiedView>;

const CAST = [
  { id: "perlica", name: "Perlica", thumbnail: "asset://perlica.png" },
  { id: "natsume", name: "Natsume" },
];

function seed(): Record<string, ChatHistoryEntry[]> {
  return {
    perlica: [
      { role: "user", text: "hi", ts: T - 120_000, send_id: "s0" },
      { role: "assistant", text: "Hello.", ts: T - 110_000, turn_id: "1" },
      { role: "assistant", text: "Are you there?", ts: T - 60_000, turn_id: "2", to: "natsume" },
    ],
    natsume: [
      { role: "user", text: "hi", ts: T - 119_000, send_id: "s0" },
      { role: "assistant", text: "Yes.", ts: T - 50_000, turn_id: "3" },
    ],
  };
}

function mount(opts: { mainId?: string; now?: () => number } = {}): void {
  document.body.innerHTML = '<div id="app"></div>';
  view = createUnifiedView({
    mount: document.querySelector("#app")!,
    cast: () => CAST,
    transcripts: () => CAST.map((c) => ({ ...c, entries: transcripts[c.id] ?? [] })),
    mainId: () => opts.mainId ?? "perlica",
    now: opts.now ?? (() => T),
    randomId: () => `send-${++nextId}`,
  });
  routed = [];
  view.onRoute((e) => routed.push(e));
  view.refresh();
}

const field = () => document.querySelector<HTMLTextAreaElement>(".yui-input__field")!;
const lines = () => [...document.querySelectorAll<HTMLElement>(".yui-uc__line")];

function type(text: string): void {
  field().value = text;
  field().dispatchEvent(new Event("input", { bubbles: true }));
}
function press(key: string): void {
  field().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
}

beforeEach(() => {
  transcripts = seed();
  nextId = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
});

describe("unified view — the log", () => {
  it("lists both transcripts in time order with speaker, photo or dot, marker and age", () => {
    mount();

    expect(lines().map((l) => l.querySelector(".yui-uc__who")?.textContent)).toEqual([
      "You",
      "Perlica",
      "Perlica",
      "Natsume",
    ]);
    expect(lines().map((l) => l.querySelector(".yui-uc__say")?.textContent)).toEqual([
      "hi",
      "Hello.",
      "→ NatsumeAre you there?",
      "Yes.",
    ]);
    expect(lines().map((l) => l.querySelector(".yui-uc__ago")?.textContent)).toEqual([
      "2min",
      "2min",
      "1min",
      "now",
    ]);
    expect(lines()[1]?.querySelector("img.yui-uc__avatar")?.getAttribute("src")).toBe(
      "asset://perlica.png",
    );
    expect(lines()[3]?.querySelector("span.yui-uc__dot")).not.toBeNull();
    expect(lines()[0]?.querySelector(".yui-uc__avatar, .yui-uc__dot")).toBeNull();
    expect(document.querySelectorAll(".yui-uc__cast li")).toHaveLength(2);
    expect(document.querySelector(".yui-uc__title")?.textContent).toBe("Unified chat");
  });

  it("names main's preset on the target chip before anyone spoke, then the last speaker", () => {
    transcripts = { perlica: [], natsume: [] };
    mount({ mainId: "natsume" });
    expect(document.querySelector(".yui-uc__target")?.textContent).toContain("to Natsume");

    transcripts = seed();
    view.refresh();
    expect(document.querySelector(".yui-uc__target")?.textContent).toContain("to Natsume");
    transcripts.perlica = [
      ...transcripts.perlica!,
      { role: "assistant", text: "Back.", ts: T - 10_000, turn_id: "4" },
    ];
    view.refresh();
    expect(document.querySelector(".yui-uc__target")?.textContent).toContain("to Perlica");
  });
});

describe("unified view — routing", () => {
  it("a picked mention shows as a pill and the send routes to it with its text and a send id", () => {
    mount();
    type("@nat");
    press("Enter");
    expect(document.querySelector(".yui-uc__pill")?.textContent).toContain("@Natsume");

    type("hello");
    press("Enter");

    expect(routed).toEqual([
      { sendId: "send-1", to: "natsume", text: "@Natsume hello", mention: "character" },
    ]);
    expect(document.querySelector(".yui-uc__pill")?.hasAttribute("hidden")).toBe(true);
    expect(field().value).toBe("");
  });

  it("draws the sent line at once as a pending row and replaces it by the recorded one", () => {
    mount();
    type("@nat");
    press("Enter");
    type("hello");
    press("Enter");

    expect(lines().at(-1)?.classList.contains("is-pending")).toBe(true);
    expect(lines().at(-1)?.querySelector(".yui-uc__say")?.textContent).toContain("@Natsume hello");

    transcripts.natsume = [
      ...transcripts.natsume!,
      { role: "user", text: "@Natsume hello", ts: T - 1_000, send_id: "send-1" },
    ];
    view.refresh();

    expect(document.querySelectorAll(".is-pending")).toHaveLength(0);
    expect(lines().filter((l) => l.textContent?.includes("@Natsume hello"))).toHaveLength(1);
  });

  it("@everyone emits to the first target only, then to the second once the first is done", () => {
    mount();
    type("@");
    [...document.querySelectorAll<HTMLElement>("[role=option]")]
      .find((o) => o.querySelector(".yui-uc__opt-name")?.textContent === "@everyone")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    type("hi");
    press("Enter");

    expect(routed).toHaveLength(1);
    expect(routed[0]).toMatchObject({
      sendId: "send-1",
      text: "@everyone hi",
      mention: "everyone",
    });
    const first = routed[0]!.to;
    const second = first === "perlica" ? "natsume" : "perlica";

    view.turnDone({ sendId: "send-1", preset: first });

    expect(routed).toHaveLength(2);
    expect(routed[1]).toMatchObject({ sendId: "send-1", to: second, mention: "everyone" });
  });

  it("a typed @natsume without a pick routes to the last speaker as plain text", () => {
    mount();

    type("@natsume hi");
    press("Enter");

    expect(routed).toEqual([{ sendId: "send-1", to: "natsume", text: "@natsume hi" }]);
  });
});

describe("unified view — pending sends over time", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T);
    mount({ now: () => Date.now() });
  });
  afterEach(() => vi.useRealTimers());

  const pendingTexts = () =>
    [...document.querySelectorAll(".is-pending .yui-uc__say")].map((el) => el.textContent);

  it("removes a pending row through its own timer 60 seconds after the send", () => {
    type("hello");
    press("Enter");
    expect(pendingTexts()).toHaveLength(1);

    vi.advanceTimersByTime(59_000);
    expect(pendingTexts()).toHaveLength(1);
    vi.advanceTimersByTime(2_000);
    expect(pendingTexts()).toEqual([]);
  });

  it("keeps the row of a send that still waits behind a running sequence", () => {
    type("@");
    [...document.querySelectorAll<HTMLElement>("[role=option]")]
      .find((o) => o.querySelector(".yui-uc__opt-name")?.textContent === "@everyone")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    type("first");
    press("Enter");
    type("second");
    press("Enter");

    vi.advanceTimersByTime(65_000);

    expect(pendingTexts()).toHaveLength(1);
    expect(pendingTexts()[0]).toContain("second");
  });
});

describe("unified view — the mention pill", () => {
  it("Backspace in an empty field removes it", () => {
    mount();
    type("@nat");
    press("Enter");
    expect(document.querySelector(".yui-uc__pill")?.hasAttribute("hidden")).toBe(false);

    press("Backspace");

    expect(document.querySelector(".yui-uc__pill")?.hasAttribute("hidden")).toBe(true);
  });
});

describe("unified view — running replies", () => {
  it("draws growing pending speech with the preset's face, then replaces it with its record", () => {
    mount();
    view.speechStream({ preset: "perlica", turn_id: "7", op: "begin" });
    expect(lines()).toHaveLength(4);
    view.speechStream({ preset: "perlica", turn_id: "7", op: "push", delta: "Hello" });
    expect(lines().at(-1)?.querySelector(".yui-uc__say")?.textContent).toBe("HelloPending");
    expect(lines().at(-1)?.classList.contains("is-pending")).toBe(true);
    expect(lines().at(-1)?.querySelector("img")?.getAttribute("src")).toBe("asset://perlica.png");
    view.speechStream({ preset: "perlica", turn_id: "7", op: "push", delta: " there" });
    expect(lines().at(-1)?.querySelector(".yui-uc__say")?.textContent).toBe("Hello therePending");
    view.speechStream({ preset: "perlica", turn_id: "7", op: "end" });
    transcripts.perlica!.push({ role: "assistant", turn_id: "7", text: "Hello there", ts: T + 1 });
    view.refresh();
    expect(lines()).toHaveLength(5);
    expect(document.querySelectorAll(".is-pending")).toHaveLength(0);
    expect(lines().at(-1)?.querySelector(".yui-uc__say")?.textContent).toBe("Hello there");
  });

  it("does not move a scrolled-up log when speech grows", () => {
    mount();
    const log = document.querySelector<HTMLElement>(".yui-uc__log")!;
    Object.defineProperties(log, {
      scrollHeight: { value: 1000, configurable: true },
      clientHeight: { value: 300 },
    });
    log.scrollTop = 120;
    view.speechStream({ preset: "perlica", turn_id: "7", op: "begin" });
    view.speechStream({ preset: "perlica", turn_id: "7", op: "push", delta: "Hello" });
    expect(log.scrollTop).toBe(120);
    Object.defineProperty(log, "scrollHeight", { value: 1200 });
    view.speechStream({ preset: "perlica", turn_id: "7", op: "push", delta: " there" });
    expect(log.scrollTop).toBe(120);
  });

  it("expires ended speech with the existing expiry timer and keeps its age at now", () => {
    vi.useFakeTimers();
    let now = T;
    mount({ now: () => now });
    view.speechStream({ preset: "perlica", turn_id: "7", op: "begin" });
    view.speechStream({ preset: "perlica", turn_id: "7", op: "push", delta: "Partial" });
    now += 120_000;
    view.refresh();
    expect(lines().at(-1)?.querySelector("time")?.textContent).toBe("now");
    view.speechStream({ preset: "perlica", turn_id: "7", op: "end" });
    now += 59_999;
    vi.advanceTimersByTime(59_999);
    expect(document.querySelectorAll(".is-pending")).toHaveLength(1);
    now += 2;
    vi.advanceTimersByTime(2);
    expect(document.querySelectorAll(".is-pending")).toHaveLength(0);
  });
});
