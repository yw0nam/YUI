// @vitest-environment jsdom

/**
 * settings-stores.test.ts — localStorage-backed settings store factory.
 *
 * Pins createSettingsStores' complete store bag and reactive store interface.
 */

import { describe, expect, it } from "vitest";
import { createSettingsStores } from "./settings-stores";

describe("createSettingsStores", () => {
  it("returns every settings store", () => {
    const stores = createSettingsStores();

    expect(Object.keys(stores)).toEqual([
      "screenshotSettings",
      "ttsSettings",
      "sttSettings",
      "idleThrottleSettings",
      "proactiveSettings",
      "scheduleSettings",
      "workflowSettings",
      "agentNotifySettings",
      "presenceSettings",
      "recentAppsSettings",
      "contextSettings",
      "contextHistory",
      "lipsyncSettings",
      "vadSettings",
      "agentSettings",
      "fillerSettings",
      "sessionStore",
      "sessionDiagnostics",
      "chatHistoryStore",
      "endpointsSettings",
      "chatKeySettings",
      "sttKeySettings",
      "ttsKeySettings",
      "cameraSettings",
      "gazeSettings",
      "hintSettings",
      "railCollapsedSettings",
    ]);
  });

  it("returns reactive stores", () => {
    const stores = createSettingsStores();

    for (const store of Object.values(stores)) {
      expect(typeof store.get).toBe("function");
    }
  });

  // bootstrap() registers teardown by iterating the returned bag, so every value must be disposable.
  it("returns disposable stores", () => {
    const stores = createSettingsStores();

    for (const [name, store] of Object.entries(stores)) {
      expect(typeof store.dispose, `${name}.dispose`).toBe("function");
    }
  });
});
