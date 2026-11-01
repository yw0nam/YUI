// @vitest-environment jsdom
/** terminal-view.test.ts — the Terminal tab over a stream of terminal snapshots: row states, the Allow card, Take back, an exited shell, and the font-size keys. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessRequest, Terminal, TerminalSnapshot } from "../../contract";

interface FakeScreen {
  written: string[];
  options: { fontSize?: number };
  /** The custom key handler; false keeps the key from the shell. */
  keys?: (event: KeyboardEvent) => boolean;
}
const { screens } = vi.hoisted(() => ({ screens: [] as FakeScreen[] }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    written: string[] = [];
    options: { fontSize?: number };
    keys?: (event: KeyboardEvent) => boolean;
    cols = 120;
    rows = 32;
    constructor(options: { fontSize?: number }) {
      this.options = { ...options };
      screens.push(this);
    }
    attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
      this.keys = handler;
    }
    write(data: string | Uint8Array) {
      this.written.push(typeof data === "string" ? data : new TextDecoder().decode(data));
    }
    open() {}
    onData() {
      return { dispose() {} };
    }
    resize() {}
    loadAddon(addon: { activate(terminal: unknown): void }) {
      addon.activate(this);
    }
    focus() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    terminal?: { options: { fontSize?: number } };
    activate(terminal: { options: { fontSize?: number } }) {
      this.terminal = terminal;
    }
    fit() {}
    /** A 1040 × 520 px screen at 0.6 × 1.25 em cells. */
    proposeDimensions() {
      const px = this.terminal!.options.fontSize!;
      return { cols: Math.floor(1040 / (px * 0.6)), rows: Math.floor(520 / (px * 1.25)) };
    }
    dispose() {}
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { setLocale } from "../i18n";
import { createTerminalView } from "./terminal-view";

function terminal(id: string, openedAt: number, over: Partial<Terminal> = {}): Terminal {
  return {
    id,
    owner: { kind: "user" },
    title: `~/${id}`,
    openedAt,
    exitCode: null,
    access: null,
    lastCommand: null,
    ...over,
  };
}

function request(
  id: string,
  terminalId: string,
  deadline: number,
  kind: "read" | "write" = "read",
): AccessRequest {
  return {
    id,
    terminalId,
    presetId: "yui",
    kind,
    text: kind === "write" ? "npm test" : null,
    deadline,
  };
}

const snap = (terminals: Terminal[], requests: AccessRequest[] = []): TerminalSnapshot => ({
  revision: 1,
  terminals,
  requests,
});

beforeEach(() => {
  setLocale("en");
  document.body.innerHTML = "";
  screens.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

function build(fontSize = 13) {
  const onFontSize = vi.fn();
  const client = {
    open: vi.fn(async () => "t9"),
    close: vi.fn(async () => {}),
    input: vi.fn(async () => {}),
    resize: vi.fn(async () => {}),
    attach: vi.fn(async () => {}),
    answer: vi.fn(async () => {}),
    takeBack: vi.fn(async () => {}),
  };
  const back = document.createElement("button");
  const view = createTerminalView({
    shell: { back, selected: () => false, focusSelected() {}, headChanged() {} },
    now: () => 0,
    preset: (id) => ({ id, name: id === "yui" ? "Yui" : id }),
    client,
    fontSize,
    onFontSize,
  });
  document.body.append(view.el);
  const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel);
  const button = (text: string) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text);
  return { view, client, $, button, onFontSize };
}

it.each([
  [
    "a request waits on it",
    snap([terminal("t1", 1)], [request("r1", "t1", 60_000)]),
    "Asks for access",
    true,
  ],
  ["a preset holds access", snap([terminal("t1", 1, { access: "yui" })]), "Yui has access", false],
  ["its shell runs", snap([terminal("t1", 1)]), "Running", false],
  ["its shell exited", snap([terminal("t1", 1, { exitCode: 0 })]), "Exited", false],
])("words a list row whose terminal %s", (_name, snapshot, word, amber) => {
  const { view, $ } = build();
  view.update(snapshot);

  const state = $('.yui-threads-list [data-id="t1"] .yui-threads-state')!;
  expect(state.textContent).toBe(word);
  expect(state.classList.contains("is-input-required")).toBe(amber);
});

it("counts the terminals in the head, hidden at none, and marks a waiting request", () => {
  const { view } = build();
  view.update(snap([]));
  expect(view.head()).toEqual({ count: "", waiting: false });

  view.update(snap([terminal("t1", 1), terminal("t2", 2)], [request("r1", "t1", 60_000)]));
  expect(view.head()).toEqual({ count: "2 terminals", waiting: true });

  view.update(snap([terminal("t1", 1)]));
  expect(view.head()).toEqual({ count: "1 terminal", waiting: false });
});

it("shows the oldest request, Show terminal only for another terminal, and answers it", () => {
  const { view, client, $, button } = build();
  // t2 opened last, so it is selected; the store lists the older request, on t1, first.
  view.update(
    snap(
      [terminal("t1", 1), terminal("t2", 2)],
      [request("r1", "t1", 60_000), request("r2", "t2", 70_000, "write")],
    ),
  );

  expect($(".yui-terminal-request h3")!.textContent).toBe("Wants to read the output");
  expect(button("Show terminal")).toBeDefined();
  expect($(".yui-terminal-request__more")!.textContent).toBe("1 more");
  button("Allow")!.click();
  expect(client.answer).toHaveBeenCalledWith("r1", true);

  view.update(snap([terminal("t1", 1), terminal("t2", 2)], [request("r2", "t2", 70_000, "write")]));
  expect($(".yui-terminal-request h3")!.textContent).toBe("Wants to type this");
  expect($(".yui-terminal-request pre")!.textContent).toBe("npm test");
  expect(button("Show terminal")).toBeUndefined();
  button("Deny")!.click();
  expect(client.answer).toHaveBeenCalledWith("r2", false);
});

it("takes access back and says the next request asks again", async () => {
  const { view, client, $, button } = build();
  view.update(snap([terminal("t1", 1, { access: "yui", lastCommand: "git status" })]));
  expect($(".yui-terminal-access code")!.textContent).toBe("git status");

  button("Take back")!.click();
  view.update(snap([terminal("t1", 1)]));

  expect(client.takeBack).toHaveBeenCalledWith("t1");
  expect($(".yui-terminal-access")!.textContent).toBe(
    "Access taken back. The next request asks again.",
  );
});

it("writes the exit line into an exited terminal and words its state Exited", () => {
  const { view, $ } = build();
  view.update(snap([terminal("t1", 1)]));
  view.update(snap([terminal("t1", 1, { exitCode: 3 })]));
  view.update(snap([terminal("t1", 1, { exitCode: 3 })]));

  expect($(".yui-terminal-pane .yui-threads-pane__line .yui-threads-state")!.textContent).toBe(
    "Exited",
  );
  const lines = screens[0]!.written.filter((text) => text.includes("[Shell exited with code 3]"));
  expect(lines).toHaveLength(1);
});

it("draws a list row as the owner, state and time on one line, then the title and id", () => {
  const { view, $ } = build();
  view.update(snap([terminal("t1", 0)]));

  const row = $('.yui-threads-list [data-id="t1"]')!;
  expect([...row.children].map((el) => [el.className, el.textContent])).toEqual([
    ["yui-threads-row__meta", "YouRunningjust now"],
    ["yui-terminal-title", "~/t1t1"],
  ]);
});

it("names each terminal by the id agents use, in its row and the pane head", () => {
  const { view, $ } = build();
  view.update(snap([terminal("t1", 1), terminal("t2", 2)]));

  const rows = [...document.querySelectorAll(".yui-threads-list .yui-terminal-id")];
  expect(rows.map((el) => el.textContent)).toEqual(["t2", "t1"]);
  expect($(".yui-terminal-pane .yui-terminal-id")!.textContent).toBe("t2");
});

it("names the requested terminal by its id on the Allow card and in the rail", () => {
  const { view, $ } = build();
  view.update(snap([terminal("t1", 1), terminal("t2", 2)], [request("r1", "t1", 60_000)]));

  expect($(".yui-terminal-request .yui-terminal-id")?.textContent).toBe("t1");
  expect($<HTMLElement>('.yui-threads-rail [data-id="t1"]')!.title).toBe(
    "~/t1 t1, Asks for access",
  );
});

describe("font-size keys", () => {
  beforeEach(() => {
    // A laid-out screen opens and fits.
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([{}] as never);
  });
  afterEach(() => vi.restoreAllMocks());

  const press = (screen: FakeScreen, init: KeyboardEventInit): boolean =>
    screen.keys!(new KeyboardEvent("keydown", { cancelable: true, ...init }));
  const sizes = () => screens.map((screen) => screen.options.fontSize);

  it.each([
    ["Linux x86_64", { ctrlKey: true }],
    ["MacIntel", { metaKey: true }],
  ])("grows every screen 1 px on %s, keeps it from the shell, and resizes the PTYs", (platform, mod) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
    const { view, client, onFontSize } = build(13);
    view.update(snap([terminal("t1", 1), terminal("t2", 2)]));
    client.resize.mockClear();

    expect(press(screens[0]!, { key: "=", ...mod })).toBe(false);
    expect(press(screens[0]!, { key: "+", shiftKey: true, ...mod })).toBe(false);

    expect(sizes()).toEqual([15, 15]);
    expect(onFontSize.mock.calls).toEqual([[14], [15]]);
    expect(client.resize).toHaveBeenLastCalledWith(115, 27);
  });

  it.each([
    ["- shrinks", 13, "-", 12],
    ["0 resets to the default", 20, "0", 13],
    ["- stops at 10", 10, "-", 10],
    ["= stops at 24", 24, "=", 24],
  ])("%s", (_name, start, key, size) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const { view } = build(start);
    view.update(snap([terminal("t1", 1)]));

    expect(press(screens[0]!, { key, ctrlKey: true })).toBe(false);

    expect(sizes()).toEqual([size]);
  });

  it("starts every screen at the stored size", () => {
    const { view } = build(18);
    view.update(snap([terminal("t1", 1), terminal("t2", 2)]));

    expect(sizes()).toEqual([18, 18]);
  });

  it.each([
    ["Escape", { key: "Escape" }],
    ["= without the modifier", { key: "=" }],
    ["Control+Command+S", { key: "s", ctrlKey: true, metaKey: true }],
    ["Control+= with Alt", { key: "=", ctrlKey: true, altKey: true }],
  ])("hands %s to the shell and keeps the size", (_name, init) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    const { view, onFontSize } = build(13);
    view.update(snap([terminal("t1", 1)]));

    expect(press(screens[0]!, init)).toBe(true);

    expect(sizes()).toEqual([13]);
    expect(onFontSize).not.toHaveBeenCalled();
  });
});
