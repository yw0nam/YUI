import type { ContextSettings, createContextSettings } from "../../io/context-settings";
import type { createEndpointsSettings } from "../../io/endpoints-settings";
import type { createRecentAppsSettings } from "../../io/recent-apps-settings";

type ContextStore = ReturnType<typeof createContextSettings>;
type RecentAppsStore = ReturnType<typeof createRecentAppsSettings>;
type EndpointsStore = ReturnType<typeof createEndpointsSettings>;

const TOGGLES: Array<{
  key: keyof ContextSettings;
  label: string;
  sub: string;
}> = [
  {
    key: "send_recent_apps",
    label: "Recent apps",
    sub: "Include buffered foreground app changes",
  },
  {
    key: "send_active_app",
    label: "Active app",
    sub: "Include the current foreground application",
  },
  {
    key: "send_window_title",
    label: "Window title",
    sub: "Include the active window title",
  },
  {
    key: "send_posture",
    label: "Posture",
    sub: "Include the character's current posture",
  },
];

export function createAdvancedSettings(
  mount: HTMLElement,
  deps: {
    context: ContextStore;
    recentApps: RecentAppsStore;
    endpoints: EndpointsStore;
    defaultContextWindow?: number;
  },
): { dispose(): void } {
  mount.classList.add("devtools-advanced");
  const heading = document.createElement("h2");
  heading.className = "devtools-section-title";
  heading.textContent = "Context signals";
  mount.appendChild(heading);

  const switches = new Map<keyof ContextSettings, HTMLButtonElement>();
  for (const toggle of TOGGLES) {
    const row = document.createElement("div");
    row.className = "yui-row";
    row.innerHTML = `
      <div class="yui-row__main">
        <span class="yui-row__label"></span>
        <span class="yui-row__sub"></span>
      </div>
      <button class="yui-switch" type="button" role="switch"></button>
    `;
    row.querySelector(".yui-row__label")!.textContent = toggle.label;
    row.querySelector(".yui-row__sub")!.textContent = toggle.sub;
    const button = row.querySelector<HTMLButtonElement>(".yui-switch")!;
    button.setAttribute("aria-label", toggle.label);
    button.addEventListener("click", () => {
      deps.context.set({ [toggle.key]: !deps.context.get()[toggle.key] });
    });
    switches.set(toggle.key, button);
    mount.appendChild(row);
  }

  const separator = document.createElement("div");
  separator.className = "devtools-separator";
  const limitsHeading = document.createElement("h2");
  limitsHeading.className = "devtools-section-title";
  limitsHeading.textContent = "Limits";
  mount.append(separator, limitsHeading);

  function numericRow(label: string, sub: string, id: string): HTMLInputElement {
    const row = document.createElement("div");
    row.className = "yui-row";
    row.innerHTML = `
      <div class="yui-row__main">
        <label class="yui-row__label"></label>
        <span class="yui-row__sub"></span>
      </div>
      <input class="devtools-number" type="number" min="1" inputmode="numeric" />
    `;
    const input = row.querySelector<HTMLInputElement>("input")!;
    input.id = id;
    row.querySelector<HTMLLabelElement>("label")!.htmlFor = id;
    row.querySelector("label")!.textContent = label;
    row.querySelector(".yui-row__sub")!.textContent = sub;
    mount.appendChild(row);
    return input;
  }

  const recentApps = numericRow(
    "Recent apps cap",
    "Maximum buffered app switches",
    "devtools-recent-apps-cap",
  );
  recentApps.max = "50";
  recentApps.addEventListener("change", () => {
    deps.recentApps.setRecentAppsMax(Number(recentApps.value));
  });

  const contextWindow = numericRow(
    "Context window (tokens)",
    "Empty uses the bundled endpoint configuration",
    "devtools-context-window",
  );
  contextWindow.placeholder = deps.defaultContextWindow?.toString() ?? "Default";
  contextWindow.addEventListener("input", () => {
    deps.endpoints.set({ chat_model_context_window: contextWindow.value });
  });

  function reflectContext(settings: ContextSettings): void {
    for (const [key, button] of switches) {
      button.setAttribute("aria-checked", String(settings[key]));
    }
  }
  function reflectRecent(): void {
    recentApps.value = String(deps.recentApps.get().recent_apps_max);
  }
  function reflectEndpoints(): void {
    contextWindow.value = deps.endpoints.get().chat_model_context_window;
  }

  reflectContext(deps.context.get());
  reflectRecent();
  reflectEndpoints();
  const unsubscribers = [
    deps.context.subscribe(reflectContext),
    deps.recentApps.subscribe(reflectRecent),
    deps.endpoints.subscribe(reflectEndpoints),
  ];
  return {
    dispose: () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    },
  };
}
