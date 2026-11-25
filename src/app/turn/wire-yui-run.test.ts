/** wire-yui-run.test.ts — a yui_run body write loads through the character menu's swap. */

import { describe, expect, it, vi } from "vitest";
import { selectionRows } from "../../io/chat/tools/run/selection-rows";
import { createSettingsApi } from "../../io/chat/tools/run/settings-api";
import { createSettingsStores } from "../../settings/settings-stores";
import { selectionPort } from "./wire-yui-run";

describe("selectionPort", () => {
  it("a body write reaches swapVrm with the found option", async () => {
    const swapVrm = vi.fn(async () => {});
    const vrm = selectionPort(
      {
        list: () => [
          { id: "yui", url: "/vrms/a.vrm" },
          { id: "kei", url: "/vrms/b.vrm" },
        ],
        getActiveId: () => "yui",
      },
      swapVrm,
    );
    const speaker = selectionPort(
      { list: () => [{ id: "soft" }], getActiveId: () => "soft" },
      vi.fn(async () => {}),
    );
    const settings = createSettingsApi({
      stores: createSettingsStores(),
      request: async () => "allow",
      rows: selectionRows({ vrm, speaker }),
    });

    expect(
      await settings.write({ character: { body: "kei" } }, undefined, new AbortController().signal),
    ).toEqual({ "character.body": "ok" });
    expect(swapVrm).toHaveBeenCalledWith({ id: "kei", url: "/vrms/b.vrm" });
  });
});
