/**
 * import-card-preset.test.ts — creating a preset from an imported card.
 *
 * Pins src/settings/preset/import-card-preset.ts: name suffixing, the card merged into
 * the copied yui.agent with the send switch on, the thumbnail retained onto the entry,
 * the pending greeting, activation, and the cleanup that leaves no orphan preset or
 * thumbnail. The registry is a fake and storage is in-memory.
 */

import { describe, expect, it, vi } from "vitest";
import { readCard } from "../../config/validators/persona/read-card";
import type { Card } from "../../config/validators/persona/types";
import { createPresetFromCard } from "./import-card-preset";
import { resolveStorageKey } from "./preset-keys";

/** A card whose extensions.yui holds the given keys; `other_ext` stands for every other extension. */
const fillerCard = (yui: Record<string, unknown>): Card =>
  readCard({
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: { name: "Mio", extensions: { ...yui, other_ext: { kept: true } } },
  }).card;

/** The filler value registry.create copies onto the new preset before the import runs. */
const copiedFiller = { enabled: true, language: "en", customPools: { en: { first: ["hi"] } } };

function seedFiller(storage: Storage, id: string): void {
  storage.setItem(resolveStorageKey("yui.filler", id), JSON.stringify(copiedFiller));
}

/** A card as a V3 import produces it: V3-only extras under extensions.chara_card_v3. */
const v3Card = (): Card =>
  readCard({
    spec: "chara_card_v3",
    spec_version: "3.0",
    data: {
      name: "Mio",
      description: "desc",
      creator: "someone",
      tags: ["a", "b"],
      nickname: "Mii",
      group_only_greetings: [],
    },
  }).card;

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  } as Storage;
}

function fakeRegistry(
  seed: Array<{ id: string; name: string; thumbnail?: string }> = [],
  ids: string[] = [],
): {
  registry: {
    create(name: string): string | null;
    setThumbnail(id: string, url: string | undefined): boolean;
    activate(id: string): boolean;
    remove(id: string): boolean;
  };
  list: Array<{ id: string; name: string; thumbnail?: string }>;
  removed: string[];
  activated: string[];
} {
  const list = seed.map((entry) => ({ ...entry }));
  const removed: string[] = [];
  const activated: string[] = [];
  let next = 0;
  return {
    registry: {
      create(name: string): string | null {
        const trimmed = name.trim();
        if (!trimmed || list.some((e) => e.name === trimmed)) return null;
        const id = ids[next] ?? `id${next + 1}`;
        next += 1;
        list.push({ id, name: trimmed });
        return id;
      },
      setThumbnail: vi.fn((id: string, url: string | undefined): boolean => {
        const entry = list.find((e) => e.id === id);
        if (!entry) return false;
        if (url === undefined) delete entry.thumbnail;
        else entry.thumbnail = url;
        return true;
      }),
      activate: vi.fn((id: string): boolean => {
        if (!list.some((e) => e.id === id)) return false;
        activated.push(id);
        return true;
      }),
      remove: vi.fn((id: string): boolean => {
        const at = list.findIndex((e) => e.id === id);
        if (at === -1) return false;
        removed.push(id);
        list.splice(at, 1);
        return true;
      }),
    },
    list,
    removed,
    activated,
  };
}

