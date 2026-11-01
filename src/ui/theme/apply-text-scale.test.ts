// @vitest-environment jsdom
import { expect, it } from "vitest";
import { createTextSizeSettings } from "../../settings/appearance/text-size-settings";
import { applyTextScale } from "./apply-text-scale";

it("sets --yui-text-scale on the root and follows the store until disposed", () => {
  const store = createTextSizeSettings();
  store.setScale(1.25);
  const root = document.createElement("div");

  const dispose = applyTextScale({ store, root });
  expect(root.style.getPropertyValue("--yui-text-scale")).toBe("1.25");

  store.setScale(0.9);
  expect(root.style.getPropertyValue("--yui-text-scale")).toBe("0.9");

  dispose();
  store.setScale(1.4);
  expect(root.style.getPropertyValue("--yui-text-scale")).toBe("0.9");
  store.dispose();
});
