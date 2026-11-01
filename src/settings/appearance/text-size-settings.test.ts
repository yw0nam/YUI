import { expect, it } from "vitest";
import { createTextSizeSettings, type TextSizeSettings } from "./text-size-settings";

it("loads, persists and validates the text size", () => {
  let saved: unknown = { scale: 1.25 };
  const storage = {
    load: () => saved as TextSizeSettings,
    save: (value: TextSizeSettings) => {
      saved = value;
    },
  };
  const store = createTextSizeSettings({ storage });
  expect(store.get()).toEqual({ scale: 1.25 });
  store.setScale(1.4);
  expect(saved).toEqual({ scale: 1.4 });
  expect(createTextSizeSettings({ storage }).get()).toEqual({ scale: 1.4 });
  saved = { scale: 1.3 };
  expect(createTextSizeSettings({ storage }).get()).toEqual({ scale: 1 });
});

it("defaults to 100%", () => {
  expect(createTextSizeSettings({ storage: { load: () => null, save: () => {} } }).get()).toEqual({
    scale: 1,
  });
});
