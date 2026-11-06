import { expect, it } from "vitest";
import { createThreadTurnsSettings, type ThreadTurnsSettings } from "./thread-turns-settings";

it("defaults to off, falls back on an invalid stored level, and persists a set level", () => {
  let saved: unknown = null;
  const storage = {
    load: () => saved as ThreadTurnsSettings,
    save: (value: ThreadTurnsSettings) => {
      saved = value;
    },
  };
  expect(createThreadTurnsSettings({ storage }).get()).toEqual({ level: "off" });
  saved = { level: "loud" };
  const store = createThreadTurnsSettings({ storage });
  expect(store.get()).toEqual({ level: "off" });
  store.setLevel("notable");
  expect(saved).toEqual({ level: "notable" });
  expect(createThreadTurnsSettings({ storage }).get()).toEqual({ level: "notable" });
});
