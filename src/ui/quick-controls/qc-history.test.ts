// @vitest-environment jsdom
/**
 * History tab — session accordion over the persisted transcript, plus the
 * Input-tab "keep bubble until dismissed" switch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatHistoryStore } from "../../io/chat-history-store";
import { createFlagSettings } from "../../io/persisted-store";
import { createSessionDiagnosticsStore } from "../../io/session-diagnostics";
import { createSessionStore } from "../../io/session-store";
import { setLocale } from "../i18n";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs } from "./test-helpers";

function seedStore() {
  const store = createChatHistoryStore();
  // older session
  store.append({
    role: "user",
    text: "vLLM 서버 올리는 것 좀 도와줘",
    ts: Date.parse("2026-08-12T07:40:00Z"),
  });
  store.append({
    role: "assistant",
    text: "포트부터 확인해보자",
    ts: Date.parse("2026-08-12T07:41:00Z"),
  });
  store.startNewSession(Date.parse("2026-08-13T09:10:00Z"));
  // current session
  store.append({
    role: "user",
    text: "방금 그 빌드 왜 실패했어?",
    ts: Date.parse("2026-08-13T09:12:00Z"),
  });
  store.append({
    role: "assistant",
    text: "cargo fmt 미적용이 원인이야",
    ts: Date.parse("2026-08-13T09:13:00Z"),
  });
  return store;
}

describe("createQuickControls — history tab", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({ ...defaultQcArgs(mount), ...extra });
  }

  it("adds a 6th rail tab wired to its own panel when a transcript is injected", () => {
    const qc = buildQc({ transcript: seedStore() });
    qc.open();

    const tabs = Array.from(qc.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(tabs).toHaveLength(6);
    expect(qc.el.querySelectorAll('[role="tabpanel"]')).toHaveLength(6);

    const histTab = tabs[5];
    expect(histTab.textContent).toContain("History");
    expect(histTab.getAttribute("aria-label")).toBeTruthy();
    expect(histTab.dataset.tip).toBeTruthy();
    expect(histTab.hasAttribute("title")).toBe(false);
    const panel = qc.el.querySelector<HTMLElement>(`#${histTab.getAttribute("aria-controls")}`)!;
    expect(panel.getAttribute("aria-labelledby")).toBe(histTab.id);

    qc.dispose();
  });

  it("omits the history tab when no transcript is injected", () => {
    const qc = buildQc();
    qc.open();

    expect(qc.el.querySelectorAll('[role="tab"]')).toHaveLength(5);
    expect(qc.el.querySelector(".yui-hist")).toBeNull();

    qc.dispose();
  });

  it("End key selects the history tab and moves the rail indicator", () => {
    const qc = buildQc({ transcript: seedStore() });
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]')!;
    const tabs = Array.from(qc.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    tabs[0].focus();
    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));

    expect(tabs[5].getAttribute("aria-selected")).toBe("true");
    expect(tablist.style.getPropertyValue("--tab")).toBe("5");

    qc.dispose();
  });

  it("renders one row per session, newest first, with turn counts", () => {
    const qc = buildQc({ transcript: seedStore() });
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-hist__sess"));
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector(".yui-hist__sess-count")!.textContent).toContain("2");
    expect(rows[1].querySelector(".yui-hist__sess-count")!.textContent).toContain("2");

    qc.dispose();
  });

  it("expands the current session by default and collapses the older ones", () => {
    const qc = buildQc({ transcript: seedStore() });
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-hist__sess"));
    expect(rows[0].getAttribute("aria-expanded")).toBe("true");
    expect(rows[1].getAttribute("aria-expanded")).toBe("false");

    const groups = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-hist__sess-group"));
    expect(groups[0].classList.contains("is-open")).toBe(true);
    expect(groups[0].querySelectorAll(".yui-hist__turn")).toHaveLength(2);
    expect(groups[1].querySelectorAll(".yui-hist__turn")).toHaveLength(0);

    qc.dispose();
  });

  it("shows a first-utterance preview on collapsed session rows only", () => {
    const qc = buildQc({ transcript: seedStore() });
    qc.open();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-hist__sess"));
    expect(rows[0].querySelector(".yui-hist__sess-preview")).toBeNull();
    expect(rows[1].querySelector(".yui-hist__sess-preview")!.textContent).toContain(
      "vLLM 서버 올리는 것 좀 도와줘",
    );

    qc.dispose();
  });

  it("clicking a collapsed session expands it in place", () => {
    const qc = buildQc({ transcript: seedStore() });
    qc.open();

    qc.el.querySelectorAll<HTMLButtonElement>(".yui-hist__sess")[1].click();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-hist__sess"));
    expect(rows[1].getAttribute("aria-expanded")).toBe("true");
    const groups = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-hist__sess-group"));
    expect(groups[1].querySelectorAll(".yui-hist__turn")).toHaveLength(2);
    // the current session stays open — sessions toggle independently
    expect(rows[0].getAttribute("aria-expanded")).toBe("true");

    qc.dispose();
  });

  it("keeps focus on the session row it just toggled", () => {
    const qc = buildQc({ transcript: seedStore() });
    qc.open();

    const row = qc.el.querySelectorAll<HTMLButtonElement>(".yui-hist__sess")[1];
    row.focus();
    row.click();

    const after = qc.el.querySelectorAll<HTMLButtonElement>(".yui-hist__sess")[1];
    expect(document.activeElement).toBe(after);

    qc.dispose();
  });

  it("points each session row at the turn log it discloses", () => {
    const qc = buildQc({ transcript: seedStore() });
    qc.open();

    const row = qc.el.querySelector<HTMLButtonElement>(".yui-hist__sess")!;
    const log = qc.el.querySelector<HTMLElement>(".yui-hist__log")!;
    expect(row.getAttribute("aria-controls")).toBe(log.id);
    expect(log.getAttribute("role")).toBe("region");
    expect(log.getAttribute("aria-labelledby")).toBe(row.id);

    qc.dispose();
  });

  it("clicking the open current session collapses it", () => {
    const qc = buildQc({ transcript: seedStore() });
    qc.open();

    const row = qc.el.querySelector<HTMLButtonElement>(".yui-hist__sess")!;
    row.click();

    const after = qc.el.querySelector<HTMLButtonElement>(".yui-hist__sess")!;
    expect(after.getAttribute("aria-expanded")).toBe("false");
    expect(qc.el.querySelector(".yui-hist__turn")).toBeNull();

    qc.dispose();
  });

  it("marks YUI turns so its name renders in the accent color", () => {
    const qc = buildQc({ transcript: seedStore() });
    qc.open();

    const turns = Array.from(qc.el.querySelectorAll<HTMLElement>(".yui-hist__turn"));
    expect(turns[0].classList.contains("is-yui")).toBe(false);
    expect(turns[1].classList.contains("is-yui")).toBe(true);
    expect(turns[0].querySelector(".yui-hist__who")!.textContent).toBeTruthy();
    expect(turns[1].querySelector(".yui-hist__who")!.textContent).toBeTruthy();
    expect(turns[0].querySelector(".yui-hist__say")!.textContent).toBe("방금 그 빌드 왜 실패했어?");
    expect(turns[0].querySelector(".yui-hist__ts")!.textContent).toMatch(/^\d{2}:\d{2}$/);

    qc.dispose();
  });

  it("renders user text as plain text — markup is never injected", () => {
    const store = createChatHistoryStore();
    store.append({ role: "user", text: "<img src=x onerror=alert(1)> **bold**", ts: 1 });
    const qc = buildQc({ transcript: store });
    qc.open();

    const say = qc.el.querySelector<HTMLElement>(".yui-hist__say")!;
    expect(say.querySelector("img")).toBeNull();
    expect(say.querySelector("strong")).toBeNull();
    expect(say.textContent).toBe("<img src=x onerror=alert(1)> **bold**");

    qc.dispose();
  });

  it("live-updates when a turn is appended to the store", () => {
    const store = seedStore();
    const qc = buildQc({ transcript: store });
    qc.open();
    expect(qc.el.querySelectorAll(".yui-hist__turn")).toHaveLength(2);

    store.append({ role: "user", text: "하나 더", ts: Date.parse("2026-08-13T09:20:00Z") });

    expect(qc.el.querySelectorAll(".yui-hist__turn")).toHaveLength(3);
    expect(qc.el.querySelectorAll(".yui-hist__sess")[0].textContent).toContain("3");

    qc.dispose();
  });

  it("live-updates when a new session boundary is written", () => {
    const store = seedStore();
    const qc = buildQc({ transcript: store });
    qc.open();
    expect(qc.el.querySelectorAll(".yui-hist__sess")).toHaveLength(2);

    store.startNewSession(Date.parse("2026-08-13T10:00:00Z"));

    expect(qc.el.querySelectorAll(".yui-hist__sess")).toHaveLength(3);
    expect(qc.el.querySelectorAll(".yui-hist__turn")).toHaveLength(0);

    qc.dispose();
  });

  it("renders the storage footnote", () => {
    const qc = buildQc({ transcript: seedStore() });
    qc.open();

    const foot = qc.el.querySelector<HTMLElement>(".yui-hist__foot")!;
    expect(foot.textContent).toContain("200");

    qc.dispose();
  });

  it("shows an empty note when nothing has been said yet", () => {
    const qc = buildQc({ transcript: createChatHistoryStore() });
    qc.open();

    expect(qc.el.querySelector(".yui-hist__turn")).toBeNull();
    expect(qc.el.querySelector(".yui-hist__empty")).not.toBeNull();

    qc.dispose();
  });
});

describe("createQuickControls — start fresh action in the History tab", () => {
  let mount: HTMLElement;
  let sessionStore: ReturnType<typeof createSessionStore>;
  let sessionDiagnostics: ReturnType<typeof createSessionDiagnosticsStore>;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    sessionStore = createSessionStore();
    sessionDiagnostics = createSessionDiagnosticsStore();
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
      sessionStore,
      sessionDiagnostics,
      transcript: seedStore(),
      ...extra,
    });
  }

  it.each([
    ["popover"],
    ["window"],
  ] as const)("renders the action under the session list in the %s variant", (variant) => {
    const qc = buildQc({ variant });
    qc.open();

    const panel = qc.el.querySelector<HTMLElement>("#yui-panel-hist")!;
    const action = panel.querySelector<HTMLElement>(".yui-hist__action")!;
    expect(action).not.toBeNull();
    expect(action.querySelector(".yui-session__action-label")!.textContent).toBe("Start fresh");
    expect(action.querySelector(".yui-session__action-sub")!.textContent).toBeTruthy();
    expect(action.querySelector(".yui-session__reset")).not.toBeNull();
    expect(action.querySelector<HTMLElement>(".yui-confirm")!.hidden).toBe(true);
    // it sits after the session list, not before it
    expect(
      panel.querySelector(".yui-hist")!.compareDocumentPosition(action) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    qc.dispose();
  });

  it("omits the action when the reset stores are absent", () => {
    const qc = createQuickControls({ ...defaultQcArgs(mount), transcript: seedStore() });
    qc.open();

    expect(qc.el.querySelector("#yui-panel-hist")).not.toBeNull();
    expect(qc.el.querySelector(".yui-hist__action")).toBeNull();
    expect(qc.el.querySelector(".yui-session__reset")).toBeNull();

    qc.dispose();
  });

  it("confirming runs the one reset path: session id, diagnostics, transcript boundary", () => {
    sessionStore.set("resp_x"); // populate so clear() actually fires
    sessionDiagnostics.setUsage(50000, 200000);
    const clearSession = vi.spyOn(sessionStore, "clear");
    const clearDiag = vi.spyOn(sessionDiagnostics, "clear");
    const transcript = seedStore();
    const startNewSession = vi.spyOn(transcript, "startNewSession");

    const qc = buildQc({ variant: "popover", transcript });
    qc.open();

    const confirm = qc.el.querySelector<HTMLElement>(".yui-hist__action .yui-confirm")!;
    const reset = qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__reset")!;
    expect(confirm.hidden).toBe(true);
    reset.click();
    // the confirm takes the link's place rather than stacking under it
    expect(confirm.hidden).toBe(false);
    expect(reset.hidden).toBe(true);

    qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__confirm")!.click();

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(clearDiag).toHaveBeenCalledTimes(1);
    expect(startNewSession).toHaveBeenCalledTimes(1);
    expect(qc.el.querySelector<HTMLElement>(".yui-hist__action .yui-confirm")!.hidden).toBe(true);
    expect(reset.hidden).toBe(false);

    qc.dispose();
  });

  it("cancelling dismisses the confirm without resetting anything", () => {
    sessionStore.set("resp_y");
    const clearSession = vi.spyOn(sessionStore, "clear");
    const transcript = seedStore();
    const startNewSession = vi.spyOn(transcript, "startNewSession");

    const qc = buildQc({ variant: "popover", transcript });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__reset")!.click();
    qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__cancel")!.click();

    expect(clearSession).not.toHaveBeenCalled();
    expect(startNewSession).not.toHaveBeenCalled();
    expect(qc.el.querySelector<HTMLElement>(".yui-hist__action .yui-confirm")!.hidden).toBe(true);

    qc.dispose();
  });

  it("disarms the confirm when the panel is closed and reopened", () => {
    const qc = buildQc({ variant: "popover" });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__reset")!.click();
    expect(qc.el.querySelector<HTMLElement>(".yui-hist__action .yui-confirm")!.hidden).toBe(false);

    qc.close();
    qc.open();

    // reopening must not land the user on an armed destructive pill
    expect(qc.el.querySelector<HTMLElement>(".yui-hist__action .yui-confirm")!.hidden).toBe(true);
    expect(
      qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__reset")!.hidden,
    ).toBe(false);

    qc.dispose();
  });

  it("shows the new boundary in the list right after a confirmed reset", () => {
    const transcript = seedStore();
    const qc = buildQc({ variant: "popover", transcript });
    qc.open();
    expect(qc.el.querySelectorAll(".yui-hist__sess")).toHaveLength(2);

    qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__reset")!.click();
    qc.el.querySelector<HTMLButtonElement>(".yui-hist__action .yui-session__confirm")!.click();

    const rows = Array.from(qc.el.querySelectorAll<HTMLButtonElement>(".yui-hist__sess"));
    expect(rows).toHaveLength(3);
    // the fresh current session is on top, open and empty; the closed one keeps its turns
    expect(rows[0].getAttribute("aria-expanded")).toBe("true");
    expect(qc.el.querySelector(".yui-hist__empty")).not.toBeNull();
    expect(rows[1].querySelector(".yui-hist__sess-count")!.textContent).toContain("2");

    qc.dispose();
  });
});

describe("createQuickControls — start fresh keeps the transcript", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("start fresh opens a new session group instead of erasing prior turns", () => {
    const store = createChatHistoryStore();
    store.append({ role: "user", text: "keep me", ts: 1 });
    const qc = createQuickControls({
      ...defaultQcArgs(mount),
      variant: "window",
      sessionStore: createSessionStore(),
      sessionDiagnostics: createSessionDiagnosticsStore(),
      transcript: store,
    });
    qc.open();

    qc.el.querySelector<HTMLButtonElement>(".yui-session__reset")!.click();
    qc.el.querySelector<HTMLButtonElement>(".yui-session__confirm")!.click();

    expect(store.entriesAfterLastBoundary()).toEqual([]);
    expect(store.sessions()).toHaveLength(2);
    expect(store.sessions()[1].entries[0].text).toBe("keep me");

    qc.dispose();
  });
});

describe("createQuickControls — keep bubble until dismissed switch", () => {
  let mount: HTMLElement;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    setLocale("en");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("is absent when no store is injected", () => {
    const qc = createQuickControls(defaultQcArgs(mount));
    qc.open();
    expect(qc.el.querySelector(".yui-bubble-persist-switch")).toBeNull();
    qc.dispose();
  });

  it("renders in the Input tab, off by default, and toggles the store", () => {
    const bubblePersistSettings = createFlagSettings(false);
    const qc = createQuickControls({ ...defaultQcArgs(mount), bubblePersistSettings });
    qc.open();

    const sw = qc.el.querySelector<HTMLButtonElement>(".yui-bubble-persist-switch")!;
    expect(qc.el.querySelector<HTMLElement>("#yui-panel-input")!.contains(sw)).toBe(true);
    expect(sw.getAttribute("aria-checked")).toBe("false");

    sw.click();
    expect(bubblePersistSettings.get().enabled).toBe(true);
    expect(sw.getAttribute("aria-checked")).toBe("true");

    qc.dispose();
  });

  it("reflects an external store change while open", () => {
    const bubblePersistSettings = createFlagSettings(false);
    const qc = createQuickControls({ ...defaultQcArgs(mount), bubblePersistSettings });
    qc.open();

    bubblePersistSettings.setEnabled(true);
    expect(
      qc.el
        .querySelector<HTMLButtonElement>(".yui-bubble-persist-switch")!
        .getAttribute("aria-checked"),
    ).toBe("true");

    qc.dispose();
  });
});
