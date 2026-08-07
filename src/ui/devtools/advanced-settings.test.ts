// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createContextSettings } from "../../io/context-settings";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { createRecentAppsStore } from "../../io/settings-stores";
import { setLocale } from "../i18n";
import { createAdvancedSettings } from "./advanced-settings";

const inMemoryRecentAppsStore = () => {
  let value: { value: number } | null = null;
  return createRecentAppsStore({
    load: () => value,
    save: (next) => {
      value = next;
    },
  });
};

describe("Advanced Settings", () => {
  let attachedMount: HTMLElement | null = null;

  beforeEach(() => setLocale("en"));
  afterEach(() => {
    attachedMount?.remove();
    attachedMount = null;
    vi.restoreAllMocks();
  });

  it("binds context toggles and numeric settings to their existing stores", () => {
    const mount = document.createElement("section");
    const context = createContextSettings();
    const recentApps = inMemoryRecentAppsStore();
    const endpoints = createEndpointsSettings();
    createAdvancedSettings(mount, { context, recentApps, endpoints });

    mount.querySelector<HTMLButtonElement>('[aria-label="Window title"]')!.click();
    expect(context.get().send_window_title).toBe(false);

    const cap = mount.querySelector<HTMLInputElement>("#devtools-recent-apps-cap")!;
    // The advertised max is the bound the store actually clamps to, not a second copy of it.
    expect(cap.max).toBe("50");
    recentApps.set(Number(cap.max) + 1);
    expect(recentApps.get().value).toBe(10);

    cap.value = "14";
    cap.dispatchEvent(new Event("change"));
    expect(recentApps.get().value).toBe(14);

    const window = mount.querySelector<HTMLInputElement>("#devtools-context-window")!;
    window.value = "64000";
    window.dispatchEvent(new Event("input"));
    expect(endpoints.get().chat_model_context_window).toBe("64000");
  });

  it("renders localized headings, labels, sub-lines, and placeholders", () => {
    setLocale("ja");
    const mount = document.createElement("section");
    createAdvancedSettings(mount, {
      context: createContextSettings(),
      recentApps: inMemoryRecentAppsStore(),
      endpoints: createEndpointsSettings(),
    });

    expect(mount.textContent).toContain("コンテキスト信号");
    expect(mount.textContent).toContain("アクティブなウィンドウタイトルを含める");
    expect(mount.querySelector('[role="switch"]')?.getAttribute("aria-label")).toBe("最近のアプリ");
    expect(mount.querySelector<HTMLInputElement>("#devtools-context-window")?.placeholder).toBe(
      "デフォルト",
    );
  });

  it("keeps the context-window text while the input is focused", () => {
    attachedMount = document.createElement("section");
    document.body.appendChild(attachedMount);
    const endpoints = createEndpointsSettings();
    createAdvancedSettings(attachedMount, {
      context: createContextSettings(),
      recentApps: inMemoryRecentAppsStore(),
      endpoints,
    });
    const input = attachedMount.querySelector<HTMLInputElement>("#devtools-context-window")!;

    input.focus();
    input.value = "64000";
    endpoints.set({ chat_model_context_window: "128000" });

    expect(input.value).toBe("64000");
  });

  it("keeps the recent-apps text while the input is focused", () => {
    attachedMount = document.createElement("section");
    document.body.appendChild(attachedMount);
    const recentApps = inMemoryRecentAppsStore();
    createAdvancedSettings(attachedMount, {
      context: createContextSettings(),
      recentApps,
      endpoints: createEndpointsSettings(),
    });
    const input = attachedMount.querySelector<HTMLInputElement>("#devtools-recent-apps-cap")!;

    input.focus();
    input.value = "25";
    recentApps.set(30);

    expect(input.value).toBe("25");
  });

  it("keeps a committed recent-apps edit over a concurrent remote value", () => {
    attachedMount = document.createElement("section");
    document.body.appendChild(attachedMount);
    const recentApps = inMemoryRecentAppsStore();
    createAdvancedSettings(attachedMount, {
      context: createContextSettings(),
      recentApps,
      endpoints: createEndpointsSettings(),
    });
    const input = attachedMount.querySelector<HTMLInputElement>("#devtools-recent-apps-cap")!;

    input.focus();
    input.value = "25";
    recentApps.set(30);
    input.dispatchEvent(new Event("change"));
    input.blur();

    expect(input.value).toBe("25");
  });

  it("reflects the context-window value when the input blurs", () => {
    attachedMount = document.createElement("section");
    document.body.appendChild(attachedMount);
    const endpoints = createEndpointsSettings();
    createAdvancedSettings(attachedMount, {
      context: createContextSettings(),
      recentApps: inMemoryRecentAppsStore(),
      endpoints,
    });
    const input = attachedMount.querySelector<HTMLInputElement>("#devtools-context-window")!;

    input.focus();
    input.value = "64000";
    endpoints.set({ chat_model_context_window: "128000" });
    input.blur();

    expect(input.value).toBe("128000");
  });

  it("reflects an uncommitted recent-apps edit away when the input blurs", () => {
    attachedMount = document.createElement("section");
    document.body.appendChild(attachedMount);
    const recentApps = inMemoryRecentAppsStore();
    createAdvancedSettings(attachedMount, {
      context: createContextSettings(),
      recentApps,
      endpoints: createEndpointsSettings(),
    });
    const input = attachedMount.querySelector<HTMLInputElement>("#devtools-recent-apps-cap")!;

    input.focus();
    input.value = "25";
    recentApps.set(30);
    input.blur();

    expect(input.value).toBe("30");
  });

  it("reflects the context-window value while the document is unfocused", () => {
    attachedMount = document.createElement("section");
    document.body.appendChild(attachedMount);
    const endpoints = createEndpointsSettings();
    createAdvancedSettings(attachedMount, {
      context: createContextSettings(),
      recentApps: inMemoryRecentAppsStore(),
      endpoints,
    });
    const input = attachedMount.querySelector<HTMLInputElement>("#devtools-context-window")!;
    input.focus();
    vi.spyOn(document, "hasFocus").mockReturnValue(false);

    input.value = "64000";
    endpoints.set({ chat_model_context_window: "128000" });

    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("128000");
  });
});
