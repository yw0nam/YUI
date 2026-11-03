// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatKeySettings } from "../../../../settings/backend/api-key-settings";
import {
  createEndpointsSettings,
  type EndpointOverrides,
} from "../../../../settings/backend/endpoints-settings";
import { createProactiveSettings } from "../../../../settings/cues/proactive-settings";
import { createScheduleSettings } from "../../../../settings/cues/schedule-settings";
import { setLocale } from "../../../i18n";
import { GEMINI_PRESET } from "../../constants";
import { createQuickStart } from "./quick-start";

const REFUSED = "Google did not accept this key. Paste the key you copied again.";
const FAILED = "Could not reach Google. Check your internet connection and try again.";
const OWN_SERVER_URL = "http://localhost:8643/v1";

const settle = () => new Promise<void>((r) => setTimeout(r, 0));
const models = () => new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 });

function setup(
  fetchImpl: typeof globalThis.fetch = async () => models(),
  opts: {
    showHelp?: boolean;
    getEndpointDefaults?: () => EndpointOverrides | undefined;
  } = {},
) {
  const fetchMock = vi.fn(fetchImpl);
  const endpointsSettings = createEndpointsSettings();
  const chatKeySettings = createChatKeySettings();
  const proactiveSettings = createProactiveSettings({ locale: "en" });
  const scheduleSettings = createScheduleSettings({ locale: "en" });
  const onConnected = vi.fn();
  const page = createQuickStart({
    endpointsSettings,
    chatKeySettings,
    proactiveSettings,
    scheduleSettings,
    getEndpointDefaults: opts.getEndpointDefaults,
    getFetch: async () => fetchMock,
    onConnected,
    showHelp: opts.showHelp ?? false,
  });
  document.body.append(page.el);
  const input = page.el.querySelector<HTMLInputElement>('input[type="password"]')!;
  const button = [...page.el.querySelectorAll("button")].find((b) => b.textContent === "Connect")!;
  const connect = async (key: string) => {
    input.value = key;
    button.click();
    await settle();
    await settle();
  };
  const expectNothingWritten = () => {
    expect(endpointsSettings.get().chat_base_url).toBe("");
    expect(endpointsSettings.get().chat_model).toBe("");
    expect(chatKeySettings.get().apiKey).toBe("");
    expect(proactiveSettings.get().enabled).toBe(true);
    expect(scheduleSettings.get().enabled).toBe(true);
    expect(onConnected).not.toHaveBeenCalled();
  };
  const visibleText = (selector: string) =>
    [...page.el.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => !el.closest("[hidden]"))
      .map((el) => el.textContent);
  const el = (selector: string) => page.el.querySelector<HTMLElement>(selector)!;
  return {
    page,
    fetchMock,
    endpointsSettings,
    chatKeySettings,
    proactiveSettings,
    scheduleSettings,
    onConnected,
    input,
    button,
    connect,
    expectNothingWritten,
    visibleText,
    el,
  };
}

