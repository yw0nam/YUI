import { afterEach, beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";
import "../../styles.css";
import "./settings-window.css";
import { setLocale } from "../i18n";
import { createQuickControls } from "./quick-controls";
import { defaultQcArgs } from "./test-helpers";

let qc: ReturnType<typeof createQuickControls> | undefined;

beforeEach(() => {
  setLocale("en");
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
});

afterEach(() => {
  qc?.dispose();
  qc = undefined;
});

it("drops the rail to icons at the 507px panel of the minimum settings window", async () => {
  qc = createQuickControls(defaultQcArgs(document.querySelector<HTMLElement>("#app")!));
  qc.open({ page: "react" });
  await page.viewport(507, 680);
  expect(document.querySelector<HTMLElement>(".yui-rail")!.getBoundingClientRect().width).toBe(48);
  expect(getComputedStyle(document.querySelector(".yui-search__input")!).display).toBe("none");
});
