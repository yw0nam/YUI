import { Tabs } from "@base-ui/react/tabs";
import { type ComponentProps, type Ref, useImperativeHandle } from "react";

export interface TabsHandle {
  select(id: string, focus?: FocusOptions): boolean;
  focus(id: string, opts?: FocusOptions): void;
  selected(): string;
}

interface TabsState {
  value: string;
  select(id: string): boolean;
}

export function useTabs(o: {
  ids: readonly string[];
  initial: string;
  onSelect(id: string): void;
  handle: Ref<TabsHandle>;
}): TabsState {
  useImperativeHandle(o.handle, () => ({
    select: () => true,
    focus() {},
    selected: () => o.initial,
  }));
  return { value: o.initial, select: () => true };
}

export function TabsRoot({
  tabs,
  ...props
}: Omit<ComponentProps<typeof Tabs.Root>, "value" | "defaultValue" | "onValueChange"> & {
  tabs: TabsState;
}) {
  return <Tabs.Root value={tabs.value} {...props} />;
}

export function Tab(props: ComponentProps<typeof Tabs.Tab>) {
  return <Tabs.Tab {...props} />;
}

export function TabPanel(props: ComponentProps<typeof Tabs.Panel>) {
  return <Tabs.Panel keepMounted {...props} />;
}
