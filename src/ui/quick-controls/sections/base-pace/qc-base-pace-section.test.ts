// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { createBasePaceSettings } from "../../../../settings/active-hours/base-pace-settings";
import { setLocale } from "../../../i18n";
import { createQuickControls } from "../../quick-controls";
import { defaultQcArgs } from "../../test-helpers";

beforeEach(() => {
  setLocale("en");
});

afterEach(() => {
  document.body.innerHTML = "";
});

function build() {
  const mount = document.body.appendChild(document.createElement("div"));
  const basePaceSettings = createBasePaceSettings();
  const qc = createQuickControls({ ...defaultQcArgs(mount), basePaceSettings });
  qc.open({ tab: "react" });
  const cell = (label: string) =>
    [
      ...qc.el.querySelectorAll<HTMLButtonElement>(
        '#yui-panel-react [aria-label="How often she speaks up"] .yui-seg__btn',
      ),
    ].find((b) => b.textContent === label);
  return { qc, basePaceSettings, cell };
}

it("shows Normal selected and writes the high pace when More is clicked", () => {
  const { qc, basePaceSettings, cell } = build();

  expect(cell("Normal")?.getAttribute("aria-checked")).toBe("true");
  cell("More")?.click();

  expect(basePaceSettings.get()).toEqual({ pace: "high" });
  expect(cell("More")?.getAttribute("aria-checked")).toBe("true");
  qc.dispose();
});

it("opens the Persona page from the Active hours link", () => {
  const { qc } = build();
  const link = [...qc.el.querySelectorAll<HTMLButtonElement>("#yui-panel-react button")].find(
    (b) => b.textContent === "Persona › Active hours",
  );

  link?.click();

  expect(qc.selectedTab()).toBe("persona");
  qc.dispose();
});
