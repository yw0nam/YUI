import type { createEndpointsSettings } from "../../io/endpoints-settings";
import { t } from "../i18n";
import { reflectUnlessEditing } from "../reflect-unless-editing";

type EndpointsStore = ReturnType<typeof createEndpointsSettings>;

export function createAdvancedSettings(
  mount: HTMLElement,
  deps: {
    endpoints: EndpointsStore;
    defaultContextWindow?: number;
  },
): { dispose(): void } {
  mount.classList.add("devtools-advanced");
  const heading = document.createElement("h2");
  heading.className = "devtools-section-title";
  heading.textContent = t("devtools.advanced.limits");
  mount.appendChild(heading);

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

  function reflectEndpoints(): void {
    reflectUnlessEditing(contextWindow, deps.endpoints.get().chat_model_context_window);
  }

  contextWindow.addEventListener("blur", reflectEndpoints);
  reflectEndpoints();
  const unsubscribers = [deps.endpoints.subscribe(reflectEndpoints)];
  return {
    dispose: () => {
      contextWindow.removeEventListener("blur", reflectEndpoints);
      for (const unsubscribe of unsubscribers) unsubscribe();
    },
  };
}
