// The rail's panels, measured with the real stylesheets in WebKit: a switch inside a panel's fade shows one panel.
import { afterEach, beforeEach, expect, it } from "vitest";
import "../../../styles.css";
import "../settings-window.css";
import { setLocale } from "../../i18n";
import { createQuickControls } from "../quick-controls";
import { defaultQcArgs } from "../test-helpers";

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

it("two rail switches within 200 ms leave exactly one panel shown", () => {
  qc = createQuickControls(defaultQcArgs(document.querySelector<HTMLElement>("#app")!));
  qc.el.querySelector<HTMLButtonElement>("#yui-tab-conn")!.click();
  qc.el.querySelector<HTMLButtonElement>("#yui-tab-voice")!.click();

  const shown = [...qc.el.querySelectorAll(".yui-tabpanel")]
    .filter((panel) => getComputedStyle(panel).display !== "none")
    .map((panel) => panel.id);
  expect(shown).toEqual(["yui-panel-voice"]);
});
