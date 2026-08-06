// @vitest-environment jsdom

/**
 * settings-stores.test.ts — localStorage-backed settings store factory.
 *
 * Pins createSettingsStores' complete store bag and reactive store interface.
 */

import { describe, expect, it } from "vitest";
import {
  broadcastSyncStores,
  createSettingsStores,
  reloadSyncStores,
  SYNC_MODE,
} from "./settings-stores";

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

  // Totality is already a compile error via Record<keyof SettingsStores, SyncMode>; this pins the
  // table to the bag's order so the two stay readable side by side.
  it("declares a sync mode for every settings store, in bag order", () => {
    expect(Object.keys(SYNC_MODE)).toEqual(Object.keys(createSettingsStores()));
  });

  it("includes every broadcast store in the reload set", () => {
    const stores = createSettingsStores();
    const reloadStores = reloadSyncStores(stores);

    for (const store of broadcastSyncStores(stores)) {
      expect(reloadStores).toContain(store);
    }
  });

  it("broadcasts gaze and camera settings", () => {
    const stores = createSettingsStores();
    const broadcastStores = broadcastSyncStores(stores);

    expect(broadcastStores).toContain(stores.gazeSettings);
    expect(broadcastStores).toContain(stores.cameraSettings);
  });

  it("keeps STT intent and the first-run hint window-local", () => {
    const stores = createSettingsStores();
    const reloadStores = reloadSyncStores(stores);
    const broadcastStores = broadcastSyncStores(stores);

    expect(reloadStores).not.toContain(stores.sttSettings);
    expect(reloadStores).not.toContain(stores.hintSettings);
    expect(broadcastStores).not.toContain(stores.sttSettings);
    expect(broadcastStores).not.toContain(stores.hintSettings);
  });

  it("returns stores with the required sync interfaces", () => {
    const stores = createSettingsStores();

    for (const store of reloadSyncStores(stores)) {
      expect(typeof store.reloadFromStorage).toBe("function");
    }
    for (const store of broadcastSyncStores(stores)) {
      expect(typeof store.reloadFromStorage).toBe("function");
      expect(typeof store.subscribe).toBe("function");
    }
  });
});
