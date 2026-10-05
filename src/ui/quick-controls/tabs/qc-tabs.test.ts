// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatHistoryStore } from "../../../io/chat/conversation/chat-history-store";
import { createVadSettings } from "../../../settings/voice/vad-settings";
import { setLocale } from "../../i18n";
import type { QuickControlsTab } from "../constants";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs } from "../test-helpers";

describe("createQuickControls — tab rail", () => {
  let mount: HTMLElement;
  let vad: ReturnType<typeof createVadSettings>;

  beforeEach(() => {
    let rafId = 0;
    vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return ++rafId;
    });
    vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {});
    mount = document.createElement("div");
    document.body.appendChild(mount);
    vad = createVadSettings();
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
    // Existing assertions pin Korean copy/selectors; render the panel in ko.
    setLocale("ko");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function buildQc(extra?: Partial<Parameters<typeof createQuickControls>[0]>) {
    return createQuickControls({
      ...defaultQcArgs(mount),
      vad,
      ...extra,
    });
  }

  function tabs(qc: ReturnType<typeof createQuickControls>): HTMLButtonElement[] {
    return Array.from(qc.el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
  }

  function panelFor(
    qc: ReturnType<typeof createQuickControls>,
    tab: HTMLButtonElement,
  ): HTMLElement {
    return qc.el.querySelector<HTMLElement>(`#${tab.getAttribute("aria-controls")}`)!;
  }

  it("renders the tabs conn, talk, char, input, react, general in order, each wired to its panel", () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    expect(t.map((tab) => tab.id)).toEqual([
      "yui-tab-conn",
      "yui-tab-talk",
      "yui-tab-char",
      "yui-tab-input",
      "yui-tab-react",
      "yui-tab-general",
    ]);
    expect(qc.el.querySelectorAll('[role="tabpanel"]').length).toBe(6);

    // Each tab is wired to a panel and each panel back to its tab.
    for (const tab of t) {
      const panel = panelFor(qc, tab);
      expect(panel).not.toBeNull();
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    }

    qc.dispose();
  });

  it("renders no rail collapse button and no sliding tab indicator", () => {
    const qc = buildQc();
    qc.open();

    expect(qc.el.querySelector(".yui-rail-collapse")).toBeNull();
    expect(qc.el.querySelector(".yui-tabs__ind")).toBeNull();

    qc.dispose();
  });

  it("defaults to the 대화 tab active; its panel visible, others hidden", () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    const active = t.find((tab) => tab.getAttribute("aria-selected") === "true")!;
    expect(active.id).toBe("yui-tab-talk");
    expect(active.getAttribute("aria-label")).toBe("대화");

    for (const tab of t) {
      const on = tab === active;
      expect(tab.getAttribute("aria-selected")).toBe(String(on));
      expect(tab.tabIndex).toBe(on ? 0 : -1);
      expect(panelFor(qc, tab).hidden).toBe(!on);
    }

    qc.dispose();
  });

  it("clicking a tab switches the active panel + aria-selected/hidden", () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    const target = qc.el.querySelector<HTMLButtonElement>("#yui-tab-general")!;
    target.click();

    expect(target.getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, target).hidden).toBe(false);
    for (const tab of t) {
      if (tab === target) continue;
      expect(tab.getAttribute("aria-selected")).toBe("false");
      expect(panelFor(qc, tab).hidden).toBe(true);
    }

    qc.dispose();
  });

  it("open({ tab }) lands directly on the requested tab", () => {
    const qc = buildQc();
    qc.open(undefined, { tab: "conn" });

    const conn = tabs(qc).find((tab) => tab.id === "yui-tab-conn")!;
    expect(conn.getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, conn).hidden).toBe(false);
    expect(qc.isOpen()).toBe(true);
    // Focus follows the requested tab, not the first control the popover would land on.
    expect(document.activeElement).toBe(conn);

    qc.dispose();
  });

  it("open({ tab }) moves focus to that tab without a visible focus ring", () => {
    const qc = buildQc();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    qc.open(undefined, { tab: "conn" });

    expect(focus).toHaveBeenLastCalledWith(expect.objectContaining({ focusVisible: false }));
    expect(focus.mock.contexts.at(-1)).toBe(qc.el.querySelector("#yui-tab-conn"));

    qc.dispose();
  });

  // The narrow-panel container query hides the label; aria-label and the tooltip name the icon then.
  it.each([
    "popover",
    "window",
  ] as const)("the %s rail gives every tab a label, an aria-label and a tooltip", (variant) => {
    const qc = buildQc({ variant });

    for (const tab of tabs(qc)) {
      const name = tab.getAttribute("aria-label");
      expect(name).toBeTruthy();
      expect(tab.querySelector(".yui-tab__label")?.textContent).toBe(name);
      expect(tab.dataset.tip).toBeTruthy();
    }

    qc.dispose();
  });

  it("selectedTab() names the tab the user is on", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.selectedTab()).toBe("talk");

    qc.el.querySelector<HTMLButtonElement>("#yui-tab-general")!.click();
    expect(qc.selectedTab()).toBe("general");

    qc.dispose();
  });

  it("open({ tab }) switches an already-open panel to that tab", () => {
    const qc = buildQc();
    qc.open();
    qc.open(undefined, { tab: "conn" });

    const conn = tabs(qc).find((tab) => tab.id === "yui-tab-conn")!;
    expect(conn.getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, conn).hidden).toBe(false);

    qc.dispose();
  });

  it("open({ tab }) reaches every tab the tablist renders, hist sitting before general", () => {
    // The tab union is the panel's public vocabulary — it must not omit a rendered tab.
    const names: QuickControlsTab[] = ["conn", "talk", "char", "input", "react", "hist", "general"];
    // A transcript is what renders the history tab, so inject one to get the full rail.
    const qc = buildQc({ transcript: createChatHistoryStore() });
    expect(tabs(qc).map((tab) => tab.id)).toEqual(names.map((name) => `yui-tab-${name}`));

    for (const name of names) {
      qc.open(undefined, { tab: name });
      const target = tabs(qc).find((tab) => tab.id === `yui-tab-${name}`)!;
      expect(target.getAttribute("aria-selected")).toBe("true");
      expect(panelFor(qc, target).hidden).toBe(false);
    }

    qc.dispose();
  });

  it("ArrowRight / ArrowLeft move the active tab (roving tabindex)", () => {
    const qc = buildQc();
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]')!;
    const t = tabs(qc);
    // Arrows step from the selected tab — talk, the default, sits second.
    t[1].focus();

    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(t[2].getAttribute("aria-selected")).toBe("true");
    expect(t[2].tabIndex).toBe(0);
    expect(t[1].tabIndex).toBe(-1);
    expect(panelFor(qc, t[2]).hidden).toBe(false);

    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(t[1].getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, t[1]).hidden).toBe(false);

    qc.dispose();
  });

  it("Home / End jump to the first / last tab", () => {
    const qc = buildQc();
    qc.open();

    const tablist = qc.el.querySelector<HTMLElement>('[role="tablist"]')!;
    const t = tabs(qc);
    t[0].focus();

    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(t[5].id).toBe("yui-tab-general");
    expect(t[5].getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, t[5]).hidden).toBe(false);

    tablist.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(t[0].getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, t[0]).hidden).toBe(false);

    qc.dispose();
  });

  it("keeps exactly one panel visible at all times", () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    for (const tab of t) {
      tab.click();
      const visible = t.filter((x) => !panelFor(qc, x).hidden);
      expect(visible.length).toBe(1);
      expect(visible[0]).toBe(tab);
    }

    qc.dispose();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Language picker (i18n)
// ─────────────────────────────────────────────────────────────────────────────
