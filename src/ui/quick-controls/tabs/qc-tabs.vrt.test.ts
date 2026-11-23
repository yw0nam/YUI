// The rail, measured in WebKit with the real stylesheets and focus rules: a switch inside a panel's
// fade shows one panel, and an arrow key after a pointer click shows the next tab's tip.
import { afterEach, beforeEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import "../../../styles.css";
import "../settings-window.css";
import { createPresetRegistry } from "../../../settings/preset/preset-registry";
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

// The test frame marks an arrow-moved focus :focus-visible; the settings window does not (rung 1), so the
// focus the arrow lands is made the same way here.
it("a pointer click on a rail tab, then Down, shows the next tab's tip", async () => {
  qc = createQuickControls({
    ...defaultQcArgs(document.querySelector<HTMLElement>("#app")!),
    presetRegistry: createPresetRegistry(),
  });
  await userEvent.click(qc.el.querySelector<HTMLButtonElement>("#yui-tab-persona")!);
  const body = qc.el.querySelector<HTMLButtonElement>("#yui-tab-body")!;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
  body.focus({ focusVisible: false });
  expect(body.matches(":focus-visible")).toBe(false);

  await expect
    .poll(() => document.querySelector(".yui-hint-tip[data-open]")?.textContent, { timeout: 1000 })
    .toBe("Body");
});

it.each([
  ["Home", "yui-tab-conn", "Connection"],
  ["End", "yui-tab-general", "General"],
])("%s as the first focus-moving key after a pointer click shows the tip of the tab it reaches", async (key, id, tip) => {
  qc = createQuickControls({
    ...defaultQcArgs(document.querySelector<HTMLElement>("#app")!),
    presetRegistry: createPresetRegistry(),
  });
  await userEvent.click(qc.el.querySelector<HTMLButtonElement>("#yui-tab-react")!);
  document.dispatchEvent(new KeyboardEvent("keydown", { key }));
  qc.el.querySelector<HTMLButtonElement>(`#${id}`)!.focus({ focusVisible: false });

  await expect
    .poll(() => document.querySelector(".yui-hint-tip[data-open]")?.textContent, { timeout: 1000 })
    .toBe(tip);
});
