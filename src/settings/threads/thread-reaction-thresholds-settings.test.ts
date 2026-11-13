import { expect, it } from "vitest";
import {
  createThreadReactionThresholdsSettings,
  type ThreadReactionThresholdsSettings,
} from "./thread-reaction-thresholds-settings";

it("keeps each stored field in its list, defaults the other, and persists a set count", () => {
  let saved: unknown = null;
  const storage = {
    load: () => saved as ThreadReactionThresholdsSettings,
    save: (value: ThreadReactionThresholdsSettings) => {
      saved = value;
    },
  };
  saved = { count: 5, wait_min: 7 };
  const store = createThreadReactionThresholdsSettings({ storage });
  expect(store.get()).toEqual({ count: 5, wait_min: 10 });
  store.setCount(2);
  expect(saved).toEqual({ count: 2, wait_min: 10 });
});
