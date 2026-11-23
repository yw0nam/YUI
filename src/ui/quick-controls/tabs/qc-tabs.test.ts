// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChatHistoryStore } from "../../../io/chat/conversation/chat-history-store";
import type { SettingsPage } from "../../../settings/panels/settings-pages";
import { createVadSettings } from "../../../settings/voice/vad-settings";
import { setLocale } from "../../i18n";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs, fakePlugins } from "../test-helpers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function press(el: Element, key: string) {
  await act(async () => {
    fireEvent.keyDown(el, { key });
  });
}

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

  it("renders the character's pages, then every character's pages, each wired to its panel", () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    expect(t.map((tab) => tab.id)).toEqual([
      "yui-tab-conn",
      "yui-tab-voice",
      "yui-tab-persona",
      "yui-tab-body",
      "yui-tab-together",
      "yui-tab-listening",
      "yui-tab-perms",
      "yui-tab-react",
      "yui-tab-motion",
      "yui-tab-general",
    ]);
    expect(qc.el.querySelectorAll('[role="tabpanel"]').length).toBe(10);
    expect(qc.el.querySelector("#yui-tab-conn")?.previousElementSibling?.textContent).toBe(
      "이 캐릭터",
    );
    expect(qc.el.querySelector("#yui-tab-together")?.previousElementSibling?.textContent).toBe(
      "모든 캐릭터",
    );
    // Only tabs carry a role in the tablist; the group headings are presentation.
    expect(
      [...qc.el.querySelectorAll('[role="tablist"] > :not([role="tab"])')].map((e) =>
        e.getAttribute("role"),
      ),
    ).toEqual(["presentation", "presentation"]);

    // Each tab is wired to a panel and each panel back to its tab.
    for (const tab of t) {
      const panel = panelFor(qc, tab);
      expect(panel).not.toBeNull();
      expect(panel.getAttribute("role")).toBe("tabpanel");
      expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
    }

    qc.dispose();
  });

  it("opens on Connection with Quick start shown while chat is unconfigured", () => {
    const qc = buildQc({ openOnQuickStart: true });
    qc.open();

    const conn = tabs(qc)[0]!;
    expect(conn.id).toBe("yui-tab-conn");
    expect(conn.getAttribute("aria-selected")).toBe("true");
    expect(conn.tabIndex).toBe(0);
    expect(qc.selectedTab()).toBe("conn");
    expect(panelFor(qc, conn).hidden).toBe(false);
    expect(qc.el.querySelector<HTMLElement>('.yui-conn-view[data-view="quick"]')?.hidden).toBe(
      false,
    );
    expect(qc.el.querySelector<HTMLElement>('.yui-conn-view[data-view="detail"]')?.hidden).toBe(
      true,
    );
    expect(qc.el.querySelector<HTMLElement>("#yui-panel-persona")?.hidden).toBe(true);

    qc.dispose();
  });

  it("leaves the rail without a first-conversation page and opens on persona otherwise", () => {
    const qc = buildQc();
    qc.open();

    expect(qc.el.querySelector("#yui-tab-first")).toBeNull();
    expect(qc.el.querySelector("#yui-panel-first")).toBeNull();
    expect(qc.selectedTab()).toBe("persona");

    qc.dispose();
  });

  it("selecting Connection shows Detailed settings", () => {
    const qc = buildQc();
    qc.open();

    qc.el.querySelector<HTMLButtonElement>("#yui-tab-conn")!.click();

    expect(qc.selectedTab()).toBe("conn");
    expect(qc.el.querySelector<HTMLElement>('.yui-conn-view[data-view="detail"]')?.hidden).toBe(
      false,
    );
    expect(qc.el.querySelector<HTMLElement>('.yui-conn-view[data-view="quick"]')?.hidden).toBe(
      true,
    );

    qc.dispose();
  });

  it("Quick start reports a confirmed key", async () => {
    const onFirstConversationConnected = vi.fn();
    const qc = buildQc({
      openOnQuickStart: true,
      onFirstConversationConnected,
      getFetch: async () => async () =>
        new Response(JSON.stringify({ data: [{ id: "m" }] }), { status: 200 }),
    });
    qc.open();
    const panel = qc.el.querySelector<HTMLElement>('.yui-conn-view[data-view="quick"]')!;
    expect(panel).not.toBeNull();
    const button = (name: string) =>
      [...panel.querySelectorAll("button")].find((b) => b.textContent === name)!;

    panel.querySelector("input")!.value = "AIza-good";
    button("연결하기").click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(onFirstConversationConnected).toHaveBeenCalledTimes(1);

    qc.dispose();
  });

  it("renders no rail collapse button and no sliding tab indicator", () => {
    const qc = buildQc();
    qc.open();

    expect(qc.el.querySelector(".yui-rail-collapse")).toBeNull();
    expect(qc.el.querySelector(".yui-tabs__ind")).toBeNull();

    qc.dispose();
  });

  it("defaults to the 페르소나 page active; its panel visible, others hidden", () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    const active = t.find((tab) => tab.getAttribute("aria-selected") === "true")!;
    expect(active.id).toBe("yui-tab-persona");
    expect(active.getAttribute("aria-label")).toBe("페르소나");

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

  it("open({ page }) lands directly on the requested tab", () => {
    const qc = buildQc();
    qc.open({ page: "conn" });

    const conn = tabs(qc).find((tab) => tab.id === "yui-tab-conn")!;
    expect(conn.getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, conn).hidden).toBe(false);
    // Focus follows the requested tab, not the first control the panel would land on.
    expect(document.activeElement).toBe(conn);

    qc.dispose();
  });

  it("open({ page }) moves focus to that tab without a visible focus ring", () => {
    const qc = buildQc();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    qc.open({ page: "conn" });

    expect(focus).toHaveBeenLastCalledWith(expect.objectContaining({ focusVisible: false }));
    expect(focus.mock.contexts.at(-1)).toBe(qc.el.querySelector("#yui-tab-conn"));

    qc.dispose();
  });

  // The narrow-panel container query hides the label; aria-label and the tooltip name the icon then.
  it("the rail gives every tab a label, an aria-label and a tooltip", () => {
    const qc = buildQc();

    for (const tab of tabs(qc)) {
      const name = tab.getAttribute("aria-label");
      expect(name).toBeTruthy();
      expect(tab.querySelector(".yui-tab__label")?.textContent).toBe(name);
      act(() => {
        fireEvent.keyDown(document.body, { key: "Tab" });
        tab.focus();
      });
      expect(document.querySelector(".yui-hint-tip[data-open]")?.textContent).toBeTruthy();
      expect(tab.getAttribute("aria-describedby")).toBe("yui-hint-tip");
    }

    qc.dispose();
  });

  it("selectedTab() names the tab the user is on", () => {
    const qc = buildQc();
    qc.open();
    expect(qc.selectedTab()).toBe("persona");

    qc.el.querySelector<HTMLButtonElement>("#yui-tab-general")!.click();
    expect(qc.selectedTab()).toBe("general");

    qc.dispose();
  });

  it("open({ page }) switches an already-open panel to that tab", () => {
    const qc = buildQc();
    qc.open();
    qc.open({ page: "conn" });

    const conn = tabs(qc).find((tab) => tab.id === "yui-tab-conn")!;
    expect(conn.getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, conn).hidden).toBe(false);

    qc.dispose();
  });

  it("open({ page }) reaches every tab the tablist renders, hist closing the character's pages", () => {
    // The tab union is the panel's public vocabulary — it must not omit a rendered tab.
    const names: SettingsPage[] = [
      "conn",
      "voice",
      "persona",
      "body",
      "hist",
      "together",
      "listening",
      "perms",
      "plugins",
      "react",
      "motion",
      "general",
    ];
    // A transcript renders the history tab and the MCP host the plugins tab: the full rail.
    const { host, manage } = fakePlugins();
    const qc = buildQc({
      transcript: createChatHistoryStore(),
      plugins: { host, manage },
      openOnQuickStart: true,
    });
    expect(tabs(qc).map((tab) => tab.id)).toEqual(names.map((name) => `yui-tab-${name}`));

    for (const name of names) {
      qc.open({ page: name });
      const target = tabs(qc).find((tab) => tab.id === `yui-tab-${name}`)!;
      expect(target.getAttribute("aria-selected")).toBe("true");
      expect(panelFor(qc, target).hidden).toBe(false);
    }

    qc.dispose();
  });

  it("entering the Plugins page shows its sections and loads the plugin catalog", () => {
    const { host, manage } = fakePlugins();
    const qc = buildQc({ plugins: { host, manage } });
    qc.open();
    expect(manage.catalog).not.toHaveBeenCalled();

    tabs(qc)
      .find((tab) => tab.id === "yui-tab-plugins")!
      .click();

    expect(manage.catalog).toHaveBeenCalledTimes(1);
    expect(
      Array.from(
        qc.el.querySelectorAll("#yui-panel-plugins .yui-sec__title"),
        (h) => h.textContent,
      ),
    ).toEqual(["설치된 플러그인", "설치할 수 있는 플러그인"]);

    qc.dispose();
  });

  it("ArrowDown / ArrowUp move the active tab (roving tabindex)", async () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    // Arrows step from the selected tab — persona, the default, sits third.
    t[2].focus();

    await press(t[2], "ArrowDown");
    expect(t[3].getAttribute("aria-selected")).toBe("true");
    expect(t[3].tabIndex).toBe(0);
    expect(t[2].tabIndex).toBe(-1);
    expect(panelFor(qc, t[3]).hidden).toBe(false);

    await press(t[3], "ArrowUp");
    expect(t[2].getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, t[2]).hidden).toBe(false);

    qc.dispose();
  });

  it("Home / End jump to the first / last tab", async () => {
    const qc = buildQc();
    qc.open();

    const t = tabs(qc);
    t[0].focus();

    await press(t[0], "End");
    expect(t[9].id).toBe("yui-tab-general");
    expect(t[9].getAttribute("aria-selected")).toBe("true");
    expect(panelFor(qc, t[9]).hidden).toBe(false);

    await press(t[9], "Home");
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

// jsdom lays nothing out; in the scrolling column rail a shrinkable heading collapses to 0px.
it("keeps the rail group headings from shrinking when the rail overflows", () => {
  const css = readFileSync(resolve(__dirname, "../quick-controls.css"), "utf-8");
  const start = css.indexOf("\n.yui-tabs__group {");
  expect(css.slice(start, css.indexOf("\n}", start + 1))).toMatch(/\n\s*flex: none;/);
});
