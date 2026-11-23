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

it("drops the rail to icons at the settings window's 480px minimum", async () => {
  const qc = createQuickControls(defaultQcArgs(document.querySelector<HTMLElement>("#app")!));
  qc.open({ page: "react" });
  await page.viewport(480, 680);
  const rail = document.querySelector<HTMLElement>(".yui-rail")!;
  expect(rail.getBoundingClientRect().width).toBe(48);
  qc.dispose();
});
