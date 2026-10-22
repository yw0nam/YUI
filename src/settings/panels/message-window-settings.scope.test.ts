// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import {
  createMessageWindowSettings,
  localStorageMessageWindowStorage,
} from "./message-window-settings";

afterEach(() => {
  localStorage.clear();
  history.replaceState(null, "", "/");
});
it("keeps main on the released global key while bound windows use independent keys", () => {
  localStorage.setItem(
    "yui.presets",
    JSON.stringify({
      active: "a",
      list: [
        { id: "default", name: "Default" },
        { id: "a", name: "A" },
      ],
    }),
  );
  const main = createMessageWindowSettings({ storage: localStorageMessageWindowStorage() });
  main.setMode("popped");
  history.replaceState(null, "", "/?preset=b");
  const bound = createMessageWindowSettings({ storage: localStorageMessageWindowStorage() });
  bound.setPosition(12, 34);
  expect(JSON.parse(localStorage.getItem("yui.message-window")!)).toEqual({
    mode: "popped",
    x: null,
    y: null,
  });
  expect(JSON.parse(localStorage.getItem("yui.b.message-window")!)).toEqual({
    mode: "docked",
    x: 12,
    y: 34,
  });
  expect(localStorage.getItem("yui.a.message-window")).toBeNull();
  main.dispose();
  bound.dispose();
});

it.each([
  ["/?preset=a&edit=b", "yui.b.message-window"],
  ["/?preset=a", "yui.a.message-window"],
])("stores the message window of %s under %s", (url, key) => {
  history.replaceState(null, "", url);
  const store = createMessageWindowSettings({ storage: localStorageMessageWindowStorage() });
  store.setPosition(1, 2);
  expect(Object.keys(localStorage)).toEqual([key]);
  store.dispose();
});
