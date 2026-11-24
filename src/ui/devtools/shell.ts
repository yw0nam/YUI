/** The Developer Tools window's facade: one React root over the window, and the section it shows. */

import { createElement, createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { createContextHistory } from "../../io/chat/conversation/context-history";
import type { createEndpointsSettings } from "../../settings/backend/endpoints-settings";
import type { TabsHandle } from "../controls/tabs";
import { type DevtoolsSection, DevtoolsWindow } from "./devtools-window";
import { createMotionLoad, type LoadMotionPreview } from "./motion-preview/motion-load";

interface DevtoolsShellOptions {
  mount: HTMLElement;
  history: ReturnType<typeof createContextHistory>;
  endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  defaultContextWindow?: number;
  /** Loads the motion preview into the Motion panel's view, on the panel's first activation. */
  loadMotionPreview: LoadMotionPreview;
}

export function createDevtoolsShell(options: DevtoolsShellOptions): {
  readonly active: DevtoolsSection;
  /** Resolves once any motion-preview load triggered by this activation settles. */
  activate(section: DevtoolsSection): Promise<void>;
  dispose(): void;
} {
  const tabs = createRef<TabsHandle>();
  const motion = createMotionLoad(options.loadMotionPreview);
  const root = createRoot(options.mount);
  flushSync(() =>
    root.render(
      createElement(DevtoolsWindow, {
        tabs,
        history: options.history,
        endpoints: options.endpointsSettings,
        defaultContextWindow: options.defaultContextWindow,
        motion,
      }),
    ),
  );

  return {
    get active() {
      return tabs.current!.selected() as DevtoolsSection;
    },
    activate(section) {
      flushSync(() => tabs.current!.select(section));
      return section === "motion" ? motion.begin() : Promise.resolve();
    },
    dispose() {
      motion.dispose();
      root.unmount();
    },
  };
}