describe("createQuickStart", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("a confirmed key writes the URL, model and key, turns check-ins and the schedule off, and connects once", async () => {
    const s = setup();
    s.endpointsSettings.set({ chat_api: "push" });

    await s.connect(" AIza-good ");

    expect(s.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = s.fetchMock.mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/models");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer AIza-good");
    expect(s.endpointsSettings.get().chat_base_url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai",
    );
    expect(s.endpointsSettings.get().chat_model).toBe("models/gemini-3.5-flash-lite");
    expect(s.endpointsSettings.get().chat_api).toBe("chat_completions");
    expect(s.chatKeySettings.get().apiKey).toBe("AIza-good");
    expect(s.proactiveSettings.get().enabled).toBe(false);
    expect(s.scheduleSettings.get().enabled).toBe(false);
    expect(s.onConnected).toHaveBeenCalledTimes(1);
    expect(s.visibleText('[role="status"]')).toEqual(["Connected. You can start talking now."]);
  });

  it.each([
    ["refused 401", 401],
    ["refused 403", 403],
    ["http 400, a bad Gemini key", 400],
  ])("%s shows the refused line with the key page link and writes nothing", async (_, status) => {
    const s = setup(async () => new Response("{}", { status }));

    await s.connect("AIza-bad");

    expect(s.visibleText('[role="alert"] span')).toEqual([REFUSED]);
    const link = s.page.el.querySelector<HTMLAnchorElement>('[role="alert"] a')!;
    expect(link.href).toBe("https://aistudio.google.com/apikey");
    expect(link.textContent).toBe("Open key page again");
    expect(link.closest("[hidden]")).toBeNull();
    s.expectNothingWritten();
  });

  it.each<[string, typeof globalThis.fetch]>([
    [
      "unreachable",
      async () => {
        throw new TypeError("network");
      },
    ],
    ["http 500", async () => new Response("{}", { status: 500 })],
    ["malformed", async () => new Response("not json", { status: 200 })],
  ])("%s shows the failed line without the key link and writes nothing", async (_, fetchImpl) => {
    const s = setup(fetchImpl);

    await s.connect("AIza-any");

    expect(s.visibleText('[role="alert"] span')).toEqual([FAILED]);
    expect(s.visibleText('[role="alert"] a')).toEqual([]);
    s.expectNothingWritten();
  });

  it("an empty key shows the need-key line and sends no request", async () => {
    const s = setup();

    await s.connect("   ");

    expect(s.visibleText('[role="alert"] span')).toEqual(["Paste a key first."]);
    expect(s.fetchMock).not.toHaveBeenCalled();
    s.expectNothingWritten();
  });

  it("locks the key field and the button while the key is read, and unlocks them on a failure", async () => {
    let respond: (res: Response) => void = () => {};
    const s = setup(() => new Promise((r) => (respond = r)));

    await s.connect("AIza-slow");

    expect(s.input.disabled).toBe(true);
    expect(s.button.disabled).toBe(true);
    expect(s.visibleText('[role="status"]')).toEqual(["Checking the key…"]);

    respond(new Response("{}", { status: 401 }));
    await settle();
    await settle();

    expect(s.input.disabled).toBe(false);
    expect(s.button.disabled).toBe(false);
    expect(s.visibleText('[role="status"]')).toEqual([]);
  });

  it("a read still in flight at dispose writes nothing", async () => {
    let respond: (res: Response) => void = () => {};
    const s = setup(() => new Promise((r) => (respond = r)));

    await s.connect("AIza-slow");
    s.page.dispose();
    respond(models());
    await settle();
    await settle();

    s.expectNothingWritten();
  });

  it("states what is sent and the daily limit before the key field, and links the key page", () => {
    const s = setup();

    const text = s.page.el.textContent!;
    const beforeField = text.slice(0, text.indexOf("Paste the key"));
    expect(beforeField).toContain("Talk on the Google Gemini free tier.");
    expect(beforeField).toContain(
      "Your conversation and the name and window title of the app in front go to Google.",
    );
    expect(beforeField).toContain("people may review them");
    expect(beforeField).toContain("The free tier has a daily limit.");

    const key = [...s.page.el.querySelectorAll("a")].find(
      (a) => a.textContent === "Open key page",
    )!;
    expect(key.href).toBe("https://aistudio.google.com/apikey");
    expect(key.target).toBe("_blank");
    expect(key.rel).toBe("noopener noreferrer");
  });
});

describe("createQuickStart — the state it reads from the stores", () => {
  beforeEach(() => setLocale("en"));
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("warns that the key replaces the server already configured", () => {
    const s = setup();
    s.endpointsSettings.set({ chat_base_url: OWN_SERVER_URL });

    s.page.reflect();

    expect(s.el(".yui-start__own").hidden).toBe(false);
    expect(s.el(".yui-start__own").textContent).toBe(
      "Connecting with this key replaces your current server with Google Gemini.",
    );
  });

  it("shows the connected state for Gemini with a saved key", () => {
    const s = setup();
    s.endpointsSettings.set({ chat_base_url: GEMINI_PRESET.url });
    s.chatKeySettings.setApiKey("AIza-good");

    s.page.reflect();

    expect(s.el(".yui-start__setup").hidden).toBe(true);
    expect(s.el(".yui-start__connected").hidden).toBe(false);
  });

  it("shows the setup state for Gemini without a key", () => {
    const s = setup();
    s.endpointsSettings.set({ chat_base_url: GEMINI_PRESET.url });

    s.page.reflect();

    expect(s.el(".yui-start__setup").hidden).toBe(false);
    expect(s.el(".yui-start__connected").hidden).toBe(true);
  });

  it("falls back to the setup state and the warning when the server changes", () => {
    const s = setup();
    s.endpointsSettings.set({ chat_base_url: GEMINI_PRESET.url });
    s.chatKeySettings.setApiKey("AIza-good");
    s.page.reflect();

    s.endpointsSettings.set({ chat_base_url: OWN_SERVER_URL });
    s.page.reflect();

    expect(s.el(".yui-start__setup").hidden).toBe(false);
    expect(s.el(".yui-start__connected").hidden).toBe(true);
    expect(s.el(".yui-start__own").hidden).toBe(false);
  });

  it("the connected state carries the two guide buttons", () => {
    const s = setup(undefined, { showHelp: true });
    s.endpointsSettings.set({ chat_base_url: GEMINI_PRESET.url });
    s.chatKeySettings.setApiKey("AIza-good");

    s.page.reflect();

    const connected = s.el(".yui-start__connected");
    expect(connected.hidden).toBe(false);
    expect([...connected.querySelectorAll("[data-guide]")].map((b) => b.dataset.guide)).toEqual([
      "controls",
      "capabilities",
    ]);
  });
});
