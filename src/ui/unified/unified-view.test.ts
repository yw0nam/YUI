// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
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

function mount(opts: { mainId?: string } = {}): void {
  document.body.innerHTML = '<div id="app"></div>';
  view = createUnifiedView({
    mount: document.querySelector("#app")!,
    cast: () => CAST,
    transcripts: () => CAST.map((c) => ({ ...c, entries: transcripts[c.id] ?? [] })),
    mainId: () => opts.mainId ?? "perlica",
    now: () => T,
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
