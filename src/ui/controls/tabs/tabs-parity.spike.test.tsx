// @vitest-environment jsdom
// Throwaway spike for #2029: can Base UI Tabs replace the settings rail (tabs/tab-rail.ts) and the
// Threads window tabs (threads/window/threads-tabs.ts)?
// Layouts: "rail" = vertical, four tabs, group headings inside the tablist, ids yui-tab-* / yui-panel-*.
//          "bar"  = horizontal, two tabs, ids yui-threads-tab-* / yui-threads-panel-*.
// Arms: "today"     = createTabRail (rail) / createThreadsTabs (bar), the shipped code.
//       "plain"     = Tabs.Root/List/Tab/Panel, keepMounted, caller-chosen ids, Base UI defaults.
//       "plain+aof" = plain plus activateOnFocus on the list (a prop, no wrapper code).
//       "wrapped"   = plain+aof plus the lines between WRAP-BEGIN and WRAP-END.
// Cases labelled ACCEPTED are Base UI default differences (as #2070's wrap and Home/End were); the
// asserted value is what Base UI does. Cases labelled WRAP need the wrapper to match today.
// jsdom does not turn an Enter keydown on a <button> into a click; a click stands in for it.
// Base UI composite parts register only while connected (D-13): every arm renders into document.body.

import { readFileSync } from "node:fs";
import { Tabs } from "@base-ui/react/tabs";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { act, useState } from "react";
import { flushSync } from "react-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "../../i18n";
import { createTabRail, tabButtonHtml, tabPanelOpenHtml } from "../../quick-controls/tabs/tab-rail";
import type { TabBody } from "../../threads/window/threads-tabs";
import { createThreadsTabs } from "../../threads/window/threads-tabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Arm = "today" | "plain" | "plain+aof" | "wrapped";

interface Layout {
  name: "rail" | "bar";
  ids: string[];
  initial: string;
  vertical: boolean;
  prefix: string;
  tabClass: string;
  panelClass: string;
  listClass: string;
  label(id: string): string;
}

const RAIL: Layout = {
  name: "rail",
  ids: ["conn", "voice", "persona", "body"],
  initial: "persona",
  vertical: true,
  prefix: "yui",
  tabClass: "yui-tab",
  panelClass: "yui-tabpanel",
  listClass: "yui-tabs",
  label: (id) => t(`tabs.${id}`),
};
const BAR: Layout = {
  name: "bar",
  ids: ["threads", "terminal"],
  initial: "threads",
  vertical: false,
  prefix: "yui-threads",
  tabClass: "yui-threads__tab",
  panelClass: "yui-threads__panes",
  listClass: "yui-threads__tabs",
  label: (id) => t(id === "threads" ? "threads.title" : "terminal.title"),
};
const tabIdOf = (L: Layout, id: string) => `${L.prefix}-tab-${id}`;
const panelIdOf = (L: Layout, id: string) => `${L.prefix}-panel-${id}`;

interface Driver {
  tabs: HTMLButtonElement[];
  panels: HTMLElement[];
  list: HTMLElement;
  onSelect: ReturnType<typeof vi.fn>;
  /** Code-driven select; undefined where the arm has no such entry point. */
  select?: (id: string, focus?: FocusOptions | false) => boolean;
  /** Code-driven set of the controlled value, with no onSelect (plain arms). */
  set?: (id: string) => void;
}

