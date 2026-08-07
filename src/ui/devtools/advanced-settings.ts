import type { ContextSettings, createContextSettings } from "../../io/context-settings";
import type { createEndpointsSettings } from "../../io/endpoints-settings";
import type { ClampedIntSettingsStore } from "../../io/persisted-store";
import { t } from "../i18n";

type ContextStore = ReturnType<typeof createContextSettings>;
type EndpointsStore = ReturnType<typeof createEndpointsSettings>;

const TOGGLES: Array<{
  key: keyof ContextSettings;
  labelKey: string;
  subKey: string;
}> = [
  {
    key: "send_recent_apps",
    labelKey: "devtools.advanced.recent_apps_label",
    subKey: "devtools.advanced.recent_apps_sub",
  },
  {
    key: "send_active_app",
    labelKey: "devtools.advanced.active_app_label",
    subKey: "devtools.advanced.active_app_sub",
  },
  {
    key: "send_window_title",
    labelKey: "devtools.advanced.window_title_label",
    subKey: "devtools.advanced.window_title_sub",
  },
  {
    key: "send_posture",
    labelKey: "devtools.advanced.posture_label",
    subKey: "devtools.advanced.posture_sub",
  },
];

export function createAdvancedSettings(
  mount: HTMLElement,
  deps: {
    context: ContextStore;
    recentApps: ClampedIntSettingsStore;
    endpoints: EndpointsStore;
    defaultContextWindow?: number;
  },
): { dispose(): void } {
  mount.classList.add("devtools-advanced");
  const heading = document.createElement("h2");
  heading.className = "devtools-section-title";
  heading.textContent = t("devtools.advanced.context_signals");
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
    const label = t(toggle.labelKey);
    row.querySelector(".yui-row__label")!.textContent = label;
    row.querySelector(".yui-row__sub")!.textContent = t(toggle.subKey);
    const button = row.querySelector<HTMLButtonElement>(".yui-switch")!;
    button.setAttribute("aria-label", label);
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
  limitsHeading.textContent = t("devtools.advanced.limits");
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
    t("devtools.advanced.recent_apps_cap_label"),
    t("devtools.advanced.recent_apps_cap_sub"),
    "devtools-recent-apps-cap",
  );
  recentApps.max = String(deps.recentApps.ceil);
  recentApps.addEventListener("change", () => {
    deps.recentApps.set(Number(recentApps.value));
  });

  const contextWindow = numericRow(
    t("devtools.advanced.context_window_label"),
    t("devtools.advanced.context_window_sub"),
    "devtools-context-window",
  );
  contextWindow.placeholder =
    deps.defaultContextWindow?.toString() ?? t("devtools.advanced.context_window_default");
  contextWindow.addEventListener("input", () => {
    deps.endpoints.set({ chat_model_context_window: contextWindow.value });
  });

  function reflectContext(settings: ContextSettings): void {
    for (const [key, button] of switches) {
      button.setAttribute("aria-checked", String(settings[key]));
    }
  }
  function reflectRecent(): void {
    recentApps.value = String(deps.recentApps.get().value);
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
