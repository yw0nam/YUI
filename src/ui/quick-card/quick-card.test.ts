// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushSocketState } from "../../io/chat/push/push-socket";
import type { ChatTransport } from "../../settings/backend/endpoints-settings";
import { createFlagSettings } from "../../settings/persisted-store";
import { createFillerSettings } from "../../settings/voice/filler-settings";
import { createVadSettings } from "../../settings/voice/vad-settings";
import { setLocale } from "../i18n";
import { createSwitchRows } from "../quick-controls/switch-row";
import { createQuickCard } from "./quick-card";

vi.mock("./quick-card.css", () => ({}));
vi.mock("../unified/avatar.css", () => ({}));

function picker(options: { id: string; label: string }[]) {
  let current = options[0]!.id;
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

function build(over: Record<string, unknown> = {}) {
  const ttsSettings = createFlagSettings(true);
  const bubblePersistSettings = createFlagSettings(false);
  const unifiedChatSwitch = createFlagSettings(false);
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
    ...over,
  };
  const card = createQuickCard(deps as Parameters<typeof createQuickCard>[0]);
  const q = <T extends Element>(selector: string) => card.el.querySelector<T>(selector)!;
  const tile = (n: number) => card.el.querySelectorAll<HTMLButtonElement>(".yui-qcard__tile")[n]!;
  const setTransport = (next: typeof transport) => {
    transport = next;
    for (const cb of transportSubs) cb();
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
    mount,
  };
}

beforeEach(() => setLocale("en"));
afterEach(() => {
  document.body.innerHTML = "";
});

describe("createQuickCard", () => {
  it("opens in the mount and its tiles write and follow their stores", () => {
    const { card, tile, mount, ttsSettings, bubblePersistSettings, unifiedChatSwitch, deps } =
      build();
    card.open({ x: 10, y: 20 });

    expect(mount.contains(card.el)).toBe(true);
    expect(
      [0, 1, 2, 3].map((n) => [tile(n).textContent, tile(n).getAttribute("aria-checked")]),
    ).toEqual([
      ["VoiceOn", "true"],
      ["ListenOff", "false"],
      ["Keep bubbleOff", "false"],
      ["Unified chatOff", "false"],
    ]);

    tile(0).click();
    tile(1).click();
    expect(ttsSettings.get().enabled).toBe(false);
    expect(deps.listen.set).toHaveBeenCalledWith(true);
    bubblePersistSettings.setEnabled(true);
    unifiedChatSwitch.setEnabled(true);
    expect([0, 1, 2, 3].map((n) => tile(n).getAttribute("aria-checked"))).toEqual([
      "false",
      "true",
      "true",
      "true",
    ]);
  });

  it("disables Listen and reads Main only on another character's card", () => {
    const { card, tile } = build({ listen: null });
    card.open({ x: 0, y: 0 });

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
    card.open({ x: 0, y: 0 });

    expect(tile(2).disabled).toBe(true);
    expect(tile(2).title).toBe("Off while the unified chat window shows");
  });

  it("applies the Body and Reference voice selects at once", () => {
    const { card, deps } = build();
    card.open({ x: 0, y: 0 });
    const [body, voice] = card.el.querySelectorAll<HTMLSelectElement>("select");

    expect([body!.value, voice!.value]).toEqual(["carlotta", "natsume"]);
    body!.value = "aemeath";
    body!.dispatchEvent(new Event("change"));
    voice!.value = "ayase";
    voice!.dispatchEvent(new Event("change"));

    expect(deps.body.select).toHaveBeenCalledExactlyOnceWith("aemeath");
    expect(deps.voice.select).toHaveBeenCalledExactlyOnceWith("ayase");
  });

  it("asks before it resets the conversation and resets once on confirm", () => {
    const { card, q, deps } = build();
    card.open({ x: 0, y: 0 });

    q<HTMLButtonElement>(".yui-qcard__reset").click();
    expect(q<HTMLElement>(".yui-qcard__confirm").hidden).toBe(false);
    expect(q(".yui-qcard__confirm").textContent).toContain("Reset this conversation?");
    q<HTMLButtonElement>(".yui-qcard__cancel").click();
    expect(q<HTMLElement>(".yui-qcard__confirm").hidden).toBe(true);
    expect(deps.resetConversation).not.toHaveBeenCalled();

    q<HTMLButtonElement>(".yui-qcard__reset").click();
    q<HTMLButtonElement>(".yui-qcard__confirm-go").click();
    expect(deps.resetConversation).toHaveBeenCalledOnce();
    expect(q<HTMLElement>(".yui-qcard__confirm").hidden).toBe(true);
  });

  it("turns this character off and opens every setting; main's card has no Turn off", () => {
    const bound = build();
    bound.card.open({ x: 0, y: 0 });
    bound.q<HTMLButtonElement>(".yui-qcard__turnoff").click();
    bound.q<HTMLButtonElement>(".yui-qcard__all").click();
    expect(bound.deps.turnOff).toHaveBeenCalledOnce();
    expect(bound.deps.openAllSettings).toHaveBeenCalledOnce();

    const main = build({ turnOff: null });
    expect(main.card.el.querySelector(".yui-qcard__turnoff")).toBeNull();
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
    card.open({ x: 0, y: 0 });
    setTransport(transport);

    expect(q(".yui-qcard__name").textContent).toBe("Yui");
    expect(q(".yui-qcard__transport").textContent).toBe(line);
  });

  it.each([
    ["the ×", (h: ReturnType<typeof build>) => h.q<HTMLButtonElement>(".yui-qcard__close").click()],
    [
      "Escape",
      (h: ReturnType<typeof build>) =>
        h
          .q(".yui-qcard__name")
          .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    ],
    [
      "a pointerdown outside the card",
      (h: ReturnType<typeof build>) =>
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })),
    ],
    ["the window's blur", () => window.dispatchEvent(new Event("blur"))],
  ])("closes on %s and hands focus back", (_name, act) => {
    const h = build();
    h.card.open({ x: 0, y: 0 });
    expect(h.card.el.contains(document.activeElement)).toBe(true);

    act(h);

    expect(h.card.isOpen()).toBe(false);
    expect(h.mount.contains(h.card.el)).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it("stays open on a pointerdown inside it, and its Escape never reaches the document", () => {
    const { card, q } = build();
    const onDocKey = vi.fn();
    document.addEventListener("keydown", onDocKey);
    card.open({ x: 0, y: 0 });

    q(".yui-qcard__name").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(card.isOpen()).toBe(true);
    q(".yui-qcard__name").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );

    expect(card.isOpen()).toBe(false);
    expect(onDocKey).not.toHaveBeenCalled();
    document.removeEventListener("keydown", onDocKey);
  });
});
