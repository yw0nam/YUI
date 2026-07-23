import type { createContextHistory } from "../../io/context-history";
import type { createContextSettings } from "../../io/context-settings";
import type { createEndpointsSettings } from "../../io/endpoints-settings";
import type { createRecentAppsSettings } from "../../io/recent-apps-settings";
import { createAdvancedSettings } from "./advanced-settings";
import { createContextInspector } from "./context-inspector";

export type DevtoolsSection = "context" | "advanced" | "motion";

export interface DevtoolsShellOptions {
  mount: HTMLElement;
  history: ReturnType<typeof createContextHistory>;
  contextSettings: ReturnType<typeof createContextSettings>;
  recentAppsSettings: ReturnType<typeof createRecentAppsSettings>;
  endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  defaultContextWindow?: number;
  loadMotionPreview: (mount: HTMLElement) => Promise<void>;
}

const SECTIONS: Array<{ id: DevtoolsSection; label: string }> = [
  { id: "context", label: "Context Inspector" },
  { id: "advanced", label: "Advanced Settings" },
  { id: "motion", label: "Motion Preview" },
];

export function createDevtoolsShell(options: DevtoolsShellOptions): {
  activate(section: DevtoolsSection): void;
  dispose(): void;
} {
  options.mount.innerHTML = `
    <main class="devtools">
      <header class="devtools-header">Developer Tools</header>
      <div class="devtools-body">
        <nav class="devtools-nav" aria-label="Developer tools sections"></nav>
        <div class="devtools-content"></div>
      </div>
    </main>
  `;
  const nav = options.mount.querySelector<HTMLElement>(".devtools-nav")!;
  const content = options.mount.querySelector<HTMLElement>(".devtools-content")!;
  const panels = new Map<DevtoolsSection, HTMLElement>();
  let active: DevtoolsSection = "context";
  let motionLoaded = false;

  for (const section of SECTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "yui-tab devtools-nav__item";
    button.dataset.section = section.id;
    button.textContent = section.label;
    button.addEventListener("click", () => activate(section.id));
    nav.appendChild(button);

    const panel = document.createElement("section");
    panel.className = "devtools-panel";
    panel.dataset.panel = section.id;
    panel.hidden = section.id !== active;
    content.appendChild(panel);
    panels.set(section.id, panel);
  }

  const inspector = createContextInspector(panels.get("context")!, options.history);
  const advanced = createAdvancedSettings(panels.get("advanced")!, {
    context: options.contextSettings,
    recentApps: options.recentAppsSettings,
    endpoints: options.endpointsSettings,
    defaultContextWindow: options.defaultContextWindow,
  });

  function reflect(): void {
    for (const button of nav.querySelectorAll<HTMLButtonElement>(".devtools-nav__item")) {
      const selected = button.dataset.section === active;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-current", selected ? "page" : "false");
    }
    for (const [id, panel] of panels) panel.hidden = id !== active;
  }

  function activate(section: DevtoolsSection): void {
    active = section;
    reflect();
    if (section === "motion" && !motionLoaded) {
      motionLoaded = true;
      const panel = panels.get("motion")!;
      panel.innerHTML = '<div class="devtools-loading">Loading motion preview…</div>';
      void options.loadMotionPreview(panel);
    }
  }

  reflect();
  return {
    activate,
    dispose() {
      inspector.dispose();
      advanced.dispose();
      options.mount.replaceChildren();
    },
  };
}
