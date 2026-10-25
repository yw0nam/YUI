/**
 * card-thumbnail.test.ts — the thumbnail file steps.
 *
 * Pins src/io/assets/card/card-thumbnail.ts: the retain and remove calls over the Rust
 * commands, and the convertFileSrc URL a retained thumbnail hands back.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardThumbnailDeps } from "./card-thumbnail";
import { pickPresetPhoto, removeCardThumbnail, retainCardThumbnail } from "./card-thumbnail";

function makeDeps(over: Partial<CardThumbnailDeps> = {}): CardThumbnailDeps {
  return {
    invoke: vi.fn(
      async () => "/app-data/cards/abcd1234.png",
    ) as unknown as CardThumbnailDeps["invoke"],
    convertFileSrc: vi.fn((path: string) => `asset://localhost${path}`),
    ...over,
  };
}

describe("retainCardThumbnail", () => {
  it("renames the temp copy to the preset id and returns its file URL", async () => {
    const deps = makeDeps();
    const url = await retainCardThumbnail("mio-1a2b3c", "abcd1234", deps);
    expect(deps.invoke).toHaveBeenCalledWith("retain_card_thumbnail", {
      tempId: "mio-1a2b3c",
      presetId: "abcd1234",
    });
    expect(url).toBe("asset://localhost/app-data/cards/abcd1234.png");
  });
});

describe("removeCardThumbnail", () => {
  it("removes through the remove command", async () => {
    const deps = makeDeps();
    await removeCardThumbnail("mio-1a2b3c", deps);
    expect(deps.invoke).toHaveBeenCalledWith("remove_card_thumbnail", {
      id: "mio-1a2b3c",
    });
  });
});

describe("pickPresetPhoto", () => {
  afterEach(() => vi.useRealTimers());

  it("asks the picker for the preset and returns a file URL that changes with each pick", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const deps = makeDeps();

    const url = await pickPresetPhoto("abcd1234", deps);

    expect(deps.invoke).toHaveBeenCalledWith("pick_preset_photo", { presetId: "abcd1234" });
    expect(url).toBe("asset://localhost/app-data/cards/abcd1234.png?v=1000");
  });

  it("returns null when the picker is dismissed", async () => {
    const deps = makeDeps({
      invoke: vi.fn(async () => null) as unknown as CardThumbnailDeps["invoke"],
    });

    expect(await pickPresetPhoto("abcd1234", deps)).toBeNull();
    expect(deps.convertFileSrc).not.toHaveBeenCalled();
  });
});
