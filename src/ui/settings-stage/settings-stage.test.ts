// @vitest-environment jsdom
// The stage's foot re-reads its own character on each source a change can arrive through.
import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEndpointsSettings,
  localStorageEndpointsStorage,
} from "../../settings/backend/endpoints-settings";
import { createPetWindows } from "../../settings/preset/pet-windows";
import { createPresetRegistry } from "../../settings/preset/preset-registry";
import { setLocale } from "../i18n";
import { createSettingsStage } from "./settings-stage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settingsChanged = new Set<() => void>();
let stage: { dispose(): void } | undefined;

function mount() {
  const app = document.body.appendChild(document.createElement("div"));
  const presetRegistry = createPresetRegistry();
  const endpointsSettings = createEndpointsSettings({ storage: localStorageEndpointsStorage() });
  stage = createSettingsStage({
    mount: app,
    presetRegistry,
    petWindows: createPetWindows(),
    boundId: null,
    getDefaultChatApi: () => undefined,
    endpointsSettings,
    onSettingsChanged: (cb) => {
      settingsChanged.add(cb);
      return () => settingsChanged.delete(cb);
    },
  });
  const shown = () =>
    [".yui-settings-stage__name", ".yui-settings-stage__meta"].map(
      (s) => app.querySelector(s)?.textContent,
    );
  return { presetRegistry, endpointsSettings, shown };
}

describe("createSettingsStage", () => {
  beforeEach(() => {
    setLocale("en");
    localStorage.setItem(
      "yui.presets",
      JSON.stringify({
        active: "default",
        list: [
          { id: "default", name: "Yui" },
          { id: "b", name: "Mio" },
        ],
      }),
    );
  });

  afterEach(() => {
    act(() => stage?.dispose());
    stage = undefined;
    settingsChanged.clear();
    localStorage.clear();
    history.replaceState(null, "", "/");
    setLocale("en");
    document.body.innerHTML = "";
  });

  it("follows a rename of its character and a new language", () => {
    const { presetRegistry, shown } = mount();

    act(() => void presetRegistry.rename("default", "Yuna"));
    expect(shown()).toEqual(["Yuna", "Responses · In main"]);
    act(() => setLocale("ko"));

    expect(shown()).toEqual(["Yuna", "Responses · 메인"]);
  });

  it("re-reads its character's transport when this window switches the chat type", () => {
    const { endpointsSettings, shown } = mount();

    act(() => endpointsSettings.set({ chat_api: "push" }));

    expect(shown()).toEqual(["Yui", "Push · In main"]);
  });

  it.each([
    [
      "a storage event",
      () => window.dispatchEvent(new StorageEvent("storage", { key: "yui.endpoints" })),
    ],
    [
      "another window's settings change",
      () => {
        for (const cb of settingsChanged) cb();
      },
    ],
    ["the window's focus", () => window.dispatchEvent(new Event("focus"))],
  ])("re-reads its own character's transport on %s while the panel edits another", (_, signal) => {
    history.replaceState(null, "", "/settings.html?edit=b");
    const { shown } = mount();
    expect(shown()).toEqual(["Yui", "Responses · In main"]);

    localStorage.setItem("yui.endpoints", JSON.stringify({ chat_api: "push" }));
    act(signal);

    expect(shown()).toEqual(["Yui", "Push · In main"]);
  });
});
