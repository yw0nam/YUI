/** info-api.test.ts — yui.info lists the bodies, voices and monitors a setting can name. */

import { expect, it } from "vitest";
import { createInfoApi } from "./info-api";

it("lists bodies and voices by id and label, and monitors by index and name", async () => {
  const info = createInfoApi({
    bodies: () => [{ id: "yui", label: "Yui" }, { id: "kei" }],
    voices: () => [{ id: "v1", label: "Soft" }],
    monitors: async () => [
      { index: 0, label: "Built-in", width: 1512, height: 982, primary: true },
      { index: 1, label: "Display 2", width: 1920, height: 1080, primary: false },
    ],
  });

  expect(await info()).toEqual({
    bodies: [
      { id: "yui", label: "Yui" },
      { id: "kei", label: "kei" },
    ],
    voices: [{ id: "v1", label: "Soft" }],
    monitors: [
      { index: 0, name: "Built-in", width: 1512, height: 982 },
      { index: 1, name: "Display 2", width: 1920, height: 1080 },
    ],
  });
});
