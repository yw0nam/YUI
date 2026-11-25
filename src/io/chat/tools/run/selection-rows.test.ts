/** selection-rows.test.ts — character.body and character.voice are per-character direct rows over the io selections. */

import { describe, expect, it, vi } from "vitest";
import { createSettingsStores } from "../../../../settings/settings-stores";
import { selectionRows } from "./selection-rows";
import { createSettingsApi, type RequestSettings } from "./settings-api";

function fakeSelection(active: string, ids: string[]) {
  let current = active;
  return {
    list: () => ids.map((id) => ({ id })),
    getActiveId: () => current,
    swap: vi.fn(async (id: string) => {
      current = id;
    }),
  };
}

function harness() {
  const vrm = fakeSelection("yui", ["yui", "kei"]);
  const speaker = fakeSelection("soft", ["soft", "airy"]);
  const request = vi.fn<RequestSettings>(async () => "allow");
  const settings = createSettingsApi({
    stores: createSettingsStores(),
    request,
    rows: selectionRows({ vrm, speaker }),
  });
  return { settings, vrm, speaker, request };
}

describe("selectionRows", () => {
  it("reads the two selections into the document's character group", () => {
    const { settings } = harness();

    expect(settings.read().character).toEqual({
      reasoning_effort: "default",
      active_hours: null,
      body: "yui",
      voice: "soft",
    });
  });

  it("loads a listed id through the selection's swap and answers ok", async () => {
    const { settings, vrm, speaker } = harness();
    const signal = new AbortController().signal;

    expect(
      await settings.write({ character: { body: "kei", voice: "airy" } }, undefined, signal),
    ).toEqual({ "character.body": "ok", "character.voice": "ok" });
    expect(vrm.swap).toHaveBeenCalledWith("kei");
    expect(speaker.swap).toHaveBeenCalledWith("airy");
    expect(vrm.getActiveId()).toBe("kei");
    expect(speaker.getActiveId()).toBe("airy");

    expect(await settings.write({ character: { body: "kei" } }, undefined, signal)).toEqual({
      "character.body": "ok",
    });
  });

  it("answers invalid for an id the selection does not list", async () => {
    const { settings, vrm } = harness();

    expect(
      await settings.write(
        { character: { body: "ghost" } },
        undefined,
        new AbortController().signal,
      ),
    ).toEqual({ "character.body": "error: invalid character.body" });
    expect(vrm.swap).not.toHaveBeenCalled();
  });

  it("answers failed to load and keeps the selection when the swap rejects", async () => {
    const { settings, speaker } = harness();
    speaker.swap.mockRejectedValueOnce(new Error("load failed"));

    expect(
      await settings.write(
        { character: { voice: "airy" } },
        undefined,
        new AbortController().signal,
      ),
    ).toEqual({ "character.voice": "error: character.voice failed to load" });
    expect(speaker.swap).toHaveBeenCalledWith("airy");
    expect(speaker.getActiveId()).toBe("soft");
  });
});
