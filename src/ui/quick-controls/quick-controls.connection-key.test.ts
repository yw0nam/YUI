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

  function build(opts: { openOnQuickStart: boolean; url: string; key?: string }) {
    const args = defaultQcArgs(mount);
    args.endpointsSettings.set({ chat_base_url: opts.url });
    if (opts.key) args.chatKeySettings.setApiKey(opts.key);
    const fetchMock = vi.fn(async () => models());
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
    qc.open({ tab: "persona" });

    qc.open({ tab: "conn", focus: "chat_key" } as never);
    await settle();

    expect(view(shown).hidden).toBe(false);
    expect(document.activeElement?.id).toBe(fieldId);
    expect(document.activeElement?.closest("[hidden]")).toBeNull();

    qc.dispose();
  });
});