// ---------------------------------------------------------------------------------------------
// Arm "today"
// ---------------------------------------------------------------------------------------------
function mountToday(L: Layout, ids: string[], initial: string): Driver {
  const onSelect = vi.fn();
  if (L.name === "rail") {
    document.body.innerHTML = `
      <div class="yui-quick__cols">
        <div class="yui-rail">
          <div class="yui-tabs" role="tablist" aria-label="Settings area" aria-orientation="vertical">
            <p class="yui-tabs__group" role="presentation">Group</p>${ids.map((id) => tabButtonHtml(id, "", { selected: id === initial, tipKey: `tabs.${id}` })).join("")}
          </div>
        </div>
        <div class="yui-quick__body">${ids.map((id) => `${tabPanelOpenHtml(id, { hidden: id !== initial })}</div>`).join("")}</div>
      </div>`;
    const list = document.querySelector<HTMLElement>('[role="tablist"]')!;
    const tabs = [...list.querySelectorAll<HTMLButtonElement>(".yui-tab")];
    const panels = [...document.querySelectorAll<HTMLElement>(".yui-tabpanel")];
    const rail = createTabRail({ rail: list, buttons: tabs, panels, initial, onSelect });
    return { tabs, panels, list, onSelect, select: (id, focus) => rail.select(id, focus) };
  }
  const bodies = new Map<TabBody, string>();
  const threadTabs = createThreadsTabs({
    count: document.createElement("span"),
    onSwitch: (body) => onSelect(bodies.get(body)),
  });
  document.body.innerHTML = "";
  document.body.append(threadTabs.el);
  const panels = ids.map((id) => {
    const el = document.createElement("div");
    el.className = L.panelClass;
    const body = {
      el,
      list: el,
      head: () => ({ count: "", waiting: false }),
      hasSelection: () => false,
      focusList() {},
      focusRail() {},
      move() {},
      shown() {},
      dispose() {},
    } as TabBody;
    bodies.set(body, id);
    threadTabs.add(id as "threads", body);
    document.body.append(el);
    return el;
  });
  if (initial !== L.initial) threadTabs.select(initial as "threads");
  onSelect.mockClear();
  return {
    tabs: [...threadTabs.el.querySelectorAll<HTMLButtonElement>('[role="tab"]')],
    panels,
    list: threadTabs.el,
    onSelect,
    select: (id) => {
      threadTabs.select(id as "threads");
      return true;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Arms "plain" / "plain+aof": Base UI Tabs, no wrapper code. The host holds the controlled value.
// ---------------------------------------------------------------------------------------------
let setPlain: (id: string) => void = () => {};

function Frame({ children, tabs }: { children: React.ReactNode; tabs: React.ReactNode }) {
  return (
    <>
      {tabs}
      <div className="yui-quick__body">{children}</div>
    </>
  );
}

function PlainHost(p: {
  L: Layout;
  ids: string[];
  initial: string;
  aof: boolean;
  onSelect(id: string): void;
}) {
  const { L } = p;
  const [value, setValue] = useState(p.initial);
  setPlain = setValue;
  return (
    <Tabs.Root
      value={value}
      onValueChange={(v) => {
        setValue(v as string);
        p.onSelect(v as string);
      }}
      orientation={L.vertical ? "vertical" : "horizontal"}
      className={L.name === "rail" ? "yui-quick__cols" : "yui-threads"}
    >
      <Frame
        tabs={
          <div className="yui-rail">
            <Tabs.List className={L.listClass} aria-label="Settings area" activateOnFocus={p.aof}>
              {L.name === "rail" && (
                <p className="yui-tabs__group" role="presentation">
                  Group
                </p>
              )}
              {p.ids.map((id) => (
                <Tabs.Tab
                  key={id}
                  value={id}
                  id={tabIdOf(L, id)}
                  className={L.tabClass}
                  aria-label={L.label(id)}
                  data-tip={L.label(id)}
                >
                  {L.label(id)}
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </div>
        }
      >
        {p.ids.map((id) => (
          <Tabs.Panel
            key={id}
            value={id}
            keepMounted
            id={panelIdOf(L, id)}
            className={L.panelClass}
          >
            {id}
          </Tabs.Panel>
        ))}
      </Frame>
    </Tabs.Root>
  );
}

// ---------------------------------------------------------------------------------------------
// Arm "wrapped": the smallest wrapper that closes the gaps measured below.
// Everything between WRAP-BEGIN and WRAP-END is the wrapper's cost; lines marked RECLICK are the
// optional part that makes a click on the current tab report again, as today's rail does.
// ---------------------------------------------------------------------------------------------
// WRAP-BEGIN
type Ids = { prefix: string; value: string };
type TabProps = ComponentProps<typeof Tabs.Tab> & Ids & { onSelect(id: string): void }; // RECLICK (onSelect)
function Tab({ prefix, value, onSelect, ...p }: TabProps) {
  const again = (e: React.MouseEvent) =>
    e.currentTarget.getAttribute("aria-selected") === "true" && onSelect(value); // RECLICK
  return (
    <Tabs.Tab
      value={value}
      id={`${prefix}-tab-${value}`}
      aria-controls={`${prefix}-panel-${value}`}
      onClick={again} // RECLICK
      {...p}
    />
  );
}
function Panel({ prefix, value, ...p }: ComponentProps<typeof Tabs.Panel> & Ids) {
  return <Tabs.Panel value={value} keepMounted id={`${prefix}-panel-${value}`} {...p} />;
}
function useTabsState(
  ids: string[],
  initial: string,
  prefix: string,
  onSelect: (id: string) => void,
) {
  const [value, setValue] = useState(initial);
  const change = (id: string) => {
    setValue(id);
    onSelect(id);
  };
  const select = (id: string, focus: FocusOptions | false = false) => {
    if (!ids.includes(id)) return false;
    flushSync(() => setValue(id)); // so the focus below finds the tab selected and activateOnFocus stays quiet
    onSelect(id);
    if (focus) document.getElementById(`${prefix}-tab-${id}`)?.focus(focus);
    return true;
  };
  return { value, change, select };
}
// WRAP-END

let wrappedSelect: (id: string, focus?: FocusOptions | false) => boolean = () => false;

function WrappedHost(p: { L: Layout; ids: string[]; initial: string; onSelect(id: string): void }) {
  const { L } = p;
  const state = useTabsState(p.ids, p.initial, L.prefix, p.onSelect);
  wrappedSelect = state.select;
  return (
    <Tabs.Root
      value={state.value}
      onValueChange={(v) => state.change(v as string)}
      orientation={L.vertical ? "vertical" : "horizontal"}
      className={L.name === "rail" ? "yui-quick__cols" : "yui-threads"}
    >
      <Frame
        tabs={
          <div className="yui-rail">
            <Tabs.List className={L.listClass} aria-label="Settings area" activateOnFocus>
              {L.name === "rail" && (
                <p className="yui-tabs__group" role="presentation">
                  Group
                </p>
              )}
              {p.ids.map((id) => (
                <Tab
                  key={id}
                  prefix={L.prefix}
                  value={id}
                  onSelect={p.onSelect}
                  className={L.tabClass}
                  aria-label={L.label(id)}
                  data-tip={L.label(id)}
                >
                  {L.label(id)}
                </Tab>
              ))}
            </Tabs.List>
          </div>
        }
      >
        {p.ids.map((id) => (
          <Panel key={id} prefix={L.prefix} value={id} className={L.panelClass}>
            {id}
          </Panel>
        ))}
      </Frame>
    </Tabs.Root>
  );
}

function mountBase(arm: Exclude<Arm, "today">, L: Layout, ids: string[], initial: string): Driver {
  const onSelect = vi.fn();
  const container = document.body.appendChild(document.createElement("div"));
  render(
    arm === "wrapped" ? (
      <WrappedHost L={L} ids={ids} initial={initial} onSelect={onSelect} />
    ) : (
      <PlainHost L={L} ids={ids} initial={initial} aof={arm === "plain+aof"} onSelect={onSelect} />
    ),
    { container },
  );
  const q = <T extends HTMLElement>(sel: string) => [...container.querySelectorAll<T>(sel)];
  return {
    tabs: q<HTMLButtonElement>('[role="tab"]'),
    panels: q('[role="tabpanel"]'),
    list: container.querySelector<HTMLElement>('[role="tablist"]')!,
    onSelect,
    ...(arm === "wrapped"
      ? {
          select: (id, focus) => {
            let hit = false;
            act(() => {
              hit = wrappedSelect(id, focus);
            });
            return hit;
          },
        }
      : { set: (id) => act(() => setPlain(id)) }),
  };
}

function mount(arm: Arm, L: Layout, o: { ids?: string[]; initial?: string } = {}): Driver {
  const ids = o.ids ?? L.ids;
  const initial = o.initial ?? L.initial;
  return arm === "today" ? mountToday(L, ids, initial) : mountBase(arm, L, ids, initial);
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------
async function press(el: Element, key: string) {
  await act(async () => {
    fireEvent.keyDown(el, { key });
  });
}
const click = (el: HTMLElement) => act(() => el.click());
const selectedId = (d: Driver) =>
  d.tabs.find((b) => b.getAttribute("aria-selected") === "true")?.id ?? null;
const shortOf = (L: Layout, id: string | null) => (id ? id.slice(tabIdOf(L, "").length) : null);
const visiblePanels = (d: Driver) => d.panels.filter((p) => !p.hidden);
const stops = (d: Driver) => d.tabs.map((b) => b.tabIndex);

beforeAll(() => setLocale("en"));
afterEach(() => {
  act(() => cleanup());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const arms: Arm[] = ["today", "plain", "plain+aof", "wrapped"];
const layouts = [RAIL, BAR];

describe.each(layouts)("Tabs parity, $name layout", (L) => {
  describe.each(arms)("%s", (arm) => {
    const idx = (id: string) => L.ids.indexOf(id);

    // ---- roles and names ----------------------------------------------------------------------
    it("R1 roles: a named tablist, tabs with aria-selected, panels labelled by their tab", () => {
      const d = mount(arm, L);
      expect(d.list.getAttribute("role")).toBe("tablist");
      expect(d.tabs.map((b) => b.getAttribute("role"))).toEqual(L.ids.map(() => "tab"));
      expect(d.tabs.map((b) => b.getAttribute("aria-selected"))).toEqual(
        L.ids.map((id) => String(id === L.initial)),
      );
      expect(d.panels.map((p) => p.getAttribute("role"))).toEqual(L.ids.map(() => "tabpanel"));
      expect(d.panels.map((p) => p.getAttribute("aria-labelledby"))).toEqual(
        L.ids.map((id) => tabIdOf(L, id)),
      );
      // rail: aria-orientation=vertical; bar: none (horizontal is the tablist default)
      expect(d.list.getAttribute("aria-orientation")).toBe(L.vertical ? "vertical" : null);
    });

    it("R2 ids: tab and panel keep the yui-* ids and aria-controls points at the panel (settings-search and ~10 selectors rely on it)", () => {
      const d = mount(arm, L);
      expect(d.tabs.map((b) => b.id)).toEqual(L.ids.map((id) => tabIdOf(L, id)));
      expect(d.panels.map((p) => p.id)).toEqual(L.ids.map((id) => panelIdOf(L, id)));
      const controls = d.tabs.map((b) => b.getAttribute("aria-controls"));
      if (arm === "plain" || arm === "plain+aof") {
        // WRAP: Panel's own generated id is what Tab's aria-controls reports; an `id` prop on Panel only changes the DOM id
        // (TabsPanel.mjs:42 registers the generated id; :65-74 lets elementProps override only the attribute).
        expect(controls.every((c) => c?.startsWith("base-ui-"))).toBe(true);
        expect(controls).not.toEqual(d.panels.map((p) => p.id));
      } else {
        expect(controls).toEqual(L.ids.map((id) => panelIdOf(L, id)));
      }
    });

    it("R3 names: each tab is findable by its label; the tablist by its aria-label", () => {
      const d = mount(arm, L);
      const names = d.tabs.map((b) => b.getAttribute("aria-label") ?? b.textContent);
      expect(names).toEqual(L.ids.map((id) => L.label(id)));
      if (L.name === "rail") expect(d.list.getAttribute("aria-label")).toBe("Settings area");
    });

    // ---- roving tabindex and selection at mount -----------------------------------------------
    it("T1 mount: the selected tab is the only tab stop", () => {
      const d = mount(arm, L);
      expect(stops(d)).toEqual(L.ids.map((id) => (id === L.initial ? 0 : -1)));
    });

    it("T2 mount on a later tab: the tab stop starts on it", () => {
      const initial = L.ids.at(-1)!;
      const d = mount(arm, L, { initial });
      expect(stops(d)).toEqual(L.ids.map((id) => (id === initial ? 0 : -1)));
      expect(shortOf(L, selectedId(d))).toBe(initial);
    });

    // ---- panels --------------------------------------------------------------------------------
    it("P1 every panel stays mounted; exactly the selected one is not hidden, after each click", () => {
      const d = mount(arm, L);
      for (const id of L.ids) {
        click(d.tabs[idx(id)]!);
        expect(d.panels).toHaveLength(L.ids.length);
        expect(visiblePanels(d).map((p) => p.id)).toEqual([panelIdOf(L, id)]);
        expect(d.panels.filter((p) => p.hasAttribute("hidden"))).toHaveLength(L.ids.length - 1);
      }
    });

    it("P2 a hidden panel: today leaves tabindex 0 and no inert; Base UI sets tabindex -1 and inert (ACCEPTED: nothing queries either)", () => {
      const d = mount(arm, L);
      const hiddenPanel = d.panels.find((p) => p.hidden)!;
      if (L.name === "bar" && arm === "today") return; // the Threads panes are the view's own elements: no tabindex, no inert
      expect(hiddenPanel.getAttribute("tabindex")).toBe(arm === "today" ? "0" : "-1");
      expect(hiddenPanel.hasAttribute("inert")).toBe(arm !== "today");
      const shown = d.panels.find((p) => !p.hidden)!;
      expect(shown.hasAttribute("inert")).toBe(false);
      expect(shown.getAttribute("tabindex")).toBe(arm === "today" && L.name === "bar" ? null : "0");
    });

    // ---- click ---------------------------------------------------------------------------------
    it("K1 click another tab: it is selected, its panel shows, onSelect reports its id once", () => {
      const d = mount(arm, L);
      const target = L.ids.find((id) => id !== L.initial)!;
      click(d.tabs[idx(target)]!);
      expect(shortOf(L, selectedId(d))).toBe(target);
      expect(visiblePanels(d).map((p) => p.id)).toEqual([panelIdOf(L, target)]);
      expect(stops(d)).toEqual(L.ids.map((id) => (id === target ? 0 : -1)));
      expect(d.onSelect.mock.calls).toEqual([[target]]);
    });

    it("K2 click the current tab: today reports it again (conn's entered() re-runs); Base UI does not (ACCEPTED default; RECLICK lines restore it)", () => {
      const d = mount(arm, L);
      click(d.tabs[idx(L.initial)]!);
      const reported = arm === "today" || arm === "wrapped";
      expect(d.onSelect).toHaveBeenCalledTimes(reported ? 1 : 0);
      expect(shortOf(L, selectedId(d))).toBe(L.initial);
    });

    // ---- keyboard ------------------------------------------------------------------------------
    // [selected, focused] after one key from `start`, for today / plain / plain+aof(=wrapped).
    type Row = [
      start: string,
      key: string,
      today: [string, string],
      plain: [string, string],
      aof: [string, string],
    ];
    const rail: Row[] = [
      ["persona", "ArrowDown", ["body", "body"], ["persona", "body"], ["body", "body"]],
      ["persona", "ArrowUp", ["voice", "voice"], ["persona", "voice"], ["voice", "voice"]],
      ["persona", "ArrowRight", ["body", "body"], ["persona", "persona"], ["persona", "persona"]], // ACCEPTED: vertical list ignores Left/Right (useCompositeRoot.mjs:135-136,173-174)
      ["persona", "ArrowLeft", ["voice", "voice"], ["persona", "persona"], ["persona", "persona"]], // ACCEPTED, same
      ["persona", "Home", ["conn", "conn"], ["persona", "conn"], ["conn", "conn"]],
      ["persona", "End", ["body", "body"], ["persona", "body"], ["body", "body"]],
      ["body", "ArrowDown", ["conn", "conn"], ["body", "conn"], ["conn", "conn"]], // wrap: loopFocus defaults true (TabsList.mjs:23, composite :183-187)
      ["conn", "ArrowUp", ["body", "body"], ["conn", "body"], ["body", "body"]],
    ];
    const bar: Row[] = [
      [
        "threads",
        "ArrowRight",
        ["terminal", "terminal"],
        ["threads", "terminal"],
        ["terminal", "terminal"],
      ],
      [
        "threads",
        "ArrowLeft",
        ["terminal", "terminal"],
        ["threads", "terminal"],
        ["terminal", "terminal"],
      ], // two tabs: wrap
      [
        "threads",
        "ArrowDown",
        ["threads", "threads"],
        ["threads", "threads"],
        ["threads", "threads"],
      ], // horizontal ignores Up/Down, as today
      [
        "threads",
        "ArrowUp",
        ["threads", "threads"],
        ["threads", "threads"],
        ["threads", "threads"],
      ],
      [
        "terminal",
        "Home",
        ["terminal", "terminal"],
        ["terminal", "threads"],
        ["threads", "threads"],
      ], // ACCEPTED: Home/End are new on the bar (today ignores them)
      ["threads", "End", ["threads", "threads"], ["threads", "terminal"], ["terminal", "terminal"]], // ACCEPTED, same
    ];
    it.each(
      L.name === "rail" ? rail : bar,
    )("G1 key from %s: %s -> [selected, focused] per arm", async (start, key, today, plain, aof) => {
      const d = mount(arm, L, { initial: start });
      d.tabs[idx(start)]!.focus();
      await press(d.tabs[idx(start)]!, key);
      const want = arm === "today" ? today : arm === "plain" ? plain : aof;
      const focused = shortOf(L, document.activeElement?.id ?? null);
      expect([shortOf(L, selectedId(d)), focused]).toEqual(want);
      // the roving tab stop follows focus in every arm
      expect(stops(d)).toEqual(L.ids.map((id) => (id === want[1] ? 0 : -1)));
    });

    it("G2 a key that moves focus without selecting (plain): Enter/click on the focused tab then selects; today and aof never reach that state", async () => {
      if (arm !== "plain") return;
      const d = mount(arm, L);
      const next = L.ids[(idx(L.initial) + 1) % L.ids.length]!;
      d.tabs[idx(L.initial)]!.focus();
      await press(d.tabs[idx(L.initial)]!, L.vertical ? "ArrowDown" : "ArrowRight");
      expect(d.onSelect).not.toHaveBeenCalled();
      click(d.tabs[idx(next)]!); // a browser clicks a button on Enter and Space
      expect(d.onSelect.mock.calls).toEqual([[next]]);
    });

    it("G3 onSelect fires once per arrow where the key selects", async () => {
      if (arm === "plain") return;
      const d = mount(arm, L);
      d.tabs[idx(L.initial)]!.focus();
      await press(d.tabs[idx(L.initial)]!, L.vertical ? "ArrowDown" : "ArrowRight");
      expect(d.onSelect).toHaveBeenCalledTimes(1);
    });

    // ---- code-driven select --------------------------------------------------------------------
    it("S1 select(id) from code: selects, swaps the panel, moves the tab stop, reports once (plain: sets the value only, no report: WRAP)", () => {
      const d = mount(arm, L);
      const target = L.ids.find((id) => id !== L.initial)!;
      if (d.select) {
        expect(d.select(target)).toBe(true);
        expect(d.onSelect.mock.calls).toEqual([[target]]);
      } else {
        d.set!(target);
        expect(d.onSelect).not.toHaveBeenCalled(); // WRAP: a controlled value set from code is not a change event
      }
      expect(shortOf(L, selectedId(d))).toBe(target);
      expect(visiblePanels(d).map((p) => p.id)).toEqual([panelIdOf(L, target)]);
      expect(stops(d)).toEqual(L.ids.map((id) => (id === target ? 0 : -1))); // the tab stop follows when focus is outside the list
    });

    it("S2 select(unknown id) is ignored and returns false (rail only; the bar's select is typed to its two tabs; plain has no entry point: WRAP)", () => {
      if (L.name === "bar") return;
      const d = mount(arm, L);
      if (!d.select) return;
      expect(d.select("hist")).toBe(false);
      expect(d.onSelect).not.toHaveBeenCalled();
      expect(shortOf(L, selectedId(d))).toBe(L.initial);
    });

    it("S3 select(id, { focusVisible: false }) focuses that tab with those options (rail only: the bar's select never focuses; plain has none: WRAP)", () => {
      if (L.name === "bar") return;
      const d = mount(arm, L);
      if (!d.select) return;
      const focus = vi.spyOn(HTMLElement.prototype, "focus");
      d.select("conn", { focusVisible: false });
      expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });
      expect(focus.mock.contexts.at(-1)).toBe(d.tabs[0]);
      expect(document.activeElement).toBe(d.tabs[0]);
      expect(d.onSelect.mock.calls).toEqual([["conn"]]); // once, not twice: focus must not re-activate
    });

    it("S4 select(current id) from code reports again (today does; Base UI would not; the wrapper reports explicitly)", () => {
      const d = mount(arm, L);
      if (!d.select) return;
      expect(d.select(L.initial)).toBe(true);
      expect(d.onSelect.mock.calls).toEqual([[L.initial]]);
    });

    it("S5 select(id) from code while focus sits on another tab: today moves the tab stop to it; Base UI leaves it on the focused tab (ACCEPTED: TabsTab.mjs:93-98)", async () => {
      if (L.name === "bar") return; // two tabs: the arrow lands on the other one
      const d = mount(arm, L);
      d.tabs[2]!.focus();
      await press(d.tabs[2]!, "ArrowDown"); // focus now on "body", the last tab
      if (d.select) d.select("conn");
      else d.set!("conn");
      expect(shortOf(L, selectedId(d))).toBe("conn");
      expect(L.ids[stops(d).indexOf(0)]).toBe(arm === "today" ? "conn" : "body");
    });

    // ---- absent tabs ----------------------------------------------------------------------------
    it("H1 a page absent at mount (Plugins/History): no tab, no panel; End and wrap skip over nothing", async () => {
      if (L.name === "bar") return;
      const ids = ["conn", "persona", "body"]; // voice absent
      const d = mount(arm, L, { ids, initial: "persona" });
      expect(d.tabs.map((b) => b.id)).toEqual(ids.map((id) => tabIdOf(L, id)));
      expect(d.panels).toHaveLength(3);
      expect(d.select ? d.select("voice") : false).toBe(false);
      d.tabs[1]!.focus();
      await press(d.tabs[1]!, "End");
      expect(document.activeElement?.id).toBe(tabIdOf(L, "body"));
      expect(d.tabs.map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
    });

    // ---- group headings in the tablist ----------------------------------------------------------
    it("H2 rail: the group headings are role=presentation children of the tablist, never tabs, and Home/End skip them", async () => {
      if (L.name === "bar") return;
      const d = mount(arm, L);
      expect(
        [...d.list.querySelectorAll(':scope > :not([role="tab"])')].map((e) =>
          e.getAttribute("role"),
        ),
      ).toEqual(["presentation"]);
      d.tabs[2]!.focus();
      await press(d.tabs[2]!, "Home");
      expect(document.activeElement).toBe(d.tabs[0]);
    });

    // ---- DOM shape callers and CSS see -----------------------------------------------------------
    it("D1 tab markup: a <button type=button> with the caller's class, data-tip and aria-label; the attributes Base UI adds", () => {
      const d = mount(arm, L);
      const tab = d.tabs[idx(L.initial)]!;
      expect(tab.tagName).toBe("BUTTON");
      expect(tab.getAttribute("type")).toBe("button");
      expect(tab.className).toBe(L.tabClass);
      if (L.name === "rail")
        expect(tab.dataset.tip).toBe(
          arm === "today" ? tab.getAttribute("aria-label") : L.label(L.initial),
        );
      const attrs = [...tab.attributes].map((a) => a.name).sort();
      const common = ["aria-controls", "aria-selected", "class", "id", "role", "tabindex", "type"];
      if (arm === "today") {
        // rail: + data-tip, aria-label; bar: + data-tab, no aria-label
        expect(attrs).toEqual(
          L.name === "rail"
            ? [...common, "aria-label", "data-tip"].sort()
            : [...common, "data-tab"].sort(),
        );
      } else {
        // Base UI adds data-active (selected tab) and data-activation-direction on every tab
        expect(attrs).toEqual(
          [
            ...common,
            "aria-label",
            "data-tip",
            "aria-disabled",
            "data-active",
            "data-activation-direction",
            "data-composite-item-active",
            "data-orientation",
          ].sort(),
        );
        expect(tab.getAttribute("data-active")).toBe("");
        expect(tab.getAttribute("data-orientation")).toBe(L.vertical ? "vertical" : "horizontal");
      }
    });

    it("D2 the list and the Root: the list is a <div>; Base UI adds a Root <div> that must wrap both list and panels (they may sit in different subtrees)", () => {
      const d = mount(arm, L);
      expect(d.list.tagName).toBe("DIV");
      expect(d.list.className).toBe(L.listClass);
      const root = d.list.closest(
        "[data-orientation].yui-quick__cols, [data-orientation].yui-threads",
      );
      if (arm === "today") expect(root).toBeNull();
      else {
        expect(root).not.toBeNull();
        expect(root!.contains(d.panels[0]!)).toBe(true); // panel and list share the Root through context, not a parent
        expect(d.list.parentElement!.contains(d.panels[0]!)).toBe(false);
      }
    });

    // ---- settings search reads the rail and panels ----------------------------------------------
    it("X1 settings-search: .yui-tab nodes get a foreign count span and .is-dim, the panel is found by aria-controls, closest('[hidden]') names the hidden panel", () => {
      if (L.name === "bar") return;
      const d = mount(arm, L);
      const tab = d.tabs[0]!;
      tab.insertAdjacentHTML("beforeend", `<span class="yui-tab__count" hidden></span>`);
      tab.classList.add("is-dim");
      const panel = document.getElementById(tab.getAttribute("aria-controls")!);
      if (arm === "plain" || arm === "plain+aof") {
        expect(panel?.id).not.toBe(panelIdOf(L, "conn")); // WRAP: aria-controls does not reach the yui-panel-* element
      } else {
        expect(panel?.id).toBe(panelIdOf(L, "conn"));
        expect(panel!.closest("[hidden]:not([data-search-view])")).toBe(panel); // conn is not the selected tab: it is hidden
      }
      // a re-render (selecting another tab) must not wipe what the search script added to a React-owned button
      click(d.tabs[1]!);
      expect(tab.querySelector(".yui-tab__count")).not.toBeNull();
      expect(tab.classList.contains("is-dim")).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Extra measurements that are not per-arm
// ---------------------------------------------------------------------------------------------
describe("Base UI Tabs defaults", () => {
  it("E1 without keepMounted a closed panel is not in the DOM (TabsPanel.mjs:31,95-98); keepMounted is a prop, no wrapper", () => {
    const container = document.body.appendChild(document.createElement("div"));
    render(
      <Tabs.Root defaultValue="a">
        <Tabs.List>
          <Tabs.Tab value="a">A</Tabs.Tab>
          <Tabs.Tab value="b">B</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="a">a</Tabs.Panel>
        <Tabs.Panel value="b">b</Tabs.Panel>
      </Tabs.Root>,
      { container },
    );
    expect(container.querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
  });

  it("E2 hidden lands in the same act as aria-selected (search reads [hidden] at query time)", () => {
    const d = mount("plain", RAIL);
    click(d.tabs[0]!);
    expect(d.tabs[0]!.getAttribute("aria-selected")).toBe("true");
    expect(d.panels[0]!.hasAttribute("hidden")).toBe(false);
    expect(d.panels[2]!.hasAttribute("hidden")).toBe(true);
  });

  it("E3 a controlled value naming no rendered tab selects nothing and shows no panel (a caller must not set one)", () => {
    const d = mount("plain", RAIL);
    d.set!("hist");
    expect(selectedId(d)).toBeNull();
    expect(visiblePanels(d)).toEqual([]);
    expect(stops(d).filter((s) => s === 0)).toHaveLength(1); // a tab stop survives
  });

  it("W1 wrapper size: lines between WRAP-BEGIN and WRAP-END (code only, blanks and pure comments excluded)", () => {
    const src = readFileSync(__filename, "utf-8").split("\n");
    const begin = src.findIndex((l) => l.trim() === "// WRAP-BEGIN");
    const end = src.findIndex((l) => l.trim() === "// WRAP-END");
    const code = src
      .slice(begin + 1, end)
      .filter((l) => l.trim() !== "" && !l.trim().startsWith("//"));
    const reclick = code.filter((l) => l.includes("RECLICK"));
    // 38 code lines; RECLICK marks 3 of the 4 lines that restore re-click reporting (the `again` const spans two lines)
    expect([code.length, reclick.length]).toEqual([38, 3]);
  });
});
