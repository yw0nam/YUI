/** state-api.test.ts — yui.state reports times as ISO 8601 with the local offset, who is open, and the screen-recording permission. */

const previousTz = process.env.TZ;
process.env.TZ = "Asia/Seoul";

import { afterAll, describe, expect, it } from "vitest";
import { createStateApi } from "./state-api";

afterAll(() => {
  process.env.TZ = previousTz;
});

const deps = {
  startedAt: async () => Date.UTC(2026, 10, 26, 0, 0, 0),
  lastTogether: () => Date.UTC(2026, 10, 25, 15, 30, 0) as number | null,
  presets: () => [
    { id: "default", name: "Yui" },
    { id: "mika", name: "Mika" },
    { id: "rei", name: "Rei" },
  ],
  openIds: () => ["default", "mika"],
  selfId: () => "mika",
  screenRecording: async () => "granted",
};

describe("createStateApi", () => {
  it("reports ISO times with the local offset, every character with who is open and who asks", async () => {
    expect(await createStateApi(deps)()).toEqual({
      running_since: "2026-11-26T09:00:00+09:00",
      last_together: "2026-11-26T00:30:00+09:00",
      characters: [
        { name: "Yui", open: true, me: false },
        { name: "Mika", open: true, me: true },
        { name: "Rei", open: false, me: false },
      ],
      permissions: { screen_recording: "granted" },
    });
  });

  it("reports no last presence as null and a permission it does not know as unknown", async () => {
    const state = await createStateApi({
      ...deps,
      lastTogether: () => null,
      screenRecording: async () => "restricted",
    })();

    expect(state.last_together).toBeNull();
    expect(state.permissions).toEqual({ screen_recording: "unknown" });
  });
});
