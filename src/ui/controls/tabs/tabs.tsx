/**
 * Tabs on Base UI's Tabs: tab `yui-tab-<id>` controls panel `yui-panel-<id>`, every panel stays
 * mounted, and a handle selects a tab from code. The caller renders `Tabs.List` and owns the state
 * through `useTabs`, so a selection re-renders everything the caller renders.
 */

import { Tabs } from "@base-ui/react/tabs";
import {
  type ComponentProps,
  createContext,
  type Ref,
  useContext,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

export interface TabsHandle {
  /** Selects a known tab and reports it, the selected one included; with options, focuses it. False for an unknown id. */
  select(id: string, focus?: FocusOptions): boolean;
  /** Focuses a tab without reporting it. */
  focus(id: string, opts?: FocusOptions): void;
  /** The selected tab's id. */
  selected(): string;
}

interface TabsState {
  value: string;
  select(id: string): boolean;
}

const Selected = createContext("");

const tabOf = (id: string): HTMLElement | null => document.getElementById(`yui-tab-${id}`);

export function useTabs(o: {
  ids: readonly string[];
  initial: string;
  /** Every selection, whatever drove it: a click, a key or the handle. */
  onSelect(id: string): void;
  handle: Ref<TabsHandle>;
}): TabsState {
  const [value, setValue] = useState(o.initial);
  const current = useRef(o.initial);

  const select = (id: string, focus?: FocusOptions): boolean => {
    if (!o.ids.includes(id)) return false;
    current.current = id;
    // Committed first, so the focus below lands on a selected tab and activateOnFocus stays quiet.
    flushSync(() => setValue(id));
    if (focus) tabOf(id)?.focus(focus);
    o.onSelect(id);
    return true;
  };

  useImperativeHandle(o.handle, () => ({
    select,
    focus: (id, opts) => tabOf(id)?.focus(opts),
    selected: () => current.current,
  }));

  return { value, select };
}

export function TabsRoot({
  tabs,
  ...props
}: Omit<ComponentProps<typeof Tabs.Root>, "value" | "defaultValue" | "onValueChange"> & {
  tabs: TabsState;
}) {
  return (
    <Selected.Provider value={tabs.value}>
      <Tabs.Root value={tabs.value} onValueChange={(id: string) => tabs.select(id)} {...props} />
    </Selected.Provider>
  );
}

export function Tab({ value, ...props }: ComponentProps<typeof Tabs.Tab> & { value: string }) {
  return (
    <Tabs.Tab
      value={value}
      id={`yui-tab-${value}`}
      aria-controls={`yui-panel-${value}`}
      {...props}
    />
  );
}

export function TabPanel({
  value,
  ...props
}: ComponentProps<typeof Tabs.Panel> & { value: string }) {
  const selected = useContext(Selected);
  // Base UI hides a closing panel only after its fade ends; the hide lands with the selection instead.
  return (
    <Tabs.Panel
      value={value}
      keepMounted
      id={`yui-panel-${value}`}
      hidden={selected !== value}
      {...props}
    />
  );
}
