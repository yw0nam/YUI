// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
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
  beforeEach(() => setLocale("en"));

  it("binds context toggles and numeric settings to their existing stores", () => {
    const mount = document.createElement("section");
    const context = createContextSettings();
    const recentApps = inMemoryRecentAppsStore();
    const endpoints = createEndpointsSettings();
    createAdvancedSettings(mount, { context, recentApps, endpoints });

    mount.querySelector<HTMLButtonElement>('[aria-label="Window title"]')!.click();
    expect(context.get().send_window_title).toBe(false);

    const cap = mount.querySelector<HTMLInputElement>("#devtools-recent-apps-cap")!;
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
});