describe("createPresetFromCard", () => {
  it("suffixes the name past an existing name 2", async () => {
    const { registry, list } = fakeRegistry(
      [
        { id: "default", name: "default" },
        { id: "a1", name: "Mio" },
        { id: "a2", name: "Mio 2" },
      ],
      ["n1", "n2", "n3"],
    );
    const id = await createPresetFromCard({ registry, card: v3Card(), storage: memoryStorage() });
    expect(id).toBe("n1");
    expect(list.at(-1)).toEqual({ id: "n1", name: "Mio 3" });
  });

  it("merges the card into the copied agent value with the send switch on", async () => {
    const { registry } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    const storage = memoryStorage();
    storage.setItem(
      resolveStorageKey("yui.agent", "n1"),
      JSON.stringify({ reasoning_effort: "low", send_card: true, card: null }),
    );
    const id = await createPresetFromCard({ registry, card: v3Card(), storage });
    const agent = JSON.parse(storage.getItem(resolveStorageKey("yui.agent", id))!);
    expect(agent.reasoning_effort).toBe("low");
    expect(agent.send_card).toBe(true);
    expect(agent.card).toEqual(v3Card());
  });

  it("writes the pending greeting and activates the new preset", async () => {
    const { registry, activated } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    const storage = memoryStorage();
    const id = await createPresetFromCard({ registry, card: v3Card(), storage });
    expect(storage.getItem(resolveStorageKey("yui.greeting-pending", id))).toBe("1");
    expect(activated).toEqual([id]);
  });

  it("stores the retained thumbnail URL on the new entry", async () => {
    const { registry, list } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    const retainThumbnail = vi.fn(async () => "asset://localhost/app-data/cards/n1.png");
    const id = await createPresetFromCard({
      registry,
      card: v3Card(),
      retainThumbnail,
      storage: memoryStorage(),
    });
    expect(retainThumbnail).toHaveBeenCalledWith(id);
    expect(list.find((e) => e.id === id)?.thumbnail).toBe(
      "asset://localhost/app-data/cards/n1.png",
    );
  });

  it("a failing retention removes the preset and discards the thumbnail", async () => {
    const { registry, removed } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    const discardThumbnail = vi.fn(async () => {});
    await expect(
      createPresetFromCard({
        registry,
        card: v3Card(),
        storage: memoryStorage(),
        retainThumbnail: vi.fn(async () => {
          throw new Error("thumbnail retain failed");
        }),
        discardThumbnail,
      }),
    ).rejects.toThrow("thumbnail retain failed");
    expect(removed).toEqual(["n1"]);
    expect(discardThumbnail).toHaveBeenCalledWith("n1");
  });

  it("a failing thumbnail discard keeps the original error", async () => {
    const { registry } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    await expect(
      createPresetFromCard({
        registry,
        card: v3Card(),
        storage: memoryStorage(),
        retainThumbnail: vi.fn(async () => {
          throw new Error("thumbnail retain failed");
        }),
        discardThumbnail: vi.fn(async () => {
          throw new Error("thumbnail discard failed");
        }),
      }),
    ).rejects.toThrow("thumbnail retain failed");
  });

  it("imports the card's filler pools into the new preset's filler value", async () => {
    const { registry } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    const storage = memoryStorage();
    seedFiller(storage, "n1");
    const card = fillerCard({ yui: { filler: { ja: { first: ["A"] } }, keep: "x" } });
    const id = await createPresetFromCard({ registry, card, storage, fillerLocale: "ko" });
    expect(JSON.parse(storage.getItem(resolveStorageKey("yui.filler", id))!)).toEqual({
      enabled: true,
      language: "en",
      customPools: { ja: { first: ["A"] } },
    });
    const agentCard = JSON.parse(storage.getItem(resolveStorageKey("yui.agent", id))!).card;
    expect(agentCard.extensions).toEqual({ yui: { keep: "x" }, other_ext: { kept: true } });
  });

  it("removes extensions.yui from the stored card when the filler was its only key", async () => {
    const { registry } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    const storage = memoryStorage();
    seedFiller(storage, "n1");
    const card = fillerCard({ yui: { filler: { ja: { first: ["A"] } } } });
    const id = await createPresetFromCard({ registry, card, storage });
    const agentCard = JSON.parse(storage.getItem(resolveStorageKey("yui.agent", id))!).card;
    expect(agentCard.extensions).toEqual({ other_ext: { kept: true } });
  });

  it("a failing filler write rolls the preset back and rethrows", async () => {
    const { registry, removed } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    const storage = memoryStorage();
    seedFiller(storage, "n1");
    const raw = storage.setItem.bind(storage);
    vi.spyOn(storage, "setItem").mockImplementation((key, value) => {
      if (key === resolveStorageKey("yui.filler", "n1")) throw new Error("quota");
      raw(key, value);
    });
    await expect(
      createPresetFromCard({
        registry,
        card: fillerCard({ yui: { filler: { ja: { first: ["A"] } } } }),
        storage,
      }),
    ).rejects.toThrow("quota");
    expect(removed).toEqual(["n1"]);
  });

  it("a card without extensions.yui keeps the copied pools", async () => {
    const { registry } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    const storage = memoryStorage();
    seedFiller(storage, "n1");
    const id = await createPresetFromCard({ registry, card: v3Card(), storage });
    expect(JSON.parse(storage.getItem(resolveStorageKey("yui.filler", id))!)).toEqual(copiedFiller);
  });

  it("an invalid filler keeps the copied pools and logs card_import_filler_invalid", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { registry } = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    const storage = memoryStorage();
    seedFiller(storage, "n1");
    const card = fillerCard({ yui: { filler: { ja: { first: 42 } } } });
    const id = await createPresetFromCard({ registry, card, storage });
    expect(JSON.parse(storage.getItem(resolveStorageKey("yui.filler", id))!)).toEqual(copiedFiller);
    expect(
      warn.mock.calls.filter((c) => String(c[0]).includes("card_import_filler_invalid")),
    ).toHaveLength(1);
  });

  it("a refused thumbnail entry removes the preset and discards the thumbnail", async () => {
    const fake = fakeRegistry([{ id: "default", name: "default" }], ["n1"]);
    vi.mocked(fake.registry.setThumbnail).mockReturnValue(false);
    const discardThumbnail = vi.fn(async () => {});
    await expect(
      createPresetFromCard({
        registry: fake.registry,
        card: v3Card(),
        storage: memoryStorage(),
        retainThumbnail: vi.fn(async () => "asset://localhost/app-data/cards/n1.png"),
        discardThumbnail,
      }),
    ).rejects.toThrow("preset_create_failed");
    expect(fake.removed).toEqual(["n1"]);
    expect(discardThumbnail).toHaveBeenCalledWith("n1");
  });
});
