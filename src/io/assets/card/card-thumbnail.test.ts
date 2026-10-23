/**
 * card-thumbnail.test.ts — the thumbnail file steps.
 *
 * Pins src/io/assets/card/card-thumbnail.ts: the retain and remove calls over the Rust
 * commands, and the convertFileSrc URL a retained thumbnail hands back.
 */

import { describe, expect, it, vi } from "vitest";
import type { CardThumbnailDeps } from "./card-thumbnail";
import { removeCardThumbnail, retainCardThumbnail } from "./card-thumbnail";

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
