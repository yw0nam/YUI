/** selection-rows.test.ts — character.body and character.voice are per-character direct rows over the io selections. */

import { describe, expect, it, vi } from "vitest";
import { createSettingsStores } from "../../../../settings/settings-stores";
import { type SelectionPort, selectionRows } from "./selection-rows";
import { createSettingsApi, type RequestSettings } from "./settings-api";

function fakeSelection(active: string, ids: string[]): SelectionPort {
  let current = active;
  return {
    list: () => ids.map((id) => ({ id })),
    getActiveId: () => current,
    select: vi.fn((id: string) => {
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

  it("writes a listed id through the selection's own setter", async () => {
    const { settings, vrm, speaker } = harness();
    const signal = new AbortController().signal;

    expect(
      await settings.write({ character: { body: "kei", voice: "airy" } }, undefined, signal),
    ).toEqual({ "character.body": "ok", "character.voice": "ok" });
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
    expect(vrm.select).not.toHaveBeenCalled();
  });
});
