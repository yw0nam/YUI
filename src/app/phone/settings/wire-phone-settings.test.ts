// @vitest-environment jsdom
/**
 * wire-phone-settings.test.ts — the phone settings wiring's lifecycle: disposing it lands typed
 * input and releases the push-state subscription; the bundled config fills the placeholders.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EndpointsConfig } from "../../../contract";
import { createVrmSelection } from "../../../io/assets/vrm-selection";
import type { PushSocket } from "../../../io/chat/push-socket";
import {
  CAMERA_AZIMUTH_DEFAULT,
  CAMERA_POLAR_DEFAULT,
} from "../../../renderer/geometry/camera-fit";
import { CAMERA_ZOOM_DEFAULT } from "../../../settings/avatar/camera-settings";
import { createSettingsStores } from "../../../settings/settings-stores";
import { setLocale } from "../../../ui/i18n";
import { createConversationStores } from "../../settings/conversation-stores";
import { createPhoneSettings } from "./wire-phone-settings";

describe("createPhoneSettings", () => {
  beforeEach(() => {
    setLocale("en");
    try {
      globalThis.localStorage?.clear();
    } catch {
      /* Ignore environments without localStorage */
    }
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  const ENDPOINTS: EndpointsConfig = {
    chat_base_url: "",
    stt_base_url: "",
    tts_base_url: "",
    chat_api: "push",
  };

  function setup(config: Parameters<typeof createPhoneSettings>[0]["config"]) {
    const stores = createSettingsStores();
    const unsubscribeState = vi.fn();
    const pushSocket = {
      getState: () => ({ kind: "offline" }),
      onState: () => unsubscribeState,
      sendReset: () => true,
      reconnectNow: () => {},
    } as unknown as PushSocket;
    const mount = document.createElement("div");
    document.body.append(mount);
    const vrmSelection = createVrmSelection({
      available: [{ id: "shino", label: "Shino", url: "/vrms/shino.vrm", source: "bundled" }],
      defaultValue: "/vrms/shino.vrm",
    });
    const phoneSettings = createPhoneSettings({
      mount,
      stores,
      vrm: { vrmSelection, swapVrm: async () => {}, importVrm: async () => {} },
      removeUserVrm: async () => {},
      conversation: createConversationStores(),
      pushSocket,
      stopTurn: () => {},
      getEndpoints: () => ENDPOINTS,
      config,
    });
    return { stores, unsubscribeState, mount, phoneSettings, vrmSelection };
  }

  it("dispose commits dirty input and removes the push-state subscription", () => {
    const { stores, unsubscribeState, mount, phoneSettings } = setup({
      get() {
        throw new Error("config not loaded");
      },
    });
    phoneSettings.open("conn");
    // Typed but never blurred — only a commit on dispose lands it.
    const sttUrl = mount.querySelector<HTMLInputElement>("#yui-ep-stt_base_url")!;
    sttUrl.value = "http://stt.test/v1";
    sttUrl.dispatchEvent(new Event("input", { bubbles: true }));

    phoneSettings.dispose();

    expect(stores.endpointsSettings.get().stt_base_url).toBe("http://stt.test/v1");
    expect(unsubscribeState).toHaveBeenCalledTimes(1);
    expect(mount.querySelector(".yui-phone-settings")).toBeNull();
  });

  it("fills the endpoint placeholders from the bundled config", () => {
    const { mount, phoneSettings } = setup({
      get: () => ({ endpoints: { ...ENDPOINTS, stt_base_url: "http://bundled.test/v1" } }),
    });
    phoneSettings.open("conn");
    expect(mount.querySelector<HTMLInputElement>("#yui-ep-stt_base_url")!.placeholder).toBe(
      "http://bundled.test/v1",
    );
    phoneSettings.dispose();
  });

  it("the Character tab lists the VRMs and its reset button resets the camera view", () => {
    const { stores, mount, phoneSettings, vrmSelection } = setup({
      get() {
        throw new Error("config not loaded");
      },
    });
    stores.cameraSettings.setZoom(2);
    stores.cameraSettings.setAzimuth(1);
    stores.cameraSettings.setPolar(1);
    phoneSettings.open("char");

    const ids = Array.from(mount.querySelectorAll<HTMLElement>(".yui-vrm[data-vrm-id]")).map(
      (r) => r.dataset.vrmId,
    );
    expect(ids).toEqual(vrmSelection.list().map((o) => o.id));
    mount.querySelector<HTMLButtonElement>(".yui-viewpoint-reset")!.click();

    expect(stores.cameraSettings.get().zoom).toBe(CAMERA_ZOOM_DEFAULT);
    expect(stores.cameraSettings.get().azimuth).toBe(CAMERA_AZIMUTH_DEFAULT);
    expect(stores.cameraSettings.get().polar).toBe(CAMERA_POLAR_DEFAULT);
    phoneSettings.dispose();
  });
});
