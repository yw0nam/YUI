// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createContextSettings } from "../../io/context-settings";
import { createEndpointsSettings } from "../../io/endpoints-settings";
import { createRecentAppsSettings } from "../../io/recent-apps-settings";
import { createAdvancedSettings } from "./advanced-settings";

describe("Advanced Settings", () => {
  it("binds context toggles and numeric settings to their existing stores", () => {
    const mount = document.createElement("section");
    const context = createContextSettings();
    const recentApps = createRecentAppsSettings();
    const endpoints = createEndpointsSettings();
    createAdvancedSettings(mount, { context, recentApps, endpoints });

    mount.querySelector<HTMLButtonElement>('[aria-label="Window title"]')!.click();
    expect(context.get().send_window_title).toBe(false);

    const cap = mount.querySelector<HTMLInputElement>("#devtools-recent-apps-cap")!;
    cap.value = "14";
    cap.dispatchEvent(new Event("change"));
    expect(recentApps.get().recent_apps_max).toBe(14);

    const window = mount.querySelector<HTMLInputElement>("#devtools-context-window")!;
    window.value = "64000";
    window.dispatchEvent(new Event("input"));
    expect(endpoints.get().chat_model_context_window).toBe("64000");
  });
});
