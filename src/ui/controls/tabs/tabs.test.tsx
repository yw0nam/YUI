// @vitest-environment jsdom
import { Tabs } from "@base-ui/react/tabs";
import { act, cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Tab, TabPanel, type TabsHandle, TabsRoot, useTabs } from "./tabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const IDS = ["conn", "voice", "hist"] as const;

function Rail(p: { handle: React.Ref<TabsHandle>; onSelect(id: string): void }) {
  const tabs = useTabs({ ids: IDS, initial: "conn", onSelect: p.onSelect, handle: p.handle });
  return (
    <TabsRoot tabs={tabs} orientation="vertical">
      <Tabs.List activateOnFocus>
        {IDS.map((id) => (
          <Tab key={id} value={id}>
            {id}
          </Tab>
        ))}
      </Tabs.List>
      {IDS.map((id) => (
        <TabPanel key={id} value={id}>
          {id}
        </TabPanel>
      ))}
    </TabsRoot>
  );
}

function mount() {
  const handle = createRef<TabsHandle>();
  const onSelect = vi.fn<(id: string) => void>();
  render(<Rail handle={handle} onSelect={onSelect} />, {
    container: document.body.appendChild(document.createElement("div")),
  });
  const tab = (id: string) =>
    [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (t) => t.textContent === id,
    )!;
  return { handle: handle.current!, onSelect, tab };
}

afterEach(() => {
  act(() => cleanup());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Tabs", () => {
  it("gives each tab and panel its yui id and points each at the other", () => {
    mount();
    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const panels = [...document.querySelectorAll('[role="tabpanel"]')];
    expect(tabs.map((t) => [t.id, t.getAttribute("aria-controls")])).toEqual([
      ["yui-tab-conn", "yui-panel-conn"],
      ["yui-tab-voice", "yui-panel-voice"],
      ["yui-tab-hist", "yui-panel-hist"],
    ]);
    expect(panels.map((p) => [p.id, p.getAttribute("aria-labelledby")])).toEqual([
      ["yui-panel-conn", "yui-tab-conn"],
      ["yui-panel-voice", "yui-tab-voice"],
      ["yui-panel-hist", "yui-tab-hist"],
    ]);
  });

  it("select reports each known id once, the selected one included, and refuses an unknown id", () => {
    const { handle, onSelect, tab } = mount();
    let results: boolean[] = [];
    act(() => {
      results = [handle.select("voice"), handle.select("voice"), handle.select("plugins")];
    });
    expect(results).toEqual([true, true, false]);
    expect(onSelect.mock.calls).toEqual([["voice"], ["voice"]]);
    expect(tab("voice").getAttribute("aria-selected")).toBe("true");
    expect(handle.selected()).toBe("voice");
  });

  it("select with focus options and focus both focus the tab; focus reports nothing", () => {
    const { handle, onSelect, tab } = mount();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    act(() => {
      handle.select("hist", { focusVisible: false });
    });
    expect(focus).toHaveBeenLastCalledWith({ focusVisible: false });
    expect(document.activeElement).toBe(tab("hist"));
    expect(onSelect.mock.calls).toEqual([["hist"]]);

    act(() => handle.focus("hist", { focusVisible: false }));
    expect(focus.mock.contexts.at(-1)).toBe(tab("hist"));
    expect(onSelect.mock.calls).toEqual([["hist"]]);
  });

  it("a click on the selected tab reports nothing", () => {
    const { onSelect, tab } = mount();
    act(() => tab("conn").click());
    act(() => tab("voice").click());
    act(() => tab("voice").click());
    expect(onSelect.mock.calls).toEqual([["voice"]]);
  });
});
