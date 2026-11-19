// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { within } from "@testing-library/dom";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushSocketState } from "../../io/chat/push/push-socket";
import type { ChatTransport } from "../../settings/backend/endpoints-settings";
import { createFlagSettings } from "../../settings/persisted-store";
import { createFillerSettings } from "../../settings/voice/filler-settings";
import { createVadSettings } from "../../settings/voice/vad-settings";
import { setLocale } from "../i18n";
import { createSwitchRows } from "../quick-controls/switch-row";
import { createQuickCard } from "./quick-card";

// React's act() only flushes in a test environment that says so.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./quick-card.css", () => ({}));
vi.mock("../unified/avatar.css", () => ({}));

function picker(options: { id: string; label: string }[]) {
  let current = options[0]?.id ?? "";
  const subs = new Set<() => void>();
  return {
    options: () => options,
    current: () => current,
    select: vi.fn(async (id: string) => {
      current = id;
      for (const cb of subs) cb();
    }),
    subscribe: (cb: () => void) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

const cards: ReturnType<typeof createQuickCard>[] = [];

function build(over: Record<string, unknown> = {}) {
  const ttsSettings = createFlagSettings(true);
  const bubblePersistSettings = createFlagSettings(false);
  const unifiedChatSwitch = createFlagSettings(false);
  const dndSettings = createFlagSettings(false);
  const rows = createSwitchRows({
    idleThrottleSettings: createFlagSettings(false),
    vad: createVadSettings(),
    fillerSettings: createFillerSettings(),
    ttsSettings,
    bubblePersistSettings,
    unifiedChatSwitch,
  });
  const row = (selector: string) => rows.find((r) => r.selector === selector)!;
  let listening = false;
  const listenSubs = new Set<() => void>();
  let transport: { api: ChatTransport; push?: PushSocketState } = { api: "responses" };
  const transportSubs = new Set<() => void>();
  const mount = document.createElement("div");
  document.body.append(mount);
  const deps = {
    mount,
    entry: () => ({ id: "yui", name: "Yui" }),
    subscribeEntry: () => () => {},
    transport: () => transport,
    onTransport: (cb: () => void) => {
      transportSubs.add(cb);
      return () => transportSubs.delete(cb);
    },
    tiles: {
      voice: row(".yui-tts-switch"),
      bubble: row(".yui-bubble-persist-switch"),
      unified: row(".yui-unified-switch"),
    },
    listen: {
      get: () => listening,
      set: vi.fn((on: boolean) => {
        listening = on;
        for (const cb of listenSubs) cb();
      }),
      subscribe: (cb: () => void) => {
        listenSubs.add(cb);
        return () => listenSubs.delete(cb);
      },
    },
    body: picker([
      { id: "carlotta", label: "Carlotta" },
      { id: "aemeath", label: "Aemeath" },
    ]),
    voice: picker([
      { id: "natsume", label: "Natsume" },
      { id: "ayase", label: "Ayase" },
    ]),
    resetConversation: vi.fn(),
    turnOff: vi.fn() as (() => void) | null,
    openAllSettings: vi.fn(),
    openThreads: vi.fn(),
    dnd: {
      get: () => dndSettings.get().enabled,
      set: (on: boolean) => dndSettings.setEnabled(on),
      subscribe: (cb: () => void) => dndSettings.subscribe(() => cb()),
    },
    ...over,
  };
  const card = createQuickCard(deps as Parameters<typeof createQuickCard>[0]);
  cards.push(card);
  const q = <T extends Element>(selector: string) => card.el.querySelector<T>(selector)!;
  const tile = (n: number) => card.el.querySelectorAll<HTMLButtonElement>(".yui-qcard__tile")[n]!;
  const setTransport = (next: typeof transport) => {
    transport = next;
    act(() => {
      for (const cb of transportSubs) cb();
    });
  };
  return {
    card,
    deps,
    q,
    tile,
    setTransport,
    ttsSettings,
    bubblePersistSettings,
    unifiedChatSwitch,
    dndSettings,
    mount,
  };
}

beforeEach(() => setLocale("en"));
afterEach(() => {
  act(() => {
    for (const card of cards.splice(0)) card.dispose();
  });
  document.body.innerHTML = "";
});

describe("createQuickCard", () => {
  it("opens in the mount and its tiles write and follow their stores", () => {
    const { card, tile, mount, ttsSettings, bubblePersistSettings, unifiedChatSwitch, deps } =
      build();
    act(() => card.open());

    expect(mount.contains(card.el)).toBe(true);
    expect(
      [0, 1, 2, 3].map((n) => [tile(n).textContent, tile(n).getAttribute("aria-checked")]),
    ).toEqual([
      ["VoiceOn", "true"],
      ["ListenOff", "false"],
      ["Keep bubbleOff", "false"],
      ["Unified chatOff", "false"],
    ]);

    fireEvent.click(tile(0));
    fireEvent.click(tile(1));
    expect(ttsSettings.get().enabled).toBe(false);
    expect(deps.listen.set).toHaveBeenCalledWith(true);
    act(() => {
      bubblePersistSettings.setEnabled(true);
      unifiedChatSwitch.setEnabled(true);
    });
    expect([0, 1, 2, 3].map((n) => tile(n).getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "true",
      "true",
    ]);
  });

  it("rebuilds in the new language when the display language changes, an open card keeping focus", () => {
    const { card, tile } = build();
    act(() => card.open());
    tile(0).focus();

    act(() => setLocale("ko"));

    // An open card rebuilds in place; the window around it stays, and so does Escape.
    expect(card.isOpen()).toBe(true);
    expect(tile(0).querySelector(".yui-qcard__tile-label")!.textContent).toBe("음성");
    expect(card.el.contains(document.activeElement)).toBe(true);

    act(() => card.close());
    act(() => setLocale("en"));
    act(() => card.open());
    expect(tile(0).querySelector(".yui-qcard__tile-label")!.textContent).toBe("Voice");
  });

  it("puts the Quiet group above the tiles, its Do not disturb switch reading, writing and following the store", () => {
    const { card, q, dndSettings } = build();
    act(() => card.open());

    expect([...q(".yui-qcard__body").children].map((child) => child.className)).toEqual([
      "yui-qcard__quiet",
      "yui-qcard__tiles",
      "yui-qcard__opens",
      "yui-qcard__rows",
      "yui-qcard__all",
    ]);
    const quiet = q<HTMLElement>(".yui-qcard__quiet");
    const sw = quiet.querySelector<HTMLButtonElement>(".yui-switch")!;
    expect(quiet.querySelector(".yui-qcard__quiet-title")!.textContent).toBe("Quiet");
    expect(quiet.querySelector(".yui-qcard__row")!.textContent).toBe("Do not disturb");
    expect(sw.getAttribute("role")).toBe("switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(sw);
    expect(dndSettings.get().enabled).toBe(true);
    expect(sw.getAttribute("aria-checked")).toBe("true");

    // A change from another window repaints the switch.
    act(() => dndSettings.setEnabled(false));
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("disables Listen and reads Main only on another character's card", () => {
    const { card, tile } = build({ listen: null });
    act(() => card.open());

    expect(tile(1).disabled).toBe(true);
    expect(tile(1).textContent).toBe("ListenMain only");
  });

  it("disables a locked row's tile with the reason as its title", () => {
    const { deps } = build();
    const { card, tile } = build({
      tiles: {
        ...deps.tiles,
        bubble: {
          ...deps.tiles.bubble,
          lock: {
            reasonKey: "message_window.locked_unified",
            get: () => true,
            subscribe: () => () => {},
          },
        },
      },
    });
    act(() => card.open());

    expect(tile(2).disabled).toBe(true);
    expect(tile(2).title).toBe("Off while the unified chat window shows");
  });

  it("applies the Body and Reference voice selects at once", () => {
    const { card, deps } = build();
    act(() => card.open());
    const [body, voice] = card.el.querySelectorAll<HTMLSelectElement>("select");

    expect([body!.value, voice!.value]).toEqual(["carlotta", "natsume"]);
    fireEvent.change(body!, { target: { value: "aemeath" } });
    fireEvent.change(voice!, { target: { value: "ayase" } });

    expect(deps.body.select).toHaveBeenCalledExactlyOnceWith("aemeath");
    expect(deps.voice.select).toHaveBeenCalledExactlyOnceWith("ayase");
  });

  it("asks before it resets the conversation and resets once on confirm", () => {
    const { card, q, deps } = build();
    act(() => card.open());

    fireEvent.click(q<HTMLButtonElement>(".yui-qcard__reset"));
    expect(q<HTMLElement>(".yui-qcard__confirm").hidden).toBe(false);
    expect(q(".yui-qcard__confirm").textContent).toContain("Reset this conversation?");
    fireEvent.click(q<HTMLButtonElement>(".yui-qcard__cancel"));
    expect(q<HTMLElement>(".yui-qcard__confirm").hidden).toBe(true);
    expect(deps.resetConversation).not.toHaveBeenCalled();

    fireEvent.click(q<HTMLButtonElement>(".yui-qcard__reset"));
    fireEvent.click(q<HTMLButtonElement>(".yui-qcard__confirm-go"));
    expect(deps.resetConversation).toHaveBeenCalledOnce();
    expect(q<HTMLElement>(".yui-qcard__confirm").hidden).toBe(true);
    // A reset is not one of the card's closes.
    expect(card.isOpen()).toBe(true);
  });

  it("hands focus to Cancel when the confirm opens and back to Reset… when it closes", () => {
    const { card, q } = build();
    act(() => card.open());

    fireEvent.click(q<HTMLButtonElement>(".yui-qcard__reset"));
    expect(document.activeElement).toBe(q(".yui-qcard__cancel"));
    fireEvent.click(q<HTMLButtonElement>(".yui-qcard__cancel"));
    expect(document.activeElement).toBe(q(".yui-qcard__reset"));
  });

  it("reopens on Reset…, not on the confirm it was closed over", () => {
    const { card, q } = build();
    act(() => card.open());
    fireEvent.click(q<HTMLButtonElement>(".yui-qcard__reset"));
    expect(q<HTMLElement>(".yui-qcard__confirm").hidden).toBe(false);

    act(() => card.close());
    act(() => card.open());

    expect(q<HTMLElement>(".yui-qcard__confirm").hidden).toBe(true);
    expect(q<HTMLElement>(".yui-qcard__reset").hidden).toBe(false);
  });

  it("names no voice None when the voice list is empty", () => {
    const { card } = build({ voice: picker([]) });
    act(() => card.open());
    const voice = card.el.querySelectorAll<HTMLSelectElement>("select")[1]!;

    expect([...voice.options].map((o) => [o.value, o.text])).toEqual([["", "None"]]);
  });

  it("turns this character off and opens every setting; main's card has no Turn off", () => {
    const bound = build();
    act(() => bound.card.open());
    fireEvent.click(bound.q<HTMLButtonElement>(".yui-qcard__turnoff"));
    fireEvent.click(bound.q<HTMLButtonElement>(".yui-qcard__all"));
    expect(bound.deps.turnOff).toHaveBeenCalledOnce();
    expect(bound.deps.openAllSettings).toHaveBeenCalledOnce();

    const main = build({ turnOff: null });
    expect(main.card.el.querySelector(".yui-qcard__turnoff")).toBeNull();
  });

  it.each([
    ["Threads", "threads"],
    ["Terminal", "terminal"],
  ])("opens the Threads window on its %s tab and closes", (label, tab) => {
    const h = build();
    act(() => h.card.open());
    const button = within(h.card.el).getByText(label);

    fireEvent.click(button);

    expect(h.deps.openThreads).toHaveBeenCalledExactlyOnceWith(tab);
    expect(h.card.isOpen()).toBe(false);
  });

  it.each<[string, { api: ChatTransport; push?: PushSocketState }, string]>([
    ["Chat Completions", { api: "chat_completions" }, "Chat Completions"],
    ["Responses", { api: "responses" }, "Responses"],
    [
      "push ready",
      { api: "push", push: { kind: "ready", chat_id: "c1" } },
      "Push · Connected · c1",
    ],
    ["push connecting", { api: "push", push: { kind: "connecting" } }, "Push · Connecting…"],
    [
      "push reconnecting",
      { api: "push", push: { kind: "reconnecting", delay_ms: 2500 } },
      "Push · Reconnecting in 3s",
    ],
    [
      "push failed",
      { api: "push", push: { kind: "failed", code: 4401 } },
      "Push · The backend refused the key",
    ],
    ["push disconnected", { api: "push", push: { kind: "disconnected" } }, "Push · Not connected"],
  ])("heads with the name and the transport line (%s)", (_name, transport, line) => {
    const { card, q, setTransport } = build();
    act(() => card.open());
    setTransport(transport);

    expect(q(".yui-qcard__name").textContent).toBe("Yui");
    expect(q(".yui-qcard__transport").textContent).toBe(line);
  });

  it.each([
    [
      "the ×",
      (h: ReturnType<typeof build>) => fireEvent.click(h.q<HTMLButtonElement>(".yui-qcard__close")),
    ],
    [
      "Escape",
      (h: ReturnType<typeof build>) =>
        fireEvent(
          h.q(".yui-qcard__name"),
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        ),
    ],
    [
      "a pointerdown outside the card",
      () => fireEvent(document.body, new PointerEvent("pointerdown", { bubbles: true })),
    ],
    [
      "All settings…",
      (h: ReturnType<typeof build>) => fireEvent.click(h.q<HTMLButtonElement>(".yui-qcard__all")),
    ],
    [
      "Turn off",
      (h: ReturnType<typeof build>) =>
        fireEvent.click(h.q<HTMLButtonElement>(".yui-qcard__turnoff")),
    ],
  ])("closes on %s and hands focus back", (_name, closeIt) => {
    const h = build();
    act(() => h.card.open());
    expect(h.card.el.contains(document.activeElement)).toBe(true);

    closeIt(h);

    expect(h.card.isOpen()).toBe(false);
    expect(h.mount.contains(h.card.el)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it("selects no text on its head, the drag handle", () => {
    // A head drag swept the name and transport line into a text selection (rung 4).
    const css = readFileSync(resolve(__dirname, "quick-card.css"), "utf-8");
    const head = css.match(/\n\.yui-qcard__head \{([^}]*)\}/)?.[1] ?? "";

    expect(head).toContain("-webkit-user-select: none;");
    expect(head).toMatch(/\n\s*user-select: none;/);
  });

  it("hands a pointerdown on its head, not on its ×, to the head listeners", () => {
    const { card, q } = build();
    act(() => card.open());
    const onHead = vi.fn();
    card.onHeadPointerDown(onHead);

    fireEvent(q(".yui-qcard__close"), new PointerEvent("pointerdown", { bubbles: true }));
    fireEvent(q(".yui-qcard__name"), new PointerEvent("pointerdown", { bubbles: true }));

    expect(onHead).toHaveBeenCalledOnce();
  });

  it("stays open on a pointerdown inside it, and its Escape never reaches the document", () => {
    const { card, q } = build();
    const onDocKey = vi.fn();
    document.addEventListener("keydown", onDocKey);
    act(() => card.open());

    fireEvent(q(".yui-qcard__name"), new PointerEvent("pointerdown", { bubbles: true }));
    expect(card.isOpen()).toBe(true);
    fireEvent(
      q(".yui-qcard__name"),
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(card.isOpen()).toBe(false);
    expect(onDocKey).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onDocKey);
  });
});
