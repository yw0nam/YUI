import { beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../../styles.css";
import "./settings-window.css";
import { setLocale } from "../i18n";
import { createQuickControls } from "./quick-controls";
import { defaultQcArgs } from "./test-helpers";

beforeEach(() => {
  setLocale("en");
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
});

it.each(["dawn", "hearth"] as const)("paints the General settings page in %s", async (theme) => {
  const qc = createQuickControls(defaultQcArgs(document.querySelector<HTMLElement>("#app")!));
  qc.open({ page: "general" });
  await page.viewport(760, 680);
  await document.fonts.ready;
  document.documentElement.dataset.theme = theme;
  await expect
    .element(page.elementLocator(document.querySelector("#app")!))
    .toMatchScreenshot(`settings-general-${theme}`);
  qc.dispose();
});
