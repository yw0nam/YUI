// The stage beside the panel, measured with the real stylesheets in WebKit at the window's minimum.
import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../../styles.css";
import "../quick-controls/settings-window.css";
import { createPetWindows } from "../../settings/preset/pet-windows";
import { createPresetRegistry } from "../../settings/preset/preset-registry";
import { setLocale } from "../i18n";
import { createSettingsStage } from "./settings-stage";

const NAME = "Yui of the very long character name that cannot fit";
let stage: { dispose(): void } | undefined;

beforeEach(async () => {
  setLocale("en");
  localStorage.setItem(
    "yui.presets",
    JSON.stringify({ active: "default", list: [{ id: "default", name: NAME }] }),
  );
  document.body.innerHTML = '<div id="app"></div>';
  await page.viewport(880, 640);
});

afterEach(() => {
  stage?.dispose();
  stage = undefined;
  localStorage.clear();
});

it("keeps the stage 400px and the panel 480px at the 880 x 640 minimum, the long name ellipsized on one line with the state", async () => {
  const app = document.querySelector<HTMLElement>("#app")!;
  stage = createSettingsStage({
    mount: app,
    presetRegistry: createPresetRegistry(),
    petWindows: createPetWindows(),
    boundId: null,
    getDefaultChatApi: () => undefined,
    onSettingsChanged: () => () => {},
  });
  const panel = app.appendChild(document.createElement("div"));
  panel.className = "yui-settings-panel";
  await expect.poll(() => app.querySelector(".yui-settings-stage__name")?.textContent).toBe(NAME);

  const name = app.querySelector<HTMLElement>(".yui-settings-stage__name")!;
  const meta = app.querySelector<HTMLElement>(".yui-settings-stage__meta")!;
  expect(app.querySelector(".yui-settings-stage")!.getBoundingClientRect().width).toBe(400);
  expect(panel.getBoundingClientRect().width).toBe(480);
  expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
  expect(meta.getBoundingClientRect().top).toBeLessThan(name.getBoundingClientRect().bottom);
});
