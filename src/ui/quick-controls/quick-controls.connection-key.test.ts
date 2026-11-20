// @vitest-environment jsdom
/**
 * quick-controls.connection-key.test.ts — a request to focus the chat key lands on the key field
 * of the connection the user set up, whichever Connection view the window shows.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../i18n";
import { GEMINI_PRESET } from "./constants";
import { createQuickControls } from "./quick-controls";
import { defaultQcArgs } from "./test-helpers";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const models = () => new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 });

describe("createQuickControls — the chat key focus", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    setLocale("en");
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function build(
    opts: { openOnQuickStart: boolean; url: string; key?: string },
    fetchImpl: typeof globalThis.fetch = async () => models(),
  ) {
    const args = defaultQcArgs(mount);
    args.endpointsSettings.set({ chat_base_url: opts.url });
    if (opts.key) args.chatKeySettings.setApiKey(opts.key);
    const fetchMock = vi.fn(fetchImpl);
    const qc = createQuickControls({
      ...args,
      openOnQuickStart: opts.openOnQuickStart,
      getFetch: async () => fetchMock,
    });
    const view = (name: string) =>
      qc.el.querySelector<HTMLElement>(`.yui-conn-view[data-view="${name}"]`)!;
    return { qc, view, fetchMock };
  }

  it.each([
    [
      "a custom server, on a window showing Quick start",
      { openOnQuickStart: true, url: "http://localhost:8643/v1" },
      "detail",
      "yui-chatkey-input",
    ],
    [
      "the Quick start server, on a window showing Detailed settings",
      { openOnQuickStart: false, url: GEMINI_PRESET.url, key: "AIza-old" },
      "quick",
      "yui-start-key",
    ],
  ] as const)("with %s, the request shows the view holding the key and focuses its field", async (_, opts, shown, fieldId) => {
    const { qc, view } = build(opts);
    qc.open({ page: "persona" });

    qc.open({ page: "conn", focus: "chat_key" });
    await settle();

    expect(view(shown).hidden).toBe(false);
    expect(document.activeElement?.id).toBe(fieldId);
    expect(document.activeElement?.closest("[hidden]")).toBeNull();

    qc.dispose();
  });
});

describe("createQuickControls — the stored key check", () => {
  let mount: HTMLElement;
  const DONE = "Connected. You can start talking now.";
  const REJECTED = "Google no longer accepts this key. Paste a new key to keep talking.";

  beforeEach(() => {
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    setLocale("en");
    mount = document.createElement("div");
    document.body.appendChild(mount);
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  /** A Quick start user's window on Detailed settings switches to Quick start. */
  async function showQuickStart(fetchImpl: typeof globalThis.fetch) {
    const args = defaultQcArgs(mount);
    args.endpointsSettings.set({ chat_base_url: GEMINI_PRESET.url });
    args.chatKeySettings.setApiKey("AIza-old");
    const fetchMock = vi.fn(fetchImpl);
    const qc = createQuickControls({ ...args, getFetch: async () => fetchMock });
    qc.open({ page: "conn" });
    qc.el.querySelector<HTMLButtonElement>('.yui-seg__btn[data-view="quick"]')!.click();
    await settle();
    await settle();
    const quick = qc.el.querySelector<HTMLElement>('.yui-conn-view[data-view="quick"]')!;
    const visible = (selector: string) =>
      [...quick.querySelectorAll<HTMLElement>(selector)]
        .filter((el) => !el.closest("[hidden]"))
        .map((el) => el.textContent);
    const sentKeys = () =>
      fetchMock.mock.calls.map(([, init]) => new Headers(init?.headers).get("Authorization"));
    return { qc, quick, visible, sentKeys };
  }

  it("a refused stored key swaps Connected for Key rejected and opens the key field", async () => {
    const s = await showQuickStart(async () => new Response("{}", { status: 400 }));

    expect(s.sentKeys()).toEqual(["Bearer AIza-old"]);
    expect(s.visible('[role="alert"]')).toEqual([REJECTED]);
    expect(s.visible('[role="status"]')).toEqual([]);
    expect(s.quick.querySelector("#yui-start-key")!.closest("[hidden]")).toBeNull();
    expect(document.activeElement?.id).toBe("yui-start-key");

    s.qc.dispose();
  });

  it.each<[string, typeof globalThis.fetch]>([
    ["an accepted key", async () => models()],
    [
      "an unreachable server",
      async () => {
        throw new TypeError("network");
      },
    ],
    ["a server error", async () => new Response("{}", { status: 500 })],
  ])("with %s, the check keeps Connected", async (_, fetchImpl) => {
    const s = await showQuickStart(fetchImpl);

    expect(s.sentKeys()).toEqual(["Bearer AIza-old"]);
    expect(s.visible('[role="status"]')).toEqual([DONE]);
    expect(s.visible('[role="alert"]')).toEqual([]);

    s.qc.dispose();
  });

  it("a focus request opens the key field at once, and a key that passes keeps Connected and says it still works", async () => {
    const args = defaultQcArgs(mount);
    args.endpointsSettings.set({ chat_base_url: GEMINI_PRESET.url });
    args.chatKeySettings.setApiKey("AIza-old");
    const qc = createQuickControls({ ...args, getFetch: async () => async () => models() });
    const quick = qc.el.querySelector<HTMLElement>('.yui-conn-view[data-view="quick"]')!;
    const visible = (selector: string) =>
      [...quick.querySelectorAll<HTMLElement>(selector)]
        .filter((el) => !el.closest("[hidden]"))
        .map((el) => el.textContent);

    qc.open({ page: "conn", focus: "chat_key" });
    expect(document.activeElement?.id).toBe("yui-start-key");
    await settle();
    await settle();

    expect(visible('[role="status"]')).toEqual([DONE, "This key still works."]);
    expect(document.activeElement?.id).toBe("yui-start-key");

    qc.dispose();
  });

  it("the window coming back to the front checks the stored key only while Quick start shows", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const args = defaultQcArgs(mount);
    args.endpointsSettings.set({ chat_base_url: GEMINI_PRESET.url });
    args.chatKeySettings.setApiKey("AIza-old");
    const fetchMock = vi.fn(async () => models());
    const qc = createQuickControls({ ...args, getFetch: async () => fetchMock });
    qc.open({ page: "conn" });

    qc.windowFocused();
    await settle();
    expect(fetchMock).not.toHaveBeenCalled();

    qc.el.querySelector<HTMLButtonElement>('.yui-seg__btn[data-view="quick"]')!.click();
    await settle();
    vi.setSystemTime(Date.now() + 61_000);
    qc.windowFocused();
    await settle();
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
    qc.dispose();
  });
});
