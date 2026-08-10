import type { createContextHistory } from "../../io/context-history";
import type { createEndpointsSettings } from "../../io/endpoints-settings";
import { t } from "../i18n";
import { createAdvancedSettings } from "./advanced-settings";
import { createContextInspector } from "./context-inspector";

export type DevtoolsSection = "context" | "advanced" | "motion";

interface DevtoolsShellOptions {
  mount: HTMLElement;
  history: ReturnType<typeof createContextHistory>;
  endpointsSettings: ReturnType<typeof createEndpointsSettings>;
  defaultContextWindow?: number;
  loadMotionPreview: (mount: HTMLElement) => Promise<{ dispose(): void }>;
}

const SECTIONS: Array<{ id: DevtoolsSection; labelKey: string }> = [
  { id: "context", labelKey: "devtools.nav.context" },
  { id: "advanced", labelKey: "devtools.nav.advanced" },
  { id: "motion", labelKey: "devtools.nav.motion" },
];

export function createDevtoolsShell(options: DevtoolsShellOptions): {
  readonly active: DevtoolsSection;
  /** Resolves once any motion-preview load triggered by this activation settles. */
  activate(section: DevtoolsSection): Promise<void>;
  dispose(): void;
} {
  options.mount.innerHTML = `
    <main class="devtools">
      <header class="devtools-header"></header>
      <div class="devtools-body">
        <nav class="devtools-nav"></nav>
        <div class="devtools-content"></div>
      </div>
    </main>
  `;
  options.mount.querySelector<HTMLElement>(".devtools-header")!.textContent = t("devtools.label");
  const nav = options.mount.querySelector<HTMLElement>(".devtools-nav")!;
  nav.setAttribute("aria-label", t("devtools.nav_aria"));
  const content = options.mount.querySelector<HTMLElement>(".devtools-content")!;
  const panels = new Map<DevtoolsSection, HTMLElement>();
  let active: DevtoolsSection = "context";
  let motionLoad: Promise<{ dispose(): void }> | null = null;

  for (const section of SECTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "yui-tab devtools-nav__item";
    button.dataset.section = section.id;
    button.textContent = t(section.labelKey);
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

  function activate(section: DevtoolsSection): Promise<void> {
    active = section;
    reflect();
    if (section === "motion" && !motionLoad) {
      const panel = panels.get("motion")!;
      const loading = document.createElement("div");
      loading.className = "devtools-loading";
      loading.textContent = t("devtools.loading_motion");
      panel.replaceChildren(loading);
      motionLoad = options.loadMotionPreview(panel);
      motionLoad.catch(() => {
        motionLoad = null;
        const error = document.createElement("div");
        error.className = "devtools-error";
        error.textContent = t("devtools.motion_load_failed");
        panel.replaceChildren(error);
      });
    }
    return section === "motion" && motionLoad
      ? motionLoad.then(
          () => undefined,
          () => undefined,
        )
      : Promise.resolve();
  }

  reflect();
  return {
    get active() {
      return active;
    },
    activate,
    dispose() {
      inspector.dispose();
      advanced.dispose();
      if (motionLoad)
        void motionLoad.then(
          (handle) => handle.dispose(),
          () => {},
        );
      options.mount.replaceChildren();
    },
  };
}
