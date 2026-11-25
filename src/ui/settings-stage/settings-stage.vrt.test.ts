// The stage beside the panel, measured with the real stylesheets in WebKit at the settings window's sizes.
import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../../styles.css";
import "../quick-controls/settings-window.css";
import { createEndpointsSettings } from "../../settings/backend/endpoints-settings";
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

/** Mounts the stage beside a panel at the current viewport; returns the app, stage and panel. */
async function mount() {
  const app = document.querySelector<HTMLElement>("#app")!;
  stage = createSettingsStage({
    mount: app,
    presetRegistry: createPresetRegistry(),
    petWindows: createPetWindows(),
    endpointsSettings: createEndpointsSettings(),
    boundId: null,
    getDefaultChatApi: () => undefined,
    onSettingsChanged: () => () => {},
  });
  const panel = app.appendChild(document.createElement("div"));
  panel.className = "yui-settings-panel";
  await expect.poll(() => app.querySelector(".yui-settings-stage__name")?.textContent).toBe(NAME);
  return { app, column: app.querySelector<HTMLElement>(".yui-settings-stage")!, panel };
}

/** The stage column's width, its slot's height and the panel's width. */
const measure = (column: HTMLElement, panel: HTMLElement): number[] => [
  column.getBoundingClientRect().width,
  Number.parseFloat(getComputedStyle(column).paddingTop),
  panel.getBoundingClientRect().width,
];

it("keeps a 373 x 560 slot and a 507px panel at the 880 x 640 minimum, the long name ellipsized on one line with the state", async () => {
  const { app, column, panel } = await mount();

  const name = app.querySelector<HTMLElement>(".yui-settings-stage__name")!;
  const meta = app.querySelector<HTMLElement>(".yui-settings-stage__meta")!;
  expect(measure(column, panel)).toEqual([373, 560, 507]);
  expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
  expect(meta.getBoundingClientRect().top).toBeLessThan(name.getBoundingClientRect().bottom);
});

it.each([
  // The default window keeps the 400 x 600 slot.
  [1160, 680, [400, 600, 760]],
  // Tall enough for more than 900: the cap.
  [1160, 1020, [600, 900, 560]],
  // The panel's 480px bounds the slot's width before the foot bounds its height.
  [880, 680, [400, 600, 480]],
])("follows a resize to %d x %d with the largest 2:3 slot that fits, the panel at least 480px", async (width, height, sizes) => {
  const { column, panel } = await mount();

  await page.viewport(width, height);

  await expect.poll(() => measure(column, panel)).toEqual(sizes);
});
